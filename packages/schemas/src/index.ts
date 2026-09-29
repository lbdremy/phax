import {
  planApprovalsFormat,
  planDocumentFormat,
  specApprovalsFormat,
  specDocumentFormat,
  type PlanApprovalsShapes,
  type PlanDocumentShapes,
  type SpecApprovalsShapes,
  type SpecDocumentShapes,
} from "./formats/repository.js";
import {
  authoringRecordManifestFormat,
  phaseRecordManifestFormat,
  type AuthoringRecordManifestShapes,
  type PhaseRecordManifestShapes,
} from "./formats/recordManifests.js";
import {
  gateAttributionFormat,
  gateDiagnosticsFormat,
  gatePendingFormat,
  phaseFileReconciliationFormat,
  type GateAttributionShapes,
  type GateDiagnosticsShapes,
  type GatePendingShapes,
  type PhaseFileReconciliationShapes,
} from "./formats/recordTimeline.js";
import {
  complianceReviewFormat,
  phaseStatusFormat,
  phaxPlanFormat,
  registryFormat,
  runStatusFormat,
  type ComplianceReviewShapes,
  type PhaseStatusShapes,
  type PhaxPlanShapes,
  type RegistryShapes,
  type RunStatusShapes,
} from "./formats/runDirectory.js";
import { makeDocumentParser } from "./document.js";
import type { IdentifiedDocument, Parsed, ParsedDocument, ParsedShape } from "./parsed.js";
import { UNKNOWN, isUnknown, type Unknown } from "./shapes.js";

export type { Parsed, ParsedDocument, ParsedShape, Unknown };
export { UNKNOWN, isUnknown };

// The files of a run directory. Each schema and type is phax's own.
export {
  ComplianceReviewSchema,
  type ComplianceReview,
} from "../../../src/schemas/complianceReview.js";
export { PhaxPlanSchema, type PhaxPlan } from "../../../src/schemas/phaxPlan.js";
export { RegistrySchema, type Registry } from "../../../src/schemas/registry.js";
export {
  PhaseStatusSchema,
  RunStatusSchema,
  type PhaseStatus,
  type RunStatus,
} from "../../../src/schemas/status.js";
export {
  parseComplianceReview,
  parsePhaseStatus,
  parsePhaxPlan,
  parseRegistry,
  parseRunStatus,
  toLatestComplianceReview,
  toLatestPhaseStatus,
  toLatestPhaxPlan,
  toLatestRegistry,
  toLatestRunStatus,
  type ComplianceReviewShape,
  type ComplianceReviewV1,
  type LatestComplianceReview,
  type LatestPhaseStatus,
  type LatestPhaxPlan,
  type LatestPhaxPlanPhase,
  type LatestRegistry,
  type LatestRunStatus,
  type PhaseStatusShape,
  type PhaseStatusV1,
  type PhaxPlanShape,
  type PhaxPlanV1,
  type RegistryShape,
  type RegistryV1,
  type RunStatusShape,
  type RunStatusV1,
} from "./formats/runDirectory.js";

// The files of a repository. Each schema and type is phax's own; the two
// ledgers take the names the spec gives them.
export {
  ApprovalRecordFileSchema as PlanApprovalsSchema,
  type ApprovalRecordFile as PlanApprovals,
} from "../../../src/schemas/approvalRecord.js";
export {
  SpecApprovalRecordFileSchema as SpecApprovalsSchema,
  type SpecApprovalRecordFile as SpecApprovals,
} from "../../../src/schemas/specApprovalRecord.js";
export { SpecDocumentSchema, type SpecDocument } from "../../../src/schemas/specDocument.js";
export { PlanDocumentSchema, type PlanDocument } from "../../../src/schemas/planDocument.js";
export {
  parsePlanApprovals,
  parsePlanDocument,
  parseSpecApprovals,
  parseSpecDocument,
  toLatestPlanApprovals,
  toLatestPlanDocument,
  toLatestSpecApprovals,
  toLatestSpecDocument,
  type LatestPlanApprovals,
  type LatestPlanDocument,
  type LatestSpecApprovals,
  type LatestSpecDocument,
  type PlanApprovalsShape,
  type PlanApprovalsV1,
  type PlanDocumentShape,
  type PlanDocumentV1,
  type SpecApprovalsShape,
  type SpecApprovalsV1,
  type SpecDocumentShape,
  type SpecDocumentV1,
} from "./formats/repository.js";

