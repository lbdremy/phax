// The gains the run and session commands need (command-contracts plan 4, phase-01), through
// `runner.run` over the memory Io, beyond their conformance cases: an option with an optional
// value, a command's retired options, an empty render, and a handed-over exit.
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  catalogue,
  defineCommand,
  defineProgram,
  flagShapes,
  OptionalValueAnnotationId,
  reject,
  strip,
  usageSpec,
  type Command,
} from "../../../../src/cli/commandLibrary/contract/index.js";
import { call } from "./support/memoryIo.js";

const programOf = (...commands: ReadonlyArray<Command<never>>) =>
  defineProgram({
    name: "phax",
    version: "1.0.0",
    exits: { refused: 64, defect: 70 },
    refusalHint: "Run `phax --help` for usage.",
    commands,
  });

const lines = (written: ReadonlyArray<string>): ReadonlyArray<unknown> =>
  written
    .join("")
    .split("\n")
    .filter((each) => each !== "")
    .map((each): unknown => JSON.parse(each));

const Hold = Schema.optionalKey(Schema.Union(Schema.Literal(true), Schema.String)).annotations({
  identifier: "selection",
  description: "Pause the run for review at the selected phases",
  [OptionalValueAnnotationId]: true,
});

function run() {
  const seen: unknown[] = [];
  const command = defineCommand({
    name: "run",
    summary: "Run a plan",
    input: {
      args: reject(Schema.Tuple(Schema.optionalElement(Schema.String))),
      flags: reject(Schema.Struct({ hold: Hold })),
    },
    output: strip(Schema.String),
    exits: {},
    run: ({ input }) =>
      Effect.sync(() => {
        seen.push(input.flags.hold);
        return "ran";
      }),
    render: (text) => text,
  });
  return { command, seen };
}

describe("an option with an optional value", () => {
  it.each([
    [["run", "--hold"], true],
    [["run", "--hold", "phase-02"], "phase-02"],
    [["run", "--hold=phase-02"], "phase-02"],
    [["run", "--hold", "--json"], true],
    [["run"], undefined],
  ] as const)("%j decodes the hold as %j", async (argv, hold) => {
    const ran = run();
    const called = await call(programOf(ran.command), { argv });
    expect(called.code).toBe(0);
    expect(ran.seen).toEqual([hold]);
  });

  it("reads as an optional value in its shape, help, catalogue and usage spec", async () => {
    const [shape] = flagShapes(Schema.Struct({ hold: Hold }));
    expect(shape?.valueOptional).toBe(true);
    expect(shape?.switch).toBe(false);
    const help = await call(programOf(run().command), { argv: ["run", "--help"] });
    expect(help.out.join("")).toContain("--hold [selection]");
    const entry = catalogue(programOf(run().command)).commands[0];
    expect(JSON.stringify(entry?.input)).toContain('"hold"');
    expect(usageSpec(programOf(run().command))).toContain(
      `flag "--hold [selection]" help="Pause the run for review at the selected phases"`,
    );
  });

  it("is no optional value without its annotation", () => {
    const [shape] = flagShapes(
      Schema.Struct({
        hold: Schema.optionalKey(Schema.Union(Schema.Literal(true), Schema.String)),
      }),
    );
    expect(shape?.valueOptional).toBe(false);
  });
});

const SKIP_ORACLE = "--skip-oracle is no longer read: write --skip-acceptance";

function resume() {
  const seen: unknown[] = [];
  const command = defineCommand({
    name: "resume",
    summary: "Resume a run",
    input: {
      args: reject(Schema.Tuple(Schema.String)),
      flags: reject(
        Schema.Struct({
          skipAcceptance: Schema.optionalKey(Schema.Boolean),
        }),
      ),
    },
    output: strip(Schema.String),
    exits: {},
    retiredOptions: { "skip-oracle": SKIP_ORACLE },
    run: ({ input }) =>
      Effect.sync(() => {
        seen.push(input);
        return "resumed";
      }),
    render: (text) => text,
  });
  return { command, seen };
}

