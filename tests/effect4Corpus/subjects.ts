// The corpus's subject adapter: the one corpus module that touches Effect, and
// the only one a later plan migrates. `replay(subject, input)` decodes the input
// as phax's call site does and renders a refusal with the formatter that call
// site uses: the line(s) phax derives from the decode, without the file path
// or message prefix the call site wraps around them. A decoded value is
// normalised to plain data (an Effect `Option` becomes `{ _tag, value }`) so
// the canonical encoder never sees an Effect class.
//
// A persisted format has two kinds of subject. `format:<id>` reads a document
// through the schemas package's parse function for the format and answers its
// shape and value, or the first issue as `<path>: <message>`.
// `frozen:<id>/<shape>` reads it through that frozen module's decoder,
// refusing as phax's persisted reader (src/schemas/persisted.ts) renders the
// module's refusal, or, for a module phax never reads that way, as the
// package's first issue.
// `encode/<id>` is a round trip for a format phax writes: the document decoded with
// phax's file decoder, encoded with its writer, the encoded JSON answered.
import { Result, Option, ParseResult, Schema } from "effect";
import { firstRefusal, refusalsOf } from "../../src/schemas/refusal/adapter.js";
import { refusalMessage, refusalPath } from "../../src/schemas/refusal/render.js";
import {
  parseAcceptanceRequest,
  parseArchitectureReport,
  parseArchitectureRequest,
  parseArtifactStatus,
  parseAuthoringRecordManifest,
  parseBriefRecord,
  parseBriefReport,
  parseBriefRequest,
  parseCodeReview,
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
  parsePlanLint,
  parsePlanOverview,
  parseRegistry,
  parseReviewRecordManifest,
  parseReviewStop,
  parseRunList,
  parseRunStatus,
  parseSpecApprovalRecord,
  parseSpecApprovals,
  parseSpecDocument,
  parseSpecHandDecisionAnswer,
  type ParsedShape,
} from "../../packages/schemas/src/index.js";
import type { FormatId } from "../../src/schemas/schemaUrl.js";
import { decodeAuthoringRecordManifestV0_17_0 } from "../../src/schemas/history/authoring-record-manifest/0.17.0.js";
import { decodeAuthoringRecordManifestV0_23_0 } from "../../src/schemas/history/authoring-record-manifest/0.23.0.js";
import { decodeAuthoringRecordManifestPreSchema } from "../../src/schemas/history/authoring-record-manifest/pre-schema.js";
import { decodeBriefRecordV0_20_0 } from "../../src/schemas/history/brief-record/0.20.0.js";
import { decodeCodeReviewV0_29_0 } from "../../src/schemas/history/code-review/0.29.0.js";
import { decodeComplianceReviewV0_17_0 } from "../../src/schemas/history/compliance-review/0.17.0.js";
import { decodeComplianceReviewPreSchema } from "../../src/schemas/history/compliance-review/pre-schema.js";
import { decodeCostLedgerV0_25_0 } from "../../src/schemas/history/cost-ledger/0.25.0.js";
import { decodeCostLedgerV0_26_0 } from "../../src/schemas/history/cost-ledger/0.26.0.js";
import { decodeDecisionRecordManifestV0_25_0 } from "../../src/schemas/history/decision-record-manifest/0.25.0.js";
import { decodeDecisionRecordManifestV0_28_0 } from "../../src/schemas/history/decision-record-manifest/0.28.0.js";
import { decodeDecisionRecordManifestV0_30_0 } from "../../src/schemas/history/decision-record-manifest/0.30.0.js";
import { decodeFirstReadingV0_26_0 } from "../../src/schemas/history/first-reading/0.26.0.js";
import { decodeGateAttributionV0_17_0 } from "../../src/schemas/history/gate-attribution/0.17.0.js";
import { decodeGateAttributionV0_20_0 } from "../../src/schemas/history/gate-attribution/0.20.0.js";
import { decodeGateAttributionV0_21_0 } from "../../src/schemas/history/gate-attribution/0.21.0.js";
import { decodeGateAttributionV0_26_0 } from "../../src/schemas/history/gate-attribution/0.26.0.js";
import { decodeGateAttributionV0_31_0 } from "../../src/schemas/history/gate-attribution/0.31.0.js";
import { decodeGateAttributionPreSchema } from "../../src/schemas/history/gate-attribution/pre-schema.js";
import { decodeHandDecisionAnswerV0_25_0 } from "../../src/schemas/history/hand-decision-answer/0.25.0.js";
import { decodeInteractiveHandoffV0_26_0 } from "../../src/schemas/history/interactive-handoff/0.26.0.js";
import { decodeInteractiveSessionV0_26_0 } from "../../src/schemas/history/interactive-session/0.26.0.js";
import { decodeOracleRequestV0_26_0 } from "../../src/schemas/history/oracle-request/0.26.0.js";
import { decodePhaseFileReconciliationV0_17_0 } from "../../src/schemas/history/phase-file-reconciliation/0.17.0.js";
import { decodePhaseFileReconciliationPreSchema } from "../../src/schemas/history/phase-file-reconciliation/pre-schema.js";
import { decodePhaseRecordManifestV0_17_0 } from "../../src/schemas/history/phase-record-manifest/0.17.0.js";
import { decodePhaseRecordManifestV0_26_0 } from "../../src/schemas/history/phase-record-manifest/0.26.0.js";
import { decodePhaseRecordManifestV0_30_0 } from "../../src/schemas/history/phase-record-manifest/0.30.0.js";
import { decodePhaseRecordManifestV0_33_0 } from "../../src/schemas/history/phase-record-manifest/0.33.0.js";
import { decodePhaseRecordManifestPreSchema } from "../../src/schemas/history/phase-record-manifest/pre-schema.js";
import { decodePhaseStatusV0_17_0 } from "../../src/schemas/history/phase-status/0.17.0.js";
import { decodePhaseStatusV0_20_0 } from "../../src/schemas/history/phase-status/0.20.0.js";
import { decodePhaseStatusV0_26_0 } from "../../src/schemas/history/phase-status/0.26.0.js";
import { decodePhaseStatusPreSchema } from "../../src/schemas/history/phase-status/pre-schema.js";
import { decodePhaxPlanExtractionV0_32_0 } from "../../src/schemas/history/phax-plan-extraction/0.32.0.js";
import { decodePhaxPlanV0_17_0 } from "../../src/schemas/history/phax-plan/0.17.0.js";
import { decodePhaxPlanV0_26_0 } from "../../src/schemas/history/phax-plan/0.26.0.js";
import { decodePhaxPlanV0_28_0 } from "../../src/schemas/history/phax-plan/0.28.0.js";
import { decodePhaxPlanV0_32_0 } from "../../src/schemas/history/phax-plan/0.32.0.js";
import { decodePhaxPlanPreSchema } from "../../src/schemas/history/phax-plan/pre-schema.js";
import { decodePlanApprovalRecordV0_19_0 } from "../../src/schemas/history/plan-approval-record/0.19.0.js";
import { decodePlanApprovalsPreSchema } from "../../src/schemas/history/plan-approvals/pre-schema.js";
import { decodePlanDocumentV0_17_0 } from "../../src/schemas/history/plan-document/0.17.0.js";
import { decodePlanDocumentV0_20_0 } from "../../src/schemas/history/plan-document/0.20.0.js";
import { decodePlanDocumentV0_25_0 } from "../../src/schemas/history/plan-document/0.25.0.js";
import { decodePlanDocumentV0_26_0 } from "../../src/schemas/history/plan-document/0.26.0.js";
import { decodePlanDocumentV0_28_0 } from "../../src/schemas/history/plan-document/0.28.0.js";
import { decodePlanDocumentV0_32_0 } from "../../src/schemas/history/plan-document/0.32.0.js";
import { decodePlanDocumentPreSchema } from "../../src/schemas/history/plan-document/pre-schema.js";
import { decodeRegistryV0_17_0 } from "../../src/schemas/history/registry/0.17.0.js";
import { decodeRegistryPreSchema } from "../../src/schemas/history/registry/pre-schema.js";
import { decodeReviewStopV0_26_0 } from "../../src/schemas/history/review-stop/0.26.0.js";
import { decodeRunListV0_26_0 } from "../../src/schemas/history/run-list/0.26.0.js";
import { decodeRunListV0_30_0 } from "../../src/schemas/history/run-list/0.30.0.js";
import { decodeRunStatusV0_17_0 } from "../../src/schemas/history/run-status/0.17.0.js";
import { decodeRunStatusV0_26_0 } from "../../src/schemas/history/run-status/0.26.0.js";
import { decodeRunStatusPreSchema } from "../../src/schemas/history/run-status/pre-schema.js";
import { decodeSpecApprovalRecordV0_19_0 } from "../../src/schemas/history/spec-approval-record/0.19.0.js";
import { decodeSpecApprovalsPreSchema } from "../../src/schemas/history/spec-approvals/pre-schema.js";
import { decodeSpecDocumentV0_17_0 } from "../../src/schemas/history/spec-document/0.17.0.js";
import { decodeSpecDocumentV0_25_0 } from "../../src/schemas/history/spec-document/0.25.0.js";
import { decodeSpecDocumentV0_27_0 } from "../../src/schemas/history/spec-document/0.27.0.js";
import { decodeSpecDocumentPreSchema } from "../../src/schemas/history/spec-document/pre-schema.js";
import {
  decodeAcceptanceRequestFile,
  encodeAcceptanceRequestFile,
} from "../../src/schemas/acceptanceRequest.js";
import {
  decodeApprovalRecordFile,
  decodePlanRecordFile,
  encodeApprovalRecordFile,
  encodePlanRecordFile,
} from "../../src/schemas/approvalRecord.js";
import {
  decodeArtifactStatusFile,
  encodeArtifactStatusFile,
} from "../../src/schemas/artifactStatusDocument.js";
import {
  decodeAuthoringRecordManifestFile,
  encodeAuthoringRecordManifest,
} from "../../src/schemas/authoringRecord.js";
import {
  decodeBriefRecordFile,
  decodeBriefRequestFile,
  encodeBriefRecordFile,
  encodeBriefRequestFile,
} from "../../src/schemas/brief.js";
import { decodeCodeReviewFile, encodeCodeReviewFile } from "../../src/schemas/codeReview.js";
import {
  decodeComplianceReviewFile,
  encodeComplianceReviewFile,
} from "../../src/schemas/complianceReview.js";
import {
  decodeDecisionRecordManifestFile,
  encodeDecisionRecordManifest,
} from "../../src/schemas/decisionRecord.js";
import {
  PlanExtractionAnswerSchema,
  decodePlanExtractionAnswer,
} from "../../src/schemas/planExtraction.js";
import { decodeFirstReadingFile, encodeFirstReadingFile } from "../../src/schemas/firstReading.js";
import {
  decodeGateAttributionFile,
  encodeGateAttributionFile,
} from "../../src/schemas/gateAttribution.js";
import { decodeGateRequestFile, encodeGateRequestFile } from "../../src/schemas/gateRequest.js";
import {
  decodeInteractiveHandoffFile,
  encodeInteractiveHandoffFile,
} from "../../src/schemas/interactiveHandoff.js";
import {
  decodeInteractiveSessionFile,
  encodeInteractiveSessionFile,
} from "../../src/schemas/interactiveSession.js";
import { decodePhaxPlanFile, encodePhaxPlanFile } from "../../src/schemas/phaxPlan.js";
import { decodePlanDocumentFile, encodePlanDocumentFile } from "../../src/schemas/planDocument.js";
import { decodePlanLintFile, encodePlanLintFile } from "../../src/schemas/planLint.js";
import { decodePlanOverviewFile, encodePlanOverviewFile } from "../../src/schemas/planOverview.js";
import {
  decodePhaseFileReconciliationFile,
  encodePhaseFileReconciliationFile,
} from "../../src/schemas/reconciliation.js";
import { decodeRegistryFile, encodeRegistryFile } from "../../src/schemas/registry.js";
import {
  decodeReviewRecordManifestFile,
  encodeReviewRecordManifest,
} from "../../src/schemas/reviewRecord.js";
import { decodeReviewStopFile, encodeReviewStopFile } from "../../src/schemas/reviewStop.js";
import { decodeRunListFile, encodeRunListFile } from "../../src/schemas/runList.js";
import {
  decodeRunRecordManifestFile,
  encodeRunRecordManifest,
} from "../../src/schemas/runRecord.js";
import {
  decodeSpecApprovalRecordFile,
  decodeSpecRecordFile,
  encodeSpecApprovalRecordFile,
  encodeSpecRecordFile,
} from "../../src/schemas/specApprovalRecord.js";
import { decodeSpecDocumentFile, encodeSpecDocumentFile } from "../../src/schemas/specDocument.js";
import {
  decodePhaseStatusFile,
  decodeRunStatusFile,
  encodePhaseStatus,
  encodeRunStatus,
} from "../../src/schemas/status.js";
import { decodePhaxConfig, decodePhaxUserOverlay } from "../../src/schemas/phaxConfig.js";
import { decodeProviderConfig } from "../../src/schemas/providerConfig.js";
import { decodeModelRouting } from "../../src/schemas/modelRouting.js";
import { decodeTelemetryConfig } from "../../src/schemas/telemetryConfig.js";
import { extractBaseModel } from "../../src/schemas/vibeConfig.js";
import { scanClaudeOutcomeEvents } from "../../src/schemas/claudeOutput.js";
import { parseClaudeStream } from "../../src/schemas/claudeStream.js";
import { scanCodexOutcomeEvents } from "../../src/schemas/codexOutput.js";
import { findVibeResultEvent, findVibeStreamHead } from "../../src/schemas/vibeOutput.js";
import { decodeVibeExportText, decodeVibeOutcomeText } from "../../src/schemas/vibeExport.js";
import { readPlanExtractionAnswer } from "../../src/schemas/planExtraction.js";
import { decodeAuthoredSpecDocument } from "../../src/schemas/specDocument.js";
import { decodeAuthoredPlanDocument } from "../../src/schemas/planDocument.js";
import { decodePlanAuditResponse } from "../../src/schemas/planAudit.js";
import {
  decodePlanFrontmatter,
  decodeSpecFrontmatter,
} from "../../src/schemas/artifactFrontmatter.js";
import {
  formatConfigParseError,
  formatFirstViolation,
  formatParseError,
  formatPlanDocumentViolation,
} from "../../src/schemas/formatError.js";
import {
  documentText,
  readDecoderInput,
  readTargetInput,
  readTomlInput,
  streamLines,
  type Expected,
} from "./corpus.js";

