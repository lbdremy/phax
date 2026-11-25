// The per-format generator registry: for every persisted format of the ledger (FORMAT_IDS), a
// valid-value generator derived from its file schema through effect/Arbitrary, the named repairs
// that mirror the rules its reader enforces beyond the schema, its written encoding, phax's reader
// (or why phax has none) and the schemas package's reader, each answering one ReadVerdict.
import { readFileSync } from "node:fs";
import { Result, Schema } from "effect";
import fc from "fast-check";
import {
  AcceptanceRequestSchema,
  ArchitectureReportSchema,
  ArchitectureRequestSchema,
  ArtifactStatusSchema,
  AuthoringRecordManifestSchema,
  BriefRecordSchema,
  BriefReportSchema,
  BriefRequestSchema,
  CodeReviewAnswerSchema,
  CodeReviewSchema,
  ComplianceReviewAnswerSchema,
  ComplianceReviewSchema,
  CostLedgerSchema,
  DecideVerdictsSchema,
  DecisionRecordManifestSchema,
  FirstReadingSchema,
  GateAttributionSchema,
  GateReportSchema,
  GateRequestSchema,
  HandDecisionAnswerSchema,
  InteractiveHandoffSchema,
  InteractiveSessionSchema,
  OracleRequestV0_26_0Schema,
  PhaseFileReconciliationSchema,
  PhaseRecordManifestSchema,
  PhaseStatusSchema,
  PhaxPlanExtractionSchema,
  PhaxPlanSchema,
  PlanApprovalRecordSchema,
  PlanApprovalsSchema,
  PlanDocumentSchema,
  PlanHandDecisionAnswerSchema,
  FindingFateRecordManifestSchema,
  FindingListSchema,
  PlanLintSchema,
  PlanOverviewSchema,
  RegistrySchema,
  ReviewRecordManifestSchema,
  ReviewStopSchema,
  RevisionRecordManifestSchema,
  RunListSchema,
  RunStatusSchema,
  SpecApprovalRecordSchema,
  SpecApprovalsSchema,
  SpecDocumentSchema,
  SpecHandDecisionAnswerSchema,
  parseAcceptanceRequest,
  parseArchitectureReport,
  parseArchitectureRequest,
  parseArtifactStatus,
  parseAuthoringRecordManifest,
  parseBriefRecord,
  parseBriefReport,
  parseBriefRequest,
  parseCodeReview,
  parseCodeReviewAnswer,
  parseComplianceReviewAnswer,
  parseComplianceReview,
  parseCostLedger,
  parseDecideVerdicts,
  parseDecisionRecordManifest,
  parseDocument,
  parseFirstReading,
  parseGateAttribution,
  parseGateReport,
  parseGateRequest,
  parseHandDecisionAnswer,
  parseInteractiveHandoff,
  parseInteractiveSession,
  parsePhaseFileReconciliation,
  parsePhaseRecordManifest,
  parsePhaseStatus,
  parsePhaxPlan,
  parsePhaxPlanExtraction,
  parsePlanApprovalRecord,
  parsePlanApprovals,
  parsePlanDocument,
  parsePlanHandDecisionAnswer,
  parseFindingFateRecordManifest,
  parseFindingList,
  parsePlanLint,
  parsePlanOverview,
  parseRegistry,
  parseReviewRecordManifest,
  parseReviewStop,
  parseRevisionRecordManifest,
  parseRunList,
  parseRunStatus,
  parseSpecApprovalRecord,
  parseSpecApprovals,
  parseSpecDocument,
  parseSpecHandDecisionAnswer,
} from "../../../packages/schemas/src/index.js";
import { decodeHandAnswer } from "../../../src/domain/decide/handAuthored.js";
import { AuthoringRecordManifestV0_17_0Schema } from "../../../src/schemas/history/authoring-record-manifest/0.17.0.js";
import { AuthoringRecordManifestV0_23_0Schema } from "../../../src/schemas/history/authoring-record-manifest/0.23.0.js";
import { AuthoringRecordManifestPreSchemaSchema } from "../../../src/schemas/history/authoring-record-manifest/pre-schema.js";
import { BriefRecordV0_20_0Schema } from "../../../src/schemas/history/brief-record/0.20.0.js";
import { CodeReviewV0_29_0Schema } from "../../../src/schemas/history/code-review/0.29.0.js";
import { CodeReviewV0_32_0Schema } from "../../../src/schemas/history/code-review/0.32.0.js";
import { ComplianceReviewV0_17_0Schema } from "../../../src/schemas/history/compliance-review/0.17.0.js";
import { ComplianceReviewV0_32_0Schema } from "../../../src/schemas/history/compliance-review/0.32.0.js";
import { ComplianceReviewPreSchemaSchema } from "../../../src/schemas/history/compliance-review/pre-schema.js";
import { CostLedgerV0_25_0Schema } from "../../../src/schemas/history/cost-ledger/0.25.0.js";
import { CostLedgerV0_26_0Schema } from "../../../src/schemas/history/cost-ledger/0.26.0.js";
import { DecisionRecordManifestV0_25_0Schema } from "../../../src/schemas/history/decision-record-manifest/0.25.0.js";
import { DecisionRecordManifestV0_28_0Schema } from "../../../src/schemas/history/decision-record-manifest/0.28.0.js";
import { DecisionRecordManifestV0_30_0Schema } from "../../../src/schemas/history/decision-record-manifest/0.30.0.js";
import { FirstReadingV0_26_0Schema } from "../../../src/schemas/history/first-reading/0.26.0.js";
import { GateAttributionV0_17_0Schema } from "../../../src/schemas/history/gate-attribution/0.17.0.js";
import { GateAttributionV0_20_0Schema } from "../../../src/schemas/history/gate-attribution/0.20.0.js";
import { GateAttributionV0_21_0Schema } from "../../../src/schemas/history/gate-attribution/0.21.0.js";
import { GateAttributionV0_26_0Schema } from "../../../src/schemas/history/gate-attribution/0.26.0.js";
import { GateAttributionV0_31_0Schema } from "../../../src/schemas/history/gate-attribution/0.31.0.js";
import { GateAttributionV0_33_0Schema } from "../../../src/schemas/history/gate-attribution/0.33.0.js";
import { GateAttributionPreSchemaSchema } from "../../../src/schemas/history/gate-attribution/pre-schema.js";
import { HandDecisionAnswerV0_25_0Schema } from "../../../src/schemas/history/hand-decision-answer/0.25.0.js";
import { InteractiveHandoffV0_26_0Schema } from "../../../src/schemas/history/interactive-handoff/0.26.0.js";
import { InteractiveSessionV0_26_0Schema } from "../../../src/schemas/history/interactive-session/0.26.0.js";
import { PhaseFileReconciliationV0_17_0Schema } from "../../../src/schemas/history/phase-file-reconciliation/0.17.0.js";
import { PhaseFileReconciliationPreSchemaSchema } from "../../../src/schemas/history/phase-file-reconciliation/pre-schema.js";
import { PhaseRecordManifestV0_17_0Schema } from "../../../src/schemas/history/phase-record-manifest/0.17.0.js";
import { PhaseRecordManifestV0_26_0Schema } from "../../../src/schemas/history/phase-record-manifest/0.26.0.js";
import { PhaseRecordManifestV0_30_0Schema } from "../../../src/schemas/history/phase-record-manifest/0.30.0.js";
import { PhaseRecordManifestV0_33_0Schema } from "../../../src/schemas/history/phase-record-manifest/0.33.0.js";
import { PhaseRecordManifestV0_34_0Schema } from "../../../src/schemas/history/phase-record-manifest/0.34.0.js";
import { PhaseRecordManifestPreSchemaSchema } from "../../../src/schemas/history/phase-record-manifest/pre-schema.js";
import { PhaseStatusV0_17_0Schema } from "../../../src/schemas/history/phase-status/0.17.0.js";
import { PhaseStatusV0_20_0Schema } from "../../../src/schemas/history/phase-status/0.20.0.js";
import { PhaseStatusV0_26_0Schema } from "../../../src/schemas/history/phase-status/0.26.0.js";
import { PhaseStatusPreSchemaSchema } from "../../../src/schemas/history/phase-status/pre-schema.js";
import { PhaxPlanExtractionV0_32_0Schema } from "../../../src/schemas/history/phax-plan-extraction/0.32.0.js";
import { PhaxPlanExtractionV0_33_0Schema } from "../../../src/schemas/history/phax-plan-extraction/0.33.0.js";
import { PhaxPlanV0_17_0Schema } from "../../../src/schemas/history/phax-plan/0.17.0.js";
import { PhaxPlanV0_26_0Schema } from "../../../src/schemas/history/phax-plan/0.26.0.js";
import { PhaxPlanV0_28_0Schema } from "../../../src/schemas/history/phax-plan/0.28.0.js";
import { PhaxPlanV0_32_0Schema } from "../../../src/schemas/history/phax-plan/0.32.0.js";
import { PhaxPlanV0_33_0Schema } from "../../../src/schemas/history/phax-plan/0.33.0.js";
import { PhaxPlanV0_38_0Schema } from "../../../src/schemas/history/phax-plan/0.38.0.js";
import { PhaxPlanPreSchemaSchema } from "../../../src/schemas/history/phax-plan/pre-schema.js";
import { PlanApprovalRecordV0_19_0Schema } from "../../../src/schemas/history/plan-approval-record/0.19.0.js";
import { PlanApprovalRecordV0_25_0Schema } from "../../../src/schemas/history/plan-approval-record/0.25.0.js";
import { PlanApprovalsPreSchemaSchema } from "../../../src/schemas/history/plan-approvals/pre-schema.js";
import { PlanDocumentV0_17_0Schema } from "../../../src/schemas/history/plan-document/0.17.0.js";
import { PlanDocumentV0_20_0Schema } from "../../../src/schemas/history/plan-document/0.20.0.js";
import { PlanDocumentV0_25_0Schema } from "../../../src/schemas/history/plan-document/0.25.0.js";
import { PlanDocumentV0_26_0Schema } from "../../../src/schemas/history/plan-document/0.26.0.js";
import { PlanDocumentV0_28_0Schema } from "../../../src/schemas/history/plan-document/0.28.0.js";
import { PlanDocumentV0_32_0Schema } from "../../../src/schemas/history/plan-document/0.32.0.js";
import { PlanDocumentV0_33_0Schema } from "../../../src/schemas/history/plan-document/0.33.0.js";
import { PlanDocumentV0_38_0Schema } from "../../../src/schemas/history/plan-document/0.38.0.js";
import { PlanDocumentPreSchemaSchema } from "../../../src/schemas/history/plan-document/pre-schema.js";
import { RegistryV0_17_0Schema } from "../../../src/schemas/history/registry/0.17.0.js";
import { RegistryPreSchemaSchema } from "../../../src/schemas/history/registry/pre-schema.js";
import { ReviewStopV0_26_0Schema } from "../../../src/schemas/history/review-stop/0.26.0.js";
import { RunListV0_26_0Schema } from "../../../src/schemas/history/run-list/0.26.0.js";
import { RunListV0_30_0Schema } from "../../../src/schemas/history/run-list/0.30.0.js";
import { RunStatusV0_17_0Schema } from "../../../src/schemas/history/run-status/0.17.0.js";
import { RunStatusV0_26_0Schema } from "../../../src/schemas/history/run-status/0.26.0.js";
import { RunStatusPreSchemaSchema } from "../../../src/schemas/history/run-status/pre-schema.js";
import { SpecApprovalRecordV0_19_0Schema } from "../../../src/schemas/history/spec-approval-record/0.19.0.js";
import { SpecApprovalsPreSchemaSchema } from "../../../src/schemas/history/spec-approvals/pre-schema.js";
import { SpecDocumentV0_17_0Schema } from "../../../src/schemas/history/spec-document/0.17.0.js";
import { SpecDocumentV0_25_0Schema } from "../../../src/schemas/history/spec-document/0.25.0.js";
import { SpecDocumentV0_27_0Schema } from "../../../src/schemas/history/spec-document/0.27.0.js";
import { SpecDocumentPreSchemaSchema } from "../../../src/schemas/history/spec-document/pre-schema.js";
import { parseVerdictsFile } from "../../../src/domain/decide/verdicts.js";
import {
  describeReportError,
  readAcceptanceRequestFile,
  readArchitectureReport,
  readBriefRecordFile,
  readBriefReport,
  readBriefRequestFile,
  readCodeReviewFile,
  readComplianceReviewFile,
  readCostLedgerFile,
  readDocumentSidecar,
  readFirstReadingAnswer,
  readGateAttributionFile,
  readGateReport,
  readInteractiveHandoffAnswer,
  readInteractiveSessionFile,
  readPhaseFileReconciliationFile,
  readPhaseStatusFile,
  readPhaxPlanFile,
  readPlanApprovalsFile,
  readPlanRecordFile,
  readFindingFateRecordManifestFile,
  readRecordManifestFile,
  readRegistryFile,
  readReviewStopFile,
  readRunStatusFile,
  readSpecApprovalsFile,
  readSpecRecordFile,
  withSchemaUrl,
  type PersistedReadError,
  type ReportError,
} from "../../../src/schemas/persisted.js";
import { readCodeReviewAnswer } from "../../../src/schemas/codeReview.js";
import { readComplianceReviewAnswer } from "../../../src/schemas/complianceReview.js";
import { readPlanExtractionAnswer } from "../../../src/schemas/planExtraction.js";
import { OTHER_OPTION_ID } from "../../../src/schemas/questions.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { compareReleases, schemaUrl, type FormatId } from "../../../src/schemas/schemaUrl.js";
import { fromSchema } from "./fromEffect.js";

