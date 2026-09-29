// The files of a phax run directory: the run registry, run status, phase
// status, phax-plan and compliance review. Each current schema and decoder is
// phax's own; the package declares none of its own.
import {
  ComplianceReviewSchema,
  decodeComplianceReview,
  type ComplianceReview,
} from "../../../../src/schemas/complianceReview.js";
import {
  PhaxPlanSchema,
  decodePhaxPlan,
  type PhaxPlan,
  type PhaxPlanPhase,
} from "../../../../src/schemas/phaxPlan.js";
import { RegistrySchema, decodeRegistry, type Registry } from "../../../../src/schemas/registry.js";
import {
  PhaseStatusSchema,
  RunStatusSchema,
  decodePhaseStatus,
  decodeRunStatus,
  type PhaseStatus,
  type RunStatus,
} from "../../../../src/schemas/status.js";
import {
  ComplianceReviewV1Schema,
  decodeComplianceReviewV1,
  type ComplianceReviewV1,
} from "../history/compliance-review/v1.js";
import {
  PhaseStatusV1Schema,
  decodePhaseStatusV1,
  type PhaseStatusV1,
} from "../history/phase-status/v1.js";
import { PhaxPlanV1Schema, decodePhaxPlanV1, type PhaxPlanV1 } from "../history/phax-plan/v1.js";
import { RegistryV1Schema, decodeRegistryV1, type RegistryV1 } from "../history/registry/v1.js";
import {
  RunStatusV1Schema,
  decodeRunStatusV1,
  type RunStatusV1,
} from "../history/run-status/v1.js";
import type { ParsedShape } from "../parsed.js";
import { UNKNOWN, defineFormat, type Unknown } from "../shapes.js";

export type { ComplianceReviewV1, PhaseStatusV1, PhaxPlanV1, RegistryV1, RunStatusV1 };

// Every format below reads `version: 1` with phax's own decoder first, and
// falls back to its frozen v1 module for the older signatures phax no longer
// accepts. The value type of shape `v1` is the frozen type, which phax's type
// is assignable to.

// ── registry

export type RegistryShapes = { v1: RegistryV1 };

/** The id of every run registry shape the package reads. */
export type RegistryShape = keyof RegistryShapes;

export const registryFormat = defineFormat<RegistryShapes>({
  id: "registry",
  label: "run registry",
  legacy: { 1: { schema: RegistryV1Schema, decode: decodeRegistryV1 } },
  releases: [],
  current: { name: "v1", shape: { schema: RegistrySchema, decode: decodeRegistry } },
});

/** Reads `~/.phax/registry.json` of any shape phax has written. Never throws. */
export const parseRegistry: (input: unknown) => ParsedShape<RegistryShapes> = registryFormat.parse;

/** The latest run registry: no `version`. */
export type LatestRegistry = Omit<Registry, "version">;