// A decoded value as plain data: an Option as `{ _tag: "Some", value }` or
// `{ _tag: "None" }`, arrays and plain objects walked, a key whose value is
// undefined dropped. Anything else is returned as it is, for the canonical
// encoder to refuse.
function toPlain(value: unknown): unknown {
  if (Option.isOption(value)) {
    return Option.isSome(value) ? { _tag: "Some", value: toPlain(value.value) } : { _tag: "None" };
  }
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === "object" && value !== null) {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, toPlain(item)]),
    );
  }
  return value;
}

function accepted(value: unknown): Expected {
  return { ok: true, value: toPlain(value) };
}

function acceptedShape(shape: string, value: unknown): Expected {
  return { ok: true, shape, value: toPlain(value) };
}

function refused(refusal: string): Expected {
  return { ok: false, refusal };
}

function fromParse<A>(
  result: Result.Result<A, ParseResult.ParseError>,
  render: (error: ParseResult.ParseError) => string,
): Expected {
  return Result.isFailure(result) ? refused(render(result.left)) : accepted(result.right);
}

function fromLines<A>(result: Result.Result<A, string>): Expected {
  return Result.isFailure(result) ? refused(result.left) : accepted(result.right);
}

type Subject = (input: unknown) => Expected;

// A subject over several decoders: the input is `{ decoder, raw }`.
function byDecoder(decoders: Readonly<Record<string, (raw: unknown) => Expected>>): Subject {
  const table = new Map(Object.entries(decoders));
  return (input) => {
    const { decoder, raw } = readDecoderInput(input);
    const decode = table.get(decoder);
    if (decode === undefined) throw new Error(`corpus: no decoder ${JSON.stringify(decoder)}`);
    return decode(raw);
  };
}

