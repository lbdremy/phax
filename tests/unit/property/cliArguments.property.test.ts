// The command library's refusal contract, over any argument vector (§5.16, ac-cli-argv): a call
// runs the command its words name and exits with a code the program declares, or is refused with
// the program's refused code, nothing on stdout and a message on stderr. It never ends with the
// defect code. Every code is read from the program's `exits`, and each code a call ends with
// other than the refused one is bound to evidence that the command ran: its output, or the help,
// the version, the usage spec or the JSON Schema a call asked for.
import { isDeepStrictEqual } from "node:util";
import { Effect, Exit } from "effect";
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runner } from "../../../src/cli/commandLibrary/commander/run.js";
import { memoryIo } from "../../../src/cli/commandLibrary/contract/conformance/memoryIo.js";
import {
  fullName,
  usageSpec,
  type Command,
} from "../../../src/cli/commandLibrary/contract/index.js";
import {
  anyArgv,
  argvVocabulary,
  knownArgv,
  type ArgvCase,
} from "../../helpers/property/argvInputs.js";
import {
  VERDICT_DEFAULT,
  argvProgram,
  declaredExitCodes,
} from "../../helpers/property/argvProgram.js";
import { checkProperty, propertyTimeout } from "../../helpers/property/harness.js";

const program = argvProgram();
const declared = declaredExitCodes(program);
const vocabulary = argvVocabulary(program);
const inputs = fc.oneof(anyArgv(), knownArgv(program));
// The key the program's env source reads; its value is not what is under test.
const ENV = { PROP_PROFILE: "default" };

// The seed and size of the sample that checks the argv source reaches every outcome: fixed, so the
// check is reproducible.
const SAMPLE_SEED = 20_261_116;
const SAMPLE_SIZE = 2000;

const runCase = (input: ArgvCase) => {
  const io = memoryIo({
    argv: input.argv,
    stdin: input.stdin,
    env: ENV,
    stdinIsTerminal: false,
  });
  return { io, exit: Effect.runSyncExit(runner.run(program, io.io)) };
};

// --- The evidence a call ran -------------------------------------------------------------------

const programOptions = new Map(vocabulary.programOptions.map((option) => [option.long, option]));

/** The command the call's words name: its operands once the program's options (which stand
 *  anywhere) and every other dash-led word are set aside, read up to `--`, start with the
 *  command's full name; the longest such name wins. */
const matchedCommand = (argv: ReadonlyArray<string>): Command<unknown> | undefined => {
  const words: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] ?? "";
    if (word === "--") break;
    const option = programOptions.get(word);
    if (option !== undefined) {
      if (option.takesValue) index += 1;
      continue;
    }
    if (!word.startsWith("-")) words.push(word);
  }
  let matched: Command<unknown> | undefined;
  for (const command of program.commands) {
    const path = fullName(command);
    const named = path.every((word, index) => words[index] === word);
    if (named && path.length > (matched === undefined ? 0 : fullName(matched).length)) {
      matched = command;
    }
  }
  return matched;
};

/** The words stdout may be the rendered form of: the text as written, or the JSON string `--json`
 *  writes. An empty render writes nothing. */
const renderedWords = (out: string): ReadonlyArray<string> => {
  if (out === "") return [""];
  if (!out.endsWith("\n")) return [];
  const body = out.slice(0, -1);
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "string" ? [body, parsed] : [body];
  } catch {
    return [body];
  }
};

/** The first verdict code, ascending, whose predicate holds for `value`; 0 when none does. */
const verdictCode = (command: Command<unknown>, value: unknown): number => {
  const verdicts: Readonly<Record<number, (value: unknown) => boolean>> = command.verdicts ?? {};
  const codes = Object.keys(verdicts)
    .map(Number)
    .toSorted((a, b) => a - b);
  return codes.find((code) => verdicts[code]?.(value) === true) ?? 0;
};

/** stdout is the command's output, and `code` the verdict that output earns: a command without
 *  verdicts answers its own name; one with verdicts answers its operand, or its default. */
const ranCommand = (
  command: Command<unknown>,
  argv: ReadonlyArray<string>,
  out: string,
  code: number,
): boolean =>
  renderedWords(out).some((word) =>
    command.verdicts === undefined
      ? code === 0 && word === command.name
      : (argv.includes(word) || word === VERDICT_DEFAULT) && verdictCode(command, word) === code,
  );

/** stdout is what a call that asked for it displays: the help, the version, the usage spec or the
 *  command's JSON Schema. */
const displayed = (
  command: Command<unknown> | undefined,
  argv: ReadonlyArray<string>,
  out: string,
): boolean => {
  const asks = (...words: ReadonlyArray<string>): boolean =>
    argv.some((word) => words.includes(word.split("=")[0] ?? ""));
  if (asks("--help", "-h", "help") && out.startsWith(`Usage: ${program.name}`)) return true;
  if (asks(...vocabulary.version) && out === `${program.version}\n`) return true;
  if (asks(...vocabulary.usage) && out === usageSpec(program)) return true;
  if (command === undefined || !asks("--json-schema")) return false;
  try {
    const schema: unknown = JSON.parse(out);
    return (
      typeof schema === "object" &&
      schema !== null &&
      isDeepStrictEqual(Reflect.get(schema, "name"), fullName(command))
    );
  } catch {
    return false;
  }
};

/** A call that ended with a code the command's `exits` maps, or the guard's code for its words,
 *  wrote nothing on stdout and said why on stderr. */
const endedByCommand = (command: Command<unknown>, code: number): boolean => {
  const exits: Readonly<Record<string, number>> = command.exits;
  return (
    Object.values(exits).includes(code) ||
    program.guard?.({ words: fullName(command), options: {} })?.exit === code
  );
};

const runsOrRefuses = (input: ArgvCase): boolean => {
  const { io, exit } = runCase(input);
  if (!Exit.isSuccess(exit) || typeof exit.value !== "number") return false;
  const code: number = exit.value;
  const out = io.out();
  if (code === program.exits.defect) return false;
  if (code === program.exits.refused) return out === "" && io.err() !== "";
  if (!declared.has(code)) return false;
  const command = matchedCommand(input.argv);
  if (code === 0 && displayed(command, input.argv, out)) return true;
  if (command === undefined) return false;
  if (endedByCommand(command, code)) return out === "" && io.err() !== "";
  return ranCommand(command, input.argv, out, code);
};

describe("cli arguments", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit was called");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    "any argv is run or refused through the contract",
    () => {
      checkProperty(inputs, runsOrRefuses);
    },
    propertyTimeout(),
  );

  it("the argv source reaches every code the program declares, and the refusal", () => {
    const sample = fc.sample(inputs, { numRuns: SAMPLE_SIZE, seed: SAMPLE_SEED });
    const reached = new Set<number>();
    for (const input of sample) {
      const { exit } = runCase(input);
      if (Exit.isSuccess(exit)) reached.add(exit.value);
    }
    const expected = [...declared, program.exits.refused].toSorted((a, b) => a - b);
    expect([...reached].toSorted((a, b) => a - b)).toEqual(expected);
  });

  it(
    "no argv reaches the process",
    () => {
      checkProperty(inputs, (input) => {
        runCase(input);
        return exitSpy.mock.calls.length === 0;
      });
      expect(exitSpy).not.toHaveBeenCalled();
    },
    propertyTimeout(),
  );
});
