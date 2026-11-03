// The transition's dispatcher between today's Commander program (src/cli/program.ts) and the
// command runner (src/cli/commandLibrary/), with phax's runner program
// (src/cli/definitions/program.ts). A call whose leading words name a runner command, or the root
// `phax --json-schema`, goes to the runner; any other call goes to Commander, whose refusals exit
// the runner program's `refused` code and whose crashes its `defect` code. Each runner command
// is also mounted in the Commander tree as a help-only stub, so that the root's and its group's
// help list it; the usage spec generator splices the runner's own block at the stub's position.
// The bridge is internal and goes with the last plan of command-contracts, when the runner owns
// the program.
import { Command, CommanderError } from "commander";
import { Effect } from "effect";
import { isInPhaseWorktree } from "../app/loadConfig.js";
import { phaseGuardRefusal } from "../domain/security/phaseGuard.js";
import {
  argShapes,
  flagShapes,
  fullName,
  messages,
  OPTION_HELP,
  usageSpec,
  type Command as RunnerCommand,
  type Inputs,
  type Io,
  type Program,
} from "./commandLibrary/contract/index.js";
import { processIo, runner } from "./commandLibrary/commander/index.js";
import { phaxProgram } from "./definitions/program.js";

const JSON_OPTION = "--json";
const JSON_SCHEMA_OPTION = "--json-schema";
const END_OF_OPTIONS = "--";

/** The words before `--`: the ones a parser reads as options. */
function optionWords(argv: ReadonlyArray<string>): ReadonlyArray<string> {
  const end = argv.indexOf(END_OF_OPTIONS);
  return end === -1 ? argv : argv.slice(0, end);
}

/** The program's options that take no value (`--verbose`, `--trace`), as the call writes them. */
function programSwitches(program: Program<unknown>): ReadonlySet<string> {
  if (program.options === undefined) return new Set();
  return new Set(
    flagShapes(program.options.contract)
      .filter((flag) => flag.switch)
      .map((flag) => `--${flag.option}`),
  );
}

/** Where the bridge sends a call. */
export type Route =
  | { readonly to: "runner"; readonly command: ReadonlyArray<string> }
  | { readonly to: "runner"; readonly command: undefined }
  | { readonly to: "commander" };

/** Where a call goes: to the runner when its leading words, after the program's options, name
 *  one of the program's commands (the longest name that matches), or when it is the root's
 *  `--json-schema`; to Commander otherwise. */
export function route(program: Program<unknown>, argv: ReadonlyArray<string>): Route {
  const switches = programSwitches(program);
  const leading = optionWords(argv).filter((word) => !switches.has(word));
  if (leading[0] === JSON_SCHEMA_OPTION) return { to: "runner", command: undefined };
  let named: ReadonlyArray<string> | undefined;
  for (const command of program.commands) {
    const name = fullName(command);
    const matches = name.every((part, index) => leading[index] === part);
    if (matches && (named === undefined || name.length > named.length)) named = name;
  }
  return named === undefined ? { to: "commander" } : { to: "runner", command: named };
}

/** The options a call gives, by their camelCase names, as the phase guard reads them. */
function givenOptions(argv: ReadonlyArray<string>): Readonly<Record<string, true>> {
  const given: Record<string, true> = {};
  for (const word of optionWords(argv)) {
    if (!word.startsWith("--") || word === END_OF_OPTIONS) continue;
    const name = (word.slice(2).split("=")[0] ?? "").replace(/-([a-z])/g, (_, c: string) =>
      c.toUpperCase(),
    );
    given[name] = true;
  }
  return given;
}

/** The phase guard on the runner's path: the text to write and the exit, or undefined when the
 *  command may run. Under `--json` it is one `refused` line; its exit is the guard's 1, not the
 *  program's `refused` code. */
export function runnerGuard(
  command: ReadonlyArray<string>,
  argv: ReadonlyArray<string>,
): { readonly text: string; readonly exit: 1 } | undefined {
  const refusal = phaseGuardRefusal(command.join(" "), givenOptions(argv));
  if (refusal === undefined) return undefined;
  const text = optionWords(argv).includes(JSON_OPTION)
    ? messages.refused({
        source: "command",
        path: command,
        expected: "a command allowed inside a phase worktree",
        text: refusal,
        exit: 1,
      })
    : `${refusal}\n`;
  return { text, exit: 1 };
}

