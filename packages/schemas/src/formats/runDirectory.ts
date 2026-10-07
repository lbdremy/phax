// The files of a phax run directory: the run registry, run status, phase
// status, phax-plan and compliance review. Each pre-schema shape is phax's
// frozen module under src/schemas/history/; each current shape, named by
// `CURRENT_SHAPES` (`next` until a release renames it), is phax's own schema
// and decoder. The package declares none of its own.
import {
  ComplianceReviewFileSchema,
  decodeComplianceReviewFile,
  type ComplianceReview,
  type ComplianceReviewFile,
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
  PhaseStatusV0_17_0Schema,
  decodePhaseStatusV0_17_0,
  type PhaseStatusV0_17_0,
} from "../../../../src/schemas/history/phase-status/0.17.0.js";
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
  type PhaxPlanFile,
} from "../../../../src/schemas/phaxPlan.js";
import {
  RegistryFileSchema,
  decodeRegistryFile,
  type Registry,
  type RegistryFile,
} from "../../../../src/schemas/registry.js";
import {
  PhaseStatusFileSchema,
  RunStatusFileSchema,
  decodePhaseStatusFile,
  decodeRunStatusFile,
  type PhaseStatus,
  type PhaseStatusFile,
  type RunStatus,
  type RunStatusFile,
} from "../../../../src/schemas/status.js";
import { CURRENT_SHAPES } from "../generated/index.js";
import type { ParsedShape } from "../parsed.js";
import { UNKNOWN, defineFormat, type CurrentShapeName, type Unknown } from "../shapes.js";

// A document without `$schema` is read by the format's frozen pre-schema
// module as shape `pre-schema`; a `$schema` document is read by phax's decoder
// as the current shape, named by `CURRENT_SHAPES`: `next` until a release
// renames it, then that release.

// ── registry

export type RegistryShapes = { "pre-schema": RegistryPreSchema } & {
  [K in CurrentShapeName<"registry">]: RegistryFile;
};

/** The id of every run registry shape the package reads. */
export type RegistryShape = keyof RegistryShapes;

export const registryFormat = defineFormat<RegistryShapes>({
  id: "registry",
  label: "run registry",
  preSchema: { schema: RegistryPreSchemaSchema, decode: decodeRegistryPreSchema },
  releases: [],
  current: {
    name: CURRENT_SHAPES.registry,
    shape: { schema: RegistryFileSchema, decode: decodeRegistryFile },
  },
});

/** Reads `~/.phax/registry.json`. Never throws. */
export const parseRegistry: (input: unknown) => ParsedShape<RegistryShapes> = registryFormat.parse;

/** The latest run registry: phax's in-memory value, with no `version` and no `$schema`. */
export type LatestRegistry = Registry;

/** Upgrades a parsed registry in memory. Keeps every recorded fact; never invents one. */
export function toLatestRegistry(value: RegistryPreSchema | RegistryFile): LatestRegistry {
  return { runs: value.runs };
}

// ── run status

export type RunStatusShapes = { "pre-schema": RunStatusPreSchema } & {
  [K in CurrentShapeName<"run-status">]: RunStatusFile;
};

/** The id of every run status shape the package reads. */
export type RunStatusShape = keyof RunStatusShapes;

export const runStatusFormat = defineFormat<RunStatusShapes>({
  id: "run-status",
  label: "run status",
  preSchema: { schema: RunStatusPreSchemaSchema, decode: decodeRunStatusPreSchema },
  releases: [],
  current: {
    name: CURRENT_SHAPES["run-status"],
    shape: { schema: RunStatusFileSchema, decode: decodeRunStatusFile },
  },
});

/** Reads a run's `run-status.json`. Never throws. */
export const parseRunStatus: (input: unknown) => ParsedShape<RunStatusShapes> =
  runStatusFormat.parse;

/** The latest run status: phax's in-memory value, with no `version` and no `$schema`. */
export type LatestRunStatus = RunStatus;