describe("a retired option", () => {
  it("is refused with its sentence, then the hint, and 64, running nothing", async () => {
    const resumed = resume();
    const called = await call(programOf(resumed.command), {
      argv: ["resume", "x", "--skip-oracle"],
    });
    expect(called.code).toBe(64);
    expect(called.out).toEqual([]);
    expect(called.err.join("")).toBe(`${SKIP_ORACLE}\nRun \`phax --help\` for usage.\n`);
    expect(resumed.seen).toEqual([]);
  });

  it("is one refused line under --json, with 64", async () => {
    const resumed = resume();
    const called = await call(programOf(resumed.command), {
      argv: ["resume", "--json", "x", "--skip-oracle"],
    });
    expect(called.code).toBe(64);
    expect(called.out).toEqual([]);
    expect(lines(called.err)).toEqual([
      {
        kind: "refused",
        source: "flags",
        path: ["skip-oracle"],
        expected: "no such option",
        text: SKIP_ORACLE,
        exit: 64,
      },
    ]);
    expect(resumed.seen).toEqual([]);
  });

  it("is absent from help, the catalogue and the usage spec", async () => {
    const help = await call(programOf(resume().command), { argv: ["resume", "--help"] });
    expect(help.code).toBe(0);
    expect(help.out.join("")).not.toContain("skip-oracle");
    expect(JSON.stringify(catalogue(programOf(resume().command)))).not.toContain("skip-oracle");
    expect(usageSpec(programOf(resume().command))).not.toContain("skip-oracle");
  });

  it("stops the program when the command declares it too", async () => {
    const clashing = defineCommand({
      name: "resume",
      summary: "Resume a run",
      input: {
        flags: reject(Schema.Struct({ skipOracle: Schema.optionalKey(Schema.Boolean) })),
      },
      exits: {},
      retiredOptions: { "skip-oracle": SKIP_ORACLE },
      run: () => Effect.void,
    });
    const called = await call(programOf(clashing), { argv: ["resume"] });
    expect(called.code).toBe(70);
    expect(called.err.join("")).toContain("resume retires --skip-oracle");
  });
});

describe("an empty render", () => {
  const quiet = defineCommand({
    name: "quiet",
    summary: "Answers nothing on stdout",
    input: {},
    output: strip(Schema.Struct({ phaseCount: Schema.Number })),
    exits: {},
    run: () => Effect.succeed({ phaseCount: 3 }),
    render: () => "",
    notes: (value) => `run is already in review (${value.phaseCount} phases)`,
  });

  it("writes nothing on stdout while its notes reach stderr", async () => {
    const called = await call(programOf(quiet), { argv: ["quiet"] });
    expect(called.code).toBe(0);
    expect(called.out).toEqual([]);
    expect(called.err.join("")).toBe("run is already in review (3 phases)\n");
  });

  it("writes the encoded output under --json", async () => {
    const called = await call(programOf(quiet), { argv: ["quiet", "--json"] });
    expect(called.code).toBe(0);
    expect(JSON.parse(called.out.join(""))).toEqual({ phaseCount: 3 });
  });
});

function enter(code: number) {
  const seen: unknown[] = [];
  const command = defineCommand({
    name: "enter",
    summary: "Hand the terminal to a session",
    input: { args: reject(Schema.Tuple(Schema.String)) },
    output: strip(Schema.Struct({ exit: Schema.Number })),
    exits: {},
    prompts: () => true,
    unprompted: "run `phax session-info <run> --json` for the session",
    run: ({ input }) =>
      Effect.sync(() => {
        seen.push(input);
        return { exit: code };
      }),
    render: () => "",
    handsOver: (value) => value.exit,
  });
  return { command, seen };
}

describe("a handed-over exit", () => {
  it.each([0, 1, 64, 70, 255])("exits %i without --json", async (code) => {
    const entered = enter(code);
    const called = await call(programOf(entered.command), { argv: ["enter", "x"] });
    expect(called.code).toBe(code);
    expect(called.out).toEqual([]);
    expect(entered.seen).toHaveLength(1);
  });

  it("is refused under --json before it runs, because it prompts", async () => {
    const entered = enter(70);
    const called = await call(programOf(entered.command), { argv: ["enter", "x", "--json"] });
    expect(called.code).toBe(64);
    expect(called.out).toEqual([]);
    expect(lines(called.err)).toEqual([
      {
        kind: "refused",
        source: "flags",
        path: ["json"],
        expected: "a call that does not prompt",
        text: "error: --json: enter prompts; run `phax session-info <run> --json` for the session",
        exit: 64,
      },
    ]);
    expect(entered.seen).toEqual([]);
  });

  it("is said in the catalogue", () => {
    expect(catalogue(programOf(enter(0).command)).commands[0]?.handsOver).toBe(true);
  });

  it("stops the program when the command declares no prompts", async () => {
    const { prompts: _prompts, ...unprompted } = enter(0).command;
    const called = await call(programOf(unprompted), { argv: ["enter", "x"] });
    expect(called.code).toBe(70);
    expect(called.err.join("")).toContain("enter hands the terminal over and declares no prompts");
  });
});
