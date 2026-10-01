import type {
  AnyDocument,
  AuthoringRecordManifest,
  AuthoringRecordManifestShape,
  ComplianceReview,
  ComplianceReviewShape,
  DocumentFormatId,
  GateAttribution,
  GateAttributionShape,
  GateDiagnostics,
  GateDiagnosticsShape,
  GatePending,
  GatePendingShape,
  LatestAuthoringRecordManifest,
  LatestComplianceReview,
  LatestGateAttribution,
  LatestGateDiagnostics,
  LatestGatePending,
  LatestPhaseFileReconciliation,
  LatestPhaseRecordManifest,
  LatestPhaseStatus,
  LatestPhaxPlan,
  LatestRegistry,
  LatestPlanApprovals,
  LatestPlanDocument,
  LatestRunStatus,
  LatestSpecApprovals,
  LatestSpecDocument,
  Parsed,
  ParsedDocument,
  ParsedShape,
  PhaseFileReconciliation,
  PhaseFileReconciliationShape,
  PhaseRecordManifest,
  PhaseRecordManifestShape,
  PhaseStatus,
  PhaseStatusShape,
  PhaxPlan,
  PhaxPlanShape,
  PlanApprovals,
  PlanApprovalsShape,
  PlanDocument,
  PlanDocumentShape,
  RecordManifest,
  RecordManifestFormat,
  Registry,
  RegistryShape,
  RunStatus,
  RunStatusShape,
  SpecApprovals,
  SpecApprovalsShape,
  SpecDocument,
  SpecDocumentShape,
  AuthoringRecordManifestPreSchema,
  ComplianceReviewPreSchema,
  GateAttributionPreSchema,
  GateDiagnosticsPreSchema,
  GatePendingPreSchema,
  PhaseFileReconciliationPreSchema,
  PhaseRecordManifestPreSchema,
  PhaseStatusPreSchema,
  PhaxPlanPreSchema,
  PlanApprovalsPreSchema,
  PlanDocumentPreSchema,
  RegistryPreSchema,
  RunStatusPreSchema,
  SpecApprovalsPreSchema,
  SpecDocumentPreSchema,
} from "../../packages/schemas/src/index.js";
import {
  parseAuthoringRecordManifest,
  parseComplianceReview,
  parseDocument,
  parseGateAttribution,
  parseGateDiagnostics,
  parseGatePending,
  parsePhaseFileReconciliation,
  parsePhaseRecordManifest,
  parsePhaseStatus,
  parsePhaxPlan,
  parsePlanApprovals,
  parsePlanDocument,
  parseRecordManifest,
  parseRegistry,
  parseRunStatus,
  parseSpecApprovals,
  parseSpecDocument,
  toLatestAuthoringRecordManifest,
  toLatestGatePending,
  toLatestPhaseFileReconciliation,
  toLatestPhaseRecordManifest,
  toLatestPhaseStatus,
  toLatestPhaxPlan,
  toLatestRegistry,
  toLatestRunStatus,
  toLatestSpecDocument,
} from "../../packages/schemas/src/index.js";
import type { FormatSpec, Shape } from "../../packages/schemas/src/shapes.js";
import type { ApprovalRecordFile } from "../../src/schemas/approvalRecord.js";
import type {
  AuthoringRecordManifest as PhaxAuthoringRecordManifest,
  RecordManifest as PhaxRecordManifest,
} from "../../src/schemas/authoringRecord.js";
import type { ComplianceReview as PhaxComplianceReview } from "../../src/schemas/complianceReview.js";
import type { GateAttribution as PhaxGateAttribution } from "../../src/schemas/gateAttribution.js";
import type { GateDiagnosticsDocument } from "../../src/schemas/gateDiagnostics.js";
import type { GatePendingDocument } from "../../src/schemas/gatePending.js";
import type { PhaseFileReconciliation as PhaxPhaseFileReconciliation } from "../../src/schemas/reconciliation.js";
import type { PhaxPlan as PhaxPhaxPlan } from "../../src/schemas/phaxPlan.js";
import type { PlanDocument as PhaxPlanDocument } from "../../src/schemas/planDocument.js";
import type { SpecApprovalRecordFile } from "../../src/schemas/specApprovalRecord.js";
import type { SpecDocument as PhaxSpecDocument } from "../../src/schemas/specDocument.js";
import type {
  Registry as PhaxRegistry,
  RegistryFile as PhaxRegistryFile,
} from "../../src/schemas/registry.js";
import type { RunRecordManifest } from "../../src/schemas/runRecord.js";
import type { AuthoringRecordManifestPreSchema as FrozenAuthoringRecordManifest } from "../../src/schemas/history/authoring-record-manifest/pre-schema.js";
import type { ComplianceReviewPreSchema as FrozenComplianceReview } from "../../src/schemas/history/compliance-review/pre-schema.js";
import type { GateAttributionPreSchema as FrozenGateAttribution } from "../../src/schemas/history/gate-attribution/pre-schema.js";
import type { GateDiagnosticsPreSchema as FrozenGateDiagnostics } from "../../src/schemas/history/gate-diagnostics/pre-schema.js";
import type { GatePendingPreSchema as FrozenGatePending } from "../../src/schemas/history/gate-pending/pre-schema.js";
import type { PhaseFileReconciliationPreSchema as FrozenPhaseFileReconciliation } from "../../src/schemas/history/phase-file-reconciliation/pre-schema.js";
import type { PhaseRecordManifestPreSchema as FrozenPhaseRecordManifest } from "../../src/schemas/history/phase-record-manifest/pre-schema.js";
import type { PhaseStatusPreSchema as FrozenPhaseStatus } from "../../src/schemas/history/phase-status/pre-schema.js";
import type { PhaxPlanPreSchema as FrozenPhaxPlan } from "../../src/schemas/history/phax-plan/pre-schema.js";
import type { PlanApprovalsPreSchema as FrozenPlanApprovals } from "../../src/schemas/history/plan-approvals/pre-schema.js";
import type { PlanDocumentPreSchema as FrozenPlanDocument } from "../../src/schemas/history/plan-document/pre-schema.js";
import type { RegistryPreSchema as FrozenRegistry } from "../../src/schemas/history/registry/pre-schema.js";
import type { RunStatusPreSchema as FrozenRunStatus } from "../../src/schemas/history/run-status/pre-schema.js";
import type { SpecApprovalsPreSchema as FrozenSpecApprovals } from "../../src/schemas/history/spec-approvals/pre-schema.js";
import type { SpecDocumentPreSchema as FrozenSpecDocument } from "../../src/schemas/history/spec-document/pre-schema.js";
import type { FormatId } from "../../src/schemas/schemaUrl.js";
import type {
  PhaseStatus as PhaxPhaseStatus,
  PhaseStatusFile as PhaxPhaseStatusFile,
  RunStatus as PhaxRunStatus,
  RunStatusFile as PhaxRunStatusFile,
} from "../../src/schemas/status.js";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// The package's PhaseRecordManifest is phax's RunRecordManifest, both ways (§5.20)
declare const fromPackage: PhaseRecordManifest;
declare const fromPhax: RunRecordManifest;
const packageToPhax: RunRecordManifest = fromPackage;
const phaxToPackage: PhaseRecordManifest = fromPhax;
void packageToPhax;
void phaxToPackage;