// Each subject, with the phax call site it mirrors.
const SUBJECTS = new Map<string, Subject>([
  // src/app/loadConfig.ts loadConfig: decodePhaxConfig(raw), formatConfigParseError(raw, …).
  [
    "config/phax-config",
    (raw) => fromParse(decodePhaxConfig(raw), (e) => formatConfigParseError(raw, e)),
  ],
  // src/app/loadConfig.ts readUserOverlay: decodePhaxUserOverlay(raw), formatConfigParseError(raw, …).
  [
    "config/phax-user-overlay",
    (raw) => fromParse(decodePhaxUserOverlay(raw), (e) => formatConfigParseError(raw, e)),
  ],
  // src/app/loadRouting.ts readProviderConfigFile: decodeProviderConfig, formatParseError.
  ["config/provider-config", (raw) => fromParse(decodeProviderConfig(raw), formatParseError)],
  // src/app/loadRouting.ts loadModelRouting: decodeModelRouting, formatParseError.
  ["config/model-routing", (raw) => fromParse(decodeModelRouting(raw), formatParseError)],
  // src/app/loadTelemetryConfig.ts loadTelemetryConfig: decodeTelemetryConfig, formatParseError.
  ["config/telemetry-config", (raw) => fromParse(decodeTelemetryConfig(raw), formatParseError)],
  // src/app/vibeSetup.ts: extractBaseModel(toml, alias), its Left printed as it is.
  [
    "config/vibe-config",
    (input) => {
      const { toml, alias } = readTomlInput(input);
      return fromLines(extractBaseModel(toml, alias));
    },
  ],
  // src/domain/session/claudeOutcome.ts: scanClaudeOutcomeEvents(lines). Never refuses: a
  // line no decoder reads is skipped.
  ["answers/claude-output", (raw) => accepted(scanClaudeOutcomeEvents(streamLines(raw)))],
  // src/app/costLedger.ts: parseClaudeStream(lines). Never refuses: a line that does not
  // decode is skipped (a rate-limit event's is counted).
  ["answers/claude-stream", (raw) => accepted(parseClaudeStream(streamLines(raw)))],
  // src/domain/session/codexOutcome.ts: scanCodexOutcomeEvents(lines). Never refuses.
  ["answers/codex-output", (raw) => accepted(scanCodexOutcomeEvents(streamLines(raw)))],
  // src/domain/session/vibeOutcome.ts: findVibeResultEvent and findVibeStreamHead over the
  // stream's lines; undefined (no line decodes) reads as null. Never refuses.
  [
    "answers/vibe-output",
    byDecoder({
      findVibeResultEvent: (raw) => accepted(findVibeResultEvent(streamLines(raw)) ?? null),
      findVibeStreamHead: (raw) => accepted(findVibeStreamHead(streamLines(raw)) ?? null),
    }),
  ],
  // src/domain/records/usage.ts (decodeVibeExportText) and src/domain/session/vibeOutcome.ts
  // (decodeVibeOutcomeText, printed `(<reason>): <detail>` after the export's path).
  [
    "answers/vibe-export",
    byDecoder({
      decodeVibeExportText: (raw) => vibeExport(decodeVibeExportText(documentText(raw))),
      decodeVibeOutcomeText: (raw) => vibeExport(decodeVibeOutcomeText(documentText(raw))),
    }),
  ],
  // src/app/extractPlan.ts: readPlanExtractionAnswer(parsed), its Left printed as it is.
  ["answers/plan-extraction", (raw) => fromLines(readPlanExtractionAnswer(raw))],
  // src/app/authorArtifact.ts parseAuthoredDocument: the spec or plan authoring answer, its
  // Left (the first violation) printed as it is.
  [
    "answers/authoring-answer",
    byDecoder({
      spec: (raw) => fromLines(decodeAuthoredSpecDocument(raw)),
      plan: (raw) => fromLines(decodeAuthoredPlanDocument(raw)),
    }),
  ],
  // src/app/providerQuery.ts runProviderQuery (from planAuditor.ts): formatParseError.
  ["answers/plan-audit", (raw) => fromParse(decodePlanAuditResponse(raw), formatParseError)],
  // src/domain/artifact/frontmatter.ts decodeArtifactFrontmatter: the frontmatter's YAML
  // value through the spec or plan decoder, a refusal's detail formatParseError.
  [
    "documents/artifact-frontmatter",
    byDecoder({
      spec: (raw) => fromParse(decodeSpecFrontmatter(raw), formatParseError),
      plan: (raw) => fromParse(decodePlanFrontmatter(raw), formatParseError),
    }),
  ],
]);

