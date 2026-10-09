import type {
  AnyDocument,
  AuthoringRecordManifest,
  AuthoringRecordManifestShape,
  BriefAnswer,
  BriefAnswerShape,
  BriefRecord,
  BriefRecordShape,
  BriefReport,
  BriefReportShape,
  BriefRequest,
  BriefRequestShape,
  ComplianceReview,
  ComplianceReviewShape,
  DocumentFormatId,
  GateAttribution,
  GateAttributionShape,
  GateReport,
  GateReportShape,
  GateRequest,
  GateRequestShape,
  LatestAuthoringRecordManifest,
  LatestBriefAnswer,
  LatestBriefRecord,
  LatestBriefReport,
  LatestBriefRequest,
  LatestComplianceReview,
  LatestGateAttribution,
  LatestGateReport,
  LatestGateRequest,
  LatestPhaseFileReconciliation,
  LatestPhaseRecordManifest,
  LatestPhaseStatus,
  LatestPhaxPlan,
  LatestRegistry,
  LatestPlanApprovalRecord,
  LatestPlanApprovals,
  LatestPlanDocument,
  LatestRunStatus,
  LatestSpecApprovalRecord,
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
  PhaseStatusV0_17_0,
  PhaxPlan,
  PhaxPlanShape,
  PlanApprovalRecord,
  PlanApprovalRecordShape,
  PlanApprovals,
  PlanApprovalsShape,
  PlanDocument,
  PlanDocumentShape,
  PlanDocumentV0_17_0,
  GateAttributionV0_17_0,
  RecordManifest,
  RecordManifestFormat,
  Registry,
  ReportFinding,
  ReportGuide,
  ReportLocation,
  RegistryShape,
  RunStatus,
  RunStatusShape,
  SpecApprovalRecord,
  SpecApprovalRecordShape,
  SpecApprovals,
  SpecApprovalsShape,
  SpecDocument,
  SpecDocumentShape,
  Unknown,
  AuthoringRecordManifestPreSchema,
  ComplianceReviewPreSchema,
  GateAttributionPreSchema,
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
  parseBriefAnswer,
  parseBriefRecord,
  parseBriefReport,
  parseBriefRequest,
  parseComplianceReview,
  parseDocument,
  parseGateAttribution,
  parseGateReport,
  parseGateRequest,
  parsePhaseFileReconciliation,
  parsePhaseRecordManifest,
  parsePhaseStatus,
  parsePhaxPlan,
  parsePlanApprovalRecord,
  parsePlanApprovals,
  parsePlanDocument,
  parseRecordManifest,
  parseRegistry,
  parseRunStatus,
  parseSpecApprovalRecord,
  parseSpecApprovals,
  parseSpecDocument,
  toLatestAuthoringRecordManifest,
  toLatestBriefAnswer,
  toLatestBriefRecord,
  toLatestBriefReport,
  toLatestBriefRequest,
  toLatestComplianceReview,
  toLatestGateAttribution,
  toLatestGateReport,
  toLatestGateRequest,
  toLatestPhaseFileReconciliation,
  toLatestPhaseRecordManifest,
  toLatestPhaseStatus,
  toLatestPhaxPlan,
  toLatestPlanApprovalRecord,
  toLatestPlanApprovals,
  toLatestPlanDocument,
  toLatestRegistry,
  toLatestRunStatus,
  toLatestSpecApprovalRecord,
  toLatestSpecApprovals,
  toLatestSpecDocument,
} from "../../packages/schemas/src/index.js";
import { CURRENT_SHAPES } from "../../packages/schemas/src/generated/index.js";
import type { CurrentShapeName, FormatSpec, Shape } from "../../packages/schemas/src/shapes.js";
import type {
  ApprovalRecordFile,
  PlanApprovals as PhaxPlanApprovals,
  PlanRecord as PhaxPlanRecord,
  PlanRecordFile as PhaxPlanRecordFile,
} from "../../src/schemas/approvalRecord.js";
import type {
  AuthoringRecordManifest as PhaxAuthoringRecordManifest,
  AuthoringRecordManifestFile as PhaxAuthoringRecordManifestFile,
  RecordManifestFile as PhaxRecordManifestFile,
} from "../../src/schemas/authoringRecord.js";
import type {
  ComplianceReview as PhaxComplianceReview,
  ComplianceReviewFile as PhaxComplianceReviewFile,
} from "../../src/schemas/complianceReview.js";
import type {
  GateAttribution as PhaxGateAttribution,
  GateAttributionFile as PhaxGateAttributionFile,
} from "../../src/schemas/gateAttribution.js";
import type {
  BriefAnswer as PhaxBriefAnswer,
  BriefAnswerFile as PhaxBriefAnswerFile,
  BriefRecord as PhaxBriefRecord,
  BriefRecordFile as PhaxBriefRecordFile,
  BriefRequest as PhaxBriefRequest,
  BriefRequestFile as PhaxBriefRequestFile,
} from "../../src/schemas/brief.js";
import type {
  GateRequest as PhaxGateRequest,
  GateRequestFile as PhaxGateRequestFile,
} from "../../src/schemas/gateRequest.js";
import type {
  BriefFinding as PhaxBriefFinding,
  BriefReport as PhaxBriefReport,
  BriefReportFile as PhaxBriefReportFile,
} from "../../src/schemas/briefReport.js";
import type {
  GateFinding as PhaxGateFinding,
  GateReport as PhaxGateReport,
  GateReportFile as PhaxGateReportFile,
} from "../../src/schemas/gateReport.js";
import type {
  ReportGuide as PhaxReportGuide,
  ReportLocation as PhaxReportLocation,
} from "../../src/schemas/report.js";
import type {
  PhaseFileReconciliation as PhaxPhaseFileReconciliation,
  PhaseFileReconciliationFile as PhaxPhaseFileReconciliationFile,
} from "../../src/schemas/reconciliation.js";
import type {
  PhaxPlan as PhaxPhaxPlan,
  PhaxPlanFile as PhaxPhaxPlanFile,
} from "../../src/schemas/phaxPlan.js";
import type {
  PlanDocument as PhaxPlanDocument,
  PlanDocumentFile as PhaxPlanDocumentFile,
} from "../../src/schemas/planDocument.js";
import type {
  SpecApprovalRecordFile,
  SpecApprovals as PhaxSpecApprovals,
  SpecRecord as PhaxSpecRecord,
  SpecRecordFile as PhaxSpecRecordFile,
} from "../../src/schemas/specApprovalRecord.js";
import type {
  SpecDocument as PhaxSpecDocument,
  SpecDocumentFile as PhaxSpecDocumentFile,
} from "../../src/schemas/specDocument.js";
import type {
  Registry as PhaxRegistry,
  RegistryFile as PhaxRegistryFile,
} from "../../src/schemas/registry.js";
import type {
  RunRecordManifest as PhaxRunRecordManifest,
  RunRecordManifestFile,
} from "../../src/schemas/runRecord.js";
import type { AuthoringRecordManifestPreSchema as FrozenAuthoringRecordManifest } from "../../src/schemas/history/authoring-record-manifest/pre-schema.js";
import type { ComplianceReviewPreSchema as FrozenComplianceReview } from "../../src/schemas/history/compliance-review/pre-schema.js";
import type { GateAttributionV0_17_0 as FrozenGateAttributionV0_17_0 } from "../../src/schemas/history/gate-attribution/0.17.0.js";
import type { GateAttributionPreSchema as FrozenGateAttribution } from "../../src/schemas/history/gate-attribution/pre-schema.js";
import type { PhaseFileReconciliationPreSchema as FrozenPhaseFileReconciliation } from "../../src/schemas/history/phase-file-reconciliation/pre-schema.js";
import type { PhaseRecordManifestPreSchema as FrozenPhaseRecordManifest } from "../../src/schemas/history/phase-record-manifest/pre-schema.js";
import type { PhaseStatusV0_17_0 as FrozenPhaseStatusV0_17_0 } from "../../src/schemas/history/phase-status/0.17.0.js";
import type { PhaseStatusPreSchema as FrozenPhaseStatus } from "../../src/schemas/history/phase-status/pre-schema.js";
import type { PhaxPlanPreSchema as FrozenPhaxPlan } from "../../src/schemas/history/phax-plan/pre-schema.js";
import type { PlanApprovalsPreSchema as FrozenPlanApprovals } from "../../src/schemas/history/plan-approvals/pre-schema.js";
import type { PlanDocumentV0_17_0 as FrozenPlanDocumentV0_17_0 } from "../../src/schemas/history/plan-document/0.17.0.js";
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