/** Exit codes every walk of Commander's tree throws instead of exiting. */
function overrideExits(command: Command): void {
  command.exitOverride();
  for (const sub of command.commands) overrideExits(sub);
}

/** The exit of a call Commander ended by throwing: 0 for its help and `--version`, the program's
 *  `refused` code for every refusal (whose text Commander has written), else a defect, written
 *  `defect: <message>`. */
export function commanderExit(
  program: Program<unknown>,
  error: unknown,
  err: (text: string) => void,
): number {
  if (error instanceof CommanderError) {
    return error.exitCode === 0 ? 0 : program.exits.refused;
  }
  const message = error instanceof Error ? error.message : String(error);
  err(`defect: ${message}\n`);
  return program.exits.defect;
}

/** What the bridge needs of the process, as functions, so that its decisions are proved
 *  without one. */
export interface BridgeEdge {
  /** The arguments after the executable and the script. */
  readonly argv: ReadonlyArray<string>;
  readonly inPhaseWorktree: () => boolean;
  /** The runner, run over the process: the exit code it answers. */
  readonly runRunner: () => Promise<number>;
  /** Today's Commander program. */
  readonly buildCommander: () => Command;
  readonly err: (text: string) => void;
}

/** One call in, its exit code out; `undefined` when a Commander action returned without one, so
 *  the process ends as it does today. */
export async function dispatch(
  program: Program<unknown>,
  edge: BridgeEdge,
): Promise<number | undefined> {
  const routed = route(program, edge.argv);
  if (routed.to === "runner") {
    if (routed.command !== undefined && edge.inPhaseWorktree()) {
      const refused = runnerGuard(routed.command, edge.argv);
      if (refused !== undefined) {
        edge.err(refused.text);
        return refused.exit;
      }
    }
    return edge.runRunner();
  }
  // An unmigrated command answers no contract: `--json-schema` is refused before Commander,
  // which would otherwise read the root's help-only option after the command.
  if (optionWords(edge.argv).includes(JSON_SCHEMA_OPTION)) {
    edge.err(
      "error: --json-schema is answered alone, or after a command that answers through the runner\nRun `phax --help` for usage.\n",
    );
    return program.exits.refused;
  }
  const commander = edge.buildCommander();
  overrideExits(commander);
  try {
    await commander.parseAsync([...edge.argv], { from: "user" });
    return undefined;
  } catch (error: unknown) {
    return commanderExit(program, error, edge.err);
  }
}

/** phax's runner program run over this process. phase-05 provides the layers its commands
 *  need. */
function runPhaxProgram(io: Io): Promise<number> {
  return Effect.runPromise(runner.run(phaxProgram, io));
}

/** Exits once what was written to stdout and stderr is handed off: an exit right after a write
 *  to a pipe can cut it. */
function exitAfterFlush(process: NodeJS.Process, code: number): void {
  process.stdout.write("", () => {
    process.stderr.write("", () => {
      process.exit(code);
    });
  });
}

/** The bridge over the process: main.ts's one call. */
export function runBridge(process: NodeJS.Process, buildCommander: () => Command): void {
  void dispatch(phaxProgram, {
    argv: process.argv.slice(2),
    inPhaseWorktree: () => isInPhaseWorktree(process.cwd()),
    runRunner: () => runPhaxProgram(processIo(process)),
    buildCommander,
    err: (text) => {
      process.stderr.write(text);
    },
  }).then(
    (code) => {
      if (code !== undefined) exitAfterFlush(process, code);
    },
    (error: unknown) => {
      process.stderr.write(`defect: ${error instanceof Error ? error.message : String(error)}\n`);
      exitAfterFlush(process, phaxProgram.exits.defect);
    },
  );
}

// ── Help-only stubs ─────────────────────────────────────────────────────────────

/** The Commander commands mounted for a runner command: the generator and the introspection
 *  recognise them by this registry, never by their name. */
const stubs = new WeakSet<Command>();

/** Whether a Commander command is a runner command's help-only stub. */
export function isRunnerStub(command: Command): boolean {
  return stubs.has(command);
}

