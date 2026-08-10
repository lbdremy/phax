import { Either } from "effect";
import { InvalidArtifactTransitionError } from "../errors.js";

export type ArtifactKind = "spec" | "plan";

export const SPEC_STATUSES = ["Draft", "Approved", "Abandoned", "Archived"] as const;
export const PLAN_STATUSES = ["Draft", "Approved", "Stale", "Abandoned", "Archived"] as const;

export type SpecStatus = (typeof SPEC_STATUSES)[number];
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export type ArtifactStatus = SpecStatus | PlanStatus;

export type StatusFor<K extends ArtifactKind> = K extends "spec" ? SpecStatus : PlanStatus;

export function parseSpecStatus(value: string): SpecStatus | null {
  return (SPEC_STATUSES as readonly string[]).includes(value) ? (value as SpecStatus) : null;
}

export function parsePlanStatus(value: string): PlanStatus | null {
  return (PLAN_STATUSES as readonly string[]).includes(value) ? (value as PlanStatus) : null;
}

const TERMINAL_STATUSES: ReadonlySet<ArtifactStatus> = new Set(["Abandoned", "Archived"]);

export function isTerminalStatus(status: ArtifactStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

const SPEC_TRANSITIONS: Record<SpecStatus, readonly SpecStatus[]> = {
  Draft: ["Approved", "Abandoned"],
  Approved: ["Abandoned", "Archived"],
  Abandoned: [],
  Archived: [],
};

const PLAN_TRANSITIONS: Record<PlanStatus, readonly PlanStatus[]> = {
  Draft: ["Approved", "Abandoned"],
  Approved: ["Approved", "Stale", "Abandoned", "Archived"],
  Stale: ["Approved", "Draft", "Abandoned", "Archived"],
  Abandoned: [],
  Archived: [],
};

export function legalTargetsFrom<K extends ArtifactKind>(
  kind: K,
  status: StatusFor<K>,
): readonly StatusFor<K>[] {
  const table = kind === "spec" ? SPEC_TRANSITIONS : PLAN_TRANSITIONS;
  return (table as Record<string, readonly StatusFor<K>[]>)[status as string] ?? [];
}

export function requestTransition<K extends ArtifactKind>(
  kind: K,
  from: StatusFor<K>,
  to: StatusFor<K>,
): Either.Either<StatusFor<K>, InvalidArtifactTransitionError> {
  const legalTargets = legalTargetsFrom(kind, from);
  if ((legalTargets as readonly string[]).includes(to as string)) {
    return Either.right(to);
  }
  return Either.left(
    new InvalidArtifactTransitionError({
      kind,
      from: from as string,
      to: to as string,
      legalTargets: legalTargets as readonly string[],
    }),
  );
}