/** A JSON document as a generator produces it and a repair takes it. */
type Document = Readonly<Record<string, unknown>>;

/** What a reader answered: the value it read (without `$schema`) and its shape, or why it refused. */
type ReadVerdict =
  | { readonly ok: true; readonly value: unknown; readonly shape?: string }
  | { readonly ok: false; readonly message: string };

type Reader = (input: unknown) => ReadVerdict;

/** A pure function from a derived value to a valid one, mirroring one reader rule. */
interface Repair {
  /** Kebab-case, stating the rule it mirrors. */
  readonly name: string;
  /** One line naming the reader or writer that enforces the rule. */
  readonly reason: string;
  readonly repair: (value: Document) => Document;
}

/** A narrower schema derived instead of the format's own, when effect cannot derive that one. */
interface Derivation {
  readonly name: string;
  readonly reason: string;
  readonly schema: Schema.Top;
}

type PhaxReader =
  | {
      readonly phax: {
        readonly read: Reader;
        /**
         * Whether the file reads, apart from a later step that may refuse the value read (a plan
         * document's lift: "a refused lift is not a read error"). `read` when absent.
         */
        readonly readFile?: Reader;
      };
      readonly writeOnly?: never;
    }
  | { readonly phax: null; readonly writeOnly: string };

/** A frozen shape's document as written: its stamp (`null` when pre-schema) and its JSON. */
interface StampedDocument {
  readonly release: string | null;
  readonly document: unknown;
}