/** A format's current shape name, as its snapshots record it: `next` until a release renames it. */
type Current<F extends FormatId> = (typeof CURRENT_SHAPES)[F];

// The current shape name is the generated one, never a literal of its own
const currentShapeNames: Equals<Current<"registry">, CurrentShapeName<"registry">> = true;
void currentShapeNames;

// The package's PhaseRecordManifest is phax's RunRecordManifestFile, both ways (§5.20)
declare const fromPackage: PhaseRecordManifest;
declare const fromPhax: RunRecordManifestFile;
const packageToPhax: RunRecordManifestFile = fromPackage;
const phaxToPackage: PhaseRecordManifest = fromPhax;
void packageToPhax;
void phaxToPackage;

// parsePhaseRecordManifest is a union over shapes, assignable to Parsed over their values
const parsed = parsePhaseRecordManifest({});
const asParsed: Parsed<FrozenPhaseRecordManifest | PhaseRecordManifest> = parsed;
void asParsed;

// Narrowing on success yields the frozen pre-schema type or phax's own type
if (parsed.ok) {
  const shape: Equals<typeof parsed.shape, "pre-schema" | Current<"phase-record-manifest">> = true;
  const exact: Equals<typeof parsed.value, FrozenPhaseRecordManifest | RunRecordManifestFile> =
    true;
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
  id: "gate-attribution",
  label: "toy",
  releases: [],
  current: { name: "pre-schema", shape: toyShapes["pre-schema"] },
};
const filled: FormatSpec<Toy> = {
  id: "gate-attribution",
  label: "toy",
  preSchema: toyShapes["pre-schema"],
  releases: [["0.10.0", toyShapes["0.10.0"]]],
  current: { name: "next", shape: toyShapes.next },
};
void unfilled;
void filled;
// @ts-expect-error: a filled pre-schema slot never names pre-schema as the current shape
const filledWithPreSchemaCurrent: FormatSpec<Toy> = {
  id: "gate-attribution",
  label: "toy",
  preSchema: toyShapes["pre-schema"],
  releases: [],
  current: { name: "pre-schema", shape: toyShapes["pre-schema"] },
};
void filledWithPreSchemaCurrent;
const unfilledWithReleases: FormatSpec<Toy> = {
  id: "gate-attribution",
  label: "toy",
  // @ts-expect-error: an unfilled pre-schema slot has no releases
  releases: [["0.10.0", toyShapes["0.10.0"]]],
  current: { name: "pre-schema", shape: toyShapes["pre-schema"] },
};
void unfilledWithReleases;
// @ts-expect-error: a current shape named next needs a frozen pre-schema module
const nextWithoutPreSchema: FormatSpec<Toy> = {
  id: "gate-attribution",
  label: "toy",
  releases: [],
  current: { name: "next", shape: toyShapes.next },
};
void nextWithoutPreSchema;

