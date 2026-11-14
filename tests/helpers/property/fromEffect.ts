// The bridge from effect/Arbitrary into fast-check. effect's Arbitrary is opaque and runs only on
// its own runner, so a schema's derived generator is exposed to fast-check as an arbitrary over a
// (seed, size) pair, each pair sampled once through Arbitrary.sampleEffect. fast-check shrinks the
// pair (size toward 0), not the value's structure. The unstable effect/Arbitrary module is
// confined to this file.
import { Arbitrary, Cause, Effect, Exit, type Schema } from "effect";
import fc from "fast-check";

/** The default upper bound of the size a sample is drawn at. */
const DEFAULT_MAX_SIZE = 10;

const EXHAUSTED: unique symbol = Symbol("exhausted");

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const derive = <S extends Schema.Constraint>(
  label: string,
  schema: S,
): Arbitrary.Arbitrary<S["Type"]> => {
  try {
    return Arbitrary.schema(schema);
  } catch (cause) {
    throw new Error(`cannot derive a generator for ${label}: ${describeCause(cause)}`, { cause });
  }
};

const sample = <A>(
  derived: Arbitrary.Arbitrary<A>,
  seed: number,
  size: number,
): A | typeof EXHAUSTED => {
  const exit = Effect.runSyncExit(Arbitrary.sampleEffect(derived, { count: 1, seed, size }));
  if (Exit.isSuccess(exit)) return exit.value.length === 1 ? (exit.value[0] as A) : EXHAUSTED;
  // A SampleError (the only typed failure) means the sample exhausted its discards.
  if (Cause.hasFails(exit.cause) && !Cause.hasDies(exit.cause)) return EXHAUSTED;
  throw new Error(`sampling failed: ${String(Cause.squash(exit.cause))}`);
};

/**
 * The value effect/Arbitrary derives from `schema` at `seed` and `size`, or `undefined` when the
 * sample exhausts its discards. Deterministic for a given (seed, size) pair.
 */
export const sampleOnce = <S extends Schema.Constraint>(
  label: string,
  schema: S,
  seed: number,
  size: number,
): { readonly value: S["Type"] } | undefined => {
  const value = sample(derive(label, schema), seed, size);
  return value === EXHAUSTED ? undefined : { value };
};

/**
 * A fast-check arbitrary of `schema`'s decoded Type, derived through effect/Arbitrary. Throws an
 * error naming `label` when effect cannot derive the schema.
 */
export const fromSchema = <S extends Schema.Constraint>(
  label: string,
  schema: S,
  options?: { readonly maxSize?: number },
): fc.Arbitrary<S["Type"]> => {
  const derived = derive(label, schema);
  return fc
    .record({
      seed: fc.integer(),
      size: fc.integer({ min: 0, max: options?.maxSize ?? DEFAULT_MAX_SIZE }),
    })
    .map(({ seed, size }) => sample(derived, seed, size))
    .filter((value): value is S["Type"] => value !== EXHAUSTED);
};
