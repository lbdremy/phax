// The files of a phax run directory: the run registry, run status, phase
// status, phax-plan, compliance review, cost ledger and code review. Each pre-schema shape
// is phax's frozen module under src/schemas/history/; each current shape,
// named by `CURRENT_SHAPES` (`next` until a release renames it), is phax's own
// schema and decoder. The package declares none of its own. phax-plan also
// lists its 0.17.0 shape, written before phases carried `mode` and `oracle`,
// and its 0.26.0 shape, written before phases carried `testLines`, as
// releases, and lifts them as phax's reader does. The registry and run
// status list their 0.17.0 shapes, and phase status its 0.20.0 shape, written
// before `awaiting_review`; a phase status that old is lifted with
// `mode: "headless"` and `stop: null`.
import { Array as Arr } from "effect";
import {
  ComplianceReviewFileSchema,
  decodeComplianceReviewFile,
  type ComplianceReview,
  type ComplianceReviewFile,
} from "../../../../src/schemas/complianceReview.js";
import {
  CodeReviewFileSchema,
  decodeCodeReviewFile,
  type CodeReview,
  type CodeReviewFile,
} from "../../../../src/schemas/codeReview.js";
import {
  CodeReviewV0_29_0Schema,
  decodeCodeReviewV0_29_0,
  type CodeReviewV0_29_0,
} from "../../../../src/schemas/history/code-review/0.29.0.js";
import {
  CostLedgerFileSchema,
  decodeCostLedgerFile,
  type CostLedger,
  type CostLedgerFile,
} from "../../../../src/schemas/costLedger.js";
import {
  CostLedgerV0_25_0Schema,
  decodeCostLedgerV0_25_0,
  type CostLedgerV0_25_0,
} from "../../../../src/schemas/history/cost-ledger/0.25.0.js";
import {
  CostLedgerV0_26_0Schema,
  decodeCostLedgerV0_26_0,
  type CostLedgerV0_26_0,
} from "../../../../src/schemas/history/cost-ledger/0.26.0.js";
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
  PhaseStatusV0_20_0Schema,
  decodePhaseStatusV0_20_0,
  type PhaseStatusV0_20_0,
} from "../../../../src/schemas/history/phase-status/0.20.0.js";
import {
  PhaseStatusV0_17_0Schema,
  decodePhaseStatusV0_17_0,
  type PhaseStatusV0_17_0,
} from "../../../../src/schemas/history/phase-status/0.17.0.js";
import {
  PhaxPlanV0_17_0Schema,
  decodePhaxPlanV0_17_0,
  type PhaxPlanV0_17_0,
} from "../../../../src/schemas/history/phax-plan/0.17.0.js";
import {
  PhaxPlanV0_26_0Schema,
  decodePhaxPlanV0_26_0,
  type PhaxPlanV0_26_0,
} from "../../../../src/schemas/history/phax-plan/0.26.0.js";
import {
  PhaxPlanPreSchemaSchema,
  decodePhaxPlanPreSchema,
  type PhaxPlanPreSchema,
} from "../../../../src/schemas/history/phax-plan/pre-schema.js";
import {
  RegistryV0_17_0Schema,
  decodeRegistryV0_17_0,
  type RegistryV0_17_0,
} from "../../../../src/schemas/history/registry/0.17.0.js";
import {
  RegistryPreSchemaSchema,
  decodeRegistryPreSchema,
  type RegistryPreSchema,
} from "../../../../src/schemas/history/registry/pre-schema.js";
import {
  RunStatusV0_17_0Schema,
  decodeRunStatusV0_17_0,
  type RunStatusV0_17_0,
} from "../../../../src/schemas/history/run-status/0.17.0.js";
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

export type RegistryShapes = { "pre-schema": RegistryPreSchema; "0.17.0": RegistryV0_17_0 } & {
  [K in CurrentShapeName<"registry">]: RegistryFile;
};

/** The id of every run registry shape the package reads. */
export type RegistryShape = keyof RegistryShapes;