// A format born with $schema: preSchema null, no pre-schema shape, and only a
// format id born with $schema
type BornToy = { "0.10.0": { b: 2 }; next: { c: 3 } };
declare const bornShapes: { readonly [K in keyof BornToy]: Shape<BornToy[K]> };
const born: FormatSpec<BornToy> = {
  id: "plan-approval-record",
  label: "toy",
  preSchema: null,
  releases: [["0.10.0", bornShapes["0.10.0"]]],
  current: { name: "next", shape: bornShapes.next },
};
void born;
// @ts-expect-error: a format phax wrote before $schema is never born with it
const bornPreSchemaFormat: FormatSpec<BornToy> = {
  id: "gate-attribution",
  label: "toy",
  preSchema: null,
  releases: [],
  current: { name: "next", shape: bornShapes.next },
};
void bornPreSchemaFormat;
// @ts-expect-error: a format born with $schema has no frozen pre-schema module
const bornWithPreSchema: FormatSpec<Toy> = {
  id: "plan-approval-record",
  label: "toy",
  preSchema: toyShapes["pre-schema"],
  releases: [],
  current: { name: "next", shape: toyShapes.next },
};
void bornWithPreSchema;

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
  | "plan-approval-record"
  | "spec-approval-record"
  | "gate-request"
  | "brief-request"
  | "brief-answer"
  | "brief-record"
  | "gate-report"
  | "brief-report"
