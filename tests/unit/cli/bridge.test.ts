// The bridge's decisions (src/cli/bridge.ts) with doubles for the Commander program and the
// runner: where a call goes, the phase guard on the runner's path, Commander's errors mapped to
// the refused (64) and defect (70) codes, the help-only stubs and the usage blocks cut for the
// generator. No real process exits.
import { Command } from "commander";
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";
import {
  commanderExit,
  dispatch,
  isRunnerStub,
  mountRunnerStub,
  mountRunnerStubs,
  route,
  runnerGuard,
  runnerUsage,
  type BridgeEdge,
} from "../../../src/cli/bridge.js";
import {
  defineCommand,
  defineGroup,
  defineProgram,
  reject,
  strip,
} from "../../../src/cli/commandLibrary/contract/index.js";
import { phaxProgram } from "../../../src/cli/definitions/program.js";

const GUARD = (command: string): string =>
  `✗ phax ${command} is not available inside a phase worktree; run it from the main checkout (inside, only phax brief, phax architecture and read-only commands run)`;

const leaf = (name: string, flags = false) =>
  defineCommand({
    name,
    summary: `The ${name} command`,
    input: {
      args: reject(
        Schema.Tuple(
          Schema.optionalElement(
            Schema.String.annotations({ identifier: "short-name", description: "A run" }),
          ),
        ),
      ),
      ...(flags
        ? {
            flags: reject(
              Schema.Struct({
                active: Schema.optionalWith(
                  Schema.Boolean.annotations({ description: "Only active runs" }),
                  { exact: true },
                ),
              }),
            ),
          }
        : {}),
    },
    output: strip(Schema.String),
    exits: {},
    run: () => Effect.succeed(name),
  });

/** A runner program shaped like phax's once commands move: `ls`, `archive` (which the guard
 *  refuses), `plans lint` and `records sub show`, nested. */
const program = defineProgram({
  name: "phax",
  version: phaxProgram.version,
  exits: phaxProgram.exits,
  ...(phaxProgram.usage === undefined ? {} : { usage: phaxProgram.usage }),
  ...(phaxProgram.options === undefined ? {} : { options: phaxProgram.options }),
  commands: [
    leaf("ls", true),
    leaf("archive"),
    defineGroup({ name: "plans", summary: "Plans", commands: [leaf("lint")] }),
    defineGroup({
      name: "records",
      summary: "Records",
      commands: [defineGroup({ name: "sub", summary: "Sub", commands: [leaf("show")] })],
    }),
  ],
});

/** A Commander program double: the shapes of today's refusals, its output kept. */
function legacy(written: { out: string; err: string }, action = vi.fn()): () => Command {
  return () => {
    const root = new Command("phax").version("0.34.0");
    root.configureOutput({
      writeOut: (text) => {
        written.out += text;
      },
      writeErr: (text) => {
        written.err += text;
      },
    });
    root.command("unlock").argument("<short-name>").action(action);
    root.command("path").argument("<short-name>").allowExcessArguments(false).action(action);
    root.command("validate").option("--plan <path>").action(action);
    const agent = root.command("agent").description("Agents");
    const setup = agent.command("setup").description("Setup");
    setup.command("providers").action(action);
    root.command("boom").action(() => {
      throw new Error("it broke");
    });
    root.command("reject").action(async () => {
      await Promise.resolve();
      throw new Error("it rejected");
    });
    return root;
  };
}

function edge(argv: ReadonlyArray<string>, overrides: Partial<BridgeEdge> = {}) {
  const written = { out: "", err: "" };
  const runRunner = vi.fn(async () => 0);
  const action = vi.fn();
  const value: BridgeEdge = {
    argv,
    inPhaseWorktree: () => false,
    runRunner,
    buildCommander: legacy(written, action),
    err: (text) => {
      written.err += text;
    },
    ...overrides,
  };
  return { edge: value, written, runRunner, action };
}

describe("route", () => {
  it.each([
    [["ls"], ["ls"]],
    [["ls", "--active", "--json"], ["ls"]],
    [["--verbose", "ls"], ["ls"]],
    [
      ["--verbose", "--trace", "plans", "lint", "x"],
      ["plans", "lint"],
    ],
    [
      ["records", "sub", "show"],
      ["records", "sub", "show"],
    ],
  ] as const)("sends %j to the runner as %j", (argv, command) => {
    expect(route(program, argv)).toEqual({ to: "runner", command });
  });

  it("sends the root's --json-schema to the runner, after the program's options too", () => {
    expect(route(program, ["--json-schema"])).toEqual({ to: "runner", command: undefined });
    expect(route(program, ["--verbose", "--json-schema"])).toEqual({
      to: "runner",
      command: undefined,
    });
  });

  it.each([
    [[]],
    [["plans"]],
    [["plans", "status"]],
    [["plans", "--", "lint"]],
    [["unlock", "ls"]],
    [["--version"]],
    [["--help"]],
    [["records", "sub"]],
  ] as const)("sends %j to Commander", (argv) => {
    expect(route(program, argv)).toEqual({ to: "commander" });
  });

  it("sends phaxProgram's four commands to the runner and the others to Commander", () => {
    expect(route(phaxProgram, ["ls"])).toEqual({ to: "runner", command: ["ls"] });
    expect(route(phaxProgram, ["plans", "lint", "x"])).toEqual({
      to: "runner",
      command: ["plans", "lint"],
    });
    expect(route(phaxProgram, ["artifact", "status", "x"])).toEqual({
      to: "runner",
      command: ["artifact", "status"],
    });
    expect(route(phaxProgram, ["plans", "status"])).toEqual({ to: "commander" });
    expect(route(phaxProgram, ["artifact", "approve", "x"])).toEqual({ to: "commander" });
  });

  // Commander reads past these to the command word, and would call the help-only stub's action.
  it.each([
    [["--usage-format", "kdl", "ls"]],
    [["--usage-format=kdl", "ls"]],
    [["--", "ls"]],
    [["--verbose", "--usage-format", "json", "--", "ls"]],
  ] as const)("sends %j to the runner, the program's options set aside", (argv) => {
    expect(route(phaxProgram, argv)).toEqual({ to: "runner", command: ["ls"] });
  });
});

