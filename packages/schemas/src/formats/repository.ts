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
import {
  PlanApprovalsV1Schema,
  decodePlanApprovalsV1,
  type PlanApprovalsV1,
} from "../history/plan-approvals/v1.js";
import {
  PlanDocumentV1Schema,
  decodePlanDocumentV1,
  type PlanDocumentV1,
} from "../history/plan-document/v1.js";
import {
  SpecApprovalsV1Schema,
  decodeSpecApprovalsV1,
  type SpecApprovalsV1,
} from "../history/spec-approvals/v1.js";
import {
  SpecDocumentV1Schema,
  decodeSpecDocumentV1,
  type SpecDocumentV1,
} from "../history/spec-document/v1.js";
import type { ParsedShape } from "../parsed.js";
import { defineFormat } from "../shapes.js";

export type { PlanApprovalsV1, PlanDocumentV1, SpecApprovalsV1, SpecDocumentV1 };

// Every format below has one signature under `version: 1`, so its frozen v1
// module is an exact twin of phax's schema: a fallback that never fires until
// the current shape moves on.

// ── plan approvals

export type PlanApprovalsShapes = { v1: PlanApprovalsV1 };

/** The id of every plan approvals ledger shape the package reads. */
export type PlanApprovalsShape = keyof PlanApprovalsShapes;

export const planApprovalsFormat = defineFormat<PlanApprovalsShapes>({
  id: "plan-approvals",
  label: "plan approvals ledger",
  legacy: { 1: { schema: PlanApprovalsV1Schema, decode: decodePlanApprovalsV1 } },
  releases: [],
  current: {
    name: "v1",
    shape: { schema: ApprovalRecordFileSchema, decode: decodeApprovalRecordFile },
  },
});

/** Reads `docs/plans/approvals.json` of any shape phax has written. Never throws. */
export const parsePlanApprovals: (input: unknown) => ParsedShape<PlanApprovalsShapes> =
  planApprovalsFormat.parse;

/** The latest plan approvals ledger: no `version`. */
export type LatestPlanApprovals = Omit<ApprovalRecordFile, "version">;

/** Upgrades a parsed plan approvals ledger in memory. Keeps every recorded fact; never invents one. */
export function toLatestPlanApprovals(value: PlanApprovalsV1): LatestPlanApprovals {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── spec approvals

export type SpecApprovalsShapes = { v1: SpecApprovalsV1 };

/** The id of every spec approvals ledger shape the package reads. */
export type SpecApprovalsShape = keyof SpecApprovalsShapes;

export const specApprovalsFormat = defineFormat<SpecApprovalsShapes>({
  id: "spec-approvals",
  label: "spec approvals ledger",
  legacy: { 1: { schema: SpecApprovalsV1Schema, decode: decodeSpecApprovalsV1 } },
  releases: [],
  current: {
    name: "v1",
    shape: { schema: SpecApprovalRecordFileSchema, decode: decodeSpecApprovalRecordFile },
  },
});

/** Reads `docs/specs/approvals.json` of any shape phax has written. Never throws. */
export const parseSpecApprovals: (input: unknown) => ParsedShape<SpecApprovalsShapes> =
  specApprovalsFormat.parse;

/** The latest spec approvals ledger: no `version`. */
export type LatestSpecApprovals = Omit<SpecApprovalRecordFile, "version">;

/** Upgrades a parsed spec approvals ledger in memory. Keeps every recorded fact; never invents one. */
export function toLatestSpecApprovals(value: SpecApprovalsV1): LatestSpecApprovals {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── spec document

export type SpecDocumentShapes = { v1: SpecDocumentV1 };

/** The id of every spec document shape the package reads. */
export type SpecDocumentShape = keyof SpecDocumentShapes;

export const specDocumentFormat = defineFormat<SpecDocumentShapes>({
  id: "spec-document",
  label: "spec document",
  legacy: { 1: { schema: SpecDocumentV1Schema, decode: decodeSpecDocumentV1 } },
  releases: [],
  current: { name: "v1", shape: { schema: SpecDocumentSchema, decode: decodeSpecDocument } },
});

/** Reads a spec's JSON sidecar of any shape phax has written. Never throws. */
export const parseSpecDocument: (input: unknown) => ParsedShape<SpecDocumentShapes> =
  specDocumentFormat.parse;

/** The latest spec document: no `version`. */
export type LatestSpecDocument = Omit<SpecDocument, "version">;

/** Upgrades a parsed spec document in memory. Keeps every recorded fact; never invents one. */
export function toLatestSpecDocument(value: SpecDocumentV1): LatestSpecDocument {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── plan document

export type PlanDocumentShapes = { v1: PlanDocumentV1 };

/** The id of every plan document shape the package reads. */
export type PlanDocumentShape = keyof PlanDocumentShapes;

export const planDocumentFormat = defineFormat<PlanDocumentShapes>({
  id: "plan-document",
  label: "plan document",
  legacy: { 1: { schema: PlanDocumentV1Schema, decode: decodePlanDocumentV1 } },
  releases: [],
  current: { name: "v1", shape: { schema: PlanDocumentSchema, decode: decodePlanDocument } },
});

/** Reads a plan's JSON sidecar of any shape phax has written. Never throws. */
export const parsePlanDocument: (input: unknown) => ParsedShape<PlanDocumentShapes> =
  planDocumentFormat.parse;

/** The latest plan document: no `version`. */
export type LatestPlanDocument = Omit<PlanDocument, "version">;

/** Upgrades a parsed plan document in memory. Keeps every recorded fact; never invents one. */
export function toLatestPlanDocument(value: PlanDocumentV1): LatestPlanDocument {
  const { version: _version, ...recorded } = value;
  return recorded;
}