> = true;
void formats;
// parseDocument is complete: it reads every persisted format id, and no other
const complete: Equals<DocumentFormatId, FormatId> = true;
void complete;
if (document.ok) {
  const format: DocumentFormatId = document.format;
  const shape: Equals<typeof document.shape, "pre-schema" | Current<FormatId>> = true;
  void format;
  void shape;
  if (
    document.format === "phase-record-manifest" &&
    document.shape === CURRENT_SHAPES["phase-record-manifest"]
  ) {
    const exact: Equals<typeof document.value, RunRecordManifestFile> = true;
    void exact;
  }
  if (document.format === "phax-plan" && document.shape === CURRENT_SHAPES["phax-plan"]) {
    const exact: Equals<typeof document.value, PhaxPhaxPlanFile> = true;
    void exact;
  }
  if (document.format === "spec-approvals" && document.shape === "pre-schema") {
    const exact: Equals<typeof document.value, FrozenSpecApprovals> = true;
    void exact;
  }
  if (document.format === "plan-approval-record") {
    const exact: Equals<typeof document.value, PhaxPlanRecordFile> = true;
    const recordShape: Equals<typeof document.shape, Current<"plan-approval-record">> = true;
    void exact;
    void recordShape;
  }
  if (document.format === "spec-document" && document.shape === CURRENT_SHAPES["spec-document"]) {
    const exact: Equals<typeof document.value, PhaxSpecDocumentFile> = true;
    void exact;
  }
  if (
    document.format === "phase-file-reconciliation" &&
    document.shape === CURRENT_SHAPES["phase-file-reconciliation"]
  ) {
    const exact: Equals<typeof document.value, PhaxPhaseFileReconciliationFile> = true;
    void exact;
  }
}
const oneParameter: Equals<Parameters<typeof parseDocument>, [input: unknown]> = true;
void oneParameter;
declare const parsedDocument: ParsedDocument<{
  "gate-attribution": { "pre-schema": { a: string }; "0.12.0": { b: string } };
}>;
if (parsedDocument.ok && parsedDocument.shape === "0.12.0") {
  const toyValue: Equals<typeof parsedDocument.value, { b: string }> = true;
  void toyValue;
}

// Every format reads its current shape, named by CURRENT_SHAPES; a format
// phax wrote before $schema also reads its frozen pre-schema shape
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
  | PlanApprovalRecordShape
  | SpecApprovalRecordShape
  | GateRequestShape
  | BriefRequestShape
  | BriefAnswerShape
  | BriefRecordShape
  | GateReportShape
  | BriefReportShape,
  "pre-schema" | Current<FormatId>
> = true;
void shapeIds;
const eachShapeId: [
  Equals<RegistryShape, "pre-schema" | Current<"registry">>,
  Equals<RunStatusShape, "pre-schema" | Current<"run-status">>,
  Equals<PhaseStatusShape, "pre-schema" | "0.17.0" | Current<"phase-status">>,
  Equals<PhaxPlanShape, "pre-schema" | Current<"phax-plan">>,
  Equals<ComplianceReviewShape, "pre-schema" | Current<"compliance-review">>,
  Equals<PlanApprovalsShape, "pre-schema" | Current<"plan-approvals">>,
  Equals<SpecApprovalsShape, "pre-schema" | Current<"spec-approvals">>,
  Equals<SpecDocumentShape, "pre-schema" | Current<"spec-document">>,
  Equals<PlanDocumentShape, "pre-schema" | "0.17.0" | Current<"plan-document">>,
  Equals<PhaseRecordManifestShape, "pre-schema" | Current<"phase-record-manifest">>,
  Equals<AuthoringRecordManifestShape, "pre-schema" | Current<"authoring-record-manifest">>,
  Equals<GateAttributionShape, "pre-schema" | "0.17.0" | Current<"gate-attribution">>,
  Equals<PhaseFileReconciliationShape, "pre-schema" | Current<"phase-file-reconciliation">>,
  Equals<PlanApprovalRecordShape, Current<"plan-approval-record">>,
  Equals<SpecApprovalRecordShape, Current<"spec-approval-record">>,
  Equals<GateRequestShape, Current<"gate-request">>,
] = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];
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
  Equals<
    Value<typeof parsePhaseStatus>,
    FrozenPhaseStatus | FrozenPhaseStatusV0_17_0 | PhaxPhaseStatusFile
  >,
  Equals<Value<typeof parsePhaxPlan>, FrozenPhaxPlan | PhaxPhaxPlanFile>,
  Equals<Value<typeof parseComplianceReview>, FrozenComplianceReview | PhaxComplianceReviewFile>,
  Equals<Value<typeof parsePlanApprovals>, FrozenPlanApprovals | ApprovalRecordFile>,
  Equals<Value<typeof parseSpecApprovals>, FrozenSpecApprovals | SpecApprovalRecordFile>,
  Equals<Value<typeof parseSpecDocument>, FrozenSpecDocument | PhaxSpecDocumentFile>,
  Equals<
    Value<typeof parsePlanDocument>,
    FrozenPlanDocument | FrozenPlanDocumentV0_17_0 | PhaxPlanDocumentFile
  >,
  Equals<Value<typeof parsePhaseRecordManifest>, FrozenPhaseRecordManifest | RunRecordManifestFile>,
  Equals<
    Value<typeof parseAuthoringRecordManifest>,
    FrozenAuthoringRecordManifest | PhaxAuthoringRecordManifestFile
  >,
  Equals<
    Value<typeof parseGateAttribution>,
    FrozenGateAttribution | FrozenGateAttributionV0_17_0 | PhaxGateAttributionFile
  >,
  Equals<
    Value<typeof parsePhaseFileReconciliation>,
    FrozenPhaseFileReconciliation | PhaxPhaseFileReconciliationFile
  >,
  Equals<Value<typeof parsePlanApprovalRecord>, PhaxPlanRecordFile>,
  Equals<Value<typeof parseSpecApprovalRecord>, PhaxSpecRecordFile>,
  Equals<Value<typeof parseGateRequest>, PhaxGateRequestFile>,
] = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];
void parseValues;