export const registryFormat = defineFormat<RegistryShapes>({
  id: "registry",
  label: "run registry",
  preSchema: { schema: RegistryPreSchemaSchema, decode: decodeRegistryPreSchema },
  releases: [["0.17.0", { schema: RegistryV0_17_0Schema, decode: decodeRegistryV0_17_0 }]],
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
export function toLatestRegistry(
  value: RegistryPreSchema | RegistryV0_17_0 | RegistryFile,
): LatestRegistry {
  return { runs: value.runs };
}

// ── run status

export type RunStatusShapes = { "pre-schema": RunStatusPreSchema; "0.17.0": RunStatusV0_17_0 } & {
  [K in CurrentShapeName<"run-status">]: RunStatusFile;
};

/** The id of every run status shape the package reads. */
export type RunStatusShape = keyof RunStatusShapes;

export const runStatusFormat = defineFormat<RunStatusShapes>({
  id: "run-status",
  label: "run status",
  preSchema: { schema: RunStatusPreSchemaSchema, decode: decodeRunStatusPreSchema },
  releases: [["0.17.0", { schema: RunStatusV0_17_0Schema, decode: decodeRunStatusV0_17_0 }]],
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
export function toLatestRunStatus(
  value: RunStatusPreSchema | RunStatusV0_17_0 | RunStatusFile,
): LatestRunStatus {
  // No earlier phax could hold a run, so a value without `hold` is lifted with `none`.
  if ("hold" in value) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  if ("$schema" in value) {
    const { $schema: _schema, ...recorded } = value;
    return { ...recorded, hold: { selection: "none" } };
  }
  const { version: _version, ...recorded } = value;
  return { ...recorded, hold: { selection: "none" } };
}

// ── phase status

export type PhaseStatusShapes = {
  "pre-schema": PhaseStatusPreSchema;
  "0.17.0": PhaseStatusV0_17_0;
  "0.20.0": PhaseStatusV0_20_0;
} & {
  [K in CurrentShapeName<"phase-status">]: PhaseStatusFile;
};

/** The id of every phase status shape the package reads. */
export type PhaseStatusShape = keyof PhaseStatusShapes;

export const phaseStatusFormat = defineFormat<PhaseStatusShapes>({
  id: "phase-status",
  label: "phase status",
  preSchema: { schema: PhaseStatusPreSchemaSchema, decode: decodePhaseStatusPreSchema },
  releases: [
    ["0.17.0", { schema: PhaseStatusV0_17_0Schema, decode: decodePhaseStatusV0_17_0 }],
    ["0.20.0", { schema: PhaseStatusV0_20_0Schema, decode: decodePhaseStatusV0_20_0 }],
  ],
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
 * invents one: a shape older than `base` has an `Unknown` base. A shape older
 * than `mode` gets `mode: "headless"` and `stop: null`, because no phax that
 * wrote it could run an interactive phase or stop.
 */
export function toLatestPhaseStatus(
  value: PhaseStatusPreSchema | PhaseStatusV0_17_0 | PhaseStatusV0_20_0 | PhaseStatusFile,
): LatestPhaseStatus {
  if ("mode" in value) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  const headless = { mode: "headless", stop: null } as const;
  if ("base" in value) {
    const { $schema: _schema, ...recorded } = value;
    return { ...recorded, ...headless };
  }
  if ("$schema" in value) {
    const { $schema: _schema, ...recorded } = value;
    return { ...recorded, base: UNKNOWN, ...headless };
  }
  const { version: _version, ...recorded } = value;
  return { ...recorded, base: UNKNOWN, ...headless };
}

// ── phax-plan

export type PhaxPlanShapes = {
  "pre-schema": PhaxPlanPreSchema;
  "0.17.0": PhaxPlanV0_17_0;
  "0.26.0": PhaxPlanV0_26_0;
} & {
  [K in CurrentShapeName<"phax-plan">]: PhaxPlanFile;
};

/** The id of every phax-plan shape the package reads. */
export type PhaxPlanShape = keyof PhaxPlanShapes;

export const phaxPlanFormat = defineFormat<PhaxPlanShapes>({
  id: "phax-plan",
  label: "phax-plan",
  preSchema: { schema: PhaxPlanPreSchemaSchema, decode: decodePhaxPlanPreSchema },
  releases: [
    ["0.17.0", { schema: PhaxPlanV0_17_0Schema, decode: decodePhaxPlanV0_17_0 }],
    ["0.26.0", { schema: PhaxPlanV0_26_0Schema, decode: decodePhaxPlanV0_26_0 }],
  ],
  current: {
    name: CURRENT_SHAPES["phax-plan"],
    shape: { schema: PhaxPlanFileSchema, decode: decodePhaxPlanFile },
  },
});

/** Reads a run's `phax-plan.json`. Never throws. */
export const parsePhaxPlan: (input: unknown) => ParsedShape<PhaxPlanShapes> = phaxPlanFormat.parse;

type PhaxPlanPhase = PhaxPlan["phases"][number];

/**
 * A phase of the latest phax-plan. A phase an older phax extracted never
 * stated its test lines: its `testLines` is `Unknown`.
 */
export type LatestPhaxPlanPhase = Omit<PhaxPlanPhase, "testLines"> & {
  readonly testLines: PhaxPlanPhase["testLines"] | Unknown;
};

/** The latest phax-plan: phax's in-memory value, with no `version` and no `$schema`. */
export type LatestPhaxPlan = Omit<PhaxPlan, "phases"> & {
  readonly phases: readonly [LatestPhaxPlanPhase, ...LatestPhaxPlanPhase[]];
};

/**
 * Upgrades a parsed phax-plan in memory. Keeps every recorded fact; never
 * invents one: a 0.17.0 or pre-schema plan's phases get `mode: "headless"`
 * and `oracle: null`, because every phase a phax of those shapes ran was
 * headless and no oracle phase existed. Every older phase's `testLines` is
 * `Unknown`: its plan may have stated lines no older phax read, so an empty
 * list would invent the fact that it tested nothing.
 */
export function toLatestPhaxPlan(
  value: PhaxPlanPreSchema | PhaxPlanV0_17_0 | PhaxPlanV0_26_0 | PhaxPlanFile,
): LatestPhaxPlan {
  if (isCurrentPhaxPlan(value)) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  const { run, phases } = value;
  if (isV0_26_0PhaxPlan(value)) {
    return {
      run,
      phases: Arr.map(value.phases, ({ commit, ...phase }) => ({
        ...phase,
        testLines: UNKNOWN,
        commit,
      })),
    };
  }
  return {
    run,
    phases: Arr.map(phases, ({ commit, ...phase }) => ({
      ...phase,
      mode: "headless" as const,
      oracle: null,
      testLines: UNKNOWN,
      commit,
    })),
  };
}

/** Whether a parsed phax-plan is the current shape: only its phases carry `testLines`. */
function isCurrentPhaxPlan(
  value: PhaxPlanPreSchema | PhaxPlanV0_17_0 | PhaxPlanV0_26_0 | PhaxPlanFile,
): value is PhaxPlanFile {
  return "testLines" in value.phases[0];
}

/** Whether an older phax-plan is the 0.26.0 shape: only its phases carry `mode`. */
function isV0_26_0PhaxPlan(
  value: PhaxPlanPreSchema | PhaxPlanV0_17_0 | PhaxPlanV0_26_0,
): value is PhaxPlanV0_26_0 {
  return "mode" in value.phases[0];
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

// ── cost ledger

// Born with `$schema`: no pre-schema shape, and a document without `$schema`
// is unreadable. It refuses a key it does not name, at any level.

export type CostLedgerShapes = { "0.25.0": CostLedgerV0_25_0; "0.26.0": CostLedgerV0_26_0 } & {
  [K in CurrentShapeName<"cost-ledger">]: CostLedgerFile;
};

/** The id of every cost ledger shape the package reads. */
export type CostLedgerShape = keyof CostLedgerShapes;

export const costLedgerFormat = defineFormat<CostLedgerShapes>({
  id: "cost-ledger",
  label: "cost ledger",
  preSchema: null,
  releases: [
    ["0.25.0", { schema: CostLedgerV0_25_0Schema, decode: decodeCostLedgerV0_25_0 }],
    ["0.26.0", { schema: CostLedgerV0_26_0Schema, decode: decodeCostLedgerV0_26_0 }],
  ],
  current: {
    name: CURRENT_SHAPES["cost-ledger"],
    shape: { schema: CostLedgerFileSchema, decode: decodeCostLedgerFile },
  },
});

/** Reads a run's `cost-ledger.json`. Never throws. */
export const parseCostLedger: (input: unknown) => ParsedShape<CostLedgerShapes> =
  costLedgerFormat.parse;

/** The latest cost ledger: phax's in-memory value, with no `$schema`. */
export type LatestCostLedger = CostLedger;

/**
 * Upgrades a parsed cost ledger in memory: drops `$schema`, keeps every other
 * fact. A 0.25.0 or 0.26.0 ledger's entries are valid current entries as they are.
 */
export function toLatestCostLedger(
  value: CostLedgerFile | CostLedgerV0_25_0 | CostLedgerV0_26_0,
): LatestCostLedger {
  const { $schema: _schema, ...ledger } = value;
  return ledger;
}

// ── code review

// Born with `$schema`: no pre-schema shape, and a document without `$schema` is
// unreadable. It refuses a key it does not name, at any level. The current
// shape is a strict answer since 0.32.0 (a const `$schema`, the strict
// non-empty pattern); the 0.29.0 shape is listed as a release. A const
// `$schema` reads only its own stamp: a document stamped above the current
// stamp is refused at `$schema`.

export type CodeReviewShapes = {
  "0.29.0": CodeReviewV0_29_0;
} & {
  [K in CurrentShapeName<"code-review">]: CodeReviewFile;
};

/** The id of every code review shape the package reads. */
export type CodeReviewShape = keyof CodeReviewShapes;

export const codeReviewFormat = defineFormat<CodeReviewShapes>({
  id: "code-review",
  label: "code review",
  preSchema: null,
  releases: [["0.29.0", { schema: CodeReviewV0_29_0Schema, decode: decodeCodeReviewV0_29_0 }]],
  current: {
    name: CURRENT_SHAPES["code-review"],
    shape: { schema: CodeReviewFileSchema, decode: decodeCodeReviewFile },
  },
});

/** Reads a run's `code-review.json`. Never throws. */
export const parseCodeReview: (input: unknown) => ParsedShape<CodeReviewShapes> =
  codeReviewFormat.parse;

/** The latest code review: phax's in-memory value, with no `$schema`. */
export type LatestCodeReview = CodeReview;

/**
 * Upgrades a parsed code review in memory: drops `$schema`, keeps every finding.
 * A 0.29.0 review is valid in the current shape as it is.
 */
export function toLatestCodeReview(value: CodeReviewFile | CodeReviewV0_29_0): LatestCodeReview {
  const { $schema: _schema, ...review } = value;
  return review;
}
