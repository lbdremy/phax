import { Effect } from "effect";

/** Runs an effect and keeps its failure as a value, so the caller decides what it means. */
export const settle = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.either(effect);

/** Runs every effect, keeping each failure as a value instead of stopping at the first. */
export const settleAll = <A, E, R>(effects: ReadonlyArray<Effect.Effect<A, E, R>>) =>
  Effect.forEach(effects, (effect) => effect.pipe(Effect.either));