// Each shape carries its own type: the frozen module's for pre-schema, phax's
// for the current shape
const shapeValues: [
  Equals<ShapeValue<typeof parseRegistry, "pre-schema">, FrozenRegistry>,
  Equals<ShapeValue<typeof parseRegistry, Current<"registry">>, PhaxRegistryFile>,
] = [true, true];
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
] = [true, true, true, true, true, true, true, true, true, true, true, true, true];
void frozenTypes;

// Each Latest type is phax's in-memory type: no version, no $schema
const latestTypes: [
  Equals<LatestRegistry, PhaxRegistry>,
  Equals<LatestRunStatus, PhaxRunStatus>,
  Equals<
    LatestPhaseStatus,
    PhaxPhaseStatus | (Omit<PhaxPhaseStatus, "base"> & { readonly base: Unknown })
  >,
  Equals<LatestPhaxPlan, PhaxPhaxPlan>,
  Equals<LatestComplianceReview, PhaxComplianceReview>,
  Equals<LatestPlanApprovals, PhaxPlanApprovals>,
  Equals<LatestSpecApprovals, PhaxSpecApprovals>,
  Equals<LatestSpecDocument, PhaxSpecDocument>,
  Equals<
    LatestPlanDocument,
    | PhaxPlanDocument
    | (Omit<PhaxPlanDocument, "sourceSpec" | "completesSpec"> & {
        readonly sourceSpec: string;
        readonly completesSpec: Unknown;
      })
  >,
  Equals<LatestPhaseRecordManifest, PhaxRunRecordManifest>,
  Equals<LatestAuthoringRecordManifest, PhaxAuthoringRecordManifest>,
  Equals<LatestGateAttribution, PhaxGateAttribution>,
  Equals<LatestPhaseFileReconciliation, PhaxPhaseFileReconciliation>,
  Equals<LatestPlanApprovalRecord, PhaxPlanRecord>,
  Equals<LatestSpecApprovalRecord, PhaxSpecRecord>,
  Equals<LatestGateRequest, PhaxGateRequest>,
] = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];
void latestTypes;

// A format born with $schema: its record is phax's own type, both ways, and
// its in-memory value carries no $schema
declare const packagePlanRecord: PlanApprovalRecord;
declare const packageSpecRecord: SpecApprovalRecord;
const planRecordToPhax: PhaxPlanRecordFile = packagePlanRecord;
const specRecordToPhax: PhaxSpecRecordFile = packageSpecRecord;
void planRecordToPhax;
void specRecordToPhax;
const recordUpgrades: [
  Equals<Parameters<typeof toLatestPlanApprovalRecord>, [value: PhaxPlanRecordFile]>,
  Equals<Parameters<typeof toLatestSpecApprovalRecord>, [value: PhaxSpecRecordFile]>,
] = [true, true];
void recordUpgrades;
declare const latestPlanRecord: LatestPlanApprovalRecord;
// @ts-expect-error: the in-memory plan approval record carries no $schema
void latestPlanRecord.$schema;
declare const latestSpecRecord: LatestSpecApprovalRecord;
// @ts-expect-error: the in-memory spec approval record carries no $schema
void latestSpecRecord.$schema;

// The gate request is born with $schema too: phax's own type, both ways, and
// its in-memory value carries no $schema
const gateRequestIsPhax: Equals<GateRequest, PhaxGateRequestFile> = true;
void gateRequestIsPhax;
const gateRequestUpgrade: Equals<
  Parameters<typeof toLatestGateRequest>,
  [value: PhaxGateRequestFile]
> = true;
void gateRequestUpgrade;
declare const latestGateRequest: LatestGateRequest;
// @ts-expect-error: the in-memory gate request carries no $schema
void latestGateRequest.$schema;
if (document.ok && document.format === "gate-request") {
  const exact: Equals<typeof document.value, PhaxGateRequestFile> = true;
  const requestShape: Equals<typeof document.shape, Current<"gate-request">> = true;
  void exact;
  void requestShape;
}

