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
  mountRunnerGroupStub,
  mountRunnerStub,
  mountRunnerStubs,
  PARTIAL_GROUPS,
  route,
  runnerGuard,
  runnerUsage,
  runThroughOutput,
  wholeGroups,
  type BridgeEdge,
} from "../../../src/cli/bridge.js";
import {
  AliasAnnotationId,
  CompleterAnnotationId,
  defineCommand,
  defineGroup,
  defineProgram,
  OptionalValueAnnotationId,
  Refused,
  reject,
  strip,
} from "../../../src/cli/commandLibrary/contract/index.js";
import { phaxProgram } from "../../../src/cli/definitions/program.js";
import type { OutputPort } from "../../../src/ports/output.js";

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
 *  refuses), `artifact lint` and `records sub show`, nested. */
const program = defineProgram({
  name: "phax",
  version: phaxProgram.version,
  exits: phaxProgram.exits,
  ...(phaxProgram.usage === undefined ? {} : { usage: phaxProgram.usage }),
  ...(phaxProgram.options === undefined ? {} : { options: phaxProgram.options }),
  commands: [
    leaf("ls", true),
    leaf("archive"),
    defineGroup({ name: "artifact", summary: "Artifact", commands: [leaf("lint")] }),
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
      ["--verbose", "--trace", "artifact", "lint", "x"],
      ["artifact", "lint"],
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

  it.each([[[]], [["unlock", "ls"]], [["--version"]], [["--help"]]] as const)(
    "sends %j to Commander",
    (argv) => {
      expect(route(program, argv)).toEqual({ to: "commander" });
    },
  );

  // PARTIAL_GROUPS is empty: `artifact`, once held in part, is a whole group like `records`, its
  // help and its refusal of a word it does not hold included. (Before plan 3 of
  // command-contracts each of these went to Commander.)
  it.each([
    [["artifact"]],
    [["artifact", "status"]],
    [["artifact", "--", "lint"]],
    [["artifact", "--help"]],
    [["artifact", "nope"]],
  ] as const)("sends %j, a call of the once partial artifact group, to the runner", (argv) => {
    expect(route(program, argv)).toEqual({ to: "runner", command: undefined, group: "artifact" });
  });

  // `records` is no group of PARTIAL_GROUPS: the runner holds it whole, its help and its
  // refusal included. (Before whole groups, `records sub` went to Commander.)
  it.each([
    [["records"]],
    [["records", "--help"]],
    [["records", "nope"]],
    [["records", "sub"]],
    [["records", "sub", "--help"]],
    [["--verbose", "records"]],
  ] as const)("sends %j, a whole group's call, to the runner", (argv) => {
    expect(route(program, argv)).toEqual({ to: "runner", command: undefined, group: "records" });
  });

  it("holds no group in part: artifact and plans are whole in phaxProgram", () => {
    expect(PARTIAL_GROUPS).toEqual([]);
    expect(wholeGroups(program)).toEqual(["artifact", "records"]);
    expect(wholeGroups(phaxProgram)).toEqual([
      "cost",
      "agent",
      "security",
      "skills",
      "schema",
      "artifact",
      "plans",
      "records",
    ]);
    expect(route(phaxProgram, ["plans"])).toEqual({
      to: "runner",
      command: undefined,
      group: "plans",
    });
    expect(route(phaxProgram, ["artifact", "--help"])).toEqual({
      to: "runner",
      command: undefined,
      group: "artifact",
    });
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
    expect(route(phaxProgram, ["plans", "status"])).toEqual({
      to: "runner",
      command: ["plans", "status"],
    });
    expect(route(phaxProgram, ["artifact", "approve", "x"])).toEqual({
      to: "runner",
      command: ["artifact", "approve"],
    });
    expect(route(phaxProgram, ["artifact", "decide", "x"])).toEqual({
      to: "runner",
      command: ["artifact", "decide"],
    });
    expect(route(phaxProgram, ["artifact", "new", "spec", "x"])).toEqual({
      to: "runner",
      command: ["artifact", "new", "spec"],
    });
    expect(route(phaxProgram, ["enter", "x"])).toEqual({ to: "commander" });
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
    for (const argv of [["ls", "--json"], ["--json-schema"]]) {
      const call = edge(argv, { inPhaseWorktree: () => true });
      expect(await dispatch(program, call.edge), argv.join(" ")).toBe(0);
      expect(call.runRunner).toHaveBeenCalledOnce();
      expect(call.written.err).toBe("");
    }
  });

  it("lets a refused command's --help, -h and --json-schema through to the runner", async () => {
    for (const argv of [
      ["archive", "--help"],
      ["archive", "x", "-h"],
      ["archive", "--json-schema"],
    ]) {
      const call = edge(argv, { inPhaseWorktree: () => true });
      expect(await dispatch(program, call.edge), argv.join(" ")).toBe(0);
      expect(call.runRunner, argv.join(" ")).toHaveBeenCalledWith(argv);
      expect(call.written.err).toBe("");
    }
  });

  it("still refuses a --help given after `--`, as an operand", async () => {
    const call = edge(["archive", "--", "--help"], { inPhaseWorktree: () => true });
    expect(await dispatch(program, call.edge)).toBe(1);
    expect(call.runRunner).not.toHaveBeenCalled();
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

  it("answers `help <group>` on a whole group with the runner's `<group> --help`", async () => {
    const call = edge(["help", "records"]);
    await dispatch(program, call.edge);
    expect(call.runRunner).toHaveBeenCalledWith(["records", "--help"]);
  });

  it("hands a whole group called alone, or with a word it does not hold, to the runner", async () => {
    for (const argv of [["records"], ["records", "nope"]]) {
      const call = edge(argv, { inPhaseWorktree: () => true });
      await dispatch(program, call.edge);
      expect(call.runRunner, argv.join(" ")).toHaveBeenCalledWith(argv);
      expect(call.written.err).toBe("");
    }
  });

  it("answers `<group> help [command]` on a whole group with the runner's --help", async () => {
    for (const [argv, asked] of [
      [
        ["records", "help"],
        ["records", "--help"],
      ],
      [
        ["records", "help", "sub"],
        ["records", "sub", "--help"],
      ],
      [
        ["records", "sub", "help", "show"],
        ["records", "sub", "show", "--help"],
      ],
      [
        ["--verbose", "records", "help", "sub"],
        ["records", "sub", "--help"],
      ],
    ] as const) {
      const call = edge(argv);
      await dispatch(program, call.edge);
      expect(call.runRunner, argv.join(" ")).toHaveBeenCalledWith(asked);
    }
  });

  it("leaves a `help` operand of a runner command to that command", async () => {
    const call = edge(["records", "sub", "show", "help"]);
    await dispatch(program, call.edge);
    expect(call.runRunner).toHaveBeenCalledWith(["records", "sub", "show", "help"]);
  });

  it("answers `help artifact`, a group no longer held in part, with the runner's --help", async () => {
    const call = edge(["help", "artifact"]);
    await dispatch(program, call.edge);
    expect(call.runRunner).toHaveBeenCalledWith(["artifact", "--help"]);
  });

  it("leaves `help` on an unmigrated command to Commander", async () => {
    const call = edge(["help", "enter"]);
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
    // `artifact`, no longer held in part, is a help-only group stub (before plan 3 of
    // command-contracts, a Commander group the runner's commands were mounted into).
    const artifact = root.commands.find((each) => each.name() === "artifact");
    expect(artifact && isRunnerStub(artifact)).toBe(true);
    expect(artifact?.commands.map((each) => [each.name(), isRunnerStub(each)])).toEqual([
      ["lint", true],
    ]);
    // `records`, held whole, is a help-only group stub (before whole groups, a plain group).
    const records = root.commands.find((each) => each.name() === "records");
    expect(records && isRunnerStub(records)).toBe(true);
    expect(records?.commands[0]?.commands[0]?.name()).toBe("show");
  });

  it("mounts a whole group as a group stub holding a stub of each command, all registered", () => {
    const root = new Command("phax");
    mountRunnerGroupStub(root, program, ["records"]);
    const records = root.commands[0];
    expect(records?.name()).toBe("records");
    expect(records?.description()).toBe("Records");
    const sub = records?.commands[0];
    expect(sub?.name()).toBe("sub");
    expect(sub?.description()).toBe("Sub");
    const show = sub?.commands[0];
    expect(show?.name()).toBe("show");
    expect([records, sub, show].every((each) => each !== undefined && isRunnerStub(each))).toBe(
      true,
    );
    expect(show?.options.map((option) => option.long)).toEqual(["--json", "--json-schema"]);
  });

  it("keeps a group stub a command file mounted, and mounts its commands once", () => {
    const root = new Command("phax");
    mountRunnerGroupStub(root, program, ["records"]);
    root.command("unlock");
    mountRunnerStubs(root, program);
    expect(root.commands.map((each) => each.name())).toEqual([
      "records",
      "unlock",
      "ls",
      "archive",
      "artifact",
    ]);
    expect(root.commands[0]?.commands[0]?.commands.map((each) => each.name())).toEqual(["show"]);
  });

  it("refuses a whole group Commander also declares, and a group the runner has not", () => {
    const root = new Command("phax");
    root.command("records");
    expect(() => mountRunnerStubs(root, program)).toThrow(
      "phax records is both a Commander group and a runner group",
    );
    expect(() => mountRunnerGroupStub(new Command("phax"), program, ["nope"])).toThrow(
      "phax nope is not a runner group",
    );
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
    mountRunnerGroupStub(root, phaxProgram, ["artifact"]);
    const plans = root.commands[0] as Command;
    mountRunnerStubs(root, phaxProgram);
    // `plans`, held whole, is mounted once as a group stub after the stubs of the others;
    // `artifact`, mounted first, is kept.
    expect(root.commands.map((each) => each.name())).toEqual([
      "artifact",
      "validate",
      "unlock",
      "session-info",
      "path",
      "ls",
      "archive",
      "prune",
      "brief",
      "architecture",
      "init",
      "report",
      "completions",
      "cost",
      "agent",
      "security",
      "skills",
      "schema",
      "plans",
      "records",
    ]);
    expect(plans.commands.map((each) => each.name())).toEqual([
      "status",
      "approve",
      "stale",
      "abandon",
      "complete",
      "reopen",
      "decide",
      "new",
      "schema",
      "migrate-approvals",
      "migrate-documents",
    ]);
    const ls = root.commands.find((each) => each.name() === "ls");
    const wholePlans = root.commands.find((each) => each.name() === "plans");
    expect(ls && isRunnerStub(ls)).toBe(true);
    expect(wholePlans && isRunnerStub(wholePlans)).toBe(true);
    expect(wholePlans?.commands.map((each) => [each.name(), isRunnerStub(each)])).toEqual([
      ["status", true],
      ["overlap", true],
      ["lint", true],
      ["overview", true],
      ["estimate", true],
    ]);
    expect(plans.commands.every(isRunnerStub)).toBe(true);
  });
});

/** A command shaped like the authoring commands: an aliased switch, a required-value stdin flag,
 *  a check refusing a document that says `refuse`, and a run that says, reports progress, and
 *  answers the document's origin. */
const authoring = defineCommand({
  name: "author",
  summary: "Author a thing",
  input: {
    flags: reject(
      Schema.Struct({
        yes: Schema.optionalWith(Schema.Boolean, { exact: true }).annotations({
          description: "Proceed",
          [AliasAnnotationId]: "y",
        }),
      }),
    ),
    stdin: reject(Schema.String, { flag: "brief", text: true, valueRequired: true }),
  },
  output: strip(Schema.String),
  exits: {},
  check: ({ document }) =>
    document?.text === "refuse"
      ? Effect.fail(
          new Refused({ source: "stdin", path: [], expected: "a brief", text: "error: no brief" }),
        )
      : Effect.void,
  run: ({ say, progress, document }) =>
    Effect.gen(function* () {
      yield* say("authoring thing");
      yield* progress("retrying");
      return document?.origin.kind ?? "none";
    }),
  render: (origin) => `read from ${origin}`,
});

function recorded() {
  const lines: Array<readonly [string, string]> = [];
  const out: OutputPort = {
    log: (text) => lines.push(["log", text]),
    warn: (text) => lines.push(["warn", text]),
    error: (text) => lines.push(["error", text]),
  };
  return { out, lines };
}

describe("the stubs of the lifecycle gains", () => {
  const programOfAuthoring = defineProgram({
    name: "phax",
    version: "1.0.0",
    exits: { refused: 64, defect: 70 },
    commands: [authoring],
  });

  it("declares a required-value stdin flag as <file|-> and an aliased option with its letter", () => {
    const root = new Command("phax");
    mountRunnerStub(root, programOfAuthoring, ["author"]);
    const stub = root.commands[0];
    expect(stub?.options.map((option) => option.flags)).toEqual([
      "-y, --yes",
      "--brief <file|->",
      "--json",
      "--json-schema",
    ]);
    expect(stub?.options[0]?.short).toBe("-y");
  });

  it("keeps the optional [path] form of a stdin flag whose value is not required", () => {
    const optional = defineProgram({
      name: "phax",
      version: "1.0.0",
      exits: { refused: 64, defect: 70 },
      commands: [
        defineCommand({
          name: "take",
          summary: "Take a request",
          input: { stdin: reject(Schema.String, { flag: "request", text: true }) },
          output: strip(Schema.String),
          exits: {},
          run: () => Effect.succeed("taken"),
        }),
      ],
    });
    const root = new Command("phax");
    mountRunnerStub(root, optional, ["take"]);
    expect(root.commands[0]?.options[0]?.flags).toBe("--request [path]");
  });
});

describe("runThroughOutput's gains", () => {
  it("hands say to out.log, progress to out.warn and the document to run", async () => {
    const { out, lines } = recorded();
    const code = await runThroughOutput(authoring, { flags: {}, stdin: "a brief" }, out, {
      document: { origin: { kind: "file", path: "brief.md" }, text: "a brief" },
    });
    expect(code).toBe(0);
    expect(lines).toEqual([
      ["log", "authoring thing"],
      ["warn", "retrying"],
      ["log", "read from file"],
    ]);
  });

  it("runs the check first, answering 64 with its text through out.error", async () => {
    const { out, lines } = recorded();
    const code = await runThroughOutput(authoring, { flags: {}, stdin: "refuse" }, out, {
      document: { origin: { kind: "stdin" }, text: "refuse" },
    });
    expect(code).toBe(64);
    expect(lines).toEqual([["error", "error: no brief"]]);
  });
});

/** A command shaped like the run and session commands: an optional-value `--hold`, a retired
 *  `--skip-oracle`, an empty render with a note, and a handed-over exit. */
const handing = defineCommand({
  name: "enter",
  summary: "Hand the terminal over",
  input: {
    flags: reject(
      Schema.Struct({
        hold: Schema.optionalWith(Schema.Union(Schema.Literal(true), Schema.String), {
          exact: true,
        }).annotations({
          identifier: "selection",
          description: "Hold the run",
          [OptionalValueAnnotationId]: true,
        }),
      }),
    ),
  },
  output: strip(Schema.Struct({ exit: Schema.Number })),
  exits: {},
  retiredOptions: { "skip-oracle": "--skip-oracle is no longer read: write --skip-acceptance" },
  prompts: () => true,
  run: () => Effect.succeed({ exit: 70 }),
  render: () => "",
  notes: () => "session ended",
  handsOver: (value) => value.exit,
});

describe("the stubs of the run and session gains", () => {
  const programOfHanding = defineProgram({
    name: "phax",
    version: "1.0.0",
    exits: { refused: 64, defect: 70 },
    commands: [handing],
  });

  it("declares an optional-value option as --hold [selection]", () => {
    const root = new Command("phax");
    mountRunnerStub(root, programOfHanding, ["enter"]);
    const stub = root.commands[0];
    expect(stub?.options[0]?.flags).toBe("--hold [selection]");
    expect(stub?.options[0]?.optional).toBe(true);
  });

  it("declares a retired option hidden, so its help never lists it", () => {
    const root = new Command("phax");
    mountRunnerStub(root, programOfHanding, ["enter"]);
    const stub = root.commands[0];
    const retired = stub?.options.find((option) => option.long === "--skip-oracle");
    expect(retired?.hidden).toBe(true);
    expect(stub?.helpInformation()).not.toContain("skip-oracle");
  });
});

describe("runThroughOutput's run and session gains", () => {
  it("logs nothing for an empty render, warns its notes, and answers the handed-over exit", async () => {
    const { out, lines } = recorded();
    const code = await runThroughOutput(handing, { flags: {} }, out);
    expect(code).toBe(70);
    expect(lines).toEqual([["warn", "session ended"]]);
  });

  it("answers no handed-over exit under --json", async () => {
    const { out } = recorded();
    expect(await runThroughOutput(handing, { flags: {} }, out, { json: true })).toBe(0);
  });
});

describe("runnerUsage", () => {
  it("cuts the root's exit documentation and --json-schema, and each command's block by full name", () => {
    const usage = runnerUsage(program);
    expect(usage.root).toHaveLength(2);
    expect(usage.root[0]).toMatch(/^after_long_help "Exit codes:\\n {2}64 {2}refused/);
    expect(usage.root[1]).toMatch(/^flag --json-schema global=#true /);
    expect([...usage.commands.keys()]).toEqual([
      "ls",
      "archive",
      "artifact lint",
      "records sub show",
    ]);
    const show = usage.commands.get("records sub show") ?? [];
    expect(show[0]).toMatch(/^cmd show help="The show command" \{$/);
    expect(show.at(-1)).toBe("}");
    expect(show.slice(1, -1).every((line) => line.startsWith("    "))).toBe(true);
    expect(show.some((line) => line.includes("flag --json "))).toBe(true);
  });

  it("cuts each group's whole block by full name, its commands included", () => {
    const usage = runnerUsage(program);
    expect([...usage.groups.keys()]).toEqual(["artifact", "records", "records sub"]);
    const records = usage.groups.get("records") ?? [];
    expect(records[0]).toBe('cmd records help="Records" subcommand_required=#true {');
    expect(records.at(-1)).toBe("}");
    expect(records[1]).toBe('    cmd sub help="Sub" subcommand_required=#true {');
    expect(records.some((line) => line.startsWith("        cmd show "))).toBe(true);
    expect(usage.groups.get("records sub")?.[0]).toMatch(/^cmd sub /);
  });

  it("keys each complete node by its identifier", () => {
    const completed = defineProgram({
      name: "phax",
      version: "1.0.0",
      exits: { refused: 64, defect: 70 },
      commands: [
        defineCommand({
          name: "resume",
          summary: "Resume",
          input: {
            args: reject(
              Schema.Tuple(
                Schema.String.annotations({
                  identifier: "short-name",
                  [CompleterAnnotationId]: { run: "phax ls --complete", descriptions: true },
                }),
              ),
            ),
          },
          output: strip(Schema.String),
          exits: {},
          run: () => Effect.succeed("x"),
        }),
      ],
    });
    expect([...runnerUsage(completed).completes]).toEqual([
      ["short-name", 'complete "short-name" run="phax ls --complete" descriptions=#true'],
    ]);
    expect(runnerUsage(program).completes.size).toBe(0);
  });

  it("cuts the root lines and the four commands' blocks from phaxProgram", () => {
    const usage = runnerUsage(phaxProgram);
    expect(usage.root).toHaveLength(2);
    expect([...usage.commands.keys()]).toEqual([
      "validate",
      "unlock",
      "session-info",
      "path",
      "ls",
      "archive",
      "prune",
      "brief",
      "architecture",
      "init",
      "report",
      "completions",
      "cost backfill",
      "agent models",
      "agent resolve",
      "agent probe",
      "agent setup mistral-vibe",
      "agent setup providers",
      "security status",
      "skills install",
      "schema upgrade",
      "artifact status",
      "artifact approve",
      "artifact stale",
      "artifact abandon",
      "artifact complete",
      "artifact reopen",
      "artifact decide",
      "artifact new spec",
      "artifact new plan",
      "artifact schema",
      "artifact migrate-approvals",
      "artifact migrate-documents",
      "plans status",
      "plans overlap",
      "plans lint",
      "plans overview",
      "plans estimate",
      "records init",
      "records sync",
      "records status",
      "records list",
      "records explain",
    ]);
  });
});
