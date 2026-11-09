// The gains a whole program needs to run without a host parser (command-contracts plan 4,
// phase-08), through `runner.run` over the memory Io, beyond their conformance cases: the
// program's guard, root help with its summary, `-V` and the usage flags' default, the root's
// `help [command]`, the usage header and plain groups.
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  defineCommand,
  defineGroup,
  defineProgram,
  reject,
  strip,
  usageSpec,
  type GuardedCall,
  type GuardRefusal,
} from "../../../../src/cli/commandLibrary/contract/index.js";
import { call } from "./support/memoryIo.js";

const ShortName = Schema.String.annotations({ identifier: "short-name" });
const Switch = Schema.optionalKey(Schema.Boolean);

function makeProgram(guard?: (call: GuardedCall) => GuardRefusal | undefined) {
  const ran: unknown[] = [];
  const run = defineCommand({
    name: "run",
    summary: "Run a plan",
    input: {
      args: reject(Schema.Tuple(Schema.optionalElement(ShortName))),
      flags: reject(Schema.Struct({ dryRun: Switch })),
    },
    output: strip(Schema.String),
    exits: {},
    run: ({ input }) =>
      Effect.sync(() => {
        ran.push(input);
        return "ran";
      }),
    render: (text) => text,
  });
  const init = defineCommand({
    name: "init",
    summary: "Create the records",
    input: {},
    output: strip(Schema.String),
    exits: {},
    run: () => Effect.succeed("created"),
    render: (text) => text,
  });
  const program = defineProgram({
    name: "phax",
    version: "1.2.3",
    summary: "Drive things through gates",
    license: "Apache-2.0",
    versionAlias: "V",
    helpCommand: true,
    ...(guard === undefined ? {} : { guard }),
    exits: { refused: 64, defect: 70 },
    usage: {
      flag: "usage",
      format: "usage-format",
      jsonSchema: "program",
      help: "Print the usage spec and exit",
      formatHelp: "Format for --usage output",
      formatDefault: "kdl",
      minUsageVersion: "1.0.0",
      groups: "plain",
    },
    options: reject(
      Schema.Struct({
        verbose: Switch.annotations({ description: "Print progress" }),
      }),
    ),
    refusalHint: "Run `phax --help` for usage.",
    commands: [
      run,
      defineGroup({ name: "records", summary: "Manage the records", commands: [init] }),
    ],
  });
  return { program, ran };
}

const SENTENCE = "✗ phax run is not available inside a phase worktree";

function guardingRun() {
  const asked: GuardedCall[] = [];
  const guard = (called: GuardedCall): GuardRefusal | undefined => {
    asked.push(called);
    return called.words.join(" ") === "run" ? { text: SENTENCE, exit: 1 } : undefined;
  };
  return { ...makeProgram(guard), asked };
}

describe("the program's guard", () => {
  it("refuses the located command with its text and its own exit, before anything is decoded", async () => {
    const { program, ran, asked } = guardingRun();
    const result = await call(program, {
      argv: ["run", "x", "--dry-run", "--undeclared", "--", "--after"],
    });
    expect(result.code).toBe(1);
    expect(result.out).toEqual([]);
    expect(result.err.join("")).toBe(`${SENTENCE}\n`);
    expect(asked).toEqual([{ words: ["run"], options: { dryRun: true, undeclared: true } }]);
    expect(ran).toEqual([]);
  });

  it("refuses under --json with one refused line and the guard's exit", async () => {
    const { program, ran } = guardingRun();
    const result = await call(program, { argv: ["--verbose", "run", "x", "--json"] });
    expect(result.code).toBe(1);
    expect(result.out).toEqual([]);
    const lines = result.err
      .join("")
      .split("\n")
      .filter((each) => each !== "")
      .map((each): unknown => JSON.parse(each));
    expect(lines).toEqual([
      {
        kind: "refused",
        source: "command",
        path: ["run"],
        expected: "a command the program's guard allows",
        text: SENTENCE,
        exit: 1,
      },
    ]);
    expect(ran).toEqual([]);
  });

  it("names its own expected phrase in the refused line", async () => {
    const { program } = makeProgram(() => ({
      text: SENTENCE,
      exit: 1,
      expected: "a command allowed inside a phase worktree",
    }));
    const result = await call(program, { argv: ["run", "--json"] });
    expect(JSON.parse(result.err.join(""))).toMatchObject({
      expected: "a command allowed inside a phase worktree",
      exit: 1,
    });
  });

  it.each([[["run", "--help"]], [["run", "-h"]], [["run", "--json-schema"]], [["help", "run"]]])(
    "is never asked for %j",
    async (argv) => {
      const { program, asked } = guardingRun();
      const result = await call(program, { argv });
      expect(result.code).toBe(0);
      expect(result.out.join("")).not.toBe("");
      expect(asked).toEqual([]);
    },
  );

  it("lets a call it allows run", async () => {
    const { program, asked } = guardingRun();
    const result = await call(program, { argv: ["records", "init"] });
    expect(result.code).toBe(0);
    expect(result.out.join("")).toBe("created\n");
    expect(asked).toEqual([{ words: ["records", "init"], options: {} }]);
  });
});