function vibeExport<A>(
  result: Result.Result<A, { readonly reason: string; readonly detail: string }>,
): Expected {
  return Result.isFailure(result)
    ? refused(`(${result.left.reason}): ${result.left.detail}`)
    : accepted(result.right);
}

// ---------------------------------------------------------------------------
// Persisted formats.

type PackageParse = (input: unknown) => ParsedShape<Readonly<Record<string, unknown>>>;

// The package's `parseDocument` reads the oracle request, which has no parse
// function of its own: the document's `$schema` names the format.
const parseOracleRequest: PackageParse = (input) => {
  const result = parseDocument(input);
  return result.ok ? { ok: true, shape: result.shape, value: result.value } : result;
};

// Typed over every format id: a format added without an entry fails to compile.
const PACKAGE_PARSERS: { readonly [F in FormatId]: PackageParse } = {
  registry: parseRegistry,
  "run-status": parseRunStatus,
  "phase-status": parsePhaseStatus,
  "phax-plan": parsePhaxPlan,
  "compliance-review": parseComplianceReview,
  "plan-approvals": parsePlanApprovals,
  "spec-approvals": parseSpecApprovals,
  "phase-record-manifest": parsePhaseRecordManifest,
  "authoring-record-manifest": parseAuthoringRecordManifest,
  "gate-attribution": parseGateAttribution,
  "phase-file-reconciliation": parsePhaseFileReconciliation,
  "spec-document": parseSpecDocument,
  "plan-document": parsePlanDocument,
  "plan-approval-record": parsePlanApprovalRecord,
  "spec-approval-record": parseSpecApprovalRecord,
  "gate-request": parseGateRequest,
  "brief-request": parseBriefRequest,
  "brief-record": parseBriefRecord,
  "gate-report": parseGateReport,
  "brief-report": parseBriefReport,
  "hand-decision-answer": parseHandDecisionAnswer,
  "decision-record-manifest": parseDecisionRecordManifest,
  "cost-ledger": parseCostLedger,
  "architecture-request": parseArchitectureRequest,
  "architecture-report": parseArchitectureReport,
  "oracle-request": parseOracleRequest,
  "first-reading": parseFirstReading,
  "interactive-handoff": parseInteractiveHandoff,
  "interactive-session": parseInteractiveSession,
  "review-stop": parseReviewStop,
  "run-list": parseRunList,
  "decide-verdicts": parseDecideVerdicts,
  "review-record-manifest": parseReviewRecordManifest,
  "code-review": parseCodeReview,
  "phax-plan-extraction": parsePhaxPlanExtraction,
  "spec-hand-decision-answer": parseSpecHandDecisionAnswer,
  "plan-hand-decision-answer": parsePlanHandDecisionAnswer,
  "acceptance-request": parseAcceptanceRequest,
  "artifact-status": parseArtifactStatus,
  "plan-overview": parsePlanOverview,
  "plan-lint": parsePlanLint,
};

