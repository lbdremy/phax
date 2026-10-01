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
import type { FormatId } from "../../../src/schemas/schemaUrl.js";
import { makeDocumentParser } from "./document.js";
import type { IdentifiedDocument, Parsed, ParsedDocument, ParsedShape } from "./parsed.js";
import { UNKNOWN, isUnknown, type Unknown } from "./shapes.js";

export type { Parsed, ParsedDocument, ParsedShape, Unknown };
export { UNKNOWN, isUnknown };

// The files of a run directory. Each schema and type is phax's own; a format
// that writes $schema exports its file schema and type.
export {
  ComplianceReviewSchema,
  type ComplianceReview,
} from "../../../src/schemas/complianceReview.js";
export { PhaxPlanSchema, type PhaxPlan } from "../../../src/schemas/phaxPlan.js";
export {
  RegistryFileSchema as RegistrySchema,
  type RegistryFile as Registry,
} from "../../../src/schemas/registry.js";
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
  type LatestComplianceReview,
  type LatestPhaseStatus,
  type LatestPhaxPlan,
  type LatestRegistry,
  type LatestRunStatus,
  type PhaseStatusShape,
  type PhaxPlanShape,
  type RegistryShape,
  type RunStatusShape,
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
  type PlanDocumentShape,
  type SpecApprovalsShape,
  type SpecDocumentShape,
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
  type LatestAuthoringRecordManifest,
  type LatestPhaseRecordManifest,
  type PhaseRecordManifest,
  type PhaseRecordManifestShape,
  type RecordManifestFormat,
} from "./formats/recordManifests.js";

// A phase record's timeline files. Each schema and type is phax's own; the
// two gate documents take the names the spec gives them.
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
  type GateDiagnosticsShape,
  type GatePendingShape,
  type LatestGateAttribution,
  type LatestGateDiagnostics,
  type LatestGatePending,
  type LatestPhaseFileReconciliation,
  type PhaseFileReconciliationShape,
} from "./formats/recordTimeline.js";

// Each format's pre-schema shape, exactly what phax wrote before it wrote
// $schema: the schema and type of phax's frozen module under
// src/schemas/history/. Their decoders stay private; the parse functions
// read them.
export {
  RegistryPreSchemaSchema,
  type RegistryPreSchema,
} from "../../../src/schemas/history/registry/pre-schema.js";
export {
  RunStatusPreSchemaSchema,
  type RunStatusPreSchema,
} from "../../../src/schemas/history/run-status/pre-schema.js";
export {
  PhaseStatusPreSchemaSchema,
  type PhaseStatusPreSchema,
} from "../../../src/schemas/history/phase-status/pre-schema.js";
export {
  PhaxPlanPreSchemaSchema,
  type PhaxPlanPreSchema,
} from "../../../src/schemas/history/phax-plan/pre-schema.js";
export {
  ComplianceReviewPreSchemaSchema,
  type ComplianceReviewPreSchema,
} from "../../../src/schemas/history/compliance-review/pre-schema.js";
export {
  PlanApprovalsPreSchemaSchema,
  type PlanApprovalsPreSchema,
} from "../../../src/schemas/history/plan-approvals/pre-schema.js";
export {
  SpecApprovalsPreSchemaSchema,
  type SpecApprovalsPreSchema,
} from "../../../src/schemas/history/spec-approvals/pre-schema.js";
export {
  SpecDocumentPreSchemaSchema,
  type SpecDocumentPreSchema,
} from "../../../src/schemas/history/spec-document/pre-schema.js";
export {
  PlanDocumentPreSchemaSchema,
  type PlanDocumentPreSchema,
} from "../../../src/schemas/history/plan-document/pre-schema.js";
export {
  PhaseRecordManifestPreSchemaSchema,
  type PhaseRecordManifestPreSchema,
} from "../../../src/schemas/history/phase-record-manifest/pre-schema.js";
export {
  AuthoringRecordManifestPreSchemaSchema,
  type AuthoringRecordManifestPreSchema,
} from "../../../src/schemas/history/authoring-record-manifest/pre-schema.js";
export {
  GateAttributionPreSchemaSchema,
  type GateAttributionPreSchema,
} from "../../../src/schemas/history/gate-attribution/pre-schema.js";
export {
  PhaseFileReconciliationPreSchemaSchema,
  type PhaseFileReconciliationPreSchema,
} from "../../../src/schemas/history/phase-file-reconciliation/pre-schema.js";
export {
  GateDiagnosticsPreSchemaSchema,
  type GateDiagnosticsPreSchema,
} from "../../../src/schemas/history/gate-diagnostics/pre-schema.js";
export {
  GatePendingPreSchemaSchema,
  type GatePendingPreSchema,
} from "../../../src/schemas/history/gate-pending/pre-schema.js";

// Fails to compile when a format id has no entry: parseDocument reads every one.
type EveryFormat<M extends { readonly [F in FormatId]: unknown }> = M;

type DocumentShapes = EveryFormat<{
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
}>;

/** The id of every format `parseDocument` reads: every `FormatId`. */
export type DocumentFormatId = keyof DocumentShapes;

/** A document identified by its `$schema`: its format, its shape and its value. */
export type AnyDocument = IdentifiedDocument<DocumentShapes>;

/**
 * Identifies a document by its `$schema` URL alone and reads it. A pre-schema
 * document, without `$schema`, is read with its format's parse function.
 * Never throws.
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
