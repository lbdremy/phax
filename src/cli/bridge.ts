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
import { Cause, Effect, Exit, Option } from "effect";
import * as Schema from "effect/Schema";
import { isInPhaseWorktree } from "../app/loadConfig.js";
import { phaseGuardRefusal } from "../domain/security/phaseGuard.js";
import type { OutputPort } from "../ports/output.js";
import {
  argShapes,
  encodedText,
  flagShapes,
  fullName,
  messages,
  OPTION_HELP,
  Refused,
  usageSpec,
  type Command as RunnerCommand,
  type ErrorText,
  type Grouping,
  type Inputs,
  type Io,
  type Program,
  type Source,
  type StdinDocument,
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

/** The call's words once the program's own options are set aside: its switches, its usage
 *  format option with its value (spaced or attached), and a `--` written before the command
 *  word, which Commander reads past to the command. */
function leadingWords(
  program: Program<unknown>,
  argv: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const switches = programSwitches(program);
  const format = program.usage === undefined ? undefined : `--${program.usage.format}`;
  const words: string[] = [];
  let index = 0;
  for (; index < argv.length; index += 1) {
    const word = argv[index] ?? "";
    if (switches.has(word)) continue;
    if (format !== undefined && word === format) {
      index += 1;
      continue;
    }
    if (format !== undefined && word.startsWith(`${format}=`)) continue;
    break;
  }
  if (argv[index] === END_OF_OPTIONS) index += 1;
  for (; index < argv.length; index += 1) {
    const word = argv[index] ?? "";
    if (word === END_OF_OPTIONS) break;
    if (!switches.has(word)) words.push(word);
  }
  return words;
}

/** The runner's groups that Commander still holds in part: the group itself, its help, its
 *  refusal when called alone and its unmigrated commands stay Commander's, and only the runner
 *  commands named under it go to the runner. Every other runner group is held whole by the
 *  runner. Plan 3 of command-contracts empties the list. */
export const PARTIAL_GROUPS: ReadonlyArray<string> = ["artifact"];

/** The program's top-level groups the runner holds whole: each outermost group of its commands
 *  that PARTIAL_GROUPS does not name, in the order first declared. */
export function wholeGroups(program: Program<unknown>): ReadonlyArray<string> {
  const names: string[] = [];
  for (const command of program.commands) {
    const outermost = fullName(command).length > 1 ? fullName(command)[0] : undefined;
    if (outermost === undefined || PARTIAL_GROUPS.includes(outermost)) continue;
    if (!names.includes(outermost)) names.push(outermost);
  }
  return names;
}

/** Where the bridge sends a call. A call naming a whole group and none of its commands goes to
 *  the runner with the group's name, so that its help and its refusal are the runner's. */
export type Route =
  | { readonly to: "runner"; readonly command: ReadonlyArray<string> }
  | { readonly to: "runner"; readonly command: undefined; readonly group?: string }
  | { readonly to: "commander" };

/** Where a call goes: to the runner when its leading words, after the program's options, name
 *  one of the program's commands (the longest name that matches), or a group the runner holds
 *  whole whatever follows it (nothing, `--help`, a word that names none of its commands), or when
 *  it is the root's `--json-schema`; to Commander otherwise. */
export function route(program: Program<unknown>, argv: ReadonlyArray<string>): Route {
  const leading = leadingWords(program, argv);
  if (leading[0] === JSON_SCHEMA_OPTION) return { to: "runner", command: undefined };
  let named: ReadonlyArray<string> | undefined;
  for (const command of program.commands) {
    const name = fullName(command);
    const matches = name.every((part, index) => leading[index] === part);
    if (matches && (named === undefined || name.length > named.length)) named = name;
  }
  if (named !== undefined) return { to: "runner", command: named };
  const group = leading[0];
  return group !== undefined && wholeGroups(program).includes(group)
    ? { to: "runner", command: undefined, group }
    : { to: "commander" };
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
/** The options whose answer runs no command: help and the command's contracts. */
const NOTHING_RUN_OPTIONS: ReadonlySet<string> = new Set(["--help", "-h", JSON_SCHEMA_OPTION]);

export function runnerGuard(
  command: ReadonlyArray<string>,
  argv: ReadonlyArray<string>,
): { readonly text: string; readonly exit: 1 } | undefined {
  // Help and the contracts run nothing: the runner answers them inside a phase worktree too, as
  // Commander answered help before its guard ran.
  if (optionWords(argv).some((word) => NOTHING_RUN_OPTIONS.has(word))) return undefined;
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
  /** The runner, run over the process with these words: the exit code it answers. */
  readonly runRunner: (argv: ReadonlyArray<string>) => Promise<number>;
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
  // Commander's `help <command>` names a runner command, or a group the runner holds whole: the
  // runner's own help answers it, as `<words> --help` does, rather than the help-only stub's.
  const leading = leadingWords(program, edge.argv);
  if (leading[0] === "help") {
    const asked = route(program, leading.slice(1));
    if (asked.to === "runner" && asked.command !== undefined) {
      return edge.runRunner([...asked.command, "--help"]);
    }
    if (asked.to === "runner" && asked.group !== undefined) {
      return edge.runRunner([...leading.slice(1), "--help"]);
    }
  }
  // Commander's `<group> help [command]`, inside a group the runner holds whole, is that
  // command's help, or the group's.
  const at = leading.indexOf("help");
  if (at > 0) {
    const group = route(program, leading.slice(0, at));
    if (group.to === "runner" && group.command === undefined && group.group !== undefined) {
      return edge.runRunner([...leading.slice(0, at), ...leading.slice(at + 1), "--help"]);
    }
  }
  const routed = route(program, edge.argv);
  if (routed.to === "runner") {
    if (routed.command !== undefined && edge.inPhaseWorktree()) {
      const refused = runnerGuard(routed.command, edge.argv);
      if (refused !== undefined) {
        edge.err(refused.text);
        return refused.exit;
      }
    }
    return edge.runRunner(edge.argv);
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

/** phax's runner program run over this process. Each command provides its own layers inside
 *  its run, so the program needs no service. */
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
    runRunner: (argv) => runPhaxProgram({ ...processIo(process), argv }),
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

/** A runner command's chain of groups, outermost first. */
function chainOf(command: RunnerCommand<unknown>): ReadonlyArray<Grouping> {
  const chain: Grouping[] = [];
  for (let group = command.group; group !== undefined; group = group.parent) chain.unshift(group);
  return chain;
}

/** The Commander group a runner command belongs to, made when the tree has none. */
function groupOf(root: Command, command: RunnerCommand<unknown>): Command {
  let parent = root;
  for (const group of chainOf(command)) {
    parent =
      parent.commands.find((each) => each.name() === group.name) ??
      parent.command(group.name).description(group.summary);
  }
  return parent;
}

/** A runner command's help-only stub under `parent`: its summary, the arguments and options its
 *  shapes declare, `--json` and `--json-schema`, unknown options allowed. The bridge sends every
 *  call naming it to the runner, so its action never runs. */
function mountStub(parent: Command, command: RunnerCommand<unknown>): void {
  const stub = parent
    .command(command.name)
    .description(command.summary)
    .allowUnknownOption()
    .allowExcessArguments();
  const inputs: Inputs = command.input;
  for (const arg of inputs.args === undefined ? [] : argShapes(inputs.args.contract)) {
    const name = arg.variadic ? `${arg.name}...` : arg.name;
    stub.argument(arg.optional ? `[${name}]` : `<${name}>`, arg.help ?? "");
  }
  for (const flag of inputs.flags === undefined ? [] : flagShapes(inputs.flags.contract)) {
    const names =
      flag.alias === undefined ? `--${flag.option}` : `-${flag.alias}, --${flag.option}`;
    stub.option(flag.switch ? names : `${names} <${flag.valueName}>`, flag.help ?? "");
  }
  const stdinFlag = inputs.stdin?.flag;
  if (stdinFlag !== undefined) {
    if (inputs.stdin?.valueRequired === true) {
      stub.option(`--${stdinFlag} <file|->`, OPTION_HELP.stdinValue(stdinFlag));
    } else {
      stub.option(`--${stdinFlag} [path]`, OPTION_HELP.stdin(stdinFlag));
    }
  }
  stub.option(JSON_OPTION, OPTION_HELP.json).option(JSON_SCHEMA_OPTION, OPTION_HELP.jsonSchema);
  stub.action(() => {
    throw new Error(
      `phax ${fullName(command).join(" ")} answers through the runner; the bridge sends it there`,
    );
  });
  stubs.add(stub);
}

/** Mounts the runner command named `words` as a stub under `parent`, where it is called: a
 *  command file mounts its migrated commands at the place they held, so that the help and the
 *  usage spec keep their order. */
export function mountRunnerStub(
  parent: Command,
  program: Program<unknown>,
  words: ReadonlyArray<string>,
): void {
  const command = program.commands.find((each) => fullName(each).join(" ") === words.join(" "));
  if (command === undefined) {
    throw new Error(`phax ${words.join(" ")} is not a runner command`);
  }
  mountStub(parent, command);
}

/** The runner's commands under the group named `words`, each with its words after the group's. */
function commandsUnder(
  program: Program<unknown>,
  words: ReadonlyArray<string>,
): ReadonlyArray<{
  readonly command: RunnerCommand<unknown>;
  readonly rest: ReadonlyArray<string>;
}> {
  return program.commands.flatMap((command) => {
    const name = fullName(command);
    const under = name.length > words.length && words.every((word, index) => name[index] === word);
    return under ? [{ command, rest: name.slice(words.length) }] : [];
  });
}

/** Mounts the runner group named `words` under `parent`, where it is called, as a help-only
 *  group stub: the group's summary, and a help-only stub of each of its commands (its nested
 *  groups as help-only groups too), each registered as a stub. The bridge sends every call
 *  naming the group to the runner, which writes its help and its refusal; the usage spec
 *  generator splices the runner's whole block for the group at the stub's place. */
export function mountRunnerGroupStub(
  parent: Command,
  program: Program<unknown>,
  words: ReadonlyArray<string>,
): void {
  const held = commandsUnder(program, words);
  const first = held[0]?.command;
  const grouping = first === undefined ? undefined : chainOf(first)[words.length - 1];
  if (grouping === undefined) {
    throw new Error(`phax ${words.join(" ")} is not a runner group`);
  }
  const group = parent.command(grouping.name).description(grouping.summary);
  stubs.add(group);
  for (const { command, rest } of held) {
    const chain = chainOf(command);
    let level = group;
    rest.slice(0, -1).forEach((name, index) => {
      let nested = level.commands.find((each) => each.name() === name);
      if (nested === undefined) {
        nested = level.command(name).description(chain[words.length + index]?.summary ?? "");
        stubs.add(nested);
      }
      level = nested;
    });
    mountStub(level, command);
  }
}

/** Mounts each runner command no command file mounted as a stub at the end of its group, and
 *  refuses a runner command that is also a Commander command. A group the runner holds whole is
 *  mounted once as a group stub (at the end of the root when no command file mounted it), and its
 *  commands are not mounted again. */
export function mountRunnerStubs(root: Command, program: Program<unknown>): void {
  const whole = wholeGroups(program);
  for (const command of program.commands) {
    const outermost = fullName(command)[0] ?? "";
    if (fullName(command).length > 1 && whole.includes(outermost)) {
      const existing = root.commands.find((each) => each.name() === outermost);
      if (existing !== undefined && isRunnerStub(existing)) continue;
      if (existing !== undefined) {
        throw new Error(`phax ${outermost} is both a Commander group and a runner group`);
      }
      mountRunnerGroupStub(root, program, [outermost]);
      continue;
    }
    const parent = groupOf(root, command);
    const existing = parent.commands.find((each) => each.name() === command.name);
    if (existing !== undefined && isRunnerStub(existing)) continue;
    if (existing !== undefined) {
      throw new Error(
        `phax ${fullName(command).join(" ")} is both a Commander command and a runner command`,
      );
    }
    mountStub(parent, command);
  }
}

// ── The kept run functions ──────────────────────────────────────────────────────

/** What a kept run function prints to when it is not run by the runner. */
const OUTPUT_TERMINAL = { columns: 80, color: false } as const;

/** A runner command's run composed with its render, notes and sentences over the OutputPort:
 *  the run functions kept for the tests of the commands moved onto the runner (`runLs`,
 *  `runArtifactStatus`, `runPlansLint`, `runPlansOverview`). A progress note and the notes are
 *  warnings, a `say` line a log, a declared error's sentence an error; `json` logs the encoded
 *  output in place of the render. The command's check runs first: its refusal is an error, its
 *  text, answering the program's `refused` code. Answers the exit code the runner would: the
 *  refusal's, the error's, or the verdict's, or 0. */
export async function runThroughOutput(
  command: RunnerCommand<never>,
  input: Readonly<Record<string, unknown>>,
  out: OutputPort,
  options: {
    readonly json?: boolean;
    /** Log the render one line at a time, as the kept function did before its move. */
    readonly lineByLine?: boolean;
    /** Log these, one `out.log` each, in place of the render, as the kept function logged its
     *  sections before its move. */
    readonly sections?: (value: never) => ReadonlyArray<string>;
    /** Log a document the command answers in one `out.log`, as the kept function did before its
     *  move, rather than a line at a time. */
    readonly wholeDocument?: boolean;
    /** The stdin document as read, handed to the check and to run as the runner hands it. */
    readonly document?: StdinDocument;
  } = {},
): Promise<number> {
  const check = command.check;
  if (check !== undefined) {
    const checked = await Effect.runPromiseExit(
      Effect.suspend(() => check({ input, document: options.document })),
    );
    if (Exit.isFailure(checked)) {
      const failure: unknown = Option.getOrUndefined(Cause.failureOption(checked.cause));
      if (!(failure instanceof Refused)) throw Cause.squash(checked.cause);
      out.error(failure.text);
      return phaxProgram.exits.refused;
    }
  }
  const exit = await Effect.runPromiseExit(
    Effect.suspend(() =>
      command.run({
        input,
        program: {},
        progress: (text: string) =>
          Effect.sync(() => {
            if (text !== "") out.warn(text);
          }),
        say: (text: string) =>
          Effect.sync(() => {
            if (text !== "") out.log(text);
          }),
        document: options.document,
      }),
    ),
  );
  if (Exit.isFailure(exit)) {
    const failure = Cause.failureOption(exit.cause);
    const error: unknown = Option.getOrUndefined(failure);
    const tag =
      typeof error === "object" && error !== null ? Reflect.get(error, "_tag") : undefined;
    const exits: Readonly<Record<string, number>> = command.exits;
    const code = typeof tag === "string" ? exits[tag] : undefined;
    if (typeof tag !== "string" || code === undefined) throw Cause.squash(exit.cause);
    const texts: Readonly<Record<string, ((error: never) => ErrorText) | undefined>> =
      command.texts ?? {};
    const say = texts[tag];
    const said: ErrorText =
      say === undefined ? String(Reflect.get(error as object, "message")) : say(error as never);
    const sentence = typeof said === "string" ? said : said.err;
    if (typeof said !== "string" && said.out !== "") {
      for (const line of said.out.split("\n")) out.log(line);
    }
    for (const line of options.lineByLine === true ? sentence.split("\n") : [sentence]) {
      out.error(line);
    }
    return code;
  }
  const value: unknown = exit.value;
  const document = command.document?.(value);
  if (document !== undefined) {
    const text =
      typeof document.bytes === "string"
        ? document.bytes
        : new TextDecoder().decode(document.bytes);
    const lines = text.split("\n").slice(0, -1);
    for (const line of options.wholeDocument === true ? [lines.join("\n")] : lines) out.log(line);
  } else if (options.json === true && command.output !== undefined) {
    const output: Source<Schema.Schema.Any> = command.output;
    const encoded = Schema.encodeUnknownSync(output.contract as Schema.Schema<unknown, unknown>)(
      value,
    );
    out.log(encodedText(encoded).slice(0, -1));
  } else if (options.sections !== undefined) {
    for (const section of options.sections(value as never)) out.log(section);
  } else if (command.render !== undefined) {
    const text = command.render(value, OUTPUT_TERMINAL);
    for (const line of options.lineByLine === true ? text.split("\n") : [text]) out.log(line);
  }
  const notes = command.notes?.(value, OUTPUT_TERMINAL) ?? "";
  for (const line of notes === "" ? [] : notes.split("\n")) out.warn(line);
  const verdicts: Readonly<Record<number, (value: unknown) => boolean>> = command.verdicts ?? {};
  const verdict = Object.keys(verdicts)
    .map(Number)
    .toSorted((a, b) => a - b)
    .find((code) => verdicts[code]?.(value) === true);
  return verdict ?? 0;
}

// ── The usage spec's runner blocks ──────────────────────────────────────────────

/** What the usage spec generator splices from the runner program's usage spec. */
export interface RunnerUsage {
  /** The root's lines the runner adds: its exit codes' documentation and `--json-schema`. */
  readonly root: ReadonlyArray<string>;
  /** Each runner command's `cmd` block, unindented, keyed by its full name (`plans lint`). */
  readonly commands: ReadonlyMap<string, ReadonlyArray<string>>;
  /** Each runner group's whole `cmd` block (its header with `subcommand_required=#true`, and
   *  every command it holds), unindented, keyed by its full name (`cost`): the block the
   *  generator splices at a whole group's stub. */
  readonly groups: ReadonlyMap<string, ReadonlyArray<string>>;
  /** Each `complete` node the runner writes, keyed by its identifier, in its order. */
  readonly completes: ReadonlyMap<string, string>;
}

const INDENT = "    ";
const CMD_LINE = /^((?: {4})*)cmd ("(?:[^"\\]|\\.)*"|\S+)/;

/** A KDL word as written: a quoted string's text, a bare word as it is. */
const unquoted = (word: string): string =>
  word.startsWith('"')
    ? (JSON.parse(word.replace(/\\u\{([0-9a-f]+)\}/g, "\\u$1")) as string)
    : word;

/** The node starting at `start`, its children and its closing brace included, unindented. */
function blockAt(lines: ReadonlyArray<string>, start: number, indent: string): string[] {
  const line = lines[start] as string;
  const block = [line];
  if (line.endsWith(" {")) {
    for (let index = start + 1; index < lines.length; index += 1) {
      const inner = lines[index] as string;
      block.push(inner);
      if (inner === `${indent}}`) break;
    }
  }
  return block.map((each) => each.slice(indent.length));
}

const COMPLETE_LINE = /^complete ("(?:[^"\\]|\\.)*")/;

/** Cuts the runner program's usage spec into the root's added lines, its `complete` nodes, each
 *  command's block and each group's whole block. */
export function runnerUsage(program: Program<unknown>): RunnerUsage {
  const lines = usageSpec(program).split("\n");
  const root = lines.filter(
    (line) => line.startsWith("after_long_help ") || line.startsWith(`flag ${JSON_SCHEMA_OPTION} `),
  );
  const completes = new Map<string, string>();
  for (const line of lines) {
    const match = COMPLETE_LINE.exec(line);
    if (match !== null) completes.set(unquoted(match[1] ?? ""), line);
  }
  const commands = new Map<string, ReadonlyArray<string>>();
  const groupBlocks = new Map<string, ReadonlyArray<string>>();
  const groups: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const match = CMD_LINE.exec(line);
    if (match === null) continue;
    const indent = match[1] ?? "";
    const depth = indent.length / INDENT.length;
    const name = unquoted(match[2] ?? "");
    groups.length = depth;
    const block = blockAt(lines, index, indent);
    if (line.includes(" subcommand_required=#true")) {
      groups.push(name);
      groupBlocks.set(groups.join(" "), block);
      continue;
    }
    index += block.length - 1;
    commands.set([...groups, name].join(" "), block);
  }
  return { root, commands, groups: groupBlocks, completes };
}