/** One older shape of a format: a module of src/schemas/history/<id>/. */
type FrozenShape = {
  /** `pre-schema`, or the X.Y.Z of the module. */
  readonly shape: string;
  /** Valid documents of the shape, without `$schema`; derived on first call. */
  readonly valid: () => fc.Arbitrary<Document>;
  /** The releases whose stamp names this shape; empty when pre-schema. */
  readonly releases: ReadonlyArray<string>;
  /** `valid` documents encoded through the frozen schema, stamped with one of `releases`. */
  readonly stamped: () => fc.Arbitrary<StampedDocument>;
} & (
  | { readonly readers: "both"; readonly packageOnly?: never }
  | { readonly readers: "package"; readonly packageOnly: string }
);

export type FormatEntry = {
  readonly id: FormatId;
  /** The frozen shapes, oldest first: one per module under src/schemas/history/<id>/. */
  readonly frozen: ReadonlyArray<FrozenShape>;
  /** Valid current-shape documents, `$schema` first; derived on first call. */
  readonly valid: () => fc.Arbitrary<Document>;
  readonly repairs: ReadonlyArray<Repair>;
  readonly derivation?: Derivation;
  /** The written encoding of `value`, as parsed JSON: what phax's writer puts in the file. */
  readonly write: (value: Document) => unknown;
  /** The schemas package's reader. */
  readonly parse: Reader;
} & PhaxReader;

// ── adapters ──────────────────────────────────────────────────────────────

const FILE = "property.json";

function withoutSchema(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const { $schema: _schema, ...rest } = value as Document;
  return rest;
}

const ok = (value: unknown, shape?: string): ReadVerdict =>
  shape === undefined ? { ok: true, value } : { ok: true, value, shape };

const refused = (message: string): ReadVerdict => ({ ok: false, message });

/** A src/schemas/persisted.ts reader whose success is the value as it is. */
const persisted =
  (read: (file: string, input: unknown) => Result.Result<unknown, PersistedReadError>): Reader =>
  (input) => {
    const result = read(FILE, input);
    return Result.isSuccess(result) ? ok(result.success) : refused(result.failure.message);
  };

/** An answer reader of persisted.ts: the decoded document whole, `$schema` included. */
const answer =
  (read: (input: unknown) => Result.Result<unknown, ReportError>): Reader =>
  (input) => {
    const result = read(input);
    return Result.isSuccess(result)
      ? ok(withoutSchema(result.success))
      : refused(describeReportError(result.failure));
  };

type PackageParsed =
  | { readonly ok: true; readonly value: unknown; readonly shape: string }
  | { readonly ok: false; readonly error: { readonly path: string; readonly message: string } };

/** A schemas package parse function: its value without `$schema`, its shape kept. */
const fromPackage =
  (parse: (input: unknown) => PackageParsed): Reader =>
  (input) => {
    const parsed = parse(input);
    return parsed.ok
      ? ok(withoutSchema(parsed.value), parsed.shape)
      : refused(`${parsed.error.path}: ${parsed.error.message}`);
  };

/** `parseDocument`, filtered to `format`: for a format with no parse function of its own. */
const documentOf =
  (format: FormatId): Reader =>
  (input) => {
    const parsed = parseDocument(input);
    if (!parsed.ok) return refused(`${parsed.error.path}: ${parsed.error.message}`);
    if (parsed.format !== format) return refused(`$schema: names ${parsed.format}, not ${format}`);
    return ok(withoutSchema(parsed.value), parsed.shape);
  };

const readPhaxPlan: Reader = (input) => {
  const result = readPhaxPlanFile(FILE, input);
  return Result.isSuccess(result)
    ? ok(result.success.plan, result.success.shape)
    : refused(result.failure.message);
};

const readComplianceReview: Reader = (input) => {
  const result = readComplianceReviewFile(FILE, input);
  return Result.isSuccess(result)
    ? ok(result.success.review, result.success.shape)
    : refused(result.failure.message);
};

const readCodeReview: Reader = (input) => {
  const result = readCodeReviewFile(FILE, input);
  return Result.isSuccess(result)
    ? ok(result.success.review, result.success.shape)
    : refused(result.failure.message);
};

const readSpecSidecar: Reader = (input) => {
  const result = readDocumentSidecar("spec", FILE, input);
  return Result.isSuccess(result)
    ? ok(result.success.document, result.success.shape)
    : refused(result.failure.message);
};

const readPlanSidecar: Reader = (input) => {
  const result = readDocumentSidecar("plan", FILE, input);
  if (Result.isFailure(result)) return refused(result.failure.message);
  const sidecar = result.success;
  if (sidecar.shape === "current") return ok(sidecar.document, sidecar.shape);
  // An older sidecar's lift that passes every check still declares no gate profile.
  return sidecar.lift.kind === "missing-gate-profile"
    ? ok(sidecar.lift.document, sidecar.shape)
    : refused(`${sidecar.shape} lift refused: ${sidecar.lift.kind}`);
};

// The plan sidecar as the file reads: a refused lift still reads, with the value its frozen
// decoder read.
const readPlanSidecarFile: Reader = (input) => {
  const result = readDocumentSidecar("plan", FILE, input);
  if (Result.isFailure(result)) return refused(result.failure.message);
  const sidecar = result.success;
  return ok(sidecar.shape === "current" ? sidecar.document : sidecar.older, sidecar.shape);
};

const readPlanExtraction: Reader = (input) => {
  const result = readPlanExtractionAnswer(input);
  if (Result.isFailure(result)) return refused(result.failure);
  const reading = result.success;
  return reading.kind === "plan"
    ? ok({ plan: reading.plan, incomplete: null })
    : ok({ plan: null, incomplete: reading.reason });
};

// A decide session's hand answer: the stamp check, then the kind's current decoder. With no
// question presented, `decodeHandAnswer` stamps no verdict, so the value is the answer as read.
const readHandAnswer =
  (kind: "spec" | "plan"): Reader =>
  (input) => {
    const result = decodeHandAnswer(input, {
      kind,
      scope: { presented: [], reArbitrated: null },
      operator: { name: "property" },
      atIso: "2026-01-01T00:00:00.000Z",
    });
    return Result.isSuccess(result)
      ? ok(result.success)
      : refused(`${result.failure.path}: ${result.failure.message}`);
  };

