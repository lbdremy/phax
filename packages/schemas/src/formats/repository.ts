// The files of a repository: the plan and spec approvals ledgers, and the JSON
// sidecar beside a headless-authored spec or plan. Each current schema and
// decoder is phax's own; the package declares none of its own.
import {
  ApprovalRecordFileSchema,
  decodeApprovalRecordFile,
  type ApprovalRecordFile,
} from "../../../../src/schemas/approvalRecord.js";
import {
  PlanDocumentSchema,
  decodePlanDocument,
  type PlanDocument,
} from "../../../../src/schemas/planDocument.js";
import {
  SpecApprovalRecordFileSchema,
  decodeSpecApprovalRecordFile,
  type SpecApprovalRecordFile,
} from "../../../../src/schemas/specApprovalRecord.js";
import {
  SpecDocumentSchema,
  decodeSpecDocument,
  type SpecDocument,
} from "../../../../src/schemas/specDocument.js";
import type { ParsedShape } from "../parsed.js";
import { defineFormat } from "../shapes.js";

// No format below has written `$schema` yet: a document without it is read by
// phax's own decoder as shape `pre-schema`, the shape phax writes today.

// ── plan approvals

export type PlanApprovalsShapes = { "pre-schema": ApprovalRecordFile };

/** The id of every plan approvals ledger shape the package reads. */
export type PlanApprovalsShape = keyof PlanApprovalsShapes;

export const planApprovalsFormat = defineFormat<PlanApprovalsShapes>({
  id: "plan-approvals",
  label: "plan approvals ledger",
  releases: [],
  current: {
    name: "pre-schema",
    shape: { schema: ApprovalRecordFileSchema, decode: decodeApprovalRecordFile },
  },
});

/** Reads `docs/plans/approvals.json`. Never throws. */
export const parsePlanApprovals: (input: unknown) => ParsedShape<PlanApprovalsShapes> =
  planApprovalsFormat.parse;

/** The latest plan approvals ledger: no `version`. */
export type LatestPlanApprovals = Omit<ApprovalRecordFile, "version">;

/** Upgrades a parsed plan approvals ledger in memory. Keeps every recorded fact; never invents one. */
export function toLatestPlanApprovals(value: ApprovalRecordFile): LatestPlanApprovals {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── spec approvals

export type SpecApprovalsShapes = { "pre-schema": SpecApprovalRecordFile };

/** The id of every spec approvals ledger shape the package reads. */
export type SpecApprovalsShape = keyof SpecApprovalsShapes;

export const specApprovalsFormat = defineFormat<SpecApprovalsShapes>({
  id: "spec-approvals",
  label: "spec approvals ledger",
  releases: [],
  current: {
    name: "pre-schema",
    shape: { schema: SpecApprovalRecordFileSchema, decode: decodeSpecApprovalRecordFile },
  },
});

/** Reads `docs/specs/approvals.json`. Never throws. */
export const parseSpecApprovals: (input: unknown) => ParsedShape<SpecApprovalsShapes> =
  specApprovalsFormat.parse;

/** The latest spec approvals ledger: no `version`. */
export type LatestSpecApprovals = Omit<SpecApprovalRecordFile, "version">;

/** Upgrades a parsed spec approvals ledger in memory. Keeps every recorded fact; never invents one. */
export function toLatestSpecApprovals(value: SpecApprovalRecordFile): LatestSpecApprovals {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── spec document

export type SpecDocumentShapes = { "pre-schema": SpecDocument };

/** The id of every spec document shape the package reads. */
export type SpecDocumentShape = keyof SpecDocumentShapes;

export const specDocumentFormat = defineFormat<SpecDocumentShapes>({
  id: "spec-document",
  label: "spec document",
  releases: [],
  current: {
    name: "pre-schema",
    shape: { schema: SpecDocumentSchema, decode: decodeSpecDocument },
  },
});

/** Reads a spec's JSON sidecar. Never throws. */
export const parseSpecDocument: (input: unknown) => ParsedShape<SpecDocumentShapes> =
  specDocumentFormat.parse;

/** The latest spec document: no `version`. */
export type LatestSpecDocument = Omit<SpecDocument, "version">;

/** Upgrades a parsed spec document in memory. Keeps every recorded fact; never invents one. */
export function toLatestSpecDocument(value: SpecDocument): LatestSpecDocument {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── plan document

export type PlanDocumentShapes = { "pre-schema": PlanDocument };

/** The id of every plan document shape the package reads. */
export type PlanDocumentShape = keyof PlanDocumentShapes;

export const planDocumentFormat = defineFormat<PlanDocumentShapes>({
  id: "plan-document",
  label: "plan document",
  releases: [],
  current: {
    name: "pre-schema",
    shape: { schema: PlanDocumentSchema, decode: decodePlanDocument },
  },
});

/** Reads a plan's JSON sidecar. Never throws. */
export const parsePlanDocument: (input: unknown) => ParsedShape<PlanDocumentShapes> =
  planDocumentFormat.parse;

/** The latest plan document: no `version`. */
export type LatestPlanDocument = Omit<PlanDocument, "version">;

/** Upgrades a parsed plan document in memory. Keeps every recorded fact; never invents one. */
export function toLatestPlanDocument(value: PlanDocument): LatestPlanDocument {
  const { version: _version, ...recorded } = value;
  return recorded;
}