function isFormatId(id: string): id is FormatId {
  return Object.hasOwn(PACKAGE_PARSERS, id);
}

function formatSubject(id: FormatId): Subject {
  const parse = PACKAGE_PARSERS[id];
  return (raw) => {
    const result = parse(raw);
    return result.ok
      ? acceptedShape(result.shape, result.value)
      : refused(`${result.error.path}: ${result.error.message}`);
  };
}

// How a frozen decoder's refusal reads: as persisted.ts prints it
// (`formatFirstViolation`; `formatPlanDocumentViolation` for the plan documents
// phax reads with test-line context), or, where phax has no such path, as the
// package's first issue, `<path>: <message>`.
type Render = "first" | "plan-document" | "package";

function renderFrozen(render: Render, raw: unknown, error: ParseResult.ParseError): string {
  if (render === "first") return formatFirstViolation(error);
  if (render === "plan-document") return formatPlanDocumentViolation(raw, error);
  const first = firstRefusal(error);
  return first === undefined
    ? ": invalid document"
    : `${refusalPath(first.path, "dotted")}: ${refusalMessage(first)}`;
}

function frozen<A>(
  module: string,
  decode: (input: unknown) => Result.Result<A, ParseResult.ParseError>,
  render: Render,
): readonly [string, Subject] {
  return [
    `frozen:${module}`,
    (raw) => fromParse(decode(raw), (error) => renderFrozen(render, raw, error)),
  ];
}

