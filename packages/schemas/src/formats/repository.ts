// The files of a repository: each plan's and each spec's approval record
// file, the old plan and spec approvals ledgers (read to migrate), and the
// JSON sidecar beside a headless-authored spec or plan. Each pre-schema shape
// is phax's frozen module under src/schemas/history/; the approval record
// files are born with $schema and have none. Each current shape, named by
// `CURRENT_SHAPES` (`next` until a release renames it), is phax's own file
// schema and decoder. The package declares none of its own.
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
  PlanApprovalsPreSchemaSchema,
  decodePlanApprovalsPreSchema,
  type PlanApprovalsPreSchema,
} from "../../../../src/schemas/history/plan-approvals/pre-schema.js";
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
import { defineFormat, type CurrentShapeName } from "../shapes.js";

// A document without `$schema` is read by the format's frozen pre-schema
// module as shape `pre-schema`, or fails when the format is born with
// `$schema`; a `$schema` document is read by phax's decoder as the current
// shape, named by `CURRENT_SHAPES`: `next` until a release renames it, then
// that release.

// ── plan approval record

export type PlanApprovalRecordShapes = {
  [K in CurrentShapeName<"plan-approval-record">]: PlanRecordFile;
};

/** The id of every plan approval record shape the package reads. */
export type PlanApprovalRecordShape = keyof PlanApprovalRecordShapes;

export const planApprovalRecordFormat = defineFormat<PlanApprovalRecordShapes>({
  id: "plan-approval-record",
  label: "plan approval record",
  preSchema: null,
  releases: [],
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

/** Upgrades a parsed plan approval record in memory. Keeps every recorded fact; never invents one. */
export function toLatestPlanApprovalRecord(value: PlanRecordFile): LatestPlanApprovalRecord {
  const { $schema: _schema, ...recorded } = value;
  return recorded;
}

// ── spec approval record

export type SpecApprovalRecordShapes = {
  [K in CurrentShapeName<"spec-approval-record">]: SpecRecordFile;
};

/** The id of every spec approval record shape the package reads. */
export type SpecApprovalRecordShape = keyof SpecApprovalRecordShapes;

export const specApprovalRecordFormat = defineFormat<SpecApprovalRecordShapes>({
  id: "spec-approval-record",
  label: "spec approval record",
  preSchema: null,
  releases: [],
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

/** Upgrades a parsed spec approval record in memory. Keeps every recorded fact; never invents one. */
export function toLatestSpecApprovalRecord(value: SpecRecordFile): LatestSpecApprovalRecord {
  const { $schema: _schema, ...recorded } = value;
  return recorded;
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

export type SpecDocumentShapes = { "pre-schema": SpecDocumentPreSchema } & {
  [K in CurrentShapeName<"spec-document">]: SpecDocumentFile;
};

/** The id of every spec document shape the package reads. */
export type SpecDocumentShape = keyof SpecDocumentShapes;

export const specDocumentFormat = defineFormat<SpecDocumentShapes>({
  id: "spec-document",
  label: "spec document",
  preSchema: { schema: SpecDocumentPreSchemaSchema, decode: decodeSpecDocumentPreSchema },
  releases: [],
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

/** Upgrades a parsed spec document in memory. Keeps every recorded fact; never invents one. */
export function toLatestSpecDocument(
  value: SpecDocumentPreSchema | SpecDocumentFile,
): LatestSpecDocument {
  if ("$schema" in value) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── plan document

export type PlanDocumentShapes = { "pre-schema": PlanDocumentPreSchema } & {
  [K in CurrentShapeName<"plan-document">]: PlanDocumentFile;
};

/** The id of every plan document shape the package reads. */
export type PlanDocumentShape = keyof PlanDocumentShapes;

export const planDocumentFormat = defineFormat<PlanDocumentShapes>({
  id: "plan-document",
  label: "plan document",
  preSchema: { schema: PlanDocumentPreSchemaSchema, decode: decodePlanDocumentPreSchema },
  releases: [],
  current: {
    name: CURRENT_SHAPES["plan-document"],
    shape: { schema: PlanDocumentFileSchema, decode: decodePlanDocumentFile },
  },
});

/** Reads a plan's JSON sidecar. Never throws. */
export const parsePlanDocument: (input: unknown) => ParsedShape<PlanDocumentShapes> =
  planDocumentFormat.parse;

/** The latest plan document: phax's in-memory value, with no `version` and no `$schema`. */
export type LatestPlanDocument = PlanDocument;

/** Upgrades a parsed plan document in memory. Keeps every recorded fact; never invents one. */
export function toLatestPlanDocument(
  value: PlanDocumentPreSchema | PlanDocumentFile,
): LatestPlanDocument {
  if ("$schema" in value) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  const { version: _version, ...recorded } = value;
  return recorded;
}