describe("the phase guard on the runner's path", () => {
  it("refuses a refused command with today's sentence and exit 1, before the runner", async () => {
    const call = edge(["archive", "x"], { inPhaseWorktree: () => true });
    expect(await dispatch(program, call.edge)).toBe(1);
    expect(call.written.err).toBe(`${GUARD("archive")}\n`);
    expect(call.runRunner).not.toHaveBeenCalled();
  });

  it("writes one refused line under --json, its exit the guard's 1", async () => {
    const call = edge(["archive", "x", "--json"], { inPhaseWorktree: () => true });
    expect(await dispatch(program, call.edge)).toBe(1);
    expect(call.written.err.endsWith("\n")).toBe(true);
    expect(call.written.err.split("\n")).toHaveLength(2);
    expect(JSON.parse(call.written.err)).toEqual({
      kind: "refused",
      source: "command",
      path: ["archive"],
      expected: "a command allowed inside a phase worktree",
      text: GUARD("archive"),
      exit: 1,
    });
    expect(call.runRunner).not.toHaveBeenCalled();
  });

  it("lets an allowed command and the root's --json-schema through to the runner", async () => {
    for (const argv of [["ls", "--json"], ["plans", "lint", "x"], ["--json-schema"]]) {
      const call = edge(argv, { inPhaseWorktree: () => true });
      expect(await dispatch(program, call.edge), argv.join(" ")).toBe(0);
      expect(call.runRunner).toHaveBeenCalledOnce();
      expect(call.written.err).toBe("");
    }
  });

  it("reads the guard's refused options from the call's words", () => {
    expect(runnerGuard(["plans", "status"], ["plans", "status", "--apply"])?.exit).toBe(1);
    expect(runnerGuard(["plans", "status"], ["plans", "status"])).toBeUndefined();
    expect(runnerGuard(["plans", "status"], ["plans", "status", "--", "--apply"])).toBeUndefined();
  });

  it("is not asked outside a phase worktree", async () => {
    const inPhaseWorktree = vi.fn(() => false);
    const call = edge(["archive", "x"], { inPhaseWorktree });
    expect(await dispatch(program, call.edge)).toBe(0);
    expect(call.runRunner).toHaveBeenCalledOnce();
  });
});

describe("help on a runner command", () => {
  it("answers `help <command>` with the runner's own `<command> --help`", async () => {
    const call = edge(["--verbose", "help", "plans", "lint"]);
    await dispatch(phaxProgram, call.edge);
    expect(call.runRunner).toHaveBeenCalledWith(["plans", "lint", "--help"]);
  });

  it("leaves `help` on an unmigrated command to Commander", async () => {
    const call = edge(["help", "validate"]);
    await dispatch(phaxProgram, call.edge);
    expect(call.runRunner).not.toHaveBeenCalled();
  });
});

