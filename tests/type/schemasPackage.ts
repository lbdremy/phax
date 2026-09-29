import type {
  AnyDocument,
  ComplianceReview,
  ComplianceReviewShape,
  ComplianceReviewV1,
  DocumentFormatId,
  LatestComplianceReview,
  LatestPhaseRecordManifest,
  LatestPhaseStatus,
  LatestPhaxPlan,
  LatestPhaxPlanPhase,
  LatestRegistry,
  LatestRunStatus,
  Parsed,
  ParsedDocument,
  ParsedShape,
  PhaseRecordManifest,
  PhaseRecordManifestShape,
  PhaseRecordManifestV1,
  PhaseRecordManifestV2,
  PhaseStatus,
  PhaseStatusShape,
  PhaseStatusV1,
  PhaxPlan,
  PhaxPlanShape,
  PhaxPlanV1,
  Registry,
  RegistryShape,
  RegistryV1,
  RunStatus,
  RunStatusShape,
  RunStatusV1,
  Unknown,
} from "../../packages/schemas/src/index.js";
import {
  parseComplianceReview,
  parseDocument,
  parsePhaseRecordManifest,
  parsePhaseStatus,
  parsePhaxPlan,
  parseRegistry,
  parseRunStatus,
  toLatestPhaxPlan,
  toLatestRunStatus,
} from "../../packages/schemas/src/index.js";
import type { ComplianceReview as PhaxComplianceReview } from "../../src/schemas/complianceReview.js";
import type { PhaxPlan as PhaxPhaxPlan } from "../../src/schemas/phaxPlan.js";
import type { Registry as PhaxRegistry } from "../../src/schemas/registry.js";
import type { RunRecordManifest } from "../../src/schemas/runRecord.js";
import type {
  PhaseStatus as PhaxPhaseStatus,
  RunStatus as PhaxRunStatus,
} from "../../src/schemas/status.js";
import type { Surface } from "../../src/schemas/surface.js";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// The package's PhaseRecordManifest is phax's RunRecordManifest, both ways (§5.20)
declare const fromPackage: PhaseRecordManifest;
declare const fromPhax: RunRecordManifest;
const packageToPhax: RunRecordManifest = fromPackage;
const phaxToPackage: PhaseRecordManifest = fromPhax;
void packageToPhax;
void phaxToPackage;

// The frozen v2 twin has exactly the type phax writes today
const v2IsCurrent: Equals<PhaseRecordManifestV2, PhaseRecordManifest> = true;
void v2IsCurrent;

// parsePhaseRecordManifest is a union over shapes, assignable to Parsed over their values
const parsed = parsePhaseRecordManifest({});
const asParsed: Parsed<PhaseRecordManifestV1 | PhaseRecordManifest> = parsed;
void asParsed;