// A review session's answer: readCodeReviewAnswer / readComplianceReviewAnswer, the findings or
// the review without `$schema`.
const readCodeReviewAnswerValue: Reader = (input) => {
  const result = readCodeReviewAnswer(input);
  return Result.isSuccess(result) ? ok(result.success) : refused(result.failure);
};

const readComplianceReviewAnswerValue: Reader = (input) => {
  const result = readComplianceReviewAnswer(input);
  return Result.isSuccess(result) ? ok(result.success) : refused(result.failure);
};

// `phax artifact decide --verdicts` reads the file's text.
const readDecideVerdicts: Reader = (input) => {
  const result = parseVerdictsFile(JSON.stringify(input));
  return Result.isSuccess(result)
    ? ok(result.success)
    : refused(`${result.failure.path}: ${result.failure.message}`);
};

// ── generated values ──────────────────────────────────────────────────────

const isPlainRecord = (value: unknown): value is Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
};

// effect/Arbitrary builds a struct with a null prototype, which isDeepStrictEqual tells apart from
// the ordinary object a reader returns. Rebuilt with Object.fromEntries, so a `__proto__` key
// stays an own key.
const plain = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(plain);
  if (isPlainRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plain(inner)]));
  }
  return value;
};

const finiteJsonNumber = (value: unknown): unknown => {
  if (typeof value === "number") {
    if (Object.is(value, -0) || Number.isNaN(value)) return 0;
    if (value === Number.POSITIVE_INFINITY) return Number.MAX_VALUE;
    if (value === Number.NEGATIVE_INFINITY) return -Number.MAX_VALUE;
    return value;
  }
  if (Array.isArray(value)) return value.map(finiteJsonNumber);
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, finiteJsonNumber(inner)]),
    );
  }
  return value;
};

/**
 * A number JSON cannot carry is never written: -0 becomes 0, NaN 0, and ±Infinity the largest
 * finite number of its sign, which every bound a schema puts on a number still admits.
 */
const numbersAreJsonNumbers: Repair = {
  name: "numbers-are-json-numbers",
  reason:
    "every phax writer writes JSON.stringify's text, which writes -0 as 0 and NaN and ±Infinity as null",
  repair: (value) => finiteJsonNumber(value) as Document,
};

// ── repairs and derivations ───────────────────────────────────────────────

/** `id`, or `id` suffixed `~n` until it is not in `taken`; added to `taken`. */
const uniqueId = (id: string, taken: Set<string>): string => {
  let candidate = id;
  for (let n = 1; taken.has(candidate); n += 1) candidate = `${id}~${n}`;
  taken.add(candidate);
  return candidate;
};

interface Option {
  readonly id: string;
}

interface Question {
  readonly id: string;
  readonly options: ReadonlyArray<Option>;
  readonly recommendation: string;
}

interface Verdict {
  readonly kind: string;
  readonly chosen: string;
  readonly abandoned: ReadonlyArray<string>;
  readonly phase?: string;
}

interface ArbitratedQuestion extends Question {
  readonly verdict: Verdict;
  readonly history: ReadonlyArray<Verdict>;
}

// A verdict chooses a listed option or `other`, and abandons every other listed option once.
const repairVerdict = (verdict: Verdict, optionIds: ReadonlyArray<string>): Verdict => {
  const chosen =
    verdict.chosen === OTHER_OPTION_ID || optionIds.includes(verdict.chosen)
      ? verdict.chosen
      : (optionIds[0] ?? verdict.chosen);
  const kept = [
    ...new Set(verdict.abandoned.filter((id) => id !== chosen && optionIds.includes(id))),
  ];
  const abandoned = [...kept, ...optionIds.filter((id) => id !== chosen && !kept.includes(id))];
  return { ...verdict, chosen, abandoned };
};

// Unique option ids, none `other`, and a recommendation naming one of them.
const repairQuestion = <Q extends Question>(question: Q, questionIds: Set<string>): Q => {
  const optionIds = new Set([OTHER_OPTION_ID]);
  const options = question.options.map((option) => ({
    ...option,
    id: uniqueId(option.id, optionIds),
  }));
  const ids = options.map((option) => option.id);
  return {
    ...question,
    id: uniqueId(question.id, questionIds),
    options,
    recommendation: ids.includes(question.recommendation)
      ? question.recommendation
      : (ids[0] ?? question.recommendation),
  };
};

/** The question checks (`firstQuestionViolation`), over a document's two question arrays. */
const repairQuestions = (
  holder: Document,
  phaseIds: ReadonlyArray<string> | null,
): Readonly<Record<string, unknown>> => {
  const questionIds = new Set<string>();
  const openQuestions = (holder["openQuestions"] as ReadonlyArray<Question>).map((question) =>
    repairQuestion(question, questionIds),
  );
  const arbitratedQuestions = (holder["arbitratedQuestions"] as ReadonlyArray<ArbitratedQuestion>)
    .map((question) => repairQuestion(question, questionIds))
    .map((question) => {
      const ids = question.options.map((option) => option.id);
      const verdict = repairVerdict(question.verdict, ids);
      const phase =
        phaseIds !== null &&
        verdict.kind === "decided" &&
        verdict.phase !== undefined &&
        !phaseIds.includes(verdict.phase)
          ? { phase: phaseIds[0] }
          : {};
      return {
        ...question,
        verdict: { ...verdict, ...phase },
        history: question.history.map((earlier) => repairVerdict(earlier, ids)),
      };
    });
  return { ...holder, openQuestions, arbitratedQuestions };
};

const QUESTION_CHECKS_REASON =
  "firstQuestionViolation (src/schemas/questions.ts), which the spec and plan document decoders run";

const specQuestionsPassTheQuestionChecks: Repair = {
  name: "questions-pass-the-question-checks",
  reason: QUESTION_CHECKS_REASON,
  repair: (value) => repairQuestions(value, null),
};

const planQuestionsPassTheQuestionChecks: Repair = {
  name: "questions-pass-the-question-checks",
  reason: `${QUESTION_CHECKS_REASON}, a decided verdict's phase naming one of the plan's phases`,
  repair: (value) => ({
    ...value,
    preamble: repairQuestions(
      value["preamble"] as Document,
      (value["phases"] as ReadonlyArray<{ readonly id: string }>).map((phase) => phase.id),
    ),
  }),
};

interface Criterion {
  readonly refs: ReadonlyArray<string>;
}

/**
 * Unique requirement ids, every criterion ref naming a requirement, and every requirement
 * referenced: the refs of the last criterion gain the requirements no criterion names.
 */
const requirementsAreTraced: Repair = {
  name: "requirements-are-traced",
  reason:
    "the traceability check of SpecDocumentFileSchema (firstTraceabilityViolation), run by readDocumentSidecar",
  repair: (value) => {
    const taken = new Set<string>();
    const requirements = (value["requirements"] as ReadonlyArray<{ readonly id: string }>).map(
      (requirement) => ({ ...requirement, id: uniqueId(requirement.id, taken) }),
    );
    const ids = requirements.map((requirement) => requirement.id);
    const named = (value["acceptanceCriteria"] as ReadonlyArray<Criterion>).map((criterion) => ({
      ...criterion,
      refs: criterion.refs.map((ref) => (taken.has(ref) ? ref : (ids[0] ?? ref))),
    }));
    const referenced = new Set(named.flatMap((criterion) => criterion.refs));
    const unreferenced = ids.filter((id) => !referenced.has(id));
    const acceptanceCriteria = named.map((criterion, i) =>
      i === named.length - 1
        ? { ...criterion, refs: [...criterion.refs, ...unreferenced] }
        : criterion,
    );
    return { ...value, requirements, acceptanceCriteria };
  },
};

