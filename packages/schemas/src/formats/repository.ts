// The files of a repository: the plan and spec approvals ledgers, and the JSON
// sidecar beside a headless-authored spec or plan. Each pre-schema shape is
// phax's frozen module under src/schemas/history/; each current shape,
// `next`, is phax's own schema and decoder. The package declares none of its
// own.
import {
  ApprovalRecordFileSchema,
  decodeApprovalRecordFile,
  type ApprovalRecordFile,
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

/** The latest plan approvals ledger: no `version`. */
export type LatestPlanApprovals = Omit<ApprovalRecordFile, "version">;

/** Upgrades a parsed plan approvals ledger in memory. Keeps every recorded fact; never invents one. */
export function toLatestPlanApprovals(
  value: PlanApprovalsPreSchema | ApprovalRecordFile,
): LatestPlanApprovals {
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

/** The latest spec approvals ledger: no `version`. */
export type LatestSpecApprovals = Omit<SpecApprovalRecordFile, "version">;

/** Upgrades a parsed spec approvals ledger in memory. Keeps every recorded fact; never invents one. */
export function toLatestSpecApprovals(
  value: SpecApprovalsPreSchema | SpecApprovalRecordFile,
): LatestSpecApprovals {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── spec document

export type SpecDocumentShapes = { "pre-schema": SpecDocumentPreSchema; next: SpecDocument };

/** The id of every spec document shape the package reads. */
export type SpecDocumentShape = keyof SpecDocumentShapes;

export const specDocumentFormat = defineFormat<SpecDocumentShapes>({
  id: "spec-document",
  label: "spec document",
  preSchema: { schema: SpecDocumentPreSchemaSchema, decode: decodeSpecDocumentPreSchema },
  releases: [],
  current: {
    name: "next",
    shape: { schema: SpecDocumentSchema, decode: decodeSpecDocument },
  },
});

/** Reads a spec's JSON sidecar. Never throws. */
export const parseSpecDocument: (input: unknown) => ParsedShape<SpecDocumentShapes> =
  specDocumentFormat.parse;

/** The latest spec document: no `version`. */
export type LatestSpecDocument = Omit<SpecDocument, "version">;

/** Upgrades a parsed spec document in memory. Keeps every recorded fact; never invents one. */
export function toLatestSpecDocument(
  value: SpecDocumentPreSchema | SpecDocument,
): LatestSpecDocument {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── plan document

export type PlanDocumentShapes = { "pre-schema": PlanDocumentPreSchema; next: PlanDocument };

/** The id of every plan document shape the package reads. */
export type PlanDocumentShape = keyof PlanDocumentShapes;

export const planDocumentFormat = defineFormat<PlanDocumentShapes>({
  id: "plan-document",
  label: "plan document",
  preSchema: { schema: PlanDocumentPreSchemaSchema, decode: decodePlanDocumentPreSchema },
  releases: [],
  current: {
    name: "next",
    shape: { schema: PlanDocumentSchema, decode: decodePlanDocument },
  },
});

/** Reads a plan's JSON sidecar. Never throws. */
export const parsePlanDocument: (input: unknown) => ParsedShape<PlanDocumentShapes> =
  planDocumentFormat.parse;

/** The latest plan document: no `version`. */
export type LatestPlanDocument = Omit<PlanDocument, "version">;

/** Upgrades a parsed plan document in memory. Keeps every recorded fact; never invents one. */
export function toLatestPlanDocument(
  value: PlanDocumentPreSchema | PlanDocument,
): LatestPlanDocument {
  const { version: _version, ...recorded } = value;
  return recorded;
}
