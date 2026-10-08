import {
  briefAnswerFormat,
  briefRecordFormat,
  briefRequestFormat,
  type BriefAnswerShapes,
  type BriefRecordShapes,
  type BriefRequestShapes,
} from "./formats/brief.js";
import {
  planApprovalRecordFormat,
  planApprovalsFormat,
  planDocumentFormat,
  specApprovalRecordFormat,
  specApprovalsFormat,
  specDocumentFormat,
  type PlanApprovalRecordShapes,
  type PlanApprovalsShapes,
  type PlanDocumentShapes,
  type SpecApprovalRecordShapes,
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
  gateRequestFormat,
  phaseFileReconciliationFormat,
  type GateAttributionShapes,
  type GateDiagnosticsShapes,
  type GateRequestShapes,
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
  ComplianceReviewFileSchema as ComplianceReviewSchema,
  type ComplianceReviewFile as ComplianceReview,
} from "../../../src/schemas/complianceReview.js";
export {
  PhaxPlanFileSchema as PhaxPlanSchema,
  type PhaxPlanFile as PhaxPlan,
} from "../../../src/schemas/phaxPlan.js";
export {
  RegistryFileSchema as RegistrySchema,
  type RegistryFile as Registry,
} from "../../../src/schemas/registry.js";
export {
  PhaseStatusFileSchema as PhaseStatusSchema,
  RunStatusFileSchema as RunStatusSchema,
  type PhaseStatusFile as PhaseStatus,
  type RunStatusFile as RunStatus,
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

// The files of a repository. Each schema and type is phax's own file schema
// and type, under the name the spec gives it. PlanApprovals and SpecApprovals
// are the old ledgers, read to migrate to approval record files.
export {
  ApprovalRecordFileSchema as PlanApprovalsSchema,
  PlanRecordFileSchema as PlanApprovalRecordSchema,
  type ApprovalRecordFile as PlanApprovals,
  type PlanRecordFile as PlanApprovalRecord,
} from "../../../src/schemas/approvalRecord.js";
export {
  SpecApprovalRecordFileSchema as SpecApprovalsSchema,
  SpecRecordFileSchema as SpecApprovalRecordSchema,
  type SpecApprovalRecordFile as SpecApprovals,
  type SpecRecordFile as SpecApprovalRecord,
} from "../../../src/schemas/specApprovalRecord.js";
export {
  SpecDocumentFileSchema as SpecDocumentSchema,
  type SpecDocumentFile as SpecDocument,
} from "../../../src/schemas/specDocument.js";
export {
  PlanDocumentFileSchema as PlanDocumentSchema,
  type PlanDocumentFile as PlanDocument,
} from "../../../src/schemas/planDocument.js";
export {
  parsePlanApprovalRecord,
  parsePlanApprovals,
  parsePlanDocument,
  parseSpecApprovalRecord,
  parseSpecApprovals,
  parseSpecDocument,
  toLatestPlanApprovalRecord,
  toLatestPlanApprovals,
  toLatestPlanDocument,
  toLatestSpecApprovalRecord,
  toLatestSpecApprovals,
  toLatestSpecDocument,
  type LatestPlanApprovalRecord,
  type LatestPlanApprovals,
  type LatestPlanDocument,
  type LatestSpecApprovalRecord,
  type LatestSpecApprovals,
  type LatestSpecDocument,
  type PlanApprovalRecordShape,
  type PlanApprovalsShape,
  type PlanDocumentShape,
  type SpecApprovalRecordShape,
  type SpecApprovalsShape,
  type SpecDocumentShape,
} from "./formats/repository.js";

// The manifests on phax/records/v1. Each schema and type is phax's own file
// schema and type, under the name the spec gives it; the union has no format
// id, so parseDocument does not read it.
export {
  AuthoringRecordManifestFileSchema as AuthoringRecordManifestSchema,
  RecordManifestFileSchema as RecordManifestSchema,
  type AuthoringRecordManifestFile as AuthoringRecordManifest,
  type RecordManifestFile as RecordManifest,
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

// A phase record's timeline files. Each schema and type is phax's own file
// schema and type, under the name the spec gives it.
export {
  GateAttributionFileSchema as GateAttributionSchema,
  type GateAttributionFile as GateAttribution,
} from "../../../src/schemas/gateAttribution.js";
export {
  PhaseFileReconciliationFileSchema as PhaseFileReconciliationSchema,
  type PhaseFileReconciliationFile as PhaseFileReconciliation,
} from "../../../src/schemas/reconciliation.js";
export {
  GateDiagnosticsFileSchema as GateDiagnosticsSchema,
  type GateDiagnosticsFile as GateDiagnostics,
} from "../../../src/schemas/gateDiagnostics.js";
export {
  GateRequestFileSchema as GateRequestSchema,
  type GateRequestFile as GateRequest,
} from "../../../src/schemas/gateRequest.js";
export {
  parseGateAttribution,
  parseGateDiagnostics,
  parseGateRequest,
  parsePhaseFileReconciliation,
  toLatestGateAttribution,
  toLatestGateDiagnostics,
  toLatestGateRequest,
  toLatestPhaseFileReconciliation,
  type GateAttributionShape,
  type GateDiagnosticsShape,
  type GateRequestShape,
  type LatestGateAttribution,
  type LatestGateDiagnostics,
  type LatestGateRequest,
  type LatestPhaseFileReconciliation,
  type PhaseFileReconciliationShape,
} from "./formats/recordTimeline.js";

// The documents of a brief: the request on a brief provider's stdin, the
// answer it prints and the record of one brief call. Each schema and type is
// phax's own file schema and type, under the name the spec gives it.
export {
  BriefAnswerFileSchema as BriefAnswerSchema,
  BriefRecordFileSchema as BriefRecordSchema,
  BriefRequestFileSchema as BriefRequestSchema,
  type BriefAnswerFile as BriefAnswer,
  type BriefRecordFile as BriefRecord,
  type BriefRequestFile as BriefRequest,
} from "../../../src/schemas/brief.js";
export {
  parseBriefAnswer,
  parseBriefRecord,
  parseBriefRequest,
  toLatestBriefAnswer,
  toLatestBriefRecord,
  toLatestBriefRequest,
  type BriefAnswerShape,
  type BriefRecordShape,
  type BriefRequestShape,
  type LatestBriefAnswer,
  type LatestBriefRecord,
  type LatestBriefRequest,
} from "./formats/brief.js";

// Each format's pre-schema shape, exactly what phax wrote before it wrote
// $schema: the schema and type of phax's frozen module under
// src/schemas/history/. Their decoders stay private; the parse functions
// read them. A format born with $schema has none.
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

// Each released shape that is no longer current: the schema and type of
// phax's frozen module under src/schemas/history/<id>/<release>.ts. Their
// decoders stay private; the parse functions read them.
export {
  PlanDocumentV0_17_0Schema,
  type PlanDocumentV0_17_0,
} from "../../../src/schemas/history/plan-document/0.17.0.js";
export {
  PhaseStatusV0_17_0Schema,
  type PhaseStatusV0_17_0,
} from "../../../src/schemas/history/phase-status/0.17.0.js";
export {
  GateAttributionV0_17_0Schema,
  type GateAttributionV0_17_0,
} from "../../../src/schemas/history/gate-attribution/0.17.0.js";
export {
  GateDiagnosticsV0_17_0Schema,
  type GateDiagnosticsV0_17_0,
} from "../../../src/schemas/history/gate-diagnostics/0.17.0.js";
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
  "plan-approval-record": PlanApprovalRecordShapes;
  "spec-approval-record": SpecApprovalRecordShapes;
  "gate-request": GateRequestShapes;
  "brief-request": BriefRequestShapes;
  "brief-answer": BriefAnswerShapes;
  "brief-record": BriefRecordShapes;
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
    "plan-approval-record": planApprovalRecordFormat,
    "spec-approval-record": specApprovalRecordFormat,
    "gate-request": gateRequestFormat,
    "brief-request": briefRequestFormat,
    "brief-answer": briefAnswerFormat,
    "brief-record": briefRecordFormat,
  });