describe("Commander's path", () => {
  it.each([
    ["an unknown command", ["unlok"], "error: unknown command 'unlok'"],
    ["an unknown option", ["validate", "--nope"], "error: unknown option '--nope'"],
    ["a missing argument", ["unlock"], "error: missing required argument 'short-name'"],
    [
      "a missing option value",
      ["validate", "--plan"],
      "error: option '--plan <path>' argument missing",
    ],
    ["excess arguments", ["path", "a", "b"], "error: too many arguments for 'path'"],
  ])("refuses %s with 64 and Commander's text", async (_label, argv, text) => {
    const call = edge(argv);
    expect(await dispatch(program, call.edge)).toBe(64);
    expect(call.written.err).toContain(text);
    expect(call.action).not.toHaveBeenCalled();
    expect(call.runRunner).not.toHaveBeenCalled();
  });

  it("refuses a group called alone with 64, after its help on stderr", async () => {
    for (const argv of [["agent"], ["agent", "setup"], []]) {
      const call = edge(argv);
      expect(await dispatch(program, call.edge), argv.join(" ")).toBe(64);
      expect(call.written.err, argv.join(" ")).toContain("Usage:");
      expect(call.written.out).toBe("");
    }
  });

  it("answers --help and --version with 0", async () => {
    for (const argv of [["--help"], ["--version"], ["agent", "--help"]]) {
      const call = edge(argv);
      expect(await dispatch(program, call.edge), argv.join(" ")).toBe(0);
      expect(call.written.out).not.toBe("");
    }
  });

  it("writes defect text and exits 70 for a throw or a rejection escaping an action", async () => {
    for (const [argv, message] of [
      [["boom"], "it broke"],
      [["reject"], "it rejected"],
    ] as const) {
      const call = edge(argv);
      expect(await dispatch(program, call.edge)).toBe(70);
      expect(call.written.err).toBe(`defect: ${message}\n`);
      expect(call.written.err).not.toContain("Unexpected error");
    }
  });

  it("leaves the exit to the action when it returns without one", async () => {
    const call = edge(["unlock", "x"]);
    expect(await dispatch(program, call.edge)).toBeUndefined();
    expect(call.action).toHaveBeenCalledOnce();
  });

  it("refuses --json-schema on an unmigrated command with 64", async () => {
    const call = edge(["unlock", "x", "--json-schema"]);
    expect(await dispatch(program, call.edge)).toBe(64);
    expect(call.written.err).toContain("--json-schema is answered alone");
    expect(call.action).not.toHaveBeenCalled();
  });

  it("maps any non-Commander error to the defect code", () => {
    const err = vi.fn();
    expect(commanderExit(program, "a string", err)).toBe(70);
    expect(err).toHaveBeenCalledWith("defect: a string\n");
  });
});

describe("the help-only stubs", () => {
  it("mounts each runner command at its group, with its shapes, --json and --json-schema", () => {
    const root = new Command("phax");
    root.command("plans").description("Plans").command("status");
    mountRunnerStubs(root, program);
    const ls = root.commands.find((each) => each.name() === "ls");
    expect(ls && isRunnerStub(ls)).toBe(true);
    expect(ls?.description()).toBe("The ls command");
    expect(ls?.registeredArguments.map((arg) => [arg.name(), arg.required])).toEqual([
      ["short-name", false],
    ]);
    expect(ls?.options.map((option) => option.long)).toEqual([
      "--active",
      "--json",
      "--json-schema",
    ]);
    const plans = root.commands.find((each) => each.name() === "plans");
    expect(plans?.commands.map((each) => [each.name(), isRunnerStub(each)])).toEqual([
      ["status", false],
      ["lint", true],
    ]);
    const records = root.commands.find((each) => each.name() === "records");
    expect(records && isRunnerStub(records)).toBe(false);
    expect(records?.commands[0]?.commands[0]?.name()).toBe("show");
  });

  it("refuses a runner command Commander also declares", () => {
    const root = new Command("phax");
    root.command("ls");
    expect(() => mountRunnerStubs(root, program)).toThrow(
      "phax ls is both a Commander command and a runner command",
    );
  });

  it("mounts phaxProgram's commands in their groups, keeping a stub already mounted", () => {
    const root = new Command("phax");
    const plans = root.command("plans");
    mountRunnerStub(plans, phaxProgram, ["plans", "overview"]);
    mountRunnerStubs(root, phaxProgram);
    expect(root.commands.map((each) => each.name())).toEqual(["plans", "ls", "artifact"]);
    expect(plans.commands.map((each) => each.name())).toEqual(["overview", "lint"]);
    const [, ls, artifact] = root.commands;
    expect(ls && isRunnerStub(ls)).toBe(true);
    expect(artifact && isRunnerStub(artifact)).toBe(false);
    expect(artifact?.commands.map((each) => [each.name(), isRunnerStub(each)])).toEqual([
      ["status", true],
    ]);
    expect(plans.commands.every(isRunnerStub)).toBe(true);
  });
});

describe("runnerUsage", () => {
  it("cuts the root's exit documentation and --json-schema, and each command's block by full name", () => {
    const usage = runnerUsage(program);
    expect(usage.root).toHaveLength(2);
    expect(usage.root[0]).toMatch(/^after_long_help "Exit codes:\\n {2}64 {2}refused/);
    expect(usage.root[1]).toMatch(/^flag --json-schema global=#true /);
    expect([...usage.commands.keys()]).toEqual(["ls", "archive", "plans lint", "records sub show"]);
    const show = usage.commands.get("records sub show") ?? [];
    expect(show[0]).toMatch(/^cmd show help="The show command" \{$/);
    expect(show.at(-1)).toBe("}");
    expect(show.slice(1, -1).every((line) => line.startsWith("    "))).toBe(true);
    expect(show.some((line) => line.includes("flag --json "))).toBe(true);
  });

  it("cuts the root lines and the four commands' blocks from phaxProgram", () => {
    const usage = runnerUsage(phaxProgram);
    expect(usage.root).toHaveLength(2);
    expect([...usage.commands.keys()]).toEqual([
      "ls",
      "artifact status",
      "plans lint",
      "plans overview",
    ]);
  });
});