/** Upgrades a parsed run status in memory. Keeps every recorded fact; never invents one. */
export function toLatestRunStatus(value: RunStatusPreSchema | RunStatusFile): LatestRunStatus {
  if ("$schema" in value) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── phase status

export type PhaseStatusShapes = {
  "pre-schema": PhaseStatusPreSchema;
  "0.17.0": PhaseStatusV0_17_0;
} & {
  [K in CurrentShapeName<"phase-status">]: PhaseStatusFile;
};

/** The id of every phase status shape the package reads. */
export type PhaseStatusShape = keyof PhaseStatusShapes;

export const phaseStatusFormat = defineFormat<PhaseStatusShapes>({
  id: "phase-status",
  label: "phase status",
  preSchema: { schema: PhaseStatusPreSchemaSchema, decode: decodePhaseStatusPreSchema },
  releases: [["0.17.0", { schema: PhaseStatusV0_17_0Schema, decode: decodePhaseStatusV0_17_0 }]],
  current: {
    name: CURRENT_SHAPES["phase-status"],
    shape: { schema: PhaseStatusFileSchema, decode: decodePhaseStatusFile },
  },
});

/** Reads a phase's `status.json`. Never throws. */
export const parsePhaseStatus: (input: unknown) => ParsedShape<PhaseStatusShapes> =
  phaseStatusFormat.parse;

/**
 * The latest phase status: phax's in-memory value, with no `version` and no
 * `$schema`. A status older than `base` never recorded the commit its branch
 * was created from: its `base` is `Unknown`.
 */
export type LatestPhaseStatus =
  | PhaseStatus
  | (Omit<PhaseStatus, "base"> & { readonly base: Unknown });

/**
 * Upgrades a parsed phase status in memory. Keeps every recorded fact; never
 * invents one: an older shape's `base` is `Unknown`.
 */
export function toLatestPhaseStatus(
  value: PhaseStatusPreSchema | PhaseStatusV0_17_0 | PhaseStatusFile,
): LatestPhaseStatus {
  if ("base" in value) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  if ("$schema" in value) {
    const { $schema: _schema, ...recorded } = value;
    return { ...recorded, base: UNKNOWN };
  }
  const { version: _version, ...recorded } = value;
  return { ...recorded, base: UNKNOWN };
}

// ── phax-plan

export type PhaxPlanShapes = { "pre-schema": PhaxPlanPreSchema } & {
  [K in CurrentShapeName<"phax-plan">]: PhaxPlanFile;
};

/** The id of every phax-plan shape the package reads. */
export type PhaxPlanShape = keyof PhaxPlanShapes;

export const phaxPlanFormat = defineFormat<PhaxPlanShapes>({
  id: "phax-plan",
  label: "phax-plan",
  preSchema: { schema: PhaxPlanPreSchemaSchema, decode: decodePhaxPlanPreSchema },
  releases: [],
  current: {
    name: CURRENT_SHAPES["phax-plan"],
    shape: { schema: PhaxPlanFileSchema, decode: decodePhaxPlanFile },
  },
});

/** Reads a run's `phax-plan.json`. Never throws. */
export const parsePhaxPlan: (input: unknown) => ParsedShape<PhaxPlanShapes> = phaxPlanFormat.parse;

/** The latest phax-plan: phax's in-memory value, with no `version` and no `$schema`. */
export type LatestPhaxPlan = PhaxPlan;

/** Upgrades a parsed phax-plan in memory. Keeps every recorded fact; never invents one. */
export function toLatestPhaxPlan(value: PhaxPlanPreSchema | PhaxPlanFile): LatestPhaxPlan {
  if ("$schema" in value) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── compliance review

export type ComplianceReviewShapes = { "pre-schema": ComplianceReviewPreSchema } & {
  [K in CurrentShapeName<"compliance-review">]: ComplianceReviewFile;
};

/** The id of every compliance review shape the package reads. */
export type ComplianceReviewShape = keyof ComplianceReviewShapes;

export const complianceReviewFormat = defineFormat<ComplianceReviewShapes>({
  id: "compliance-review",
  label: "compliance review",
  preSchema: { schema: ComplianceReviewPreSchemaSchema, decode: decodeComplianceReviewPreSchema },
  releases: [],
  current: {
    name: CURRENT_SHAPES["compliance-review"],
    shape: { schema: ComplianceReviewFileSchema, decode: decodeComplianceReviewFile },
  },
});

/** Reads a run's `compliance-review.json`. Never throws. */
export const parseComplianceReview: (input: unknown) => ParsedShape<ComplianceReviewShapes> =
  complianceReviewFormat.parse;

/** The latest compliance review: phax's in-memory value, with no `version` and no `$schema`. */
export type LatestComplianceReview = ComplianceReview;

/** Upgrades a parsed compliance review in memory. Keeps every recorded fact; never invents one. */
export function toLatestComplianceReview(
  value: ComplianceReviewPreSchema | ComplianceReviewFile,
): LatestComplianceReview {
  if ("$schema" in value) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  const { version: _version, ...recorded } = value;
  return recorded;
}
