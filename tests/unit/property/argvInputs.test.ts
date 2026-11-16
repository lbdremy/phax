// In-phase checks of the CLI-argument property's inputs: the property program offers every path
// `PROGRAM_SHAPES` names, the vocabulary read from it is what its usage spec prints, and the
// generators draw the program's own command paths.
import { Effect, Exit } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runner } from "../../../src/cli/commandLibrary/commander/run.js";
import { memoryIo } from "../../../src/cli/commandLibrary/contract/conformance/memoryIo.js";
import { fullName, usageSpec } from "../../../src/cli/commandLibrary/contract/index.js";
import {
  anyArgv,
  argvVocabulary,
  knownArgv,
  type ArgvCase,
} from "../../helpers/property/argvInputs.js";
import {
  ARGV_GUARD_EXIT,
  PROGRAM_SHAPES,
  argvProgram,
  declaredExitCodes,
} from "../../helpers/property/argvProgram.js";
import { checkProperty, propertyTimeout } from "../../helpers/property/harness.js";

// The seed of the sample that checks the known source reaches every command path: fixed, so the
// check is reproducible.
const SAMPLE_SEED = 20_261_116;
const SAMPLE_SIZE = 1000;

const startsWith = (argv: ReadonlyArray<string>, words: ReadonlyArray<string>): boolean =>
  words.every((word, index) => argv[index] === word);

describe("the property program", () => {
  it.each(PROGRAM_SHAPES)("the property program offers $name", ({ holds }) => {
    expect(holds(argvProgram())).toBe(true);
  });

  it("names each shape once, in kebab-case, with a one-line reason", () => {
    const names = PROGRAM_SHAPES.map((shape) => shape.name);
    expect(new Set(names).size).toBe(names.length);
    for (const shape of PROGRAM_SHAPES) {
      expect(shape.name).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(shape.reason).not.toMatch(/\n/);
      expect(shape.reason.length).toBeGreaterThan(0);
    }
  });

  it("is a program the runner runs, not one it refuses as misdeclared", () => {
    const program = argvProgram();
    const memory = memoryIo({ argv: ["pair", "a", "b"] });
    const exit = Effect.runSyncExit(runner.run(program, memory.io));
    expect(Exit.isSuccess(exit) ? exit.value : exit).toBe(0);
    expect(memory.out()).toBe("pair\n");
  });

  it("declaredExitCodes holds neither the refused nor the defect code", () => {
    const program = argvProgram();
    const codes = declaredExitCodes(program);
    expect(codes.has(program.exits.refused)).toBe(false);
    expect(codes.has(program.exits.defect)).toBe(false);
    expect(program.exits.refused).not.toBe(program.exits.defect);
    expect(codes.has(0)).toBe(true);
    expect(codes.has(ARGV_GUARD_EXIT)).toBe(true);
  });
});

describe("the argv vocabulary", () => {
  it("every vocabulary word appears in the program's usage spec", () => {
    const program = argvProgram();
    const vocabulary = argvVocabulary(program);
    const spec = usageSpec(program);
    const missing: string[] = [];
    const expectIn = (word: string): void => {
      if (!spec.includes(word)) missing.push(word);
    };
    for (const command of vocabulary.commands) {
      for (const word of command.path) expectIn(`cmd ${word}`);
      for (const option of command.options) {
        expectIn(option.alias === undefined ? option.long : `${option.long} ${option.alias}`);
      }
    }
    for (const group of vocabulary.groups) for (const word of group.path) expectIn(`cmd ${word}`);
    for (const option of vocabulary.programOptions) expectIn(option.long);
    for (const word of vocabulary.usage) expectIn(word);
    expectIn(`version "${program.version}"`);
    expect(missing).toEqual([]);
    // The positionals the vocabulary counts are the `arg` nodes the spec writes.
    const counted = vocabulary.commands.reduce((sum, command) => sum + command.arguments, 0);
    const written = spec.split("\n").filter((line) => line.trim().startsWith("arg ")).length;
    expect(counted).toBe(written);
  });

  it("the words the usage spec never prints are exactly the retired and the runner's own", () => {
    const program = argvProgram();
    const vocabulary = argvVocabulary(program);
    const spec = usageSpec(program);
    // A retired word is never in the usage spec.
    for (const word of vocabulary.groups.flatMap((group) => group.retired)) {
      expect(spec, `retired word ${word}`).not.toContain(word);
    }
    for (const word of vocabulary.commands.flatMap((command) => command.retiredOptions)) {
      expect(spec, `retired option ${word}`).not.toContain(word);
    }
    // `--version` and its letter are the runner's: the spec carries the version, not its flags.
    expect(vocabulary.version).toEqual(["--version", `-${program.versionAlias}`]);
  });
});

describe("the argv generators", () => {
  it(
    "every known argv starts with a full command path of the program",
    () => {
      const program = argvProgram();
      const paths = program.commands.map(fullName);
      checkProperty(
        knownArgv(program).filter((value) => value.origin === "known"),
        (value) => paths.some((path) => startsWith(value.argv, path)),
      );
    },
    propertyTimeout(),
  );

  it(
    "the other known origins start with the words they name",
    () => {
      const program = argvProgram();
      const vocabulary = argvVocabulary(program);
      const retired = vocabulary.groups.flatMap((group) =>
        group.retired.map((word) => [...group.path, word]),
      );
      const roots = new Set([
        ...vocabulary.usage,
        ...vocabulary.version,
        ...vocabulary.programOptions.map((option) => option.long),
        "help",
      ]);
      checkProperty(
        knownArgv(program).filter((value) => value.origin !== "known"),
        (value) =>
          value.origin === "known-retired"
            ? retired.some((words) => startsWith(value.argv, words))
            : // The format option may be attached: `--usage-format=kdl`.
              value.origin === "known-root" && roots.has((value.argv[0] ?? "").split("=")[0] ?? ""),
      );
    },
    propertyTimeout(),
  );

  it("the known source reaches every command path", () => {
    const program = argvProgram();
    const sample = fc.sample(knownArgv(program), { numRuns: SAMPLE_SIZE, seed: SAMPLE_SEED });
    const missed = program.commands
      .map(fullName)
      .filter((path) => !sample.some((value) => startsWith(value.argv, path)))
      .map((path) => path.join(" "));
    expect(missed, `paths the sample missed: ${missed.join(", ")}`).toEqual([]);
    const origins = new Set(sample.map((value) => value.origin));
    expect([...origins].toSorted()).toEqual(["known", "known-retired", "known-root"]);
  });

  it(
    "the arbitrary source draws at most six words of its two kinds",
    () => {
      const seen = new Set<ArgvCase["origin"]>();
      checkProperty(anyArgv(), (value) => {
        seen.add(value.origin);
        return (
          value.argv.length <= 6 &&
          value.argv.every((word) => typeof word === "string") &&
          typeof value.stdin === "string"
        );
      });
      expect([...seen].toSorted()).toEqual(["any-strings", "option-like"]);
    },
    propertyTimeout(),
  );
});