// The three brief formats are born with $schema: phax's own types, both ways,
// one current shape each, and in-memory values without a top-level $schema
const briefTypes: [
  Equals<BriefRequest, PhaxBriefRequestFile>,
  Equals<BriefAnswer, PhaxBriefAnswerFile>,
  Equals<BriefRecord, PhaxBriefRecordFile>,
  Equals<BriefRequestShape, Current<"brief-request">>,
  Equals<BriefAnswerShape, Current<"brief-answer">>,
  Equals<BriefRecordShape, Current<"brief-record">>,
  Equals<Value<typeof parseBriefRequest>, PhaxBriefRequestFile>,
  Equals<Value<typeof parseBriefAnswer>, PhaxBriefAnswerFile>,
  Equals<Value<typeof parseBriefRecord>, PhaxBriefRecordFile>,
  Equals<LatestBriefRequest, PhaxBriefRequest>,
  Equals<LatestBriefAnswer, PhaxBriefAnswer>,
  Equals<LatestBriefRecord, PhaxBriefRecord>,
  Equals<Parameters<typeof toLatestBriefRequest>, [value: PhaxBriefRequestFile]>,
  Equals<Parameters<typeof toLatestBriefAnswer>, [value: PhaxBriefAnswerFile]>,
  Equals<Parameters<typeof toLatestBriefRecord>, [value: PhaxBriefRecordFile]>,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
void briefTypes;
declare const latestBriefRequest: LatestBriefRequest;
// @ts-expect-error: the in-memory brief request carries no $schema
void latestBriefRequest.$schema;
declare const latestBriefAnswer: LatestBriefAnswer;
// @ts-expect-error: the in-memory brief answer carries no $schema
void latestBriefAnswer.$schema;
declare const latestBriefRecord: LatestBriefRecord;
// @ts-expect-error: the in-memory brief record carries no top-level $schema
void latestBriefRecord.$schema;
if (document.ok && document.format === "brief-record") {
  const exact: Equals<typeof document.value, PhaxBriefRecordFile> = true;
  const recordShape: Equals<typeof document.shape, Current<"brief-record">> = true;
  void exact;
  void recordShape;
}

// The two reports are born with $schema: phax's own types, both ways, one
// current shape each, and in-memory values without $schema. The location,
// guide and finding they share are phax's own types too
const reportTypes: [
  Equals<GateReport, PhaxGateReportFile>,
  Equals<BriefReport, PhaxBriefReportFile>,
  Equals<GateReportShape, Current<"gate-report">>,
  Equals<BriefReportShape, Current<"brief-report">>,
  Equals<Value<typeof parseGateReport>, PhaxGateReportFile>,
  Equals<Value<typeof parseBriefReport>, PhaxBriefReportFile>,
  Equals<LatestGateReport, PhaxGateReport>,
  Equals<LatestBriefReport, PhaxBriefReport>,
  Equals<Parameters<typeof toLatestGateReport>, [value: PhaxGateReportFile]>,
  Equals<Parameters<typeof toLatestBriefReport>, [value: PhaxBriefReportFile]>,
  Equals<ReportLocation, PhaxReportLocation>,
  Equals<ReportGuide, PhaxReportGuide>,
  Equals<ReportFinding, PhaxGateFinding>,
  Equals<Exclude<keyof PhaxBriefFinding, "due">, keyof ReportFinding>,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true];
void reportTypes;
declare const briefFinding: PhaxBriefFinding;
// A brief finding is a report finding plus `due`
const briefFindingIsReportFinding: ReportFinding = briefFinding;
void briefFindingIsReportFinding;
declare const latestGateReport: LatestGateReport;
// @ts-expect-error: the in-memory gate report carries no $schema
void latestGateReport.$schema;
declare const latestBriefReport: LatestBriefReport;
// @ts-expect-error: the in-memory brief report carries no $schema
void latestBriefReport.$schema;
if (document.ok && document.format === "gate-report") {
  const exact: Equals<typeof document.value, PhaxGateReportFile> = true;
  const reportShape: Equals<typeof document.shape, Current<"gate-report">> = true;
  void exact;
  void reportShape;
}

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
// @ts-expect-error: the in-memory phase record manifest carries no $schema
void latest.$schema;
declare const latestAuthoring: LatestAuthoringRecordManifest;
// @ts-expect-error: the latest authoring manifest carries no version
void latestAuthoring.version;
// @ts-expect-error: the in-memory authoring record manifest carries no $schema
void latestAuthoring.$schema;
declare const latestPlan: LatestPhaxPlan;
// @ts-expect-error: the latest phax-plan carries no version
void latestPlan.version;
// @ts-expect-error: the in-memory phax-plan carries no $schema
void latestPlan.$schema;
// @ts-expect-error: the latest phax-plan has no place for run.backend
void latestPlan.run.backend;
declare const latestPlanApprovals: LatestPlanApprovals;
// @ts-expect-error: the latest plan approvals ledger carries no version
void latestPlanApprovals.version;
// @ts-expect-error: the in-memory plan approvals ledger carries no $schema
void latestPlanApprovals.$schema;
declare const latestSpecApprovals: LatestSpecApprovals;
// @ts-expect-error: the latest spec approvals ledger carries no version
void latestSpecApprovals.version;
// @ts-expect-error: the in-memory spec approvals ledger carries no $schema
void latestSpecApprovals.$schema;
declare const latestSpecDocument: LatestSpecDocument;
// @ts-expect-error: the latest spec document carries no version
void latestSpecDocument.version;
// @ts-expect-error: the in-memory spec document carries no $schema
void latestSpecDocument.$schema;
declare const latestPlanDocument: LatestPlanDocument;
// @ts-expect-error: the latest plan document carries no version
void latestPlanDocument.version;
// @ts-expect-error: the in-memory plan document carries no $schema
void latestPlanDocument.$schema;
declare const latestReview: LatestComplianceReview;
// @ts-expect-error: the latest compliance review carries no version
void latestReview.version;
// @ts-expect-error: the in-memory compliance review carries no $schema
void latestReview.$schema;
declare const latestAttribution: LatestGateAttribution;
// @ts-expect-error: the in-memory gate attribution carries no $schema
void latestAttribution.$schema;
declare const latestReconciliation: LatestPhaseFileReconciliation;
// @ts-expect-error: the in-memory file reconciliation carries no $schema
void latestReconciliation.$schema;

// Each toLatest takes phax's own type and the frozen pre-schema type
declare const phaxRunStatus: PhaxRunStatusFile;
declare const phaxPhaxPlan: PhaxPhaxPlanFile;
declare const phaxSpecDocument: PhaxSpecDocumentFile;
declare const phaxReconciliation: PhaxPhaseFileReconciliationFile;
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
  Equals<
    Parameters<typeof toLatestPhaseStatus>,
    [value: FrozenPhaseStatus | FrozenPhaseStatusV0_17_0 | PhaxPhaseStatusFile]
  >,
  Equals<Parameters<typeof toLatestPhaxPlan>, [value: FrozenPhaxPlan | PhaxPhaxPlanFile]>,
  Equals<
    Parameters<typeof toLatestComplianceReview>,
    [value: FrozenComplianceReview | PhaxComplianceReviewFile]
  >,
  Equals<
    Parameters<typeof toLatestPlanApprovals>,
    [value: FrozenPlanApprovals | ApprovalRecordFile]
  >,
  Equals<
    Parameters<typeof toLatestSpecApprovals>,
    [value: FrozenSpecApprovals | SpecApprovalRecordFile]
  >,
  Equals<
    Parameters<typeof toLatestSpecDocument>,
    [value: FrozenSpecDocument | PhaxSpecDocumentFile]
  >,
  Equals<
    Parameters<typeof toLatestPlanDocument>,
    [value: FrozenPlanDocument | FrozenPlanDocumentV0_17_0 | PhaxPlanDocumentFile]
  >,
  Equals<
    Parameters<typeof toLatestPhaseRecordManifest>,
    [value: FrozenPhaseRecordManifest | RunRecordManifestFile]
  >,
  Equals<
    Parameters<typeof toLatestAuthoringRecordManifest>,
    [value: FrozenAuthoringRecordManifest | PhaxAuthoringRecordManifestFile]
  >,
  Equals<
    Parameters<typeof toLatestGateAttribution>,
    [value: FrozenGateAttribution | FrozenGateAttributionV0_17_0 | PhaxGateAttributionFile]
  >,
  Equals<
    Parameters<typeof toLatestPhaseFileReconciliation>,
    [value: FrozenPhaseFileReconciliation | PhaxPhaseFileReconciliationFile]
  >,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true];
