// The lift of the gate-times change (spec gate-step-times): an attribution of a
// shape before step times (0.33.0 and earlier, its steps' surfaces already
// lifted) turned into the current shape, every time `unknown` except a skipped
// acceptance step's `not-run`. Shared by phax's reader
// (src/schemas/persisted.ts) and the schemas package's `toLatestGateAttribution`,
// so the two cannot disagree on the same document. Imports only `effect` and
// types from src/schemas, because the schemas package publishes it. Every other
// fact is kept as it was recorded.
import type { GateAttribution, GateStepResult, ProtectedPathsResult } from "./gateAttribution.js";
import type { RecordedSurface } from "./surface.js";

/** A configured step's surface: any recorded surface but `acceptance`. */
type ConfiguredSurface = Exclude<RecordedSurface, "acceptance">;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A gate step as a shape before step times recorded it: no `time`. */
export type UntimedGateStep =
  | {
      readonly command: string;
      readonly surface: ConfiguredSurface;
      readonly result: "pass" | "fail" | "refused";
    }
  | {
      readonly command: string;
      readonly surface: "acceptance";
      readonly result: "pass" | "fail" | "refused" | "skipped";
    };

/** A protected-paths result as a shape before step times recorded it: no `time`. */
type UntimedProtectedPathsResult = DistributiveOmit<
  NonNullable<ProtectedPathsResult>,
  "time"
> | null;

/** A gate attribution as a shape before step times recorded it: no `time` anywhere. */
export interface UntimedGateAttribution {
  readonly phase: string;
  readonly steps: ReadonlyArray<UntimedGateStep>;
  readonly protectedPaths: UntimedProtectedPathsResult;
}

const UNKNOWN = { kind: "unknown" } as const;

/** A step with its time: `not-run` when it is a skipped acceptance step, else `unknown`. */
function liftUntimedStep(step: UntimedGateStep): GateStepResult {
  if (step.surface === "acceptance") {
    if (step.result === "skipped") {
      return {
        command: step.command,
        surface: step.surface,
        result: "skipped",
        time: { kind: "not-run" },
      };
    }
    return { command: step.command, surface: step.surface, result: step.result, time: UNKNOWN };
  }
  return { command: step.command, surface: step.surface, result: step.result, time: UNKNOWN };
}

/** The protected-paths result with its time `unknown`; null stays null. */
function liftUntimedProtectedPaths(
  protectedPaths: UntimedProtectedPathsResult,
): ProtectedPathsResult {
  if (protectedPaths === null) return null;
  if (protectedPaths.result === "pass") {
    return { result: "pass", changes: protectedPaths.changes, time: UNKNOWN };
  }
  return { result: "fail", changes: protectedPaths.changes, time: UNKNOWN };
}

/**
 * An untimed attribution in the current shape: the attempt, every step that
 * started and a non-null protected-paths result timed `unknown`, a skipped
 * acceptance step `not-run`. Keys in the current shape's order.
 */
export function liftUntimedGateAttribution(untimed: UntimedGateAttribution): GateAttribution {
  return {
    phase: untimed.phase,
    time: UNKNOWN,
    steps: untimed.steps.map(liftUntimedStep),
    protectedPaths: liftUntimedProtectedPaths(untimed.protectedPaths),
  };
}
