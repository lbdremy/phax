// The property harness: the one door every property of this spec goes through. It reads the
// three environment variables (PHAX_PROPERTY_SEED, PHAX_PROPERTY_PATH, PHAX_PROPERTY_RUNS),
// checks a property with fast-check under them, and on a failure answers the seed, the path, the
// shrunk counter-example and a replay line.
import { isDeepStrictEqual } from "node:util";
import * as fc from "fast-check";
import { expect } from "vitest";

/** Inputs a property is checked against when PHAX_PROPERTY_RUNS is unset. */
export const DEFAULT_PROPERTY_RUNS = 100;

// The seed every property runs from while PHAX_PROPERTY_SEED is unset. Never change it casually:
// a change moves every property to inputs nobody has looked at yet.
const DEFAULT_PROPERTY_SEED = 20_261_113;

const UNIT_TIMEOUT_MS = 30_000;

/** The environment a property reads its parameters from; tests pass an explicit object. */
export type PropertyEnv = Readonly<Record<string, string | undefined>>;

export interface PropertyParameters {
  readonly seed: number;
  readonly path: string | undefined;
  readonly runs: number;
  /** `default` is the fixed seed, `env` a PHAX_PROPERTY_SEED number, `random` a drawn one. */
  readonly seedSource: "default" | "env" | "random";
}

/** A PHAX_PROPERTY_* variable holds a value the harness refuses. */
export class PropertyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PropertyConfigError";
  }
}

const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

const randomInt32 = (): number => Math.floor(Math.random() * 2 ** 32) + INT32_MIN;

// PHAX_PROPERTY_SEED=random draws one seed per process, on first read, so every property of the
// process runs from the seed the notice prints. Vitest gives each test file its own module
// instance, so a vitest run draws, and prints, one seed per property file.
let randomSeed: number | undefined;
const processRandomSeed = (): number => (randomSeed ??= randomInt32());

export interface PropertyOptions {
  /**
   * The inputs this property checks while PHAX_PROPERTY_RUNS is unset, in place of
   * DEFAULT_PROPERTY_RUNS. A set PHAX_PROPERTY_RUNS (the deep pass) still wins.
   */
  readonly defaultRuns?: number;
}

/** Reads PHAX_PROPERTY_SEED, PHAX_PROPERTY_PATH and PHAX_PROPERTY_RUNS from `env`. */
export const readPropertyParameters = (
  env: PropertyEnv,
  options: PropertyOptions = {},
): PropertyParameters => {
  const rawSeed = env["PHAX_PROPERTY_SEED"];
  let seed = DEFAULT_PROPERTY_SEED;
  let seedSource: PropertyParameters["seedSource"] = "default";
  if (rawSeed !== undefined) {
    if (rawSeed === "random") {
      seed = processRandomSeed();
      seedSource = "random";
    } else {
      const parsed = /^-?\d+$/.test(rawSeed) ? Number(rawSeed) : Number.NaN;
      if (!Number.isInteger(parsed) || parsed < INT32_MIN || parsed > INT32_MAX) {
        throw new PropertyConfigError(
          `PHAX_PROPERTY_SEED must be "random" or an integer within int32, got "${rawSeed}"`,
        );
      }
      seed = parsed;
      seedSource = "env";
    }
  }

  const rawPath = env["PHAX_PROPERTY_PATH"];
  if (rawPath !== undefined) {
    if (!/^\d+(:\d+)*$/.test(rawPath)) {
      throw new PropertyConfigError(
        `PHAX_PROPERTY_PATH must be colon-separated decimal integers, got "${rawPath}"`,
      );
    }
    if (seedSource !== "env") {
      throw new PropertyConfigError(
        `PHAX_PROPERTY_PATH needs a fixed PHAX_PROPERTY_SEED (an integer); it is unset or "random"`,
      );
    }
  }

  const rawRuns = env["PHAX_PROPERTY_RUNS"];
  let runs = options.defaultRuns ?? DEFAULT_PROPERTY_RUNS;
  if (rawRuns !== undefined) {
    const parsed = /^\d+$/.test(rawRuns) ? Number(rawRuns) : Number.NaN;
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new PropertyConfigError(
        `PHAX_PROPERTY_RUNS must be a positive decimal integer, got "${rawRuns}"`,
      );
    }
    runs = parsed;
  }

  return { seed, path: rawPath, runs, seedSource };
};

/** The line printed for a random seed, naming it; undefined for any other seed source. */
export const seedNotice = (parameters: PropertyParameters): string | undefined =>
  parameters.seedSource === "random"
    ? `Property seed ${parameters.seed} (PHAX_PROPERTY_SEED=random); replay with PHAX_PROPERTY_SEED=${parameters.seed}`
    : undefined;

export interface PropertyLocation {
  /** The repo-relative test file. */
  readonly file: string;
  /** The full test name, as vitest prints it (`describe > it`). */
  readonly name: string;
}

