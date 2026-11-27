// The program's notice (src/cli/commandLibrary/contract/command.ts, `Program.notice`), through
// `runner.run` over the memory Io: written on stderr after the guard lets a call through and
// before the command runs, as a `note` line under --json, never asked for help or the contracts,
// and a defect when it throws.
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  defineCommand,
  defineProgram,
  reject,
  strip,
  type GuardedCall,
  type GuardRefusal,
} from "../../../src/cli/commandLibrary/contract/index.js";
import { call } from "../commandLibrary/commander/support/memoryIo.js";

const NOTICE = "phax home: /tmp/elsewhere (PHAX_HOME)";

function makeProgram(options: {
  readonly guard?: (call: GuardedCall) => GuardRefusal | undefined;
  readonly notice: (call: GuardedCall) => string | undefined;
}) {
  const order: string[] = [];
  const asked: GuardedCall[] = [];
  const notice = (called: GuardedCall): string | undefined => {
    asked.push(called);
    order.push("notice");
    return options.notice(called);
  };
  const run = defineCommand({
    name: "run",
    summary: "Run a plan",
    input: { flags: reject(Schema.Struct({ dryRun: Schema.optionalKey(Schema.Boolean) })) },
    output: strip(Schema.String),
    exits: {},
    run: () =>
      Effect.sync(() => {
        order.push("run");
        return "ran";
      }),
    render: (text) => text,
  });
  const program = defineProgram({
    name: "phax",
    version: "1.2.3",
    helpCommand: true,
    ...(options.guard === undefined ? {} : { guard: options.guard }),
    notice,
    exits: { refused: 64, defect: 70 },
    commands: [run],
  });
  return { program, order, asked };
}

describe("the program's notice", () => {
  it("is written on stderr as a line before the command runs, and never on stdout", async () => {
    const { program, order, asked } = makeProgram({ notice: () => NOTICE });
    const result = await call(program, { argv: ["run", "--dry-run"] });
    expect(result.code).toBe(0);
    expect(result.err).toEqual([`${NOTICE}\n`]);
    expect(result.out.join("")).toBe("ran\n");
    expect(order).toEqual(["notice", "run"]);
    expect(asked).toEqual([{ words: ["run"], options: { dryRun: true } }]);
  });

  it("is a note line under --json", async () => {
    const { program } = makeProgram({ notice: () => NOTICE });
    const result = await call(program, { argv: ["run", "--json"] });
    expect(result.code).toBe(0);
    const lines = result.err
      .join("")
      .split("\n")
      .filter((each) => each !== "")
      .map((each): unknown => JSON.parse(each));
    expect(lines).toEqual([{ kind: "note", text: NOTICE }]);
    expect(result.out.join("")).not.toContain(NOTICE);
  });

  it("writes nothing when it says nothing", async () => {
    const { program, order } = makeProgram({ notice: () => undefined });
    const result = await call(program, { argv: ["run"] });
    expect(result.code).toBe(0);
    expect(result.err).toEqual([]);
    expect(order).toEqual(["notice", "run"]);
  });

  it("is asked after the guard lets the call through, and not when the guard refuses", async () => {
    const guarded: string[] = [];
    const allowing = makeProgram({
      guard: () => {
        guarded.push("guard");
        return undefined;
      },
      notice: () => NOTICE,
    });
    await call(allowing.program, { argv: ["run"] });
    expect([...guarded, ...allowing.order]).toEqual(["guard", "notice", "run"]);

    const refusing = makeProgram({
      guard: () => ({ text: "refused", exit: 2 }),
      notice: () => NOTICE,
    });
    const result = await call(refusing.program, { argv: ["run"] });
    expect(result.code).toBe(2);
    expect(result.err.join("")).toBe("refused\n");
    expect(refusing.order).toEqual([]);
  });

  it.each([
    [["run", "--help"]],
    [["run", "-h"]],
    [["run", "--json-schema"]],
    [["--json-schema"]],
    [["help", "run"]],
    [["--help"]],
    [["--version"]],
  ])("is never asked for %j", async (argv) => {
    const { program, asked } = makeProgram({ notice: () => NOTICE });
    const result = await call(program, { argv });
    expect(result.code).toBe(0);
    expect(result.err.join("")).not.toContain(NOTICE);
    expect(asked).toEqual([]);
  });

  it("is a defect when it throws, and the command does not run", async () => {
    const { program, order } = makeProgram({
      notice: () => {
        throw new Error("notice broke");
      },
    });
    const result = await call(program, { argv: ["run"] });
    expect(result.code).toBe(70);
    expect(result.out).toEqual([]);
    expect(result.err.join("")).toContain("notice broke");
    expect(order).toEqual(["notice"]);
  });
});