// One subject per module of packages/schemas/history.lock.json.
const FROZEN_SUBJECTS = new Map<string, Subject>([
  frozen("authoring-record-manifest/0.17.0", decodeAuthoringRecordManifestV0_17_0, "first"),
  frozen("authoring-record-manifest/0.23.0", decodeAuthoringRecordManifestV0_23_0, "first"),
  frozen("authoring-record-manifest/pre-schema", decodeAuthoringRecordManifestPreSchema, "first"),
  frozen("brief-record/0.20.0", decodeBriefRecordV0_20_0, "package"),
  frozen("code-review/0.29.0", decodeCodeReviewV0_29_0, "first"),
  frozen("compliance-review/0.17.0", decodeComplianceReviewV0_17_0, "first"),
  frozen("compliance-review/pre-schema", decodeComplianceReviewPreSchema, "first"),
  frozen("cost-ledger/0.25.0", decodeCostLedgerV0_25_0, "first"),
  frozen("cost-ledger/0.26.0", decodeCostLedgerV0_26_0, "first"),
  frozen("decision-record-manifest/0.25.0", decodeDecisionRecordManifestV0_25_0, "first"),
  frozen("decision-record-manifest/0.28.0", decodeDecisionRecordManifestV0_28_0, "first"),
  frozen("decision-record-manifest/0.30.0", decodeDecisionRecordManifestV0_30_0, "first"),
  frozen("first-reading/0.26.0", decodeFirstReadingV0_26_0, "package"),
  frozen("gate-attribution/0.17.0", decodeGateAttributionV0_17_0, "package"),
  frozen("gate-attribution/0.20.0", decodeGateAttributionV0_20_0, "package"),
  frozen("gate-attribution/0.21.0", decodeGateAttributionV0_21_0, "package"),
  frozen("gate-attribution/0.26.0", decodeGateAttributionV0_26_0, "first"),
  frozen("gate-attribution/0.31.0", decodeGateAttributionV0_31_0, "first"),
  frozen("gate-attribution/pre-schema", decodeGateAttributionPreSchema, "first"),
  frozen("hand-decision-answer/0.25.0", decodeHandDecisionAnswerV0_25_0, "package"),
  frozen("interactive-handoff/0.26.0", decodeInteractiveHandoffV0_26_0, "package"),
  frozen("interactive-session/0.26.0", decodeInteractiveSessionV0_26_0, "first"),
  frozen("oracle-request/0.26.0", decodeOracleRequestV0_26_0, "package"),
  frozen("phase-file-reconciliation/0.17.0", decodePhaseFileReconciliationV0_17_0, "first"),
  frozen("phase-file-reconciliation/pre-schema", decodePhaseFileReconciliationPreSchema, "first"),
  frozen("phase-record-manifest/0.17.0", decodePhaseRecordManifestV0_17_0, "first"),
  frozen("phase-record-manifest/0.26.0", decodePhaseRecordManifestV0_26_0, "first"),
  frozen("phase-record-manifest/0.30.0", decodePhaseRecordManifestV0_30_0, "first"),
  frozen("phase-record-manifest/0.33.0", decodePhaseRecordManifestV0_33_0, "first"),
  frozen("phase-record-manifest/pre-schema", decodePhaseRecordManifestPreSchema, "first"),
  frozen("phase-status/0.17.0", decodePhaseStatusV0_17_0, "package"),
  frozen("phase-status/0.20.0", decodePhaseStatusV0_20_0, "first"),
  frozen("phase-status/0.26.0", decodePhaseStatusV0_26_0, "first"),
  frozen("phase-status/pre-schema", decodePhaseStatusPreSchema, "first"),
  frozen("phax-plan-extraction/0.32.0", decodePhaxPlanExtractionV0_32_0, "package"),
  frozen("phax-plan/0.17.0", decodePhaxPlanV0_17_0, "first"),
  frozen("phax-plan/0.26.0", decodePhaxPlanV0_26_0, "first"),
  frozen("phax-plan/0.28.0", decodePhaxPlanV0_28_0, "first"),
  frozen("phax-plan/0.32.0", decodePhaxPlanV0_32_0, "first"),
  frozen("phax-plan/pre-schema", decodePhaxPlanPreSchema, "first"),
  frozen("plan-approval-record/0.19.0", decodePlanApprovalRecordV0_19_0, "first"),
  frozen("plan-approvals/pre-schema", decodePlanApprovalsPreSchema, "first"),
  frozen("plan-document/0.17.0", decodePlanDocumentV0_17_0, "package"),
  frozen("plan-document/0.20.0", decodePlanDocumentV0_20_0, "first"),
  frozen("plan-document/0.25.0", decodePlanDocumentV0_25_0, "first"),
  frozen("plan-document/0.26.0", decodePlanDocumentV0_26_0, "first"),
  frozen("plan-document/0.28.0", decodePlanDocumentV0_28_0, "plan-document"),
  frozen("plan-document/0.32.0", decodePlanDocumentV0_32_0, "plan-document"),
  frozen("plan-document/pre-schema", decodePlanDocumentPreSchema, "first"),
  frozen("registry/0.17.0", decodeRegistryV0_17_0, "first"),
  frozen("registry/pre-schema", decodeRegistryPreSchema, "first"),
  frozen("review-stop/0.26.0", decodeReviewStopV0_26_0, "first"),
  frozen("run-list/0.26.0", decodeRunListV0_26_0, "package"),
  frozen("run-list/0.30.0", decodeRunListV0_30_0, "package"),
  frozen("run-status/0.17.0", decodeRunStatusV0_17_0, "first"),
  frozen("run-status/0.26.0", decodeRunStatusV0_26_0, "first"),
  frozen("run-status/pre-schema", decodeRunStatusPreSchema, "first"),
  frozen("spec-approval-record/0.19.0", decodeSpecApprovalRecordV0_19_0, "first"),
  frozen("spec-approvals/pre-schema", decodeSpecApprovalsPreSchema, "first"),
  frozen("spec-document/0.17.0", decodeSpecDocumentV0_17_0, "first"),
  frozen("spec-document/0.25.0", decodeSpecDocumentV0_25_0, "first"),
  frozen("spec-document/0.27.0", decodeSpecDocumentV0_27_0, "first"),
  frozen("spec-document/pre-schema", decodeSpecDocumentPreSchema, "first"),
]);