// The test program's root help, as Commander writes it, at 200 columns so that nothing wraps.
const ROOT_HELP = `Usage: phax [options] [command]

Drive things through gates

Options:
  -V, --version               output the version number
  --verbose                   Print progress
  --usage                     Print the usage spec and exit
  --usage-format <format>     Format for --usage output (default: "kdl")
  --json-schema               Print the program's contracts as JSON Schema, or a command's after its name, and run nothing
  -h, --help                  display help for command

Commands:
  run [options] [short-name]  Run a plan
  records                     Manage the records
  help [command]              display help for command
`;

describe("root help", () => {
  it.each([[["--help"]], [["-h"]], [["help"]]])(
    "%j writes the summary, -V, the format's default and help [command]",
    async (argv) => {
      const result = await call(makeProgram().program, { argv, columns: 200 });
      expect(result.code).toBe(0);
      expect(result.err).toEqual([]);
      expect(result.out.join("")).toBe(ROOT_HELP);
    },
  );

  it.each([[["-V"]], [["--version"]]])("%j prints the version", async (argv) => {
    const result = await call(makeProgram().program, { argv });
    expect(result.code).toBe(0);
    expect(result.out.join("")).toBe("1.2.3\n");
  });
});

describe("the root's help command", () => {
  it.each([
    [
      ["help", "run"],
      ["run", "--help"],
    ],
    [
      ["help", "records"],
      ["records", "--help"],
    ],
    [
      ["help", "records", "init"],
      ["records", "init", "--help"],
    ],
    [
      ["records", "help", "init"],
      ["records", "init", "--help"],
    ],
    [
      ["records", "help"],
      ["records", "--help"],
    ],
  ])("%j answers as %j does", async (asked, flagged) => {
    const byWord = await call(makeProgram().program, { argv: asked });
    const byFlag = await call(makeProgram().program, { argv: flagged });
    expect(byWord.code).toBe(0);
    expect(byWord.out.join("")).not.toBe("");
    expect(byWord.out).toEqual(byFlag.out);
    expect(byWord.err).toEqual([]);
  });

  it("lists itself in a group's help", async () => {
    const result = await call(makeProgram().program, { argv: ["records", "--help"] });
    expect(result.out.join("")).toContain("help [command]");
  });

  it("refuses a word that names no command", async () => {
    const result = await call(makeProgram().program, { argv: ["help", "nope"] });
    expect(result.code).toBe(64);
    expect(result.out).toEqual([]);
    expect(result.err.join("")).toContain("unknown command 'nope'");
  });
});

describe("the usage header and plain groups", () => {
  const spec = usageSpec(makeProgram().program);

  it("writes license, min_usage_version and about after the version", () => {
    expect(spec.split("\n").slice(0, 6)).toEqual([
      "name phax",
      "bin phax",
      'version "1.2.3"',
      'license "Apache-2.0"',
      'min_usage_version "1.0.0"',
      'about "Drive things through gates"',
    ]);
  });

  it("writes the usage flags with their own help and default", () => {
    expect(spec).toContain('flag --usage help="Print the usage spec and exit"\n');
    expect(spec).toContain(
      'flag "--usage-format <format>" help="Format for --usage output" default="kdl"\n',
    );
  });

  it("writes a plain group without subcommand_required, and still refuses it alone", async () => {
    expect(spec).toContain('cmd records help="Manage the records" {\n');
    expect(spec).not.toContain("subcommand_required");
    const result = await call(makeProgram().program, { argv: ["records"] });
    expect(result.code).toBe(64);
    expect(result.out).toEqual([]);
  });

  it("answers the same spec on --usage", async () => {
    const result = await call(makeProgram().program, { argv: ["--usage"] });
    expect(result.code).toBe(0);
    expect(result.out.join("")).toBe(spec);
  });
});