void toLatestParameters;

// ── run-directory formats

// Each package type is phax's own type, both ways (§5.20); the registry's is
// phax's file type, as are the run status, phase status, phax-plan and
// compliance review types
const registryIsPhax: Equals<Registry, PhaxRegistryFile> = true;
const runStatusIsPhax: Equals<RunStatus, PhaxRunStatusFile> = true;
const phaseStatusIsPhax: Equals<PhaseStatus, PhaxPhaseStatusFile> = true;
// A released shape that is no longer current is its frozen module's type.
const phaseStatusV0_17_0IsFrozen: Equals<PhaseStatusV0_17_0, FrozenPhaseStatusV0_17_0> = true;
const phaxPlanIsPhax: Equals<PhaxPlan, PhaxPhaxPlanFile> = true;
const complianceReviewIsPhax: Equals<ComplianceReview, PhaxComplianceReviewFile> = true;
void registryIsPhax;
void runStatusIsPhax;
void phaseStatusIsPhax;
void phaseStatusV0_17_0IsFrozen;
void phaxPlanIsPhax;
void complianceReviewIsPhax;

// ── repository formats

// Each package type is phax's own type, both ways, under the spec's names (§5.20)
const planApprovalsIsPhax: Equals<PlanApprovals, ApprovalRecordFile> = true;
const specApprovalsIsPhax: Equals<SpecApprovals, SpecApprovalRecordFile> = true;
const specDocumentIsPhax: Equals<SpecDocument, PhaxSpecDocumentFile> = true;
const planDocumentIsPhax: Equals<PlanDocument, PhaxPlanDocumentFile> = true;
// A released shape that is no longer current is its frozen module's type.
const planDocumentV0_17_0IsFrozen: Equals<PlanDocumentV0_17_0, FrozenPlanDocumentV0_17_0> = true;
void planApprovalsIsPhax;
void specApprovalsIsPhax;
void specDocumentIsPhax;
void planDocumentIsPhax;
void planDocumentV0_17_0IsFrozen;
declare const phaxPlanApprovals: ApprovalRecordFile;
declare const packagePlanApprovals: PlanApprovals;
const planApprovalsToPackage: PlanApprovals = phaxPlanApprovals;
const planApprovalsToPhax: ApprovalRecordFile = packagePlanApprovals;
void planApprovalsToPackage;
void planApprovalsToPhax;