/** The Commander group a runner command belongs to, made when the tree has none. */
function groupOf(root: Command, command: RunnerCommand<unknown>): Command {
  const chain: { readonly name: string; readonly summary: string }[] = [];
  for (let group = command.group; group !== undefined; group = group.parent) chain.unshift(group);
  let parent = root;
  for (const group of chain) {
    parent =
      parent.commands.find((each) => each.name() === group.name) ??
      parent.command(group.name).description(group.summary);
  }
  return parent;
}

/** Mounts each runner command as a help-only Commander stub at its group: its summary, the
 *  arguments and options its shapes declare, `--json` and `--json-schema`, unknown options
 *  allowed. The bridge sends every call naming it to the runner, so its action never runs. */
export function mountRunnerStubs(root: Command, program: Program<unknown>): void {
  for (const command of program.commands) {
    const parent = groupOf(root, command);
    if (parent.commands.some((each) => each.name() === command.name)) {
      throw new Error(
        `phax ${fullName(command).join(" ")} is both a Commander command and a runner command`,
      );
    }
    const stub = parent
      .command(command.name)
      .description(command.summary)
      .allowUnknownOption()
      .allowExcessArguments();
    const inputs: Inputs = command.input;
    for (const arg of inputs.args === undefined ? [] : argShapes(inputs.args.contract)) {
      stub.argument(arg.optional ? `[${arg.name}]` : `<${arg.name}>`, arg.help ?? "");
    }
    for (const flag of inputs.flags === undefined ? [] : flagShapes(inputs.flags.contract)) {
      stub.option(
        flag.switch ? `--${flag.option}` : `--${flag.option} <${flag.field}>`,
        flag.help ?? "",
      );
    }
    if (inputs.stdin?.flag !== undefined) {
      stub.option(`--${inputs.stdin.flag} [path]`, OPTION_HELP.stdin(inputs.stdin.flag));
    }
    stub.option(JSON_OPTION, OPTION_HELP.json).option(JSON_SCHEMA_OPTION, OPTION_HELP.jsonSchema);
    stub.action(() => {
      throw new Error(
        `phax ${fullName(command).join(" ")} answers through the runner; the bridge sends it there`,
      );
    });
    stubs.add(stub);
  }
}

// ── The usage spec's runner blocks ──────────────────────────────────────────────

/** What the usage spec generator splices from the runner program's usage spec. */
export interface RunnerUsage {
  /** The root's lines the runner adds: its exit codes' documentation and `--json-schema`. */
  readonly root: ReadonlyArray<string>;
  /** Each runner command's `cmd` block, unindented, keyed by its full name (`plans lint`). */
  readonly commands: ReadonlyMap<string, ReadonlyArray<string>>;
}

const INDENT = "    ";
const CMD_LINE = /^((?: {4})*)cmd ("(?:[^"\\]|\\.)*"|\S+)/;

/** A KDL word as written: a quoted string's text, a bare word as it is. */
const unquoted = (word: string): string =>
  word.startsWith('"')
    ? (JSON.parse(word.replace(/\\u\{([0-9a-f]+)\}/g, "\\u$1")) as string)
    : word;

/** Cuts the runner program's usage spec into the root's added lines and each command's block. */
export function runnerUsage(program: Program<unknown>): RunnerUsage {
  const lines = usageSpec(program).split("\n");
  const root = lines.filter(
    (line) => line.startsWith("after_long_help ") || line.startsWith(`flag ${JSON_SCHEMA_OPTION} `),
  );
  const commands = new Map<string, ReadonlyArray<string>>();
  const groups: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const match = CMD_LINE.exec(line);
    if (match === null) continue;
    const indent = match[1] ?? "";
    const depth = indent.length / INDENT.length;
    const name = unquoted(match[2] ?? "");
    groups.length = depth;
    if (line.includes(" subcommand_required=#true")) {
      groups.push(name);
      continue;
    }
    const block = [line];
    if (line.endsWith(" {")) {
      for (index += 1; index < lines.length; index += 1) {
        const inner = lines[index] as string;
        block.push(inner);
        if (inner === `${indent}}`) break;
      }
    }
    commands.set(
      [...groups, name].join(" "),
      block.map((each) => each.slice(indent.length)),
    );
  }
  return { root, commands };
}
