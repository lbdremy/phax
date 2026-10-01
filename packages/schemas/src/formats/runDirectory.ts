// The files of a phax run directory: the run registry, run status, phase
// status, phax-plan and compliance review. Each pre-schema shape is phax's
// frozen module under src/schemas/history/; each current shape, `next`, is
// phax's own schema and decoder. The package declares none of its own.
import {
  ComplianceReviewFileSchema,
  decodeComplianceReviewFile,
  type ComplianceReview,
} from "../../../../src/schemas/complianceReview.js";
import {
  ComplianceReviewPreSchemaSchema,
  decodeComplianceReviewPreSchema,
  type ComplianceReviewPreSchema,
} from "../../../../src/schemas/history/compliance-review/pre-schema.js";
import {
  PhaseStatusPreSchemaSchema,
  decodePhaseStatusPreSchema,
  type PhaseStatusPreSchema,
} from "../../../../src/schemas/history/phase-status/pre-schema.js";
import {
  PhaxPlanPreSchemaSchema,
  decodePhaxPlanPreSchema,
  type PhaxPlanPreSchema,
} from "../../../../src/schemas/history/phax-plan/pre-schema.js";
import {
  RegistryPreSchemaSchema,
  decodeRegistryPreSchema,
  type RegistryPreSchema,
} from "../../../../src/schemas/history/registry/pre-schema.js";
import {
  RunStatusPreSchemaSchema,
  decodeRunStatusPreSchema,
  type RunStatusPreSchema,
} from "../../../../src/schemas/history/run-status/pre-schema.js";
import {
  PhaxPlanFileSchema,
  decodePhaxPlanFile,
  type PhaxPlan,
} from "../../../../src/schemas/phaxPlan.js";
import {
  RegistryFileSchema,
  decodeRegistryFile,
  type Registry,
} from "../../../../src/schemas/registry.js";
import {
  PhaseStatusFileSchema,
  RunStatusFileSchema,
  decodePhaseStatusFile,
  decodeRunStatusFile,
  type PhaseStatus,
  type RunStatus,
} from "../../../../src/schemas/status.js";
import type { ParsedShape } from "../parsed.js";
import { defineFormat } from "../shapes.js";

// A document without `$schema` is read by the format's frozen pre-schema
// module as shape `pre-schema`; no release has written `$schema` yet, so a
// `$schema` document at the package's own release is read by phax's decoder
// as shape `next`.

// ── registry

export type RegistryShapes = { "pre-schema": RegistryPreSchema; next: Registry };

/** The id of every run registry shape the package reads. */
export type RegistryShape = keyof RegistryShapes;

export const registryFormat = defineFormat<RegistryShapes>({
  id: "registry",
  label: "run registry",
  preSchema: { schema: RegistryPreSchemaSchema, decode: decodeRegistryPreSchema },
  releases: [],
  current: { name: "next", shape: { schema: RegistryFileSchema, decode: decodeRegistryFile } },
});

/** Reads `~/.phax/registry.json`. Never throws. */
export const parseRegistry: (input: unknown) => ParsedShape<RegistryShapes> = registryFormat.parse;

/** The latest run registry: no `version`. */
export type LatestRegistry = Omit<Registry, "version">;