// ── record manifests

// The authoring manifest and the union are phax's own types, both ways (§5.20)
const authoringIsPhax: Equals<AuthoringRecordManifest, PhaxAuthoringRecordManifestFile> = true;
const recordManifestIsPhax: Equals<RecordManifest, PhaxRecordManifestFile> = true;
void authoringIsPhax;
void recordManifestIsPhax;
declare const phaxAuthoring: PhaxAuthoringRecordManifestFile;
declare const packageAuthoring: AuthoringRecordManifest;
declare const phaxRecordManifest: PhaxRecordManifestFile;
declare const packageRecordManifest: RecordManifest;
const authoringToPackage: AuthoringRecordManifest = phaxAuthoring;
const authoringToPhax: PhaxAuthoringRecordManifestFile = packageAuthoring;
const recordManifestToPackage: RecordManifest = phaxRecordManifest;
const recordManifestToPhax: PhaxRecordManifestFile = packageRecordManifest;
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
const anyManifestAsParsed: Parsed<
  | FrozenPhaseRecordManifest
  | PhaseRecordManifest
  | FrozenAuthoringRecordManifest
  | AuthoringRecordManifest
> = anyManifest;
void anyManifestAsParsed;
if (anyManifest.ok) {
  const format: RecordManifestFormat = anyManifest.format;
  const shape: Equals<
    typeof anyManifest.shape,
    "pre-schema" | Current<"phase-record-manifest"> | Current<"authoring-record-manifest">
  > = true;
  void format;
  void shape;
  if (anyManifest.format === "authoring-record-manifest") {
    const exact: Equals<
      typeof anyManifest.value,
      FrozenAuthoringRecordManifest | PhaxAuthoringRecordManifestFile
    > = true;
    void exact;
  } else {
    const exact: Equals<
      typeof anyManifest.value,
      FrozenPhaseRecordManifest | RunRecordManifestFile
    > = true;
    void exact;
  }
}

// ── record timeline files

// Each package type is phax's own file type, both ways, under the spec's names
// (§5.20); its Latest type is phax's in-memory type, which never had a version
const gateAttributionIsPhax: Equals<GateAttribution, PhaxGateAttributionFile> = true;
const reconciliationIsPhax: Equals<PhaseFileReconciliation, PhaxPhaseFileReconciliationFile> = true;
// A released shape that is no longer current is its frozen module's type.
const gateAttributionV0_17_0IsFrozen: Equals<GateAttributionV0_17_0, FrozenGateAttributionV0_17_0> =
  true;
void gateAttributionIsPhax;
void reconciliationIsPhax;
void gateAttributionV0_17_0IsFrozen;
// The current gate attribution upgrades to the latest value.
declare const phaxGateAttribution: PhaxGateAttributionFile;
const upgradedGateAttribution: LatestGateAttribution = toLatestGateAttribution(phaxGateAttribution);
void upgradedGateAttribution;