/** A plan with a source spec says whether it completes it; one without says neither. */
const lineagePairsSpecAndCompletion: Repair = {
  name: "lineage-pairs-source-spec-and-completes-spec",
  reason:
    "the lineage refinement of PlanDocumentFileSchema (isLineage), run by readDocumentSidecar",
  repair: (value) => {
    if ((value["sourceSpec"] === null) === (value["completesSpec"] === null)) return value;
    return { ...value, completesSpec: value["sourceSpec"] === null ? null : true };
  },
};

// The root checks of a document's file schema discard nearly every derived document, so its
// fields are derived alone, and the repairs above mirror the checks.
const specDocumentFields: Derivation = {
  name: "fields-without-the-traceability-check",
  reason:
    "SpecDocumentFileSchema's root traceability check, which readDocumentSidecar runs, exhausts effect/Arbitrary's sampling",
  schema: Schema.Struct(SpecDocumentSchema.fields),
};

const planDocumentFields: Derivation = {
  name: "fields-without-the-lineage-and-question-checks",
  reason:
    "PlanDocumentFileSchema's root lineage and question checks, which readDocumentSidecar runs, exhaust effect/Arbitrary's sampling as the size grows",
  schema: Schema.Struct(PlanDocumentSchema.schema.fields),
};

/** A phase awaiting review entered that state with its waiting stop recorded. */
const awaitingReviewRecordsAWaitingStop: Repair = {
  name: "awaiting-review-records-a-waiting-stop",
  reason: "readPhaseStatusFile refuses a phase awaiting review whose stop is not waiting",
  repair: (value) => {
    const stop = value["stop"] as { readonly status?: unknown } | null;
    if (value["state"] !== "awaiting_review" || stop?.status === "waiting") return value;
    return {
      ...value,
      stop: { cause: value["mode"] === "interactive" ? "declared" : "held", status: "waiting" },
    };
  },
};

// ── frozen shapes ─────────────────────────────────────────────────────────

/** The releases of packages/schemas/releases.json, oldest first. */
export const RELEASE_LEDGER: ReadonlyArray<string> = (
  JSON.parse(
    readFileSync(new URL("../../../packages/schemas/releases.json", import.meta.url), "utf8"),
  ) as { readonly releases: ReadonlyArray<string> }
).releases;

const PRE_SCHEMA = "pre-schema";

interface FrozenSpec {
  /** `pre-schema`, or the X.Y.Z of the module. */
  readonly shape: string;
  /** The module's exported schema. */
  readonly schema: Schema.Top;
  readonly repairs?: ReadonlyArray<Repair>;
  readonly derivation?: Derivation;
  /** Why phax's reader refuses this shape by design; absent when phax reads it. */
  readonly packageOnly?: string;
  /**
   * Why only the shape's own release stamps it, when its `$schema` is a const (an answer's): the
   * package maps a later stamp to this shape, which then refuses it at `$schema`.
   */
  readonly ownStampOnly?: string;
}

const frozenOrder = (a: FrozenSpec, b: FrozenSpec): number =>
  a.shape === b.shape
    ? 0
    : a.shape === PRE_SCHEMA
      ? -1
      : b.shape === PRE_SCHEMA
        ? 1
        : compareReleases(a.shape, b.shape);

/**
 * The releases that stamp a shape: from its own release up to, not including, the next shape's
 * release, or the format's current stamp for the last frozen shape. A shape no later one replaces
 * and the current stamp names (a retired format's) is stamped by its own release alone.
 */
const stampRange = (
  id: FormatId,
  shape: string,
  next: string | undefined,
): ReadonlyArray<string> => {
  if (shape === PRE_SCHEMA) return [];
  const until = next ?? CURRENT_STAMPS[id];
  const range = RELEASE_LEDGER.filter(
    (release) => compareReleases(release, shape) >= 0 && compareReleases(release, until) < 0,
  );
  return range.length === 0 ? [shape] : range;
};

function frozenShapes(
  id: FormatId,
  specs: ReadonlyArray<FrozenSpec>,
  writeOnly: string | null,
): ReadonlyArray<FrozenShape> {
  const ordered = specs.toSorted(frozenOrder);
  return ordered.map((spec, index) => {
    const repairs = [numbersAreJsonNumbers, ...(spec.repairs ?? [])];
    const label = `${id} ${spec.shape} (frozen)`;
    const encode = Schema.encodeUnknownSync(spec.schema as Schema.Codec<unknown, unknown>);
    const releases =
      spec.ownStampOnly === undefined
        ? stampRange(id, spec.shape, ordered[index + 1]?.shape)
        : [spec.shape];
    let derived: fc.Arbitrary<Document> | undefined;
    const valid = (): fc.Arbitrary<Document> => {
      derived ??= fromSchema(
        spec.derivation === undefined ? label : `${label} (${spec.derivation.name})`,
        spec.derivation?.schema ?? spec.schema,
      ).map((value) =>
        repairs.reduce(
          (current, { repair }) => repair(current),
          withoutSchema(plain(value)) as Document,
        ),
      );
      return derived;
    };
    const stamped = (): fc.Arbitrary<StampedDocument> =>
      fc
        .tuple(valid(), releases.length === 0 ? fc.constant(null) : fc.constantFrom(...releases))
        .map(([value, release]) => ({
          release,
          document: JSON.parse(
            JSON.stringify(
              encode(release === null ? value : { $schema: schemaUrl(id, release), ...value }),
            ),
          ) as unknown,
        }));
    const base = { shape: spec.shape, valid, releases, stamped };
    const packageOnly = writeOnly ?? spec.packageOnly;
    return packageOnly === undefined
      ? { ...base, readers: "both" as const }
      : { ...base, readers: "package" as const, packageOnly };
  });
}

// ── entries ───────────────────────────────────────────────────────────────

interface EntrySpec {
  readonly schema: Schema.Top;
  readonly repairs?: ReadonlyArray<Repair>;
  readonly derivation?: Derivation;
  readonly parse: Reader;
}