// parsePhaseRecordManifest is a union over shapes, assignable to Parsed over their values
const parsed = parsePhaseRecordManifest({});
const asParsed: Parsed<PhaseRecordManifest> = parsed;
void asParsed;

// Narrowing on success yields the frozen pre-schema type or phax's own type
if (parsed.ok) {
  const shape: Equals<typeof parsed.shape, "pre-schema" | "next"> = true;
  const exact: Equals<typeof parsed.value, FrozenPhaseRecordManifest | RunRecordManifest> = true;
  void shape;
  void exact;
  if (parsed.shape === "pre-schema") {
    const frozen: Equals<typeof parsed.value, FrozenPhaseRecordManifest> = true;
    void frozen;
  }
  // @ts-expect-error: a success carries no error
  void parsed.error;
} else {
  const path: string = parsed.error.path;
  const message: string = parsed.error.message;
  void path;
  void message;
  // @ts-expect-error: a failure carries no value
  void parsed.value;
  // @ts-expect-error: a failure carries no shape
  void parsed.shape;
}

// ParsedShape over any map is assignable to Parsed over its values
type Toy = { "pre-schema": { a: 1 }; "0.10.0": { b: 2 }; next: { c: 3 } };
declare const toy: ParsedShape<Toy>;
const toyAsParsed: Parsed<Toy[keyof Toy]> = toy;
void toyAsParsed;