// ---------------------------------------------------------------------------
// Encode subjects.

// A round trip from the encoded side: the document is decoded with phax's current file
// decoder for the format (the one its reader uses), the decoded value is encoded with
// the format's `encode…File` writer, and the encoded JSON is the answer. An encode
// input must decode, so a decode failure throws instead of answering a refusal.
function roundTrip<A>(
  decode: (input: unknown) => Result.Result<A, ParseResult.ParseError>,
  encode: (value: A) => unknown,
): Subject {
  return (raw) => {
    const decoded = decode(raw);
    if (Result.isFailure(decoded)) {
      throw new Error(
        `corpus: an encode input must decode: ${refusalsOf(decoded.left).map(refusalMessage).join("; ")}`,
      );
    }
    return accepted(encode(decoded.right));
  };
}

// The formats phax writes through a `Schema.encode*` writer; the coverage test lists the
// formats it leaves out, with the reason.
const WRITTEN_FORMAT_IDS = [
  "registry",
  "run-status",
  "phase-status",
  "phax-plan",
  "compliance-review",
  "plan-approvals",
  "spec-approvals",
  "phase-record-manifest",
  "authoring-record-manifest",
  "gate-attribution",
  "phase-file-reconciliation",
  "spec-document",
  "plan-document",
  "plan-approval-record",
  "spec-approval-record",
  "gate-request",
  "brief-request",
  "brief-record",
  "decision-record-manifest",
  "first-reading",
  "interactive-handoff",
  "interactive-session",
  "review-stop",
  "run-list",
  "review-record-manifest",
  "code-review",
  "phax-plan-extraction",
  "acceptance-request",
  "artifact-status",
  "plan-overview",
  "plan-lint",
] as const satisfies ReadonlyArray<FormatId>;

type WrittenFormatId = (typeof WRITTEN_FORMAT_IDS)[number];