function entry<F extends FormatId>(
  id: F,
  spec: EntrySpec & PhaxReader,
): FormatEntry & { readonly id: F } {
  const { schema, derivation, parse } = spec;
  const repairs = [numbersAreJsonNumbers, ...(spec.repairs ?? [])];
  const encode = Schema.encodeUnknownSync(schema as Schema.Codec<unknown, unknown>);
  let derived: fc.Arbitrary<Document> | undefined;
  const valid = (): fc.Arbitrary<Document> => {
    derived ??= fromSchema(
      derivation === undefined ? id : `${id} (${derivation.name})`,
      derivation?.schema ?? schema,
    ).map((value) =>
      withSchemaUrl(
        id,
        repairs.reduce(
          (current, { repair }) => repair(current),
          withoutSchema(plain(value)) as Document,
        ),
      ),
    );
    return derived;
  };
  const write = (value: Document): unknown =>
    JSON.parse(JSON.stringify(encode(withSchemaUrl(id, withoutSchema(value) as Document))));
  const reader: PhaxReader =
    spec.phax === null ? { phax: null, writeOnly: spec.writeOnly } : { phax: spec.phax };
  return {
    id,
    frozen: frozenShapes(id, FROZEN_SPECS[id] ?? [], spec.phax === null ? spec.writeOnly : null),
    valid,
    repairs,
    ...(derivation === undefined ? {} : { derivation }),
    write,
    parse,
    ...reader,
  };
}

const read = (reader: Reader) => ({ read: reader });

const NEVER_RECORDED_BASE =
  "readPhaseStatusFile refuses a pre-schema phase status: it never recorded `base`, the commit its branch was created from, and phax does not re-derive one from git";

const ANSWER_READS_THE_CURRENT_STAMP =
  "readReport (src/schemas/persisted.ts) refuses an answer stamped below the format's current stamp as an older shape: the provider is told the stamp it must write";

const EXTRACTION_READS_ITS_STAMP =
  "readPlanExtractionAnswer (src/schemas/planExtraction.ts) decodes a const `$schema` that reads only the current stamp: the extraction model is told it, and no file of the answer is kept";

const ANSWER_STAMP_IS_A_CONST =
  "the shape's `$schema` is a const (answerSchemaUrlField) naming its own release, so the package refuses it at `$schema` under any later stamp";

/** An older attribution is read only when every step has a result: a pending step has none. */
const stepsPassOrFail: Repair = {
  name: "older-steps-pass-or-fail",
  reason:
    "readGateAttributionFile refuses an older attribution with a pending step, which has no result for phax to record (isPassOrFail, and the 0.26.0 decoder)",
  repair: (value) => ({
    ...value,
    steps: (value["steps"] as ReadonlyArray<Document>).map((step) =>
      step["result"] === "pending" ? { ...step, result: "fail" } : step,
    ),
  }),
};

/** A pre-schema plan never recorded `completesSpec`, so it is read only beside no source spec. */
const preSchemaPlanHasNoSourceSpec: Repair = {
  name: "pre-schema-plan-has-no-source-spec",
  reason:
    "readPlanDocumentSidecar refuses a pre-schema plan document beside a source spec: it never recorded completesSpec",
  repair: (value) => ({ ...value, sourceSpec: null }),
};

const shape = (
  name: string,
  schema: Schema.Top,
  more: Omit<FrozenSpec, "shape" | "schema"> = {},
): FrozenSpec => ({ shape: name, schema, ...more });

/** Each format's modules under src/schemas/history/<id>/, in any order. */
const FROZEN_SPECS: { readonly [F in FormatId]?: ReadonlyArray<FrozenSpec> } = {
  registry: [shape("pre-schema", RegistryPreSchemaSchema), shape("0.17.0", RegistryV0_17_0Schema)],
  "run-status": [
    shape("pre-schema", RunStatusPreSchemaSchema),
    shape("0.17.0", RunStatusV0_17_0Schema),
    shape("0.26.0", RunStatusV0_26_0Schema),
  ],
  "phase-status": [
    shape("pre-schema", PhaseStatusPreSchemaSchema, { packageOnly: NEVER_RECORDED_BASE }),
    shape("0.17.0", PhaseStatusV0_17_0Schema, {
      packageOnly:
        "readPhaseStatusFile reads a stamp below 0.26.0 with the 0.20.0 decoder, which requires `base`; 0.17.0 to 0.19.x never recorded it",
    }),
    shape("0.20.0", PhaseStatusV0_20_0Schema),
    shape("0.26.0", PhaseStatusV0_26_0Schema, { repairs: [awaitingReviewRecordsAWaitingStop] }),
  ],
  "phax-plan": [
    shape("pre-schema", PhaxPlanPreSchemaSchema),
    shape("0.17.0", PhaxPlanV0_17_0Schema),
    shape("0.26.0", PhaxPlanV0_26_0Schema),
    shape("0.28.0", PhaxPlanV0_28_0Schema),
    shape("0.32.0", PhaxPlanV0_32_0Schema),
    shape("0.33.0", PhaxPlanV0_33_0Schema),
    shape("0.38.0", PhaxPlanV0_38_0Schema),
  ],
  "compliance-review": [
    shape("pre-schema", ComplianceReviewPreSchemaSchema),
    shape("0.17.0", ComplianceReviewV0_17_0Schema),
    shape("0.32.0", ComplianceReviewV0_32_0Schema, { ownStampOnly: ANSWER_STAMP_IS_A_CONST }),
  ],
  "plan-approvals": [shape("pre-schema", PlanApprovalsPreSchemaSchema)],
  "spec-approvals": [shape("pre-schema", SpecApprovalsPreSchemaSchema)],
  "phase-record-manifest": [
    shape("pre-schema", PhaseRecordManifestPreSchemaSchema),
    shape("0.17.0", PhaseRecordManifestV0_17_0Schema),
    shape("0.26.0", PhaseRecordManifestV0_26_0Schema),
    shape("0.30.0", PhaseRecordManifestV0_30_0Schema),
    shape("0.33.0", PhaseRecordManifestV0_33_0Schema),
    shape("0.34.0", PhaseRecordManifestV0_34_0Schema),
  ],
  "authoring-record-manifest": [
    shape("pre-schema", AuthoringRecordManifestPreSchemaSchema),
    shape("0.17.0", AuthoringRecordManifestV0_17_0Schema),
    shape("0.23.0", AuthoringRecordManifestV0_23_0Schema),
  ],
  "gate-attribution": [
    shape("pre-schema", GateAttributionPreSchemaSchema, { repairs: [stepsPassOrFail] }),
    shape("0.17.0", GateAttributionV0_17_0Schema, { repairs: [stepsPassOrFail] }),
    shape("0.20.0", GateAttributionV0_20_0Schema),
    shape("0.21.0", GateAttributionV0_21_0Schema),
    shape("0.26.0", GateAttributionV0_26_0Schema),
    shape("0.31.0", GateAttributionV0_31_0Schema),
    shape("0.33.0", GateAttributionV0_33_0Schema),
  ],
  "phase-file-reconciliation": [
    shape("pre-schema", PhaseFileReconciliationPreSchemaSchema),
    shape("0.17.0", PhaseFileReconciliationV0_17_0Schema),
  ],
  "spec-document": [
    shape("pre-schema", SpecDocumentPreSchemaSchema),
    shape("0.17.0", SpecDocumentV0_17_0Schema),
    shape("0.25.0", SpecDocumentV0_25_0Schema),
    shape("0.27.0", SpecDocumentV0_27_0Schema),
  ],
  "plan-document": [
    shape("pre-schema", PlanDocumentPreSchemaSchema, { repairs: [preSchemaPlanHasNoSourceSpec] }),
    shape("0.17.0", PlanDocumentV0_17_0Schema, {
      packageOnly:
        "readPlanDocumentSidecar reads a stamp below 0.25.0 with the 0.20.0 decoder, which requires `completesSpec`; 0.17.0 to 0.19.x never recorded it",
    }),
    shape("0.20.0", PlanDocumentV0_20_0Schema),
    shape("0.25.0", PlanDocumentV0_25_0Schema),
    shape("0.26.0", PlanDocumentV0_26_0Schema),
    shape("0.28.0", PlanDocumentV0_28_0Schema),
    shape("0.32.0", PlanDocumentV0_32_0Schema),
    shape("0.33.0", PlanDocumentV0_33_0Schema, { ownStampOnly: ANSWER_STAMP_IS_A_CONST }),
    shape("0.38.0", PlanDocumentV0_38_0Schema, { ownStampOnly: ANSWER_STAMP_IS_A_CONST }),
  ],
  "plan-approval-record": [
    shape("0.19.0", PlanApprovalRecordV0_19_0Schema),
    shape("0.25.0", PlanApprovalRecordV0_25_0Schema),
  ],
  "spec-approval-record": [shape("0.19.0", SpecApprovalRecordV0_19_0Schema)],
  "brief-record": [shape("0.20.0", BriefRecordV0_20_0Schema)],
  "hand-decision-answer": [shape("0.25.0", HandDecisionAnswerV0_25_0Schema)],
  "decision-record-manifest": [
    shape("0.25.0", DecisionRecordManifestV0_25_0Schema),
    shape("0.28.0", DecisionRecordManifestV0_28_0Schema),
    shape("0.30.0", DecisionRecordManifestV0_30_0Schema),
  ],
  "cost-ledger": [
    shape("0.25.0", CostLedgerV0_25_0Schema),
    shape("0.26.0", CostLedgerV0_26_0Schema),
  ],
  "oracle-request": [shape("0.26.0", OracleRequestV0_26_0Schema)],
  "first-reading": [
    shape("0.26.0", FirstReadingV0_26_0Schema, { packageOnly: ANSWER_READS_THE_CURRENT_STAMP }),
  ],
  "interactive-handoff": [
    shape("0.26.0", InteractiveHandoffV0_26_0Schema, {
      packageOnly: ANSWER_READS_THE_CURRENT_STAMP,
    }),
  ],
  "interactive-session": [shape("0.26.0", InteractiveSessionV0_26_0Schema)],
  "review-stop": [shape("0.26.0", ReviewStopV0_26_0Schema)],
  "run-list": [shape("0.26.0", RunListV0_26_0Schema), shape("0.30.0", RunListV0_30_0Schema)],
  "code-review": [
    shape("0.29.0", CodeReviewV0_29_0Schema),
    shape("0.32.0", CodeReviewV0_32_0Schema, { ownStampOnly: ANSWER_STAMP_IS_A_CONST }),
  ],
  "phax-plan-extraction": [
    shape("0.32.0", PhaxPlanExtractionV0_32_0Schema, {
      packageOnly: EXTRACTION_READS_ITS_STAMP,
      ownStampOnly: ANSWER_STAMP_IS_A_CONST,
    }),
    shape("0.33.0", PhaxPlanExtractionV0_33_0Schema, {
      packageOnly: EXTRACTION_READS_ITS_STAMP,
      ownStampOnly: ANSWER_STAMP_IS_A_CONST,
    }),
  ],
};