// Narrowing on the shape id yields that shape's exact type
if (parsed.ok) {
  const shape: PhaseRecordManifestShape = parsed.shape;
  void shape;
  if (parsed.shape === "v1") {
    const value: PhaseRecordManifestV1 = parsed.value;
    const exact: Equals<typeof parsed.value, PhaseRecordManifestV1> = true;
    void value;
    void exact;
  } else {
    const value: PhaseRecordManifest = parsed.value;
    const exact: Equals<typeof parsed.value, PhaseRecordManifest> = true;
    void value;
    void exact;
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

type Success = Extract<ReturnType<typeof parsePhaseRecordManifest>, { ok: true }>;
const shapeIds: Equals<Success["shape"], "v1" | "v2"> = true;
const successValues: Equals<Success["value"], PhaseRecordManifestV1 | PhaseRecordManifest> = true;
void shapeIds;
void successValues;

// ParsedShape over any map is assignable to Parsed over its values
type Toy = { v1: { a: 1 }; "0.10.0": { b: 2 }; next: { c: 3 } };
declare const toy: ParsedShape<Toy>;
const toyAsParsed: Parsed<Toy[keyof Toy]> = toy;
void toyAsParsed;

// Parsed is readonly throughout
declare const failure: Extract<Parsed<PhaseRecordManifest>, { ok: false }>;
// @ts-expect-error: path is readonly
failure.error.path = "outcome";

// The latest manifest drops version, marks what v1 never recorded, keeps the rest
declare const latest: LatestPhaseRecordManifest;
// @ts-expect-error: the latest manifest carries no version
void latest.version;
const surfaces: Equals<
  LatestPhaseRecordManifest["verifiedSurfaces"],
  ReadonlyArray<Surface> | Unknown
> = true;
void surfaces;
const addedInV2: Equals<
  Exclude<keyof PhaseRecordManifest, keyof PhaseRecordManifestV1>,
  "verifiedSurfaces"
> = true;
void addedInV2;
const sameFields: Equals<
  Omit<LatestPhaseRecordManifest, "verifiedSurfaces">,
  Omit<PhaseRecordManifest, "version" | "verifiedSurfaces">
> = true;
void sameFields;

// parseDocument names the format and the shape, and narrows to the exact type
const document = parseDocument({});
const documentAsParsed: Parsed<AnyDocument["value"]> = document;
void documentAsParsed;
const formats: Equals<
  DocumentFormatId,
  | "phase-record-manifest"
  | "registry"
  | "run-status"
  | "phase-status"
  | "phax-plan"
  | "compliance-review"
> = true;
void formats;
if (document.ok) {
  const format: DocumentFormatId = document.format;
  void format;
  if (document.format === "phase-record-manifest" && document.shape === "v1") {
    const exact: Equals<typeof document.value, PhaseRecordManifestV1> = true;
    void exact;
  }
}
const oneParameter: Equals<Parameters<typeof parseDocument>, [input: unknown]> = true;
void oneParameter;
declare const parsedDocument: ParsedDocument<{ "gate-pending": { "0.12.0": { a: string } } }>;
if (parsedDocument.ok) {
  const toyShape: Equals<typeof parsedDocument.shape, "0.12.0"> = true;
  void toyShape;
}

// ── run-directory formats

// Each package type is phax's own type, both ways (§5.20)
const registryIsPhax: Equals<Registry, PhaxRegistry> = true;
const runStatusIsPhax: Equals<RunStatus, PhaxRunStatus> = true;
const phaseStatusIsPhax: Equals<PhaseStatus, PhaxPhaseStatus> = true;
const phaxPlanIsPhax: Equals<PhaxPlan, PhaxPhaxPlan> = true;
const complianceReviewIsPhax: Equals<ComplianceReview, PhaxComplianceReview> = true;
void registryIsPhax;
void runStatusIsPhax;
void phaseStatusIsPhax;
void phaxPlanIsPhax;
void complianceReviewIsPhax;

// A single-signature format's frozen v1 twin has exactly phax's type
const registryTwin: Equals<RegistryV1, PhaxRegistry> = true;
const phaseStatusTwin: Equals<PhaseStatusV1, PhaxPhaseStatus> = true;
const complianceReviewTwin: Equals<ComplianceReviewV1, PhaxComplianceReview> = true;
void registryTwin;
void phaseStatusTwin;
void complianceReviewTwin;

// The frozen v1 of a format with older signatures is wider: phax's type is
// assignable to it, not the other way
declare const phaxRunStatus: PhaxRunStatus;
declare const phaxPhaxPlan: PhaxPhaxPlan;
const runStatusIntoV1: RunStatusV1 = phaxRunStatus;
const phaxPlanIntoV1: PhaxPlanV1 = phaxPhaxPlan;
void runStatusIntoV1;
void phaxPlanIntoV1;
declare const olderRunStatus: RunStatusV1;
declare const olderPhaxPlan: PhaxPlanV1;
// @ts-expect-error: an older run status may lack namespace
const runStatusFromV1: PhaxRunStatus = olderRunStatus;
// @ts-expect-error: an older phax-plan may lack requiredCommands
const phaxPlanFromV1: PhaxPhaxPlan = olderPhaxPlan;
void runStatusFromV1;
void phaxPlanFromV1;

// Each parse function names its shape and narrows to the exact type
const registryResult = parseRegistry({});
const runStatusResult = parseRunStatus({});
const phaseStatusResult = parsePhaseStatus({});
const phaxPlanResult = parsePhaxPlan({});
const complianceReviewResult = parseComplianceReview({});
const shapeIds1: Equals<
  RegistryShape | RunStatusShape | PhaseStatusShape | PhaxPlanShape | ComplianceReviewShape,
  "v1"
> = true;
void shapeIds1;
if (registryResult.ok) {
  const value: Equals<typeof registryResult.value, RegistryV1> = true;
  void value;
}
if (runStatusResult.ok && runStatusResult.shape === "v1") {
  const value: Equals<typeof runStatusResult.value, RunStatusV1> = true;
  void value;
}
if (phaseStatusResult.ok) {
  const value: Equals<typeof phaseStatusResult.value, PhaseStatusV1> = true;
  void value;
}
if (phaxPlanResult.ok) {
  const value: Equals<typeof phaxPlanResult.value, PhaxPlanV1> = true;
  void value;
}
if (complianceReviewResult.ok) {
  const value: Equals<typeof complianceReviewResult.value, ComplianceReviewV1> = true;
  void value;
}
if (document.ok && document.format === "phax-plan") {
  const exact: Equals<typeof document.value, PhaxPlanV1> = true;
  void exact;
}

// The latest shapes: no version, and each fact an older signature lacked is T | Unknown
const latestRunStatusNamespace: Equals<
  LatestRunStatus["namespace"],
  PhaxRunStatus["namespace"] | Unknown
> = true;
const latestRunStatusRest: Equals<
  Omit<LatestRunStatus, "namespace">,
  Omit<PhaxRunStatus, "version" | "namespace">
> = true;
const latestRequiredCommands: Equals<
  LatestPhaxPlan["run"]["requiredCommands"],
  ReadonlyArray<string> | Unknown
> = true;
const latestPlannedFiles: Equals<
  LatestPhaxPlanPhase["plannedFilesToCreate" | "plannedFilesToEdit" | "optionalFilesToEdit"],
  ReadonlyArray<string> | Unknown
> = true;
const latestRegistry: Equals<LatestRegistry, Omit<PhaxRegistry, "version">> = true;
const latestPhaseStatus: Equals<LatestPhaseStatus, Omit<PhaxPhaseStatus, "version">> = true;
const latestComplianceReview: Equals<
  LatestComplianceReview,
  Omit<PhaxComplianceReview, "version">
> = true;
void latestRunStatusNamespace;
void latestRunStatusRest;
void latestRequiredCommands;
void latestPlannedFiles;
void latestRegistry;
void latestPhaseStatus;
void latestComplianceReview;
declare const latestPlan: LatestPhaxPlan;
// @ts-expect-error: the latest phax-plan has no place for run.backend
void latestPlan.run.backend;
// @ts-expect-error: the latest phax-plan carries no version
void latestPlan.version;
const upgradedRunStatus: LatestRunStatus = toLatestRunStatus(olderRunStatus);
const upgradedPhaxPlan: LatestPhaxPlan = toLatestPhaxPlan(olderPhaxPlan);
void upgradedRunStatus;
void upgradedPhaxPlan;