// The manifests on phax/records/v1. Each schema and type is phax's own; the
// union has no format id, so parseDocument does not read it.
export {
  AuthoringRecordManifestSchema,
  RecordManifestSchema,
  type AuthoringRecordManifest,
  type RecordManifest,
} from "../../../src/schemas/authoringRecord.js";
export {
  PhaseRecordManifestSchema,
  parseAuthoringRecordManifest,
  parsePhaseRecordManifest,
  parseRecordManifest,
  toLatestAuthoringRecordManifest,
  toLatestPhaseRecordManifest,
  type AuthoringRecordManifestShape,
  type AuthoringRecordManifestV1,
  type LatestAuthoringRecordManifest,
  type LatestPhaseRecordManifest,
  type PhaseRecordManifest,
  type PhaseRecordManifestShape,
  type PhaseRecordManifestV1,
  type PhaseRecordManifestV2,
  type RecordManifestFormat,
} from "./formats/recordManifests.js";

// A phase record's timeline files, each read as the unversioned shape v0.
// Each schema and type is phax's own; the two gate documents take the names
// the spec gives them.
export {
  GateAttributionSchema,
  type GateAttribution,
} from "../../../src/schemas/gateAttribution.js";
export {
  PhaseFileReconciliationSchema,
  type PhaseFileReconciliation,
} from "../../../src/schemas/reconciliation.js";
export {
  GateDiagnosticsDocumentSchema as GateDiagnosticsSchema,
  type GateDiagnosticsDocument as GateDiagnostics,
} from "../../../src/schemas/gateDiagnostics.js";
export {
  GatePendingDocumentSchema as GatePendingSchema,
  type GatePendingDocument as GatePending,
} from "../../../src/schemas/gatePending.js";
export {
  parseGateAttribution,
  parseGateDiagnostics,
  parseGatePending,
  parsePhaseFileReconciliation,
  toLatestGateAttribution,
  toLatestGateDiagnostics,
  toLatestGatePending,
  toLatestPhaseFileReconciliation,
  type GateAttributionShape,
  type GateAttributionV0,
  type GateDiagnosticsShape,
  type GateDiagnosticsV0,
  type GatePendingShape,
  type GatePendingV0,
  type LatestGateAttribution,
  type LatestGateDiagnostics,
  type LatestGatePending,
  type LatestPhaseFileReconciliation,
  type PhaseFileReconciliationShape,
  type PhaseFileReconciliationV0,
} from "./formats/recordTimeline.js";

type DocumentShapes = {
  "phase-record-manifest": PhaseRecordManifestShapes;
  "authoring-record-manifest": AuthoringRecordManifestShapes;
  registry: RegistryShapes;
  "run-status": RunStatusShapes;
  "phase-status": PhaseStatusShapes;
  "phax-plan": PhaxPlanShapes;
  "compliance-review": ComplianceReviewShapes;
  "plan-approvals": PlanApprovalsShapes;
  "spec-approvals": SpecApprovalsShapes;
  "spec-document": SpecDocumentShapes;
  "plan-document": PlanDocumentShapes;
  "gate-attribution": GateAttributionShapes;
  "phase-file-reconciliation": PhaseFileReconciliationShapes;
  "gate-diagnostics": GateDiagnosticsShapes;
  "gate-pending": GatePendingShapes;
};

/** The id of every format `parseDocument` reads. */
export type DocumentFormatId = keyof DocumentShapes;

/** A document identified by its `$schema`: its format, its shape and its value. */
export type AnyDocument = IdentifiedDocument<DocumentShapes>;

/**
 * Identifies a document by its `$schema` URL alone and reads it. A legacy
 * document without `$schema`, including every unversioned timeline file, is
 * read with its format's parse function. Never throws.
 */
export const parseDocument: (input: unknown) => ParsedDocument<DocumentShapes> =
  makeDocumentParser<DocumentShapes>({
    "phase-record-manifest": phaseRecordManifestFormat,
    "authoring-record-manifest": authoringRecordManifestFormat,
    registry: registryFormat,
    "run-status": runStatusFormat,
    "phase-status": phaseStatusFormat,
    "phax-plan": phaxPlanFormat,
    "compliance-review": complianceReviewFormat,
    "plan-approvals": planApprovalsFormat,
    "spec-approvals": specApprovalsFormat,
    "spec-document": specDocumentFormat,
    "plan-document": planDocumentFormat,
    "gate-attribution": gateAttributionFormat,
    "phase-file-reconciliation": phaseFileReconciliationFormat,
    "gate-diagnostics": gateDiagnosticsFormat,
    "gate-pending": gatePendingFormat,
  });