/** Every ledger format's entry; typed over every FormatId, so a missing one fails the typecheck. */
export const FORMAT_REGISTRY: { readonly [F in FormatId]: FormatEntry & { readonly id: F } } = {
  registry: entry("registry", {
    schema: RegistrySchema,
    phax: read(persisted(readRegistryFile)),
    parse: fromPackage(parseRegistry),
  }),
  "run-status": entry("run-status", {
    schema: RunStatusSchema,
    phax: read(persisted(readRunStatusFile)),
    parse: fromPackage(parseRunStatus),
  }),
  "phase-status": entry("phase-status", {
    schema: PhaseStatusSchema,
    repairs: [awaitingReviewRecordsAWaitingStop],
    phax: read(persisted(readPhaseStatusFile)),
    parse: fromPackage(parsePhaseStatus),
  }),
  "phax-plan": entry("phax-plan", {
    schema: PhaxPlanSchema,
    phax: read(readPhaxPlan),
    parse: fromPackage(parsePhaxPlan),
  }),
  "compliance-review": entry("compliance-review", {
    schema: ComplianceReviewSchema,
    phax: read(readComplianceReview),
    parse: fromPackage(parseComplianceReview),
  }),
  "plan-approvals": entry("plan-approvals", {
    schema: PlanApprovalsSchema,
    phax: read(persisted(readPlanApprovalsFile)),
    parse: fromPackage(parsePlanApprovals),
  }),
  "spec-approvals": entry("spec-approvals", {
    schema: SpecApprovalsSchema,
    phax: read(persisted(readSpecApprovalsFile)),
    parse: fromPackage(parseSpecApprovals),
  }),
  "phase-record-manifest": entry("phase-record-manifest", {
    schema: PhaseRecordManifestSchema,
    phax: read(persisted(readRecordManifestFile)),
    parse: fromPackage(parsePhaseRecordManifest),
  }),
  "authoring-record-manifest": entry("authoring-record-manifest", {
    schema: AuthoringRecordManifestSchema,
    phax: read(persisted(readRecordManifestFile)),
    parse: fromPackage(parseAuthoringRecordManifest),
  }),
  "gate-attribution": entry("gate-attribution", {
    schema: GateAttributionSchema,
    phax: read(persisted(readGateAttributionFile)),
    parse: fromPackage(parseGateAttribution),
  }),
  "phase-file-reconciliation": entry("phase-file-reconciliation", {
    schema: PhaseFileReconciliationSchema,
    phax: read(persisted(readPhaseFileReconciliationFile)),
    parse: fromPackage(parsePhaseFileReconciliation),
  }),
  "spec-document": entry("spec-document", {
    schema: SpecDocumentSchema,
    derivation: specDocumentFields,
    repairs: [specQuestionsPassTheQuestionChecks, requirementsAreTraced],
    phax: read(readSpecSidecar),
    parse: fromPackage(parseSpecDocument),
  }),
  "plan-document": entry("plan-document", {
    schema: PlanDocumentSchema,
    derivation: planDocumentFields,
    repairs: [lineagePairsSpecAndCompletion, planQuestionsPassTheQuestionChecks],
    phax: { read: readPlanSidecar, readFile: readPlanSidecarFile },
    parse: fromPackage(parsePlanDocument),
  }),
  "plan-approval-record": entry("plan-approval-record", {
    schema: PlanApprovalRecordSchema,
    phax: read(persisted(readPlanRecordFile)),
    parse: fromPackage(parsePlanApprovalRecord),
  }),
  "spec-approval-record": entry("spec-approval-record", {
    schema: SpecApprovalRecordSchema,
    phax: read(persisted(readSpecRecordFile)),
    parse: fromPackage(parseSpecApprovalRecord),
  }),
  "gate-request": entry("gate-request", {
    schema: GateRequestSchema,
    phax: null,
    writeOnly: "phax writes it on a report step's stdin and never reads it back",
    parse: fromPackage(parseGateRequest),
  }),
  "brief-request": entry("brief-request", {
    schema: BriefRequestSchema,
    phax: read(persisted(readBriefRequestFile)),
    parse: fromPackage(parseBriefRequest),
  }),
  "brief-record": entry("brief-record", {
    schema: BriefRecordSchema,
    phax: read(persisted(readBriefRecordFile)),
    parse: fromPackage(parseBriefRecord),
  }),
  "gate-report": entry("gate-report", {
    schema: GateReportSchema,
    phax: read(answer(readGateReport)),
    parse: fromPackage(parseGateReport),
  }),
  "brief-report": entry("brief-report", {
    schema: BriefReportSchema,
    phax: read(answer(readBriefReport)),
    parse: fromPackage(parseBriefReport),
  }),
  "hand-decision-answer": entry("hand-decision-answer", {
    schema: HandDecisionAnswerSchema,
    phax: null,
    writeOnly:
      "retired at 0.32.0 for the spec and plan hand decision answers: phax neither reads nor writes it",
    parse: fromPackage(parseHandDecisionAnswer),
  }),
  "decision-record-manifest": entry("decision-record-manifest", {
    schema: DecisionRecordManifestSchema,
    phax: read(persisted(readRecordManifestFile)),
    parse: fromPackage(parseDecisionRecordManifest),
  }),
  "cost-ledger": entry("cost-ledger", {
    schema: CostLedgerSchema,
    phax: read(persisted(readCostLedgerFile)),
    parse: fromPackage(parseCostLedger),
  }),
  "architecture-request": entry("architecture-request", {
    schema: ArchitectureRequestSchema,
    phax: null,
    writeOnly: "phax writes it on an architecture provider's stdin and never reads it back",
    parse: fromPackage(parseArchitectureRequest),
  }),
  "architecture-report": entry("architecture-report", {
    schema: ArchitectureReportSchema,
    phax: read(answer(readArchitectureReport)),
    parse: fromPackage(parseArchitectureReport),
  }),
  "oracle-request": entry("oracle-request", {
    schema: OracleRequestV0_26_0Schema,
    phax: null,
    writeOnly:
      "retired at 0.33.0 for the acceptance request: phax wrote it on the provider's stdin and never reads a saved one back",
    parse: documentOf("oracle-request"),
  }),
  "first-reading": entry("first-reading", {
    schema: FirstReadingSchema,
    phax: read(answer(readFirstReadingAnswer)),
    parse: fromPackage(parseFirstReading),
  }),
  "interactive-handoff": entry("interactive-handoff", {
    schema: InteractiveHandoffSchema,
    phax: read(answer(readInteractiveHandoffAnswer)),
    parse: fromPackage(parseInteractiveHandoff),
  }),
  "interactive-session": entry("interactive-session", {
    schema: InteractiveSessionSchema,
    phax: read(persisted(readInteractiveSessionFile)),
    parse: fromPackage(parseInteractiveSession),
  }),
  "review-stop": entry("review-stop", {
    schema: ReviewStopSchema,
    phax: read(persisted(readReviewStopFile)),
    parse: fromPackage(parseReviewStop),
  }),
  "run-list": entry("run-list", {
    schema: RunListSchema,
    phax: null,
    writeOnly: "`phax ls --json` prints it; phax never saves or reads one",
    parse: fromPackage(parseRunList),
  }),
  "decide-verdicts": entry("decide-verdicts", {
    schema: DecideVerdictsSchema,
    phax: read(readDecideVerdicts),
    parse: fromPackage(parseDecideVerdicts),
  }),
  "review-record-manifest": entry("review-record-manifest", {
    schema: ReviewRecordManifestSchema,
    phax: read(persisted(readRecordManifestFile)),
    parse: fromPackage(parseReviewRecordManifest),
  }),
  "code-review": entry("code-review", {
    schema: CodeReviewSchema,
    phax: read(readCodeReview),
    parse: fromPackage(parseCodeReview),
  }),
  "code-review-answer": entry("code-review-answer", {
    schema: CodeReviewAnswerSchema,
    phax: read(readCodeReviewAnswerValue),
    parse: fromPackage(parseCodeReviewAnswer),
  }),
  "compliance-review-answer": entry("compliance-review-answer", {
    schema: ComplianceReviewAnswerSchema,
    phax: read(readComplianceReviewAnswerValue),
    parse: fromPackage(parseComplianceReviewAnswer),
  }),
  "phax-plan-extraction": entry("phax-plan-extraction", {
    schema: PhaxPlanExtractionSchema,
    phax: read(readPlanExtraction),
    parse: fromPackage(parsePhaxPlanExtraction),
  }),
  "spec-hand-decision-answer": entry("spec-hand-decision-answer", {
    schema: SpecHandDecisionAnswerSchema,
    phax: read(readHandAnswer("spec")),
    parse: fromPackage(parseSpecHandDecisionAnswer),
  }),
  "plan-hand-decision-answer": entry("plan-hand-decision-answer", {
    schema: PlanHandDecisionAnswerSchema,
    phax: read(readHandAnswer("plan")),
    parse: fromPackage(parsePlanHandDecisionAnswer),
  }),
  "acceptance-request": entry("acceptance-request", {
    schema: AcceptanceRequestSchema,
    phax: read(persisted(readAcceptanceRequestFile)),
    parse: fromPackage(parseAcceptanceRequest),
  }),
  "artifact-status": entry("artifact-status", {
    schema: ArtifactStatusSchema,
    phax: null,
    writeOnly: "`phax artifact status --json` prints it; phax never saves or reads one",
    parse: fromPackage(parseArtifactStatus),
  }),
  "plan-overview": entry("plan-overview", {
    schema: PlanOverviewSchema,
    phax: null,
    writeOnly: "`phax plans overview --json` prints it; phax never saves or reads one",
    parse: fromPackage(parsePlanOverview),
  }),
  "plan-lint": entry("plan-lint", {
    schema: PlanLintSchema,
    phax: null,
    writeOnly: "`phax plans lint --json` prints it; phax never saves or reads one",
    parse: fromPackage(parsePlanLint),
  }),
  "finding-list": entry("finding-list", {
    schema: FindingListSchema,
    phax: null,
    writeOnly: "`phax finding list --json` prints it; phax never saves or reads one",
    parse: fromPackage(parseFindingList),
  }),
  "revision-record-manifest": entry("revision-record-manifest", {
    schema: RevisionRecordManifestSchema,
    phax: read(persisted(readRecordManifestFile)),
    parse: fromPackage(parseRevisionRecordManifest),
  }),
  "finding-fate-record-manifest": entry("finding-fate-record-manifest", {
    schema: FindingFateRecordManifestSchema,
    phax: read(persisted(readFindingFateRecordManifestFile)),
    parse: fromPackage(parseFindingFateRecordManifest),
  }),
};

/** The ledger ids `registry` has no entry for, in ledger order. */
export const missingGenerators = (
  ledger: ReadonlyArray<string>,
  registry: Readonly<Partial<Record<string, unknown>>>,
): ReadonlyArray<string> => ledger.filter((id) => !Object.hasOwn(registry, id));
