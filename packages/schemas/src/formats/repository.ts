// The files of a repository: each plan's and each spec's approval record
// file, the old plan and spec approvals ledgers (read to migrate), and the
// JSON sidecar beside a headless-authored spec or plan. Each pre-schema and
// released shape that is no longer current is phax's frozen module under
// src/schemas/history/; the approval record files are born with $schema and
// have no pre-schema shape, and list their 0.19.0 shape, written before they
// named the approver, as a release; the spec and plan documents list their
// 0.17.0 and 0.20.0 shapes, written before questions were arbitrated, as
// releases, and lift them as phax's reader does. Each current shape, named by
// `CURRENT_SHAPES` (`next` until a release renames it), is phax's own file
// schema and decoder. The package declares none of its own.
import { Array as Arr } from "effect";
import {
  ApprovalRecordFileSchema,
  PlanRecordFileSchema,
  decodeApprovalRecordFile,
  decodePlanRecordFile,
  type ApprovalRecordFile,
  type PlanApprovals,
  type PlanRecord,
  type PlanRecordFile,
} from "../../../../src/schemas/approvalRecord.js";
import {
  PlanApprovalRecordV0_19_0Schema,
  decodePlanApprovalRecordV0_19_0,
  type PlanApprovalRecordV0_19_0,
} from "../../../../src/schemas/history/plan-approval-record/0.19.0.js";
import {
  SpecApprovalRecordV0_19_0Schema,
  decodeSpecApprovalRecordV0_19_0,
  type SpecApprovalRecordV0_19_0,
} from "../../../../src/schemas/history/spec-approval-record/0.19.0.js";
import {
  PlanApprovalsPreSchemaSchema,
  decodePlanApprovalsPreSchema,
  type PlanApprovalsPreSchema,
} from "../../../../src/schemas/history/plan-approvals/pre-schema.js";
import {
  PlanDocumentV0_17_0Schema,
  decodePlanDocumentV0_17_0,
  type PlanDocumentV0_17_0,
} from "../../../../src/schemas/history/plan-document/0.17.0.js";
import {
  PlanDocumentV0_20_0Schema,
  decodePlanDocumentV0_20_0,
  type PlanDocumentV0_20_0,
} from "../../../../src/schemas/history/plan-document/0.20.0.js";
import {
  PlanDocumentPreSchemaSchema,
  decodePlanDocumentPreSchema,
  type PlanDocumentPreSchema,
} from "../../../../src/schemas/history/plan-document/pre-schema.js";
import {
  SpecApprovalsPreSchemaSchema,
  decodeSpecApprovalsPreSchema,
  type SpecApprovalsPreSchema,
} from "../../../../src/schemas/history/spec-approvals/pre-schema.js";
import {
  SpecDocumentV0_17_0Schema,
  decodeSpecDocumentV0_17_0,
  type SpecDocumentV0_17_0,
} from "../../../../src/schemas/history/spec-document/0.17.0.js";
import {
  SpecDocumentPreSchemaSchema,
  decodeSpecDocumentPreSchema,
  type SpecDocumentPreSchema,
} from "../../../../src/schemas/history/spec-document/pre-schema.js";
import {
  PlanDocumentFileSchema,
  decodePlanDocumentFile,
  type PlanDocument,
  type PlanDocumentFile,
} from "../../../../src/schemas/planDocument.js";
import { liftMarkedQuestions } from "../../../../src/schemas/questions.js";
import {
  SpecApprovalRecordFileSchema,
  SpecRecordFileSchema,
  decodeSpecApprovalRecordFile,
  decodeSpecRecordFile,
  type SpecApprovalRecordFile,
  type SpecApprovals,
  type SpecRecord,
  type SpecRecordFile,
} from "../../../../src/schemas/specApprovalRecord.js";
import {
  SpecDocumentFileSchema,
  decodeSpecDocumentFile,
  type SpecDocument,
  type SpecDocumentFile,
} from "../../../../src/schemas/specDocument.js";
import { CURRENT_SHAPES } from "../generated/index.js";
import type { ParsedShape } from "../parsed.js";
import { UNKNOWN, defineFormat, type CurrentShapeName, type Unknown } from "../shapes.js";

