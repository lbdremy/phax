import { Clock, Effect, type Result } from "effect";
import type { MeasuredTime } from "../schemas/gateAttribution.js";

/**
 * The time between two `Clock.currentTimeMillis` readings: the start as an
 * ISO-8601 UTC instant with milliseconds, the duration in whole milliseconds,
 * never negative (a clock stepping backwards gives 0).
 */
export function measuredTime(startedAtMs: number, endedAtMs: number): MeasuredTime {
  return {
    kind: "measured",
    startedAt: new Date(startedAtMs).toISOString(),
    durationMs: Math.max(0, Math.round(endedAtMs - startedAtMs)),
  };
}

/**
 * Runs `effect` between two readings of Effect's `Clock` and succeeds with its
 * result and its time, whether it succeeded or failed: a failure is timed too,
 * and the caller decides whether to re-fail with it.
 */
export function timed<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<readonly [Result.Result<A, E>, MeasuredTime], never, R> {
  return Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    const outcome = yield* Effect.result(effect);
    const endedAt = yield* Clock.currentTimeMillis;
    return [outcome, measuredTime(startedAt, endedAt)] as const;
  });
}