/** Upgrades a parsed registry in memory. Keeps every recorded fact; never invents one. */
export function toLatestRegistry(value: RegistryV1): LatestRegistry {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── run status

export type RunStatusShapes = { v1: RunStatusV1 };

/** The id of every run status shape the package reads. */
export type RunStatusShape = keyof RunStatusShapes;

export const runStatusFormat = defineFormat<RunStatusShapes>({
  id: "run-status",
  label: "run status",
  legacy: { 1: { schema: RunStatusV1Schema, decode: decodeRunStatusV1 } },
  releases: [],
  current: { name: "v1", shape: { schema: RunStatusSchema, decode: decodeRunStatus } },
});

/** Reads a run's `run-status.json` of any shape phax has written. Never throws. */
export const parseRunStatus: (input: unknown) => ParsedShape<RunStatusShapes> =
  runStatusFormat.parse;

/**
 * The latest run status: no `version`, and `namespace` marked `Unknown` when
 * the run predates it.
 */
export type LatestRunStatus = Omit<RunStatus, "version" | "namespace"> & {
  readonly namespace: RunStatus["namespace"] | Unknown;
};

/** Upgrades a parsed run status in memory. Keeps every recorded fact; never invents one. */
export function toLatestRunStatus(value: RunStatusV1): LatestRunStatus {
  const { version: _version, namespace, ...recorded } = value;
  return { ...recorded, namespace: namespace ?? UNKNOWN };
}

// ── phase status

export type PhaseStatusShapes = { v1: PhaseStatusV1 };

/** The id of every phase status shape the package reads. */
export type PhaseStatusShape = keyof PhaseStatusShapes;

export const phaseStatusFormat = defineFormat<PhaseStatusShapes>({
  id: "phase-status",
  label: "phase status",
  legacy: { 1: { schema: PhaseStatusV1Schema, decode: decodePhaseStatusV1 } },
  releases: [],
  current: { name: "v1", shape: { schema: PhaseStatusSchema, decode: decodePhaseStatus } },
});

/** Reads a phase's `status.json` of any shape phax has written. Never throws. */
export const parsePhaseStatus: (input: unknown) => ParsedShape<PhaseStatusShapes> =
  phaseStatusFormat.parse;

/** The latest phase status: no `version`. */
export type LatestPhaseStatus = Omit<PhaseStatus, "version">;

/** Upgrades a parsed phase status in memory. Keeps every recorded fact; never invents one. */
export function toLatestPhaseStatus(value: PhaseStatusV1): LatestPhaseStatus {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── phax-plan

export type PhaxPlanShapes = { v1: PhaxPlanV1 };

/** The id of every phax-plan shape the package reads. */
export type PhaxPlanShape = keyof PhaxPlanShapes;

export const phaxPlanFormat = defineFormat<PhaxPlanShapes>({
  id: "phax-plan",
  label: "phax-plan",
  legacy: { 1: { schema: PhaxPlanV1Schema, decode: decodePhaxPlanV1 } },
  releases: [],
  current: { name: "v1", shape: { schema: PhaxPlanSchema, decode: decodePhaxPlan } },
});

/** Reads a run's `phax-plan.json` of any shape phax has written. Never throws. */
export const parsePhaxPlan: (input: unknown) => ParsedShape<PhaxPlanShapes> = phaxPlanFormat.parse;

type PlannedFileList = "plannedFilesToCreate" | "plannedFilesToEdit" | "optionalFilesToEdit";

/** A phase of the latest phax-plan: each planned-file list `Unknown` when the plan predates it. */
export type LatestPhaxPlanPhase = Omit<PhaxPlanPhase, PlannedFileList> & {
  readonly [K in PlannedFileList]: PhaxPlanPhase[K] | Unknown;
};

/**
 * The latest phax-plan: no `version`, `run.requiredCommands` marked `Unknown`
 * when the plan predates it, and no `run.backend`, which the latest shape has
 * no place for.
 */
export type LatestPhaxPlan = {
  readonly run: Omit<PhaxPlan["run"], "requiredCommands"> & {
    readonly requiredCommands: PhaxPlan["run"]["requiredCommands"] | Unknown;
  };
  readonly phases: readonly [LatestPhaxPlanPhase, ...LatestPhaxPlanPhase[]];
};

type PhaxPlanV1Phase = PhaxPlanV1["phases"][number];

function toLatestPhaxPlanPhase(phase: PhaxPlanV1Phase): LatestPhaxPlanPhase {
  if ("plannedFilesToCreate" in phase) return phase;
  return {
    ...phase,
    plannedFilesToCreate: UNKNOWN,
    plannedFilesToEdit: UNKNOWN,
    optionalFilesToEdit: UNKNOWN,
  };
}

/** Upgrades a parsed phax-plan in memory. Keeps every recorded fact; never invents one. */
export function toLatestPhaxPlan(value: PhaxPlanV1): LatestPhaxPlan {
  const { shortName, title, branch } = value.run;
  const requiredCommands = "requiredCommands" in value.run ? value.run.requiredCommands : UNKNOWN;
  const [first, ...rest] = value.phases;
  return {
    run: { shortName, title, branch, requiredCommands },
    phases: [toLatestPhaxPlanPhase(first), ...rest.map(toLatestPhaxPlanPhase)],
  };
}

// ── compliance review

export type ComplianceReviewShapes = { v1: ComplianceReviewV1 };

/** The id of every compliance review shape the package reads. */
export type ComplianceReviewShape = keyof ComplianceReviewShapes;

export const complianceReviewFormat = defineFormat<ComplianceReviewShapes>({
  id: "compliance-review",
  label: "compliance review",
  legacy: { 1: { schema: ComplianceReviewV1Schema, decode: decodeComplianceReviewV1 } },
  releases: [],
  current: {
    name: "v1",
    shape: { schema: ComplianceReviewSchema, decode: decodeComplianceReview },
  },
});

/** Reads a run's `compliance-review.json` of any shape phax has written. Never throws. */
export const parseComplianceReview: (input: unknown) => ParsedShape<ComplianceReviewShapes> =
  complianceReviewFormat.parse;

/** The latest compliance review: no `version`. */
export type LatestComplianceReview = Omit<ComplianceReview, "version">;

/** Upgrades a parsed compliance review in memory. Keeps every recorded fact; never invents one. */
export function toLatestComplianceReview(value: ComplianceReviewV1): LatestComplianceReview {
  const { version: _version, ...recorded } = value;
  return recorded;
}