// A document without `$schema` is read by the format's frozen pre-schema
// module as shape `pre-schema`, or fails when the format is born with
// `$schema`; a `$schema` document stamped at a release the format lists is
// read by that release's frozen module; any other `$schema` document is read
// by phax's decoder as the current shape, named by `CURRENT_SHAPES`: `next`
// until a release renames it, then that release.

// ── plan approval record

export type PlanApprovalRecordShapes = { "0.19.0": PlanApprovalRecordV0_19_0 } & {
  [K in CurrentShapeName<"plan-approval-record">]: PlanRecordFile;
};

/** The id of every plan approval record shape the package reads. */
export type PlanApprovalRecordShape = keyof PlanApprovalRecordShapes;

export const planApprovalRecordFormat = defineFormat<PlanApprovalRecordShapes>({
  id: "plan-approval-record",
  label: "plan approval record",
  preSchema: null,
  releases: [
    [
      "0.19.0",
      { schema: PlanApprovalRecordV0_19_0Schema, decode: decodePlanApprovalRecordV0_19_0 },
    ],
  ],
  current: {
    name: CURRENT_SHAPES["plan-approval-record"],
    shape: { schema: PlanRecordFileSchema, decode: decodePlanRecordFile },
  },
});

/** Reads one plan's `docs/plans/approvals/<plan>.json`. Never throws. */
export const parsePlanApprovalRecord: (input: unknown) => ParsedShape<PlanApprovalRecordShapes> =
  planApprovalRecordFormat.parse;

/** The latest plan approval record: phax's in-memory value, with no `$schema`. */
export type LatestPlanApprovalRecord = PlanRecord;

/**
 * Upgrades a parsed plan approval record in memory. Keeps every recorded fact;
 * never invents one: a 0.19.0 record, written before phax named the approver,
 * is `approvedBy: { kind: "unattributed" }`, never an operator.
 */
export function toLatestPlanApprovalRecord(
  value: PlanApprovalRecordV0_19_0 | PlanRecordFile,
): LatestPlanApprovalRecord {
  if ("approvedBy" in value) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  const { $schema: _schema, ...recorded } = value;
  return { ...recorded, approvedBy: { kind: "unattributed" } };
}

// ── spec approval record

export type SpecApprovalRecordShapes = { "0.19.0": SpecApprovalRecordV0_19_0 } & {
  [K in CurrentShapeName<"spec-approval-record">]: SpecRecordFile;
};

/** The id of every spec approval record shape the package reads. */
export type SpecApprovalRecordShape = keyof SpecApprovalRecordShapes;

export const specApprovalRecordFormat = defineFormat<SpecApprovalRecordShapes>({
  id: "spec-approval-record",
  label: "spec approval record",
  preSchema: null,
  releases: [
    [
      "0.19.0",
      { schema: SpecApprovalRecordV0_19_0Schema, decode: decodeSpecApprovalRecordV0_19_0 },
    ],
  ],
  current: {
    name: CURRENT_SHAPES["spec-approval-record"],
    shape: { schema: SpecRecordFileSchema, decode: decodeSpecRecordFile },
  },
});

/** Reads one spec's `docs/specs/approvals/<spec>.json`. Never throws. */
export const parseSpecApprovalRecord: (input: unknown) => ParsedShape<SpecApprovalRecordShapes> =
  specApprovalRecordFormat.parse;

/** The latest spec approval record: phax's in-memory value, with no `$schema`. */
export type LatestSpecApprovalRecord = SpecRecord;

/**
 * Upgrades a parsed spec approval record in memory. Keeps every recorded fact;
 * never invents one: a 0.19.0 record, written before phax named the approver,
 * is `approvedBy: { kind: "unattributed" }`, never an operator.
 */
export function toLatestSpecApprovalRecord(
  value: SpecApprovalRecordV0_19_0 | SpecRecordFile,
): LatestSpecApprovalRecord {
  if ("approvedBy" in value) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  const { $schema: _schema, ...recorded } = value;
  return { ...recorded, approvedBy: { kind: "unattributed" } };
}

// ── plan approvals: the old ledger, read to migrate

export type PlanApprovalsShapes = { "pre-schema": PlanApprovalsPreSchema } & {
  [K in CurrentShapeName<"plan-approvals">]: ApprovalRecordFile;
};

/** The id of every plan approvals ledger shape the package reads. */
export type PlanApprovalsShape = keyof PlanApprovalsShapes;