export type PropertyOutcome<T> =
  | { readonly kind: "passed"; readonly seed: number; readonly runs: number }
  | {
      readonly kind: "failed";
      readonly seed: number;
      readonly path: string;
      readonly counterexample: T;
      /** The counter-example as a literal (JSON for JSON-carryable values). */
      readonly literal: string;
      /** The command line that replays this failure. */
      readonly replay: string;
      /** The full failure message: seed, path, literal and replay line. */
      readonly report: string;
    };

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

const literalOf = (value: unknown): string => {
  try {
    const json = JSON.stringify(value);
    if (json !== undefined && isDeepStrictEqual(JSON.parse(json), value)) return json;
  } catch {
    // Not JSON-carryable (a bigint, a cycle): fall through to fast-check's printer.
  }
  return fc.stringify(value);
};

// The characters with a meaning in a regular expression.
const REGEXP_SYNTAX = /[.*+?^${}()|[\]\\]/g;

/**
 * The `-t` pattern that selects exactly the test named `name`. Vitest matches `-t` as a regular
 * expression against each test's full name (`describe > it`, without the file), so the name is
 * escaped and anchored: unanchored, `hand-decision-answer > …` would also select
 * `plan-hand-decision-answer > …`.
 */
const testNamePattern = (name: string): string => `^${name.replaceAll(REGEXP_SYNTAX, "\\$&")}$`;

/** The command line that replays the failure at `seed` and `path` of the test at `location`. */
export const replayCommand = (seed: number, path: string, location: PropertyLocation): string =>
  `PHAX_PROPERTY_SEED=${seed} PHAX_PROPERTY_PATH=${path} pnpm test:unit ${location.file} -t ${shellQuote(testNamePattern(location.name))}`;

const runWith = <T>(
  { seed, path, runs }: PropertyParameters,
  arbitrary: fc.Arbitrary<T>,
  predicate: (value: T) => boolean,
  location: PropertyLocation,
): PropertyOutcome<T> => {
  const details = fc.check(fc.property(arbitrary, predicate), {
    seed,
    ...(path === undefined ? {} : { path }),
    numRuns: runs,
  });
  if (!details.failed) return { kind: "passed", seed, runs: details.numRuns };

  const counterexample = (details.counterexample as [T])[0];
  const failedPath = details.counterexamplePath ?? "";
  const literal = literalOf(counterexample);
  const replay = replayCommand(seed, failedPath, location);
  const error = details.errorInstance;
  const report = [
    `Property failed after ${details.numRuns} runs (seed ${seed}, path "${failedPath}"), shrunk ${details.numShrinks} times`,
    "Counter-example:",
    `  ${literal}`,
    ...(error instanceof Error ? [error.message] : []),
    "Replay:",
    `  ${replay}`,
  ].join("\n");
  return { kind: "failed", seed, path: failedPath, counterexample, literal, replay, report };
};

/** Checks `predicate` over `arbitrary` under the parameters read from `options.env`. */
export const runProperty = <T>(
  arbitrary: fc.Arbitrary<T>,
  predicate: (value: T) => boolean,
  options: PropertyOptions & { readonly env: PropertyEnv; readonly location: PropertyLocation },
): PropertyOutcome<T> =>
  runWith(readPropertyParameters(options.env, options), arbitrary, predicate, options.location);

let noticePrinted = false;

const locationFromVitest = (): PropertyLocation => {
  const state = expect.getState();
  const testPath = state.testPath ?? "";
  const relative = testPath.startsWith(process.cwd())
    ? testPath.slice(process.cwd().length).replace(/^[\\/]+/, "")
    : testPath;
  return { file: relative.replaceAll("\\", "/"), name: state.currentTestName ?? "" };
};

/**
 * Checks `predicate` over `arbitrary` as the current vitest test; returns on a pass, throws the
 * full report on a failure.
 */
export const checkProperty = <T>(
  arbitrary: fc.Arbitrary<T>,
  predicate: (value: T) => boolean,
  env: PropertyEnv = process.env,
  options: PropertyOptions = {},
): void => {
  const parameters = readPropertyParameters(env, options);
  const notice = seedNotice(parameters);
  if (notice !== undefined && !noticePrinted) {
    noticePrinted = true;
    process.stdout.write(`${notice}\n`);
  }
  // The parameters just read, not read again: the notice names the seed this property runs from.
  const outcome = runWith(parameters, arbitrary, predicate, locationFromVitest());
  if (outcome.kind === "failed") throw new Error(outcome.report);
};

/** The per-test timeout: the unit tier's 30 s at 100 runs, growing with PHAX_PROPERTY_RUNS. */
export const propertyTimeout = (
  parameters: PropertyParameters = readPropertyParameters(process.env),
): number => UNIT_TIMEOUT_MS * Math.max(1, Math.ceil(parameters.runs / 100));
