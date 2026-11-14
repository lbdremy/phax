// The property harness: the one door every property of this spec goes through. It reads the
// three environment variables (PHAX_PROPERTY_SEED, PHAX_PROPERTY_PATH, PHAX_PROPERTY_RUNS),
// checks a property with fast-check under them, and on a failure answers the seed, the path, the
// shrunk counter-example and a replay line.
//
// This is the stub the harness acceptance tests are written against: every body throws until the
// next phase lands the real logic. The signatures are final.
import type * as fc from "fast-check";

/** Inputs a property is checked against when PHAX_PROPERTY_RUNS is unset. */
export const DEFAULT_PROPERTY_RUNS = 100;

/** The environment a property reads its parameters from; tests pass an explicit object. */
export type PropertyEnv = Readonly<Record<string, string | undefined>>;

export interface PropertyParameters {
  readonly seed: number;
  readonly path: string | undefined;
  readonly runs: number;
  /** `default` is the fixed seed, `env` a PHAX_PROPERTY_SEED number, `random` a drawn one. */
  readonly seedSource: "default" | "env" | "random";
}

/** Reads PHAX_PROPERTY_SEED, PHAX_PROPERTY_PATH and PHAX_PROPERTY_RUNS from `env`. */
export const readPropertyParameters = (_env: PropertyEnv): PropertyParameters => {
  throw new Error("not implemented: readPropertyParameters");
};

/** The line printed for a random seed, naming it; undefined for any other seed source. */
export const seedNotice = (_parameters: PropertyParameters): string | undefined => {
  throw new Error("not implemented: seedNotice");
};

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

/** Checks `predicate` over `arbitrary` under the parameters read from `options.env`. */
export const runProperty = <T>(
  _arbitrary: fc.Arbitrary<T>,
  _predicate: (value: T) => boolean,
  _options: { readonly env: PropertyEnv; readonly location: PropertyLocation },
): PropertyOutcome<T> => {
  throw new Error("not implemented: runProperty");
};