export const planApprovalsFormat = defineFormat<PlanApprovalsShapes>({
  id: "plan-approvals",
  label: "plan approvals ledger",
  preSchema: { schema: PlanApprovalsPreSchemaSchema, decode: decodePlanApprovalsPreSchema },
  releases: [],
  current: {
    name: CURRENT_SHAPES["plan-approvals"],
    shape: { schema: ApprovalRecordFileSchema, decode: decodeApprovalRecordFile },
  },
});

/** Reads `docs/plans/approvals.json`, the old plan approvals ledger. Never throws. */
export const parsePlanApprovals: (input: unknown) => ParsedShape<PlanApprovalsShapes> =
  planApprovalsFormat.parse;

/** The latest plan approvals ledger: phax's in-memory value, with no `version` and no `$schema`. */
export type LatestPlanApprovals = PlanApprovals;

/** Upgrades a parsed plan approvals ledger in memory. Keeps every recorded fact; never invents one. */
export function toLatestPlanApprovals(
  value: PlanApprovalsPreSchema | ApprovalRecordFile,
): LatestPlanApprovals {
  if ("$schema" in value) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── spec approvals: the old ledger, read to migrate

export type SpecApprovalsShapes = { "pre-schema": SpecApprovalsPreSchema } & {
  [K in CurrentShapeName<"spec-approvals">]: SpecApprovalRecordFile;
};

/** The id of every spec approvals ledger shape the package reads. */
export type SpecApprovalsShape = keyof SpecApprovalsShapes;

export const specApprovalsFormat = defineFormat<SpecApprovalsShapes>({
  id: "spec-approvals",
  label: "spec approvals ledger",
  preSchema: { schema: SpecApprovalsPreSchemaSchema, decode: decodeSpecApprovalsPreSchema },
  releases: [],
  current: {
    name: CURRENT_SHAPES["spec-approvals"],
    shape: { schema: SpecApprovalRecordFileSchema, decode: decodeSpecApprovalRecordFile },
  },
});

/** Reads `docs/specs/approvals.json`, the old spec approvals ledger. Never throws. */
export const parseSpecApprovals: (input: unknown) => ParsedShape<SpecApprovalsShapes> =
  specApprovalsFormat.parse;

/** The latest spec approvals ledger: phax's in-memory value, with no `version` and no `$schema`. */
export type LatestSpecApprovals = SpecApprovals;

/** Upgrades a parsed spec approvals ledger in memory. Keeps every recorded fact; never invents one. */
export function toLatestSpecApprovals(
  value: SpecApprovalsPreSchema | SpecApprovalRecordFile,
): LatestSpecApprovals {
  if ("$schema" in value) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── spec document

export type SpecDocumentShapes = {
  "pre-schema": SpecDocumentPreSchema;
  "0.17.0": SpecDocumentV0_17_0;
} & {
  [K in CurrentShapeName<"spec-document">]: SpecDocumentFile;
};

/** The id of every spec document shape the package reads. */
export type SpecDocumentShape = keyof SpecDocumentShapes;

export const specDocumentFormat = defineFormat<SpecDocumentShapes>({
  id: "spec-document",
  label: "spec document",
  preSchema: { schema: SpecDocumentPreSchemaSchema, decode: decodeSpecDocumentPreSchema },
  releases: [["0.17.0", { schema: SpecDocumentV0_17_0Schema, decode: decodeSpecDocumentV0_17_0 }]],
  current: {
    name: CURRENT_SHAPES["spec-document"],
    shape: { schema: SpecDocumentFileSchema, decode: decodeSpecDocumentFile },
  },
});

/** Reads a spec's JSON sidecar. Never throws. */
export const parseSpecDocument: (input: unknown) => ParsedShape<SpecDocumentShapes> =
  specDocumentFormat.parse;

/** The latest spec document: phax's in-memory value, with no `version` and no `$schema`. */
export type LatestSpecDocument = SpecDocument;

/**
 * Upgrades a parsed spec document in memory. Keeps every recorded fact; never
 * invents one: a 0.17.0 or pre-schema document, written before verdicts
 * existed, is lifted by the author's rationale marker (`liftMarkedQuestions`),
 * its marked questions arbitrated with a lifted, unattributed verdict.
 */
export function toLatestSpecDocument(
  value: SpecDocumentPreSchema | SpecDocumentV0_17_0 | SpecDocumentFile,
): LatestSpecDocument {
  if ("arbitratedQuestions" in value) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  const { openQuestions } = value;
  if ("$schema" in value) {
    const { $schema: _schema, ...recorded } = value;
    return { ...recorded, ...liftMarkedQuestions(openQuestions) };
  }
  const { version: _version, ...recorded } = value;
  return { ...recorded, ...liftMarkedQuestions(openQuestions) };
}

// ── plan document

export type PlanDocumentShapes = {
  "pre-schema": PlanDocumentPreSchema;
  "0.17.0": PlanDocumentV0_17_0;
  "0.20.0": PlanDocumentV0_20_0;
} & {
  [K in CurrentShapeName<"plan-document">]: PlanDocumentFile;
};

/** The id of every plan document shape the package reads. */
export type PlanDocumentShape = keyof PlanDocumentShapes;

export const planDocumentFormat = defineFormat<PlanDocumentShapes>({
  id: "plan-document",
  label: "plan document",
  preSchema: { schema: PlanDocumentPreSchemaSchema, decode: decodePlanDocumentPreSchema },
  releases: [
    ["0.17.0", { schema: PlanDocumentV0_17_0Schema, decode: decodePlanDocumentV0_17_0 }],
    ["0.20.0", { schema: PlanDocumentV0_20_0Schema, decode: decodePlanDocumentV0_20_0 }],
  ],
  current: {
    name: CURRENT_SHAPES["plan-document"],
    shape: { schema: PlanDocumentFileSchema, decode: decodePlanDocumentFile },
  },
});

/** Reads a plan's JSON sidecar. Never throws. */
export const parsePlanDocument: (input: unknown) => ParsedShape<PlanDocumentShapes> =
  planDocumentFormat.parse;

/**
 * The latest plan document: phax's in-memory value, with no `version` and no
 * `$schema`. A document older than `completesSpec` that names a source spec
 * never said whether its plan completes it: its `completesSpec` is `Unknown`.
 */
export type LatestPlanDocument =
  | PlanDocument
  | (Omit<PlanDocument, "sourceSpec" | "completesSpec"> & {
      readonly sourceSpec: string;
      readonly completesSpec: Unknown;
    });

/**
 * Upgrades a parsed plan document in memory. Keeps every recorded fact; never
 * invents one: an older shape's `completesSpec` is null beside `sourceSpec:
 * null`, the only value that variant allows, and `Unknown` beside a spec path;
 * an older shape carried no questions, so its preamble's `openQuestions` and
 * `arbitratedQuestions` are empty, and no phase reason, so each phase's
 * `modelReason` is null.
 */
export function toLatestPlanDocument(
  value: PlanDocumentPreSchema | PlanDocumentV0_17_0 | PlanDocumentV0_20_0 | PlanDocumentFile,
): LatestPlanDocument {
  if (carriesQuestions(value)) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  const preamble = { ...value.preamble, openQuestions: [], arbitratedQuestions: [] };
  // modelReason joins model and effort at the end of each phase; the other
  // keys keep their recorded order (the lift is built in memory, never written).
  const phases = Arr.map(value.phases, ({ model, effort, ...phase }) => ({
    ...phase,
    modelReason: null,
    model,
    effort,
  }));
  if ("completesSpec" in value) {
    const { $schema: _schema, ...recorded } = value;
    return { ...recorded, preamble, phases };
  }
  if ("$schema" in value) {
    const { $schema: _schema, ...recorded } = value;
    return withUnrecordedCompletesSpec({ ...recorded, preamble, phases });
  }
  const { version: _version, ...recorded } = value;
  return withUnrecordedCompletesSpec({ ...recorded, preamble, phases });
}

/** Whether a parsed plan document is the current shape: only it carries preamble questions. */
function carriesQuestions(
  value: PlanDocumentPreSchema | PlanDocumentV0_17_0 | PlanDocumentV0_20_0 | PlanDocumentFile,
): value is PlanDocumentFile {
  return "openQuestions" in value.preamble;
}

function withUnrecordedCompletesSpec(
  recorded: Omit<PlanDocument, "sourceSpec" | "completesSpec"> & {
    readonly sourceSpec: string | null;
  },
): LatestPlanDocument {
  const { sourceSpec } = recorded;
  return sourceSpec === null
    ? { ...recorded, sourceSpec, completesSpec: null }
    : { ...recorded, sourceSpec, completesSpec: UNKNOWN };
}