// Typed over the written format ids: a written format without an entry fails to compile.
// Each entry names the phax decoder it reads with and the writer it encodes with.
const ENCODE_SUBJECTS: { readonly [F in WrittenFormatId]: Subject } = {
  // registry.json: decodeRegistryFile on read, encodeRegistryFile on write.
  registry: roundTrip(decodeRegistryFile, encodeRegistryFile),
  // a run's status file: decodeRunStatusFile on read, encodeRunStatus on write.
  "run-status": roundTrip(decodeRunStatusFile, encodeRunStatus),
  // a phase's status file: decodePhaseStatusFile on read, encodePhaseStatus on write.
  "phase-status": roundTrip(decodePhaseStatusFile, encodePhaseStatus),
  // phax-plan.json: decodePhaxPlanFile on read, encodePhaxPlanFile on write.
  "phax-plan": roundTrip(decodePhaxPlanFile, encodePhaxPlanFile),
  // the compliance review: decodeComplianceReviewFile, encodeComplianceReviewFile.
  "compliance-review": roundTrip(decodeComplianceReviewFile, encodeComplianceReviewFile),
  // docs/plans/approvals.json, the old ledger (phax reads it to migrate it): decodeApprovalRecordFile,
  // encodeApprovalRecordFile.
  "plan-approvals": roundTrip(decodeApprovalRecordFile, encodeApprovalRecordFile),
  // docs/specs/approvals.json, the old ledger: decodeSpecApprovalRecordFile, encodeSpecApprovalRecordFile.
  "spec-approvals": roundTrip(decodeSpecApprovalRecordFile, encodeSpecApprovalRecordFile),
  // a phase's record.json: decodeRunRecordManifestFile, encodeRunRecordManifest.
  "phase-record-manifest": roundTrip(decodeRunRecordManifestFile, encodeRunRecordManifest),
  // an authoring record.json: decodeAuthoringRecordManifestFile, encodeAuthoringRecordManifest.
  "authoring-record-manifest": roundTrip(
    decodeAuthoringRecordManifestFile,
    encodeAuthoringRecordManifest,
  ),
  // gate attribution: decodeGateAttributionFile, encodeGateAttributionFile.
  "gate-attribution": roundTrip(decodeGateAttributionFile, encodeGateAttributionFile),
  // file reconciliation: decodePhaseFileReconciliationFile, encodePhaseFileReconciliationFile.
  "phase-file-reconciliation": roundTrip(
    decodePhaseFileReconciliationFile,
    encodePhaseFileReconciliationFile,
  ),
  // the spec document: decodeSpecDocumentFile, encodeSpecDocumentFile.
  "spec-document": roundTrip(decodeSpecDocumentFile, encodeSpecDocumentFile),
  // the plan document: decodePlanDocumentFile, encodePlanDocumentFile.
  "plan-document": roundTrip(decodePlanDocumentFile, encodePlanDocumentFile),
  // docs/plans/approvals/<plan>.json: decodePlanRecordFile, encodePlanRecordFile.
  "plan-approval-record": roundTrip(decodePlanRecordFile, encodePlanRecordFile),
  // docs/specs/approvals/<spec>.json: decodeSpecRecordFile, encodeSpecRecordFile.
  "spec-approval-record": roundTrip(decodeSpecRecordFile, encodeSpecRecordFile),
  // the gate request: decodeGateRequestFile, encodeGateRequestFile.
  "gate-request": roundTrip(decodeGateRequestFile, encodeGateRequestFile),
  // the brief request: decodeBriefRequestFile, encodeBriefRequestFile.
  "brief-request": roundTrip(decodeBriefRequestFile, encodeBriefRequestFile),
  // the brief record: decodeBriefRecordFile, encodeBriefRecordFile.
  "brief-record": roundTrip(decodeBriefRecordFile, encodeBriefRecordFile),
  // the decision record: decodeDecisionRecordManifestFile, encodeDecisionRecordManifest.
  "decision-record-manifest": roundTrip(
    decodeDecisionRecordManifestFile,
    encodeDecisionRecordManifest,
  ),
  // the first reading: decodeFirstReadingFile, encodeFirstReadingFile.
  "first-reading": roundTrip(decodeFirstReadingFile, encodeFirstReadingFile),
  // the interactive handoff: decodeInteractiveHandoffFile, encodeInteractiveHandoffFile.
  "interactive-handoff": roundTrip(decodeInteractiveHandoffFile, encodeInteractiveHandoffFile),
  // the interactive session: decodeInteractiveSessionFile, encodeInteractiveSessionFile.
  "interactive-session": roundTrip(decodeInteractiveSessionFile, encodeInteractiveSessionFile),
  // the review stop: decodeReviewStopFile, encodeReviewStopFile.
  "review-stop": roundTrip(decodeReviewStopFile, encodeReviewStopFile),
  // the run list: decodeRunListFile, encodeRunListFile.
  "run-list": roundTrip(decodeRunListFile, encodeRunListFile),
  // the review record: decodeReviewRecordManifestFile, encodeReviewRecordManifest.
  "review-record-manifest": roundTrip(decodeReviewRecordManifestFile, encodeReviewRecordManifest),
  // the code review: decodeCodeReviewFile, encodeCodeReviewFile.
  "code-review": roundTrip(decodeCodeReviewFile, encodeCodeReviewFile),
  // the plan extraction answer: decodePlanExtractionAnswer (src/schemas/planExtraction.ts, how
  // readPlanExtractionAnswer reads it). phax only reads this format and has no writer for it:
  // the encoder is the answer schema's own, `Schema.encodeSync(PlanExtractionAnswerSchema)`.
  // (src/app/planCacheStore.ts's `encodeExtractedPlanCacheEntry` writes a different file, the
  // extraction cache entry, which is not this format.)
  "phax-plan-extraction": roundTrip(
    decodePlanExtractionAnswer,
    Schema.encodeSync(PlanExtractionAnswerSchema),
  ),
  // the acceptance request: decodeAcceptanceRequestFile, encodeAcceptanceRequestFile.
  "acceptance-request": roundTrip(decodeAcceptanceRequestFile, encodeAcceptanceRequestFile),
  // the artifact status answer: decodeArtifactStatusFile, encodeArtifactStatusFile.
  "artifact-status": roundTrip(decodeArtifactStatusFile, encodeArtifactStatusFile),
  // the plans overview answer: decodePlanOverviewFile, encodePlanOverviewFile.
  "plan-overview": roundTrip(decodePlanOverviewFile, encodePlanOverviewFile),
  // the plans lint answer: decodePlanLintFile, encodePlanLintFile.
  "plan-lint": roundTrip(decodePlanLintFile, encodePlanLintFile),
};

function isWrittenFormatId(id: string): id is WrittenFormatId {
  return Object.hasOwn(ENCODE_SUBJECTS, id);
}

function subjectFor(subject: string): Subject | undefined {
  const known = SUBJECTS.get(subject) ?? FROZEN_SUBJECTS.get(subject);
  if (known !== undefined) return known;
  const written = subject.startsWith("encode/") ? subject.slice("encode/".length) : "";
  if (isWrittenFormatId(written)) return ENCODE_SUBJECTS[written];
  const id = subject.startsWith("format:") ? subject.slice("format:".length) : "";
  return isFormatId(id) ? formatSubject(id) : undefined;
}

/**
 * Decodes `input` as phax decodes the subject's input. A format case file's
 * subject, `formats/<id>`, takes a `{ target, document }` input naming the
 * `format:<id>` or `frozen:<id>/<shape>` subject that decodes the document.
 * Throws on an unknown subject.
 */
export function replay(subject: string, input: unknown): Expected {
  if (subject.startsWith("formats/")) {
    const { target, document } = readTargetInput(input);
    const id = subject.slice("formats/".length);
    if (target !== `format:${id}` && !target.startsWith(`frozen:${id}/`)) {
      throw new Error(`corpus: ${JSON.stringify(target)} is not a subject of ${subject}`);
    }
    return replay(target, document);
  }
  const decode = subjectFor(subject);
  if (decode === undefined) throw new Error(`corpus: unknown subject ${JSON.stringify(subject)}`);
  return decode(input);
}