/** Upgrades a parsed registry in memory. Keeps every recorded fact; never invents one. */
export function toLatestRegistry(value: RegistryPreSchema | Registry): LatestRegistry {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── run status

export type RunStatusShapes = { "pre-schema": RunStatusPreSchema; next: RunStatus };

/** The id of every run status shape the package reads. */
export type RunStatusShape = keyof RunStatusShapes;

export const runStatusFormat = defineFormat<RunStatusShapes>({
  id: "run-status",
  label: "run status",
  preSchema: { schema: RunStatusPreSchemaSchema, decode: decodeRunStatusPreSchema },
  releases: [],
  current: { name: "next", shape: { schema: RunStatusFileSchema, decode: decodeRunStatusFile } },
});

/** Reads a run's `run-status.json`. Never throws. */
export const parseRunStatus: (input: unknown) => ParsedShape<RunStatusShapes> =
  runStatusFormat.parse;

/** The latest run status: no `version`. */
export type LatestRunStatus = Omit<RunStatus, "version">;

/** Upgrades a parsed run status in memory. Keeps every recorded fact; never invents one. */
export function toLatestRunStatus(value: RunStatusPreSchema | RunStatus): LatestRunStatus {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── phase status

export type PhaseStatusShapes = { "pre-schema": PhaseStatusPreSchema; next: PhaseStatus };

/** The id of every phase status shape the package reads. */
export type PhaseStatusShape = keyof PhaseStatusShapes;

export const phaseStatusFormat = defineFormat<PhaseStatusShapes>({
  id: "phase-status",
  label: "phase status",
  preSchema: { schema: PhaseStatusPreSchemaSchema, decode: decodePhaseStatusPreSchema },
  releases: [],
  current: {
    name: "next",
    shape: { schema: PhaseStatusFileSchema, decode: decodePhaseStatusFile },
  },
});

/** Reads a phase's `status.json`. Never throws. */
export const parsePhaseStatus: (input: unknown) => ParsedShape<PhaseStatusShapes> =
  phaseStatusFormat.parse;

/** The latest phase status: no `version`. */
export type LatestPhaseStatus = Omit<PhaseStatus, "version">;

/** Upgrades a parsed phase status in memory. Keeps every recorded fact; never invents one. */
export function toLatestPhaseStatus(value: PhaseStatusPreSchema | PhaseStatus): LatestPhaseStatus {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── phax-plan

export type PhaxPlanShapes = { "pre-schema": PhaxPlanPreSchema; next: PhaxPlan };

/** The id of every phax-plan shape the package reads. */
export type PhaxPlanShape = keyof PhaxPlanShapes;

export const phaxPlanFormat = defineFormat<PhaxPlanShapes>({
  id: "phax-plan",
  label: "phax-plan",
  preSchema: { schema: PhaxPlanPreSchemaSchema, decode: decodePhaxPlanPreSchema },
  releases: [],
  current: { name: "next", shape: { schema: PhaxPlanFileSchema, decode: decodePhaxPlanFile } },
});

/** Reads a run's `phax-plan.json`. Never throws. */
export const parsePhaxPlan: (input: unknown) => ParsedShape<PhaxPlanShapes> = phaxPlanFormat.parse;

/** The latest phax-plan: no `version`. */
export type LatestPhaxPlan = Omit<PhaxPlan, "version">;

/** Upgrades a parsed phax-plan in memory. Keeps every recorded fact; never invents one. */
export function toLatestPhaxPlan(value: PhaxPlanPreSchema | PhaxPlan): LatestPhaxPlan {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── compliance review

export type ComplianceReviewShapes = {
  "pre-schema": ComplianceReviewPreSchema;
  next: ComplianceReview;
};

/** The id of every compliance review shape the package reads. */
export type ComplianceReviewShape = keyof ComplianceReviewShapes;

export const complianceReviewFormat = defineFormat<ComplianceReviewShapes>({
  id: "compliance-review",
  label: "compliance review",
  preSchema: { schema: ComplianceReviewPreSchemaSchema, decode: decodeComplianceReviewPreSchema },
  releases: [],
  current: {
    name: "next",
    shape: { schema: ComplianceReviewFileSchema, decode: decodeComplianceReviewFile },
  },
});

/** Reads a run's `compliance-review.json`. Never throws. */
export const parseComplianceReview: (input: unknown) => ParsedShape<ComplianceReviewShapes> =
  complianceReviewFormat.parse;

/** The latest compliance review: no `version`. */
export type LatestComplianceReview = Omit<ComplianceReview, "version">;

/** Upgrades a parsed compliance review in memory. Keeps every recorded fact; never invents one. */
export function toLatestComplianceReview(
  value: ComplianceReviewPreSchema | ComplianceReview,
): LatestComplianceReview {
  const { version: _version, ...recorded } = value;
  return recorded;
}
