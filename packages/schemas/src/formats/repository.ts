// The files of a repository: the plan and spec approvals ledgers, and the JSON
// sidecar beside a headless-authored spec or plan. Each pre-schema shape is
// phax's frozen module under src/schemas/history/; each current shape,
// `next`, is phax's own file schema and decoder. The package declares none of
// its own.
import {
  ApprovalRecordFileSchema,
  decodeApprovalRecordFile,
  type ApprovalRecordFile,
  type PlanApprovals,
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
  decodeSpecApprovalRecordFile,
  type SpecApprovalRecordFile,
  type SpecApprovals,
} from "../../../../src/schemas/specApprovalRecord.js";
import {
  SpecDocumentFileSchema,
  decodeSpecDocumentFile,
  type SpecDocument,
  type SpecDocumentFile,
} from "../../../../src/schemas/specDocument.js";
import type { ParsedShape } from "../parsed.js";
import { defineFormat } from "../shapes.js";

// A document without `$schema` is read by the format's frozen pre-schema
// module as shape `pre-schema`; no release has written `$schema` yet, so a
// `$schema` document at the package's own release is read by phax's decoder
// as shape `next`.

// ── plan approvals

export type PlanApprovalsShapes = {
  "pre-schema": PlanApprovalsPreSchema;
  next: ApprovalRecordFile;
};

/** The id of every plan approvals ledger shape the package reads. */
export type PlanApprovalsShape = keyof PlanApprovalsShapes;

export const planApprovalsFormat = defineFormat<PlanApprovalsShapes>({
  id: "plan-approvals",
  label: "plan approvals ledger",
  preSchema: { schema: PlanApprovalsPreSchemaSchema, decode: decodePlanApprovalsPreSchema },
  releases: [],
  current: {
    name: "next",
    shape: { schema: ApprovalRecordFileSchema, decode: decodeApprovalRecordFile },
  },
});

/** Reads `docs/plans/approvals.json`. Never throws. */
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

// ── spec approvals

export type SpecApprovalsShapes = {
  "pre-schema": SpecApprovalsPreSchema;
  next: SpecApprovalRecordFile;
};

/** The id of every spec approvals ledger shape the package reads. */
export type SpecApprovalsShape = keyof SpecApprovalsShapes;

export const specApprovalsFormat = defineFormat<SpecApprovalsShapes>({
  id: "spec-approvals",
  label: "spec approvals ledger",
  preSchema: { schema: SpecApprovalsPreSchemaSchema, decode: decodeSpecApprovalsPreSchema },
  releases: [],
  current: {
    name: "next",
    shape: { schema: SpecApprovalRecordFileSchema, decode: decodeSpecApprovalRecordFile },
  },
});

/** Reads `docs/specs/approvals.json`. Never throws. */
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

export type SpecDocumentShapes = { "pre-schema": SpecDocumentPreSchema; next: SpecDocumentFile };

/** The id of every spec document shape the package reads. */
export type SpecDocumentShape = keyof SpecDocumentShapes;

export const specDocumentFormat = defineFormat<SpecDocumentShapes>({
  id: "spec-document",
  label: "spec document",
  preSchema: { schema: SpecDocumentPreSchemaSchema, decode: decodeSpecDocumentPreSchema },
  releases: [],
  current: {
    name: "next",
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

export type PlanDocumentShapes = { "pre-schema": PlanDocumentPreSchema; next: PlanDocumentFile };

/** The id of every plan document shape the package reads. */
export type PlanDocumentShape = keyof PlanDocumentShapes;

export const planDocumentFormat = defineFormat<PlanDocumentShapes>({
  id: "plan-document",
  label: "plan document",
  preSchema: { schema: PlanDocumentPreSchemaSchema, decode: decodePlanDocumentPreSchema },
  releases: [],
  current: {
    name: "next",
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
