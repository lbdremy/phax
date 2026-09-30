// The files of a phax run directory: the run registry, run status, phase
// status, phax-plan and compliance review. Each current schema and decoder is
// phax's own; the package declares none of its own.
import {
  ComplianceReviewSchema,
  decodeComplianceReview,
  type ComplianceReview,
} from "../../../../src/schemas/complianceReview.js";
import { PhaxPlanSchema, decodePhaxPlan, type PhaxPlan } from "../../../../src/schemas/phaxPlan.js";
import { RegistrySchema, decodeRegistry, type Registry } from "../../../../src/schemas/registry.js";
import {
  PhaseStatusSchema,
  RunStatusSchema,
  decodePhaseStatus,
  decodeRunStatus,
  type PhaseStatus,
  type RunStatus,
} from "../../../../src/schemas/status.js";
import type { ParsedShape } from "../parsed.js";
import { defineFormat } from "../shapes.js";

// No format below has written `$schema` yet: a document without it is read by
// phax's own decoder as shape `pre-schema`, the shape phax writes today.

// ── registry

export type RegistryShapes = { "pre-schema": Registry };

/** The id of every run registry shape the package reads. */
export type RegistryShape = keyof RegistryShapes;

export const registryFormat = defineFormat<RegistryShapes>({
  id: "registry",
  label: "run registry",
  releases: [],
  current: { name: "pre-schema", shape: { schema: RegistrySchema, decode: decodeRegistry } },
});

/** Reads `~/.phax/registry.json`. Never throws. */
export const parseRegistry: (input: unknown) => ParsedShape<RegistryShapes> = registryFormat.parse;

/** The latest run registry: no `version`. */
export type LatestRegistry = Omit<Registry, "version">;

/** Upgrades a parsed registry in memory. Keeps every recorded fact; never invents one. */
export function toLatestRegistry(value: Registry): LatestRegistry {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── run status

export type RunStatusShapes = { "pre-schema": RunStatus };

/** The id of every run status shape the package reads. */
export type RunStatusShape = keyof RunStatusShapes;

export const runStatusFormat = defineFormat<RunStatusShapes>({
  id: "run-status",
  label: "run status",
  releases: [],
  current: { name: "pre-schema", shape: { schema: RunStatusSchema, decode: decodeRunStatus } },
});

/** Reads a run's `run-status.json`. Never throws. */
export const parseRunStatus: (input: unknown) => ParsedShape<RunStatusShapes> =
  runStatusFormat.parse;

/** The latest run status: no `version`. */
export type LatestRunStatus = Omit<RunStatus, "version">;

/** Upgrades a parsed run status in memory. Keeps every recorded fact; never invents one. */
export function toLatestRunStatus(value: RunStatus): LatestRunStatus {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── phase status

export type PhaseStatusShapes = { "pre-schema": PhaseStatus };

/** The id of every phase status shape the package reads. */
export type PhaseStatusShape = keyof PhaseStatusShapes;

export const phaseStatusFormat = defineFormat<PhaseStatusShapes>({
  id: "phase-status",
  label: "phase status",
  releases: [],
  current: {
    name: "pre-schema",
    shape: { schema: PhaseStatusSchema, decode: decodePhaseStatus },
  },
});

/** Reads a phase's `status.json`. Never throws. */
export const parsePhaseStatus: (input: unknown) => ParsedShape<PhaseStatusShapes> =
  phaseStatusFormat.parse;

/** The latest phase status: no `version`. */
export type LatestPhaseStatus = Omit<PhaseStatus, "version">;

/** Upgrades a parsed phase status in memory. Keeps every recorded fact; never invents one. */
export function toLatestPhaseStatus(value: PhaseStatus): LatestPhaseStatus {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── phax-plan

export type PhaxPlanShapes = { "pre-schema": PhaxPlan };

/** The id of every phax-plan shape the package reads. */
export type PhaxPlanShape = keyof PhaxPlanShapes;

export const phaxPlanFormat = defineFormat<PhaxPlanShapes>({
  id: "phax-plan",
  label: "phax-plan",
  releases: [],
  current: { name: "pre-schema", shape: { schema: PhaxPlanSchema, decode: decodePhaxPlan } },
});

/** Reads a run's `phax-plan.json`. Never throws. */
export const parsePhaxPlan: (input: unknown) => ParsedShape<PhaxPlanShapes> = phaxPlanFormat.parse;

/** The latest phax-plan: no `version`. */
export type LatestPhaxPlan = Omit<PhaxPlan, "version">;

/** Upgrades a parsed phax-plan in memory. Keeps every recorded fact; never invents one. */
export function toLatestPhaxPlan(value: PhaxPlan): LatestPhaxPlan {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── compliance review

export type ComplianceReviewShapes = { "pre-schema": ComplianceReview };

/** The id of every compliance review shape the package reads. */
export type ComplianceReviewShape = keyof ComplianceReviewShapes;

export const complianceReviewFormat = defineFormat<ComplianceReviewShapes>({
  id: "compliance-review",
  label: "compliance review",
  releases: [],
  current: {
    name: "pre-schema",
    shape: { schema: ComplianceReviewSchema, decode: decodeComplianceReview },
  },
});

/** Reads a run's `compliance-review.json`. Never throws. */
export const parseComplianceReview: (input: unknown) => ParsedShape<ComplianceReviewShapes> =
  complianceReviewFormat.parse;

/** The latest compliance review: no `version`. */
export type LatestComplianceReview = Omit<ComplianceReview, "version">;

/** Upgrades a parsed compliance review in memory. Keeps every recorded fact; never invents one. */
export function toLatestComplianceReview(value: ComplianceReview): LatestComplianceReview {
  const { version: _version, ...recorded } = value;
  return recorded;
}