// Parsed is readonly throughout
declare const failure: Extract<Parsed<PhaseRecordManifest>, { ok: false }>;
// @ts-expect-error: path is readonly
failure.error.path = "outcome";

// FormatSpec's two variants are mutually exclusive
declare const toyShapes: { readonly [K in keyof Toy]: Shape<Toy[K]> };
const unfilled: FormatSpec<{ "pre-schema": { a: 1 } }> = {
  id: "gate-pending",
  label: "toy",
  releases: [],
  current: { name: "pre-schema", shape: toyShapes["pre-schema"] },
};
const filled: FormatSpec<Toy> = {
  id: "gate-pending",
  label: "toy",
  preSchema: toyShapes["pre-schema"],
  releases: [["0.10.0", toyShapes["0.10.0"]]],
  current: { name: "next", shape: toyShapes.next },
};
void unfilled;
void filled;
// @ts-expect-error: a filled pre-schema slot never names pre-schema as the current shape
const filledWithPreSchemaCurrent: FormatSpec<Toy> = {
  id: "gate-pending",
  label: "toy",
  preSchema: toyShapes["pre-schema"],
  releases: [],
  current: { name: "pre-schema", shape: toyShapes["pre-schema"] },
};
void filledWithPreSchemaCurrent;
const unfilledWithReleases: FormatSpec<Toy> = {
  id: "gate-pending",
  label: "toy",
  // @ts-expect-error: an unfilled pre-schema slot has no releases
  releases: [["0.10.0", toyShapes["0.10.0"]]],
  current: { name: "pre-schema", shape: toyShapes["pre-schema"] },
};
void unfilledWithReleases;
// @ts-expect-error: a current shape named next needs a frozen pre-schema module
const nextWithoutPreSchema: FormatSpec<Toy> = {
  id: "gate-pending",
  label: "toy",
  releases: [],
  current: { name: "next", shape: toyShapes.next },
};
void nextWithoutPreSchema;

// parseDocument names the format and the shape, and narrows to the exact type
const document = parseDocument({});
const documentAsParsed: Parsed<AnyDocument["value"]> = document;
void documentAsParsed;
const formats: Equals<
  DocumentFormatId,
  | "phase-record-manifest"
  | "authoring-record-manifest"
  | "registry"
  | "run-status"
  | "phase-status"
  | "phax-plan"
  | "compliance-review"
  | "plan-approvals"
  | "spec-approvals"
  | "spec-document"
  | "plan-document"
  | "gate-attribution"
  | "phase-file-reconciliation"
  | "gate-diagnostics"
  | "gate-pending"
> = true;
void formats;
// parseDocument is complete: it reads every persisted format id, and no other
const complete: Equals<DocumentFormatId, FormatId> = true;
void complete;
if (document.ok) {
  const format: DocumentFormatId = document.format;
  const shape: Equals<typeof document.shape, "pre-schema" | "next"> = true;
  void format;
  void shape;
  if (document.format === "phase-record-manifest" && document.shape === "next") {
    const exact: Equals<typeof document.value, RunRecordManifest> = true;
    void exact;
  }
  if (document.format === "phax-plan" && document.shape === "next") {
    const exact: Equals<typeof document.value, PhaxPhaxPlan> = true;
    void exact;
  }
  if (document.format === "spec-approvals" && document.shape === "pre-schema") {
    const exact: Equals<typeof document.value, FrozenSpecApprovals> = true;
    void exact;
  }
  if (document.format === "phase-file-reconciliation" && document.shape === "next") {
    const exact: Equals<typeof document.value, PhaxPhaseFileReconciliation> = true;
    void exact;
  }
}
const oneParameter: Equals<Parameters<typeof parseDocument>, [input: unknown]> = true;
void oneParameter;
declare const parsedDocument: ParsedDocument<{
  "gate-pending": { "pre-schema": { a: string }; "0.12.0": { b: string } };
}>;
if (parsedDocument.ok && parsedDocument.shape === "0.12.0") {
  const toyValue: Equals<typeof parsedDocument.value, { b: string }> = true;
  void toyValue;
}

// Every format reads two shapes: its frozen pre-schema shape and next
const shapeIds: Equals<
  | RegistryShape
  | RunStatusShape
  | PhaseStatusShape
  | PhaxPlanShape
  | ComplianceReviewShape
  | PlanApprovalsShape
  | SpecApprovalsShape
  | SpecDocumentShape
  | PlanDocumentShape
  | PhaseRecordManifestShape
  | AuthoringRecordManifestShape
  | GateAttributionShape
  | PhaseFileReconciliationShape
  | GateDiagnosticsShape
  | GatePendingShape,
  "pre-schema" | "next"
> = true;
void shapeIds;
const eachShapeId: [
  Equals<RegistryShape, "pre-schema" | "next">,
  Equals<RunStatusShape, "pre-schema" | "next">,
  Equals<PhaseStatusShape, "pre-schema" | "next">,
  Equals<PhaxPlanShape, "pre-schema" | "next">,
  Equals<ComplianceReviewShape, "pre-schema" | "next">,
  Equals<PlanApprovalsShape, "pre-schema" | "next">,
  Equals<SpecApprovalsShape, "pre-schema" | "next">,
  Equals<SpecDocumentShape, "pre-schema" | "next">,
  Equals<PlanDocumentShape, "pre-schema" | "next">,
  Equals<PhaseRecordManifestShape, "pre-schema" | "next">,
  Equals<AuthoringRecordManifestShape, "pre-schema" | "next">,
  Equals<GateAttributionShape, "pre-schema" | "next">,
  Equals<PhaseFileReconciliationShape, "pre-schema" | "next">,
  Equals<GateDiagnosticsShape, "pre-schema" | "next">,
  Equals<GatePendingShape, "pre-schema" | "next">,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
void eachShapeId;

/** The value a parse function's success carries. */
type Value<P extends (input: unknown) => unknown> =
  ReturnType<P> extends infer R ? (R extends { ok: true; value: infer V } ? V : never) : never;

/** The value a parse function's success carries for one shape. */
type ShapeValue<P extends (input: unknown) => unknown, S extends string> =
  ReturnType<P> extends infer R
    ? R extends { ok: true; shape: S; value: infer V }
      ? V
      : never
    : never;

// Each parse function's success value is the frozen type or phax's type
const parseValues: [
  Equals<Value<typeof parseRegistry>, FrozenRegistry | PhaxRegistryFile>,
  Equals<Value<typeof parseRunStatus>, FrozenRunStatus | PhaxRunStatusFile>,
  Equals<Value<typeof parsePhaseStatus>, FrozenPhaseStatus | PhaxPhaseStatusFile>,
  Equals<Value<typeof parsePhaxPlan>, FrozenPhaxPlan | PhaxPhaxPlan>,
  Equals<Value<typeof parseComplianceReview>, FrozenComplianceReview | PhaxComplianceReview>,
  Equals<Value<typeof parsePlanApprovals>, FrozenPlanApprovals | ApprovalRecordFile>,
  Equals<Value<typeof parseSpecApprovals>, FrozenSpecApprovals | SpecApprovalRecordFile>,
  Equals<Value<typeof parseSpecDocument>, FrozenSpecDocument | PhaxSpecDocument>,
  Equals<Value<typeof parsePlanDocument>, FrozenPlanDocument | PhaxPlanDocument>,
  Equals<Value<typeof parsePhaseRecordManifest>, FrozenPhaseRecordManifest | RunRecordManifest>,
  Equals<
    Value<typeof parseAuthoringRecordManifest>,
    FrozenAuthoringRecordManifest | PhaxAuthoringRecordManifest
  >,
  Equals<Value<typeof parseGateAttribution>, FrozenGateAttribution | PhaxGateAttribution>,
  Equals<
    Value<typeof parsePhaseFileReconciliation>,
    FrozenPhaseFileReconciliation | PhaxPhaseFileReconciliation
  >,
  Equals<Value<typeof parseGateDiagnostics>, FrozenGateDiagnostics | GateDiagnosticsDocument>,
  Equals<Value<typeof parseGatePending>, FrozenGatePending | GatePendingDocument>,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
void parseValues;

// Each shape carries its own type: the frozen module's for pre-schema, phax's for next
const shapeValues: [
  Equals<ShapeValue<typeof parseRegistry, "pre-schema">, FrozenRegistry>,
  Equals<ShapeValue<typeof parseRegistry, "next">, PhaxRegistryFile>,
  Equals<ShapeValue<typeof parseGatePending, "pre-schema">, FrozenGatePending>,
  Equals<ShapeValue<typeof parseGatePending, "next">, GatePendingDocument>,
] = [true, true, true, true];
void shapeValues;

// The package re-exports each frozen module's type under its own name
const frozenTypes: [
  Equals<RegistryPreSchema, FrozenRegistry>,
  Equals<RunStatusPreSchema, FrozenRunStatus>,
  Equals<PhaseStatusPreSchema, FrozenPhaseStatus>,
  Equals<PhaxPlanPreSchema, FrozenPhaxPlan>,
  Equals<ComplianceReviewPreSchema, FrozenComplianceReview>,
  Equals<PlanApprovalsPreSchema, FrozenPlanApprovals>,
  Equals<SpecApprovalsPreSchema, FrozenSpecApprovals>,
  Equals<SpecDocumentPreSchema, FrozenSpecDocument>,
  Equals<PlanDocumentPreSchema, FrozenPlanDocument>,
  Equals<PhaseRecordManifestPreSchema, FrozenPhaseRecordManifest>,
  Equals<AuthoringRecordManifestPreSchema, FrozenAuthoringRecordManifest>,
  Equals<GateAttributionPreSchema, FrozenGateAttribution>,
  Equals<PhaseFileReconciliationPreSchema, FrozenPhaseFileReconciliation>,
  Equals<GateDiagnosticsPreSchema, FrozenGateDiagnostics>,
  Equals<GatePendingPreSchema, FrozenGatePending>,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
void frozenTypes;

// Each Latest type drops version from phax's type; a format that writes $schema
// has phax's in-memory type; the timeline formats carry no version
const latestTypes: [
  Equals<LatestRegistry, PhaxRegistry>,
  Equals<LatestRunStatus, PhaxRunStatus>,
  Equals<LatestPhaseStatus, PhaxPhaseStatus>,
  Equals<LatestPhaxPlan, Omit<PhaxPhaxPlan, "version">>,
  Equals<LatestComplianceReview, Omit<PhaxComplianceReview, "version">>,
  Equals<LatestPlanApprovals, Omit<ApprovalRecordFile, "version">>,
  Equals<LatestSpecApprovals, Omit<SpecApprovalRecordFile, "version">>,
  Equals<LatestSpecDocument, Omit<PhaxSpecDocument, "version">>,
  Equals<LatestPlanDocument, Omit<PhaxPlanDocument, "version">>,
  Equals<LatestPhaseRecordManifest, Omit<RunRecordManifest, "version">>,
  Equals<LatestAuthoringRecordManifest, Omit<PhaxAuthoringRecordManifest, "version">>,
  Equals<LatestGateAttribution, PhaxGateAttribution>,
  Equals<LatestPhaseFileReconciliation, PhaxPhaseFileReconciliation>,
  Equals<LatestGateDiagnostics, GateDiagnosticsDocument>,
  Equals<LatestGatePending, GatePendingDocument>,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
void latestTypes;

declare const latestRegistry: LatestRegistry;
// @ts-expect-error: the latest registry carries no version
void latestRegistry.version;
// @ts-expect-error: the in-memory registry carries no $schema
void latestRegistry.$schema;
declare const latestRunStatus: LatestRunStatus;
// @ts-expect-error: the latest run status carries no version
void latestRunStatus.version;
// @ts-expect-error: the in-memory run status carries no $schema
void latestRunStatus.$schema;
declare const latestPhaseStatus: LatestPhaseStatus;
// @ts-expect-error: the latest phase status carries no version
void latestPhaseStatus.version;
// @ts-expect-error: the in-memory phase status carries no $schema
void latestPhaseStatus.$schema;
declare const latest: LatestPhaseRecordManifest;
// @ts-expect-error: the latest manifest carries no version
void latest.version;
declare const latestPlan: LatestPhaxPlan;
// @ts-expect-error: the latest phax-plan carries no version
void latestPlan.version;
// @ts-expect-error: the latest phax-plan has no place for run.backend
void latestPlan.run.backend;

// Each toLatest takes phax's own type and the frozen pre-schema type
declare const phaxRunStatus: PhaxRunStatusFile;
declare const phaxPhaxPlan: PhaxPhaxPlan;
declare const phaxSpecDocument: PhaxSpecDocument;
declare const phaxReconciliation: PhaxPhaseFileReconciliation;
const upgradedRunStatus: LatestRunStatus = toLatestRunStatus(phaxRunStatus);
const upgradedPhaxPlan: LatestPhaxPlan = toLatestPhaxPlan(phaxPhaxPlan);
const upgradedSpecDocument: LatestSpecDocument = toLatestSpecDocument(phaxSpecDocument);
const upgradedReconciliation: LatestPhaseFileReconciliation =
  toLatestPhaseFileReconciliation(phaxReconciliation);
void upgradedRunStatus;
void upgradedPhaxPlan;
void upgradedSpecDocument;
void upgradedReconciliation;
declare const frozenRunStatus: FrozenRunStatus;
declare const frozenPhaxPlan: FrozenPhaxPlan;
declare const frozenSpecDocument: FrozenSpecDocument;
declare const frozenReconciliation: FrozenPhaseFileReconciliation;
declare const frozenPhaseRecordManifest: FrozenPhaseRecordManifest;
const upgradedFrozenRunStatus: LatestRunStatus = toLatestRunStatus(frozenRunStatus);
const upgradedFrozenPhaxPlan: LatestPhaxPlan = toLatestPhaxPlan(frozenPhaxPlan);
const upgradedFrozenSpecDocument: LatestSpecDocument = toLatestSpecDocument(frozenSpecDocument);
const upgradedFrozenReconciliation: LatestPhaseFileReconciliation =
  toLatestPhaseFileReconciliation(frozenReconciliation);
const upgradedFrozenManifest: LatestPhaseRecordManifest =
  toLatestPhaseRecordManifest(frozenPhaseRecordManifest);
void upgradedFrozenRunStatus;
void upgradedFrozenPhaxPlan;
void upgradedFrozenSpecDocument;
void upgradedFrozenReconciliation;
void upgradedFrozenManifest;
const toLatestParameters: [
  Equals<Parameters<typeof toLatestRegistry>, [value: FrozenRegistry | PhaxRegistryFile]>,
  Equals<Parameters<typeof toLatestRunStatus>, [value: FrozenRunStatus | PhaxRunStatusFile]>,
  Equals<Parameters<typeof toLatestPhaseStatus>, [value: FrozenPhaseStatus | PhaxPhaseStatusFile]>,
  Equals<Parameters<typeof toLatestGatePending>, [value: FrozenGatePending | GatePendingDocument]>,
] = [true, true, true, true];
void toLatestParameters;

// ── run-directory formats

// Each package type is phax's own type, both ways (§5.20); the registry's is
// phax's file type, as are the run and phase status types
const registryIsPhax: Equals<Registry, PhaxRegistryFile> = true;
const runStatusIsPhax: Equals<RunStatus, PhaxRunStatusFile> = true;
const phaseStatusIsPhax: Equals<PhaseStatus, PhaxPhaseStatusFile> = true;
const phaxPlanIsPhax: Equals<PhaxPlan, PhaxPhaxPlan> = true;
const complianceReviewIsPhax: Equals<ComplianceReview, PhaxComplianceReview> = true;
void registryIsPhax;
void runStatusIsPhax;
void phaseStatusIsPhax;
void phaxPlanIsPhax;
void complianceReviewIsPhax;

// ── repository formats

// Each package type is phax's own type, both ways, under the spec's names (§5.20)
const planApprovalsIsPhax: Equals<PlanApprovals, ApprovalRecordFile> = true;
const specApprovalsIsPhax: Equals<SpecApprovals, SpecApprovalRecordFile> = true;
const specDocumentIsPhax: Equals<SpecDocument, PhaxSpecDocument> = true;
const planDocumentIsPhax: Equals<PlanDocument, PhaxPlanDocument> = true;
void planApprovalsIsPhax;
void specApprovalsIsPhax;
void specDocumentIsPhax;
void planDocumentIsPhax;
declare const phaxPlanApprovals: ApprovalRecordFile;
declare const packagePlanApprovals: PlanApprovals;
const planApprovalsToPackage: PlanApprovals = phaxPlanApprovals;
const planApprovalsToPhax: ApprovalRecordFile = packagePlanApprovals;
void planApprovalsToPackage;
void planApprovalsToPhax;

// ── record manifests

// The authoring manifest and the union are phax's own types, both ways (§5.20)
const authoringIsPhax: Equals<AuthoringRecordManifest, PhaxAuthoringRecordManifest> = true;
const recordManifestIsPhax: Equals<RecordManifest, PhaxRecordManifest> = true;
void authoringIsPhax;
void recordManifestIsPhax;
declare const phaxAuthoring: PhaxAuthoringRecordManifest;
declare const packageAuthoring: AuthoringRecordManifest;
declare const phaxRecordManifest: PhaxRecordManifest;
declare const packageRecordManifest: RecordManifest;
const authoringToPackage: AuthoringRecordManifest = phaxAuthoring;
const authoringToPhax: PhaxAuthoringRecordManifest = packageAuthoring;
const recordManifestToPackage: RecordManifest = phaxRecordManifest;
const recordManifestToPhax: PhaxRecordManifest = packageRecordManifest;
void authoringToPackage;
void authoringToPhax;
void recordManifestToPackage;
void recordManifestToPhax;

// The latest authoring manifest keeps sourceSha optional
const upgradedAuthoring = toLatestAuthoringRecordManifest(packageAuthoring);
const sourceShaStaysOptional: Equals<typeof upgradedAuthoring.sourceSha, string | undefined> = true;
void sourceShaStaysOptional;

// parseRecordManifest names the format and the shape, and narrows to the exact type
const recordManifestFormats: Equals<
  RecordManifestFormat,
  "phase-record-manifest" | "authoring-record-manifest"
> = true;
void recordManifestFormats;
const anyManifest = parseRecordManifest({});
const anyManifestAsParsed: Parsed<PhaseRecordManifest | AuthoringRecordManifest> = anyManifest;
void anyManifestAsParsed;
if (anyManifest.ok) {
  const format: RecordManifestFormat = anyManifest.format;
  const shape: Equals<typeof anyManifest.shape, "pre-schema" | "next"> = true;
  void format;
  void shape;
  if (anyManifest.format === "authoring-record-manifest") {
    const exact: Equals<
      typeof anyManifest.value,
      FrozenAuthoringRecordManifest | PhaxAuthoringRecordManifest
    > = true;
    void exact;
  } else {
    const exact: Equals<typeof anyManifest.value, FrozenPhaseRecordManifest | RunRecordManifest> =
      true;
    void exact;
  }
}

// ── record timeline files

// Each package type is phax's own type, both ways, under the spec's names (§5.20)
const gateAttributionIsPhax: Equals<GateAttribution, PhaxGateAttribution> = true;
const reconciliationIsPhax: Equals<PhaseFileReconciliation, PhaxPhaseFileReconciliation> = true;
const gateDiagnosticsIsPhax: Equals<GateDiagnostics, GateDiagnosticsDocument> = true;
const gatePendingIsPhax: Equals<GatePending, GatePendingDocument> = true;
void gateAttributionIsPhax;
void reconciliationIsPhax;
void gateDiagnosticsIsPhax;
void gatePendingIsPhax;
declare const phaxGateDiagnostics: GateDiagnosticsDocument;
declare const packageGateDiagnostics: GateDiagnostics;
const gateDiagnosticsToPackage: GateDiagnostics = phaxGateDiagnostics;
const gateDiagnosticsToPhax: GateDiagnosticsDocument = packageGateDiagnostics;
void gateDiagnosticsToPackage;
void gateDiagnosticsToPhax;
