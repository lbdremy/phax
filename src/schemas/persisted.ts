// The bridge between a persisted file and phax's in-memory value: the only
// src/ module that imports the frozen pre-schema decoders under
// src/schemas/history/, and, with each declaring module, the only one that
// names a file decoder. It is pure: callers read the bytes and parse the JSON,
// and pass the file path only so it appears in messages. It never imports
// packages/.
//
// A `$schema` stamp names a format's shape, not the build that wrote it. First,
// it refuses a document whose stamp is newer than the running version
// (`PHAX_RELEASE`): reading it would drop the fields that shape added, and the
// next write would lose them. Releases compare as semver, through the
// `compareReleases` the schemas package also uses.
//
// Otherwise it resolves a document the way the schemas package's
// `defineFormat` does: a document with `$schema` is read only by phax's
// current file decoder; a
// document without `$schema` is read only by the frozen pre-schema decoder,
// then stepped to the current shape. A format born with `$schema` has no
// pre-schema decoder, so a document of it without `$schema` is refused. On the
// way out, `withSchemaUrl` stamps the `$schema` a writer puts first with the
// format's current stamp (`currentSchemaUrl`, from `CURRENT_STAMPS`).
//
// It also reads the two answers phax decodes with a file decoder: the
// `gate-diagnostics` document a gate step prints (`readGateDiagnosticsAnswer`)
// and the `brief-answer` document a brief provider prints (`readBriefAnswer`).
// Each reads only stamps from its format's current stamp up to the running
// version, refuses an older shape by name, and names the URL it reads. The
// `gate-report` and `brief-report` documents that replace them are read the
// same way (`readGateReport`, `readBriefReport`), and refuse any other
// format by name.
import { Either, type ParseResult } from "effect";
import {
  decodeApprovalRecordFile,
  decodePlanRecordFile,
  type PlanApprovals,
  type PlanRecord,
} from "./approvalRecord.js";
import {
  decodeRecordManifestFile,
  type RecordManifest,
  type RecordManifestFile,
} from "./authoringRecord.js";
import {
  decodeBriefAnswerFile,
  decodeBriefRecordFile,
  decodeBriefRequestFile,
  type BriefAnswer,
  type BriefRecord,
  type BriefRequest,
} from "./brief.js";
import { decodeBriefReportFile, type BriefReportFile } from "./briefReport.js";
import { decodeComplianceReviewFile, type ComplianceReview } from "./complianceReview.js";
import { formatFirstViolation } from "./formatError.js";
import { decodeGateAttributionFile, type GateAttribution } from "./gateAttribution.js";
import { decodeGateDiagnosticsFile, type GateDiagnosticsDocument } from "./gateDiagnostics.js";
import { decodeGateReportFile, type GateReportFile } from "./gateReport.js";
import { decodeAuthoringRecordManifestPreSchema } from "./history/authoring-record-manifest/pre-schema.js";
import { decodeComplianceReviewPreSchema } from "./history/compliance-review/pre-schema.js";
import { decodeGateAttributionPreSchema } from "./history/gate-attribution/pre-schema.js";
import { decodePhaseFileReconciliationPreSchema } from "./history/phase-file-reconciliation/pre-schema.js";
import { decodePhaseRecordManifestPreSchema } from "./history/phase-record-manifest/pre-schema.js";
import { decodePhaseStatusPreSchema } from "./history/phase-status/pre-schema.js";
import { decodePhaxPlanPreSchema } from "./history/phax-plan/pre-schema.js";
import { decodePlanApprovalsPreSchema } from "./history/plan-approvals/pre-schema.js";
import { decodePlanDocumentPreSchema } from "./history/plan-document/pre-schema.js";
import { decodeRegistryPreSchema } from "./history/registry/pre-schema.js";
import { decodeRunStatusPreSchema } from "./history/run-status/pre-schema.js";
import { decodeSpecApprovalsPreSchema } from "./history/spec-approvals/pre-schema.js";
import { decodeSpecDocumentPreSchema } from "./history/spec-document/pre-schema.js";
import { decodePhaxPlanFile, type PhaxPlan } from "./phaxPlan.js";
import { decodePlanDocumentFile, type PlanDocument } from "./planDocument.js";
import {
  decodePhaseFileReconciliationFile,
  type PhaseFileReconciliation,
} from "./reconciliation.js";
import { decodeRegistryFile, type Registry } from "./registry.js";
import { describeReportIssue } from "./report.js";
import { CURRENT_STAMPS, PHAX_RELEASE } from "./release.js";
import {
  compareReleases,
  parseSchemaUrl,
  schemaUrl,
  type FormatId,
  type PreSchemaFormatId,
  type SchemaBornFormatId,
} from "./schemaUrl.js";
import {
  decodeSpecApprovalRecordFile,
  decodeSpecRecordFile,
  type SpecApprovals,
  type SpecRecord,
} from "./specApprovalRecord.js";
import { decodeSpecDocumentFile, type SpecDocument } from "./specDocument.js";
import {
  decodePhaseStatusFile,
  decodeRunStatusFile,
  type PhaseStatus,
  type RunStatus,
} from "./status.js";

/** A persisted file phax could not read. `message` starts with the file. */
export interface PersistedReadError {
  readonly _tag: "PersistedReadError";
  readonly file: string;
  readonly format: FormatId;
  readonly message: string;
}

/** A fact phax needs that a document written before `$schema` never recorded. */
export interface MissingFact {
  readonly fact: string;
}

type Decode<T> = (input: unknown) => Either.Either<T, ParseResult.ParseError>;

/** How one persisted format is read: its two decoders and their steps to the in-memory value. */
export interface PersistedSpec<Current, PreSchema, InMemory> {
  readonly format: PreSchemaFormatId;
  readonly label: string;
  readonly file: string;
  readonly decodeCurrent: Decode<Current>;
  readonly decodePreSchema: Decode<PreSchema>;
  readonly fromCurrent: (value: Current) => InMemory;
  readonly fromPreSchema: (value: PreSchema) => Either.Either<InMemory, MissingFact>;
}

function isDocumentObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readError(file: string, format: FormatId, message: string): PersistedReadError {
  return { _tag: "PersistedReadError", file, format, message: `${file}: ${message}` };
}

/**
 * Reads one parsed JSON document as a persisted format. Never throws. In order:
 * 1. a non-object fails;
 * 2. a document whose `$schema` names this format at a release newer than
 *    `PHAX_RELEASE` is refused, so it is never rewritten without the fields
 *    that release added;
 * 3. any other document with its own `$schema` key is read only by
 *    `decodeCurrent`;
 * 4. a document without `$schema` is read only by `decodePreSchema`, then
 *    `fromPreSchema`, which refuses when a fact phax needs is missing.
 */
export function readPersisted<Current, PreSchema, InMemory>(
  input: unknown,
  spec: PersistedSpec<Current, PreSchema, InMemory>,
): Either.Either<InMemory, PersistedReadError> {
  const { file, format, label } = spec;
  if (!isDocumentObject(input)) {
    return Either.left(readError(file, format, `a ${label} is a JSON object`));
  }
  if (Object.hasOwn(input, "$schema")) return readCurrent(input, spec);
  const preSchema = spec.decodePreSchema(input);
  if (Either.isLeft(preSchema)) {
    return Either.left(
      readError(
        file,
        format,
        `${label} without $schema is not in the pre-schema shape — older than the first release that writes $schema, or damaged (${formatFirstViolation(preSchema.left)})`,
      ),
    );
  }
  const stepped = spec.fromPreSchema(preSchema.right);
  if (Either.isLeft(stepped)) {
    return Either.left(
      readError(
        file,
        format,
        `${label} written before $schema lacks ${stepped.left.fact}, which phax needs — not supported`,
      ),
    );
  }
  return Either.right(stepped.right);
}

/** Steps 2 and 3 of `readPersisted`, shared by both readers: a document with its own `$schema` key. */
function readCurrent<Current, InMemory>(
  input: Readonly<Record<string, unknown>>,
  spec: {
    readonly format: FormatId;
    readonly label: string;
    readonly file: string;
    readonly decodeCurrent: Decode<Current>;
    readonly fromCurrent: (value: Current) => InMemory;
  },
): Either.Either<InMemory, PersistedReadError> {
  const { file, format, label } = spec;
  const named = parseSchemaUrl(input["$schema"]);
  if (
    named !== undefined &&
    named.formatId === format &&
    compareReleases(named.release, PHAX_RELEASE) > 0
  ) {
    return Either.left(
      readError(
        file,
        format,
        `${label} ${named.release} is newer than this phax (${PHAX_RELEASE}) — upgrade phax to read it`,
      ),
    );
  }
  const current = spec.decodeCurrent(input);
  if (Either.isLeft(current)) {
    return Either.left(readError(file, format, formatFirstViolation(current.left)));
  }
  return Either.right(spec.fromCurrent(current.right));
}

/** How a format born with `$schema` is read: its one decoder and its step to the in-memory value. */
export interface SchemaBornPersistedSpec<Current, InMemory> {
  readonly format: SchemaBornFormatId;
  readonly label: string;
  readonly file: string;
  readonly decodeCurrent: Decode<Current>;
  readonly fromCurrent: (value: Current) => InMemory;
}

/**
 * Reads one parsed JSON document as a format born with `$schema`. Never
 * throws. A non-object fails, and a document with its own `$schema` key is
 * read exactly as `readPersisted` reads one. A document without `$schema`
 * fails: phax wrote every document of the format with one, so there is no
 * pre-schema decoder to try.
 */
export function readSchemaBornPersisted<Current, InMemory>(
  input: unknown,
  spec: SchemaBornPersistedSpec<Current, InMemory>,
): Either.Either<InMemory, PersistedReadError> {
  const { file, format, label } = spec;
  if (!isDocumentObject(input)) {
    return Either.left(readError(file, format, `a ${label} is a JSON object`));
  }
  if (Object.hasOwn(input, "$schema")) return readCurrent(input, spec);
  return Either.left(
    readError(file, format, `${label} has no $schema — every ${label} is written with one`),
  );
}

type Reader<T> = (file: string, input: unknown) => Either.Either<T, PersistedReadError>;

/**
 * The `$schema` phax writes for `formatId`: its current stamp, which names the
 * format's current shape (the release that last changed it, or the running
 * version while it has a `next` snapshot), not the running version.
 */
export function currentSchemaUrl(formatId: FormatId): string {
  return schemaUrl(formatId, CURRENT_STAMPS[formatId]);
}

/**
 * `value` as the file phax writes: `$schema` first, naming `formatId`'s
 * current shape (`currentSchemaUrl`), then the value's own keys.
 */
export function withSchemaUrl<T extends object>(
  formatId: FormatId,
  value: T,
): { readonly $schema: string } & T {
  return { $schema: currentSchemaUrl(formatId), ...value };
}

/** Reads `~/.phax/registry.json`. The pre-schema registry carries every fact phax needs. */
export const readRegistryFile: Reader<Registry> = (file, input) =>
  readPersisted(input, {
    format: "registry",
    label: "run registry",
    file,
    decodeCurrent: decodeRegistryFile,
    decodePreSchema: decodeRegistryPreSchema,
    fromCurrent: ({ $schema: _schema, ...registry }) => registry,
    fromPreSchema: ({ version: _version, ...registry }) => Either.right(registry),
  });

/** Reads a run's `run-status.json`. The pre-schema run status carries every fact phax needs. */
export const readRunStatusFile: Reader<RunStatus> = (file, input) =>
  readPersisted(input, {
    format: "run-status",
    label: "run status",
    file,
    decodeCurrent: decodeRunStatusFile,
    decodePreSchema: decodeRunStatusPreSchema,
    fromCurrent: ({ $schema: _schema, ...status }) => status,
    fromPreSchema: ({ version: _version, ...status }) => Either.right(status),
  });

/**
 * Reads a phase's `status.json`. A pre-schema phase status never recorded
 * `base`, the commit its branch was created from, so it is refused rather than
 * given one re-derived from git. A `$schema` status is read by the current
 * decoder only, so one written by 0.17.0–0.19.x, which lacks `base`, is
 * refused too.
 */
export const readPhaseStatusFile: Reader<PhaseStatus> = (file, input) =>
  readPersisted(input, {
    format: "phase-status",
    label: "phase status",
    file,
    decodeCurrent: decodePhaseStatusFile,
    decodePreSchema: decodePhaseStatusPreSchema,
    fromCurrent: ({ $schema: _schema, ...status }) => status,
    fromPreSchema: () => Either.left({ fact: "base" }),
  });

/** Reads a run's `phax-plan.json`. The pre-schema phax-plan carries every fact phax needs. */
export const readPhaxPlanFile: Reader<PhaxPlan> = (file, input) =>
  readPersisted(input, {
    format: "phax-plan",
    label: "phax-plan",
    file,
    decodeCurrent: decodePhaxPlanFile,
    decodePreSchema: decodePhaxPlanPreSchema,
    fromCurrent: ({ $schema: _schema, ...plan }) => plan,
    fromPreSchema: ({ version: _version, ...plan }) => Either.right(plan),
  });

/**
 * Reads a run's `compliance-review.json`. The pre-schema review carries every
 * fact phax needs.
 */
export const readComplianceReviewFile: Reader<ComplianceReview> = (file, input) =>
  readPersisted(input, {
    format: "compliance-review",
    label: "compliance review",
    file,
    decodeCurrent: decodeComplianceReviewFile,
    decodePreSchema: decodeComplianceReviewPreSchema,
    fromCurrent: ({ $schema: _schema, ...review }) => review,
    fromPreSchema: ({ version: _version, ...review }) => Either.right(review),
  });

/** Reads `docs/plans/approvals.json`. The pre-schema ledger carries every fact phax needs. */
export const readPlanApprovalsFile: Reader<PlanApprovals> = (file, input) =>
  readPersisted(input, {
    format: "plan-approvals",
    label: "plan approvals ledger",
    file,
    decodeCurrent: decodeApprovalRecordFile,
    decodePreSchema: decodePlanApprovalsPreSchema,
    fromCurrent: ({ $schema: _schema, ...ledger }) => ledger,
    fromPreSchema: ({ version: _version, ...ledger }) => Either.right(ledger),
  });

/** Reads `docs/specs/approvals.json`. The pre-schema ledger carries every fact phax needs. */
export const readSpecApprovalsFile: Reader<SpecApprovals> = (file, input) =>
  readPersisted(input, {
    format: "spec-approvals",
    label: "spec approvals ledger",
    file,
    decodeCurrent: decodeSpecApprovalRecordFile,
    decodePreSchema: decodeSpecApprovalsPreSchema,
    fromCurrent: ({ $schema: _schema, ...ledger }) => ledger,
    fromPreSchema: ({ version: _version, ...ledger }) => Either.right(ledger),
  });

/** Reads one plan's `docs/plans/approvals/<plan>.json`. Born with `$schema`. */
export const readPlanRecordFile: Reader<PlanRecord> = (file, input) =>
  readSchemaBornPersisted(input, {
    format: "plan-approval-record",
    label: "plan approval record",
    file,
    decodeCurrent: decodePlanRecordFile,
    fromCurrent: ({ $schema: _schema, ...record }) => record,
  });

/** Reads one spec's `docs/specs/approvals/<spec>.json`. Born with `$schema`. */
export const readSpecRecordFile: Reader<SpecRecord> = (file, input) =>
  readSchemaBornPersisted(input, {
    format: "spec-approval-record",
    label: "spec approval record",
    file,
    decodeCurrent: decodeSpecRecordFile,
    fromCurrent: ({ $schema: _schema, ...record }) => record,
  });

/** Reads a spec's JSON sidecar. The pre-schema sidecar carries every fact phax needs. */
export const readSpecDocumentFile: Reader<SpecDocument> = (file, input) =>
  readPersisted(input, {
    format: "spec-document",
    label: "spec document",
    file,
    decodeCurrent: decodeSpecDocumentFile,
    decodePreSchema: decodeSpecDocumentPreSchema,
    fromCurrent: ({ $schema: _schema, ...doc }) => doc,
    fromPreSchema: ({ version: _version, ...doc }) => Either.right(doc),
  });

/**
 * Reads a plan's JSON sidecar. A pre-schema sidecar never recorded
 * `completesSpec`: beside `sourceSpec: null` it steps to null, the only value
 * that variant allows; beside a spec path it is refused rather than given an
 * invented boolean. A `$schema` sidecar is read by the current decoder only, so
 * one written by 0.17.0–0.19.x, which lacks `completesSpec`, is refused too.
 */
export const readPlanDocumentFile: Reader<PlanDocument> = (file, input) =>
  readPersisted(input, {
    format: "plan-document",
    label: "plan document",
    file,
    decodeCurrent: decodePlanDocumentFile,
    decodePreSchema: decodePlanDocumentPreSchema,
    fromCurrent: ({ $schema: _schema, ...doc }) => doc,
    fromPreSchema: ({ version: _version, sourceSpec, ...doc }) =>
      sourceSpec === null
        ? Either.right({ ...doc, sourceSpec, completesSpec: null })
        : Either.left({ fact: "completesSpec" }),
  });

type GateStepResult = GateAttribution["steps"][number];

function isPassOrFail(step: { readonly result: string }): step is GateStepResult {
  return step.result === "pass" || step.result === "fail";
}

/**
 * Reads a phase's `gate-attribution.json`. It never carried a `version`: a
 * pre-schema attribution whose every step result is `pass` or `fail` is the
 * in-memory value as it is; any other is refused.
 */
export const readGateAttributionFile: Reader<GateAttribution> = (file, input) =>
  readPersisted(input, {
    format: "gate-attribution",
    label: "gate attribution",
    file,
    decodeCurrent: decodeGateAttributionFile,
    decodePreSchema: decodeGateAttributionPreSchema,
    fromCurrent: ({ $schema: _schema, ...attribution }) => attribution,
    fromPreSchema: ({ phase, steps }) =>
      steps.every(isPassOrFail)
        ? Either.right({ phase, steps })
        : Either.left({ fact: "a pass or fail result for every step" }),
  });

/**
 * The stamps an answer reader accepts: from the format's current stamp
 * (`current`) up to the running version (`running`), both included. Each
 * reader defaults to its format's `CURRENT_STAMPS` entry and `PHAX_RELEASE`;
 * tests inject both to play a development build.
 */
export interface AnswerBounds {
  readonly current: string;
  readonly running: string;
}

/**
 * The last release whose `gate-diagnostics` shape described only the file phax
 * saves. A stamp at or below it names that shape, never a gate step's answer.
 * A historical fact: it never moves at a release cut.
 */
const LAST_SAVED_FILE_ONLY_DIAGNOSTICS_RELEASE = "0.19.0";

/** Why a gate step's diagnostics document was not read. */
export type GateDiagnosticsAnswerError =
  | { readonly kind: "malformed"; readonly reason: string }
  | { readonly kind: "newer"; readonly message: string }
  | { readonly kind: "older"; readonly message: string };

function malformed(reason: string): Either.Either<never, GateDiagnosticsAnswerError> {
  return Either.left({ kind: "malformed", reason });
}

/**
 * Reads the parsed document a diagnostics gate step printed. Never throws. In
 * order:
 * 1. a non-object is malformed;
 * 2. a document without its own `$schema` key is malformed: there is no
 *    unversioned reading;
 * 3. a `$schema` that is not a `gate-diagnostics` schema URL is malformed;
 * 4. a stamp above `bounds.running` is refused as `newer`, by name;
 * 5. a stamp at or below `LAST_SAVED_FILE_ONLY_DIAGNOSTICS_RELEASE` is
 *    malformed: it names the saved file's shape;
 * 6. a stamp below `bounds.current` is refused as `older`, naming the URL
 *    this phax reads;
 * 7. a document the file decoder rejects is malformed, with the first
 *    violation.
 * The decoded document keeps only `diagnostics`: `$schema` and any extra key
 * are dropped.
 */
export function readGateDiagnosticsAnswer(
  input: unknown,
  bounds: AnswerBounds = { current: CURRENT_STAMPS["gate-diagnostics"], running: PHAX_RELEASE },
): Either.Either<GateDiagnosticsDocument, GateDiagnosticsAnswerError> {
  if (!isDocumentObject(input)) return malformed("the document is not a JSON object");
  if (!Object.hasOwn(input, "$schema")) return malformed("the document has no $schema");
  const named = parseSchemaUrl(input["$schema"]);
  if (named === undefined || named.formatId !== "gate-diagnostics") {
    return malformed(`$schema ${JSON.stringify(input["$schema"])} does not name gate-diagnostics`);
  }
  const { release } = named;
  if (compareReleases(release, bounds.running) > 0) {
    return Either.left({
      kind: "newer",
      message: `gate-diagnostics ${release} is newer than this phax (${bounds.running}) — upgrade phax to read it`,
    });
  }
  if (compareReleases(release, LAST_SAVED_FILE_ONLY_DIAGNOSTICS_RELEASE) <= 0) {
    return malformed(
      `gate-diagnostics ${release} names the saved file's shape, not a gate step's document`,
    );
  }
  if (compareReleases(release, bounds.current) < 0) {
    return Either.left({
      kind: "older",
      message: `gate-diagnostics ${release} is an older shape — this phax reads ${schemaUrl("gate-diagnostics", bounds.current)}`,
    });
  }
  const decoded = decodeGateDiagnosticsFile(input);
  if (Either.isLeft(decoded)) {
    return malformed(`schema mismatch: ${formatFirstViolation(decoded.left)}`);
  }
  return Either.right({ diagnostics: decoded.right.diagnostics });
}

/**
 * The release current when the `brief-answer` format was added. A stamp at or
 * below it names no brief-answer shape. A historical fact: it never moves at a
 * release cut.
 */
export const LAST_RELEASE_WITHOUT_BRIEF_ANSWER = "0.19.0";

/** Why a brief provider's answer was not read. */
export type BriefAnswerError =
  | { readonly kind: "schema"; readonly reason: string }
  | { readonly kind: "newer"; readonly reason: string }
  | { readonly kind: "older"; readonly reason: string }
  | { readonly kind: "shape"; readonly reason: string };

/**
 * Reads the parsed document a brief provider printed. Never throws. In order:
 * 1. a non-object is a `shape` error;
 * 2. a document without its own `$schema` key is a `schema` error: there is
 *    no unversioned reading;
 * 3. a `$schema` that is not a `brief-answer` schema URL is a `schema` error;
 * 4. a stamp above `bounds.running` is refused as `newer`, by name;
 * 5. a stamp at or below `LAST_RELEASE_WITHOUT_BRIEF_ANSWER` is a `schema`
 *    error: it names no known shape;
 * 6. a stamp below `bounds.current` is refused as `older`, naming the URL this
 *    phax reads;
 * 7. a document the decoder rejects is a `shape` error, with the first
 *    violation.
 * The decoded answer keeps only `guarantees`: `$schema` and any extra key are
 * dropped.
 */
export function readBriefAnswer(
  input: unknown,
  bounds: AnswerBounds = { current: CURRENT_STAMPS["brief-answer"], running: PHAX_RELEASE },
): Either.Either<BriefAnswer, BriefAnswerError> {
  if (!isDocumentObject(input)) {
    return Either.left({ kind: "shape", reason: "a brief-answer document is a JSON object" });
  }
  if (!Object.hasOwn(input, "$schema")) {
    return Either.left({ kind: "schema", reason: "a brief-answer document must carry $schema" });
  }
  const named = parseSchemaUrl(input["$schema"]);
  if (named === undefined || named.formatId !== "brief-answer") {
    return Either.left({
      kind: "schema",
      reason: `$schema ${JSON.stringify(input["$schema"])} does not name brief-answer`,
    });
  }
  const { release } = named;
  if (compareReleases(release, bounds.running) > 0) {
    return Either.left({
      kind: "newer",
      reason: `brief-answer ${release} is newer than this phax (${bounds.running}) — upgrade phax to read it`,
    });
  }
  if (compareReleases(release, LAST_RELEASE_WITHOUT_BRIEF_ANSWER) <= 0) {
    return Either.left({ kind: "schema", reason: `brief-answer ${release} has no known shape` });
  }
  if (compareReleases(release, bounds.current) < 0) {
    return Either.left({
      kind: "older",
      reason: `brief-answer ${release} is an older shape — this phax reads ${schemaUrl("brief-answer", bounds.current)}`,
    });
  }
  const decoded = decodeBriefAnswerFile(input);
  if (Either.isLeft(decoded)) {
    return Either.left({
      kind: "shape",
      reason: `schema mismatch: ${formatFirstViolation(decoded.left)}`,
    });
  }
  return Either.right({ guarantees: decoded.right.guarantees });
}

/**
 * The one-line reason a refused brief answer gives, in the run output, the
 * prompt and `phax brief`. Every line names the brief-answer URL this phax
 * reads: an `older` reason already carries it, and the other kinds append it.
 */
export function describeBriefAnswerError(error: BriefAnswerError): string {
  const reason =
    error.kind === "older"
      ? error.reason
      : `${error.reason}; this phax reads ${currentSchemaUrl("brief-answer")}`;
  return error.kind === "shape"
    ? `brief answer refused: ${reason}`
    : `brief answer refused at $schema: ${reason}`;
}

/** The two report formats, each read only under its own `$schema`. */
export type ReportFormatId = "gate-report" | "brief-report";

/**
 * Why a gate report or brief report was not read. `reads` is the `$schema`
 * URL the reader reads: the format at its current stamp.
 */
export type ReportError =
  | { readonly kind: "malformed"; readonly reads: string; readonly reason: string }
  | { readonly kind: "newer"; readonly reads: string; readonly message: string }
  | { readonly kind: "older"; readonly reads: string; readonly message: string };

/**
 * Reads the parsed document a report step or a brief provider printed, as
 * `format`. Never throws. In order:
 * 1. a non-object, or a document without its own `$schema` key, is
 *    malformed: there is no unversioned reading;
 * 2. a `$schema` that names any other format id, known or not, is malformed,
 *    naming that format and the URL this reader reads;
 * 3. a stamp above `bounds.running` is refused as `newer`, by name;
 * 4. a stamp below `bounds.current` is refused as `older`, naming the URL;
 * 5. a document the decoder rejects is malformed, with `describeReportIssue`'s
 *    line: the key path, the duplicate id or the file of a disordered pair.
 * The decoded document is returned whole, `$schema` included.
 */
function readReport<T>(
  format: ReportFormatId,
  decode: Decode<T>,
  input: unknown,
  bounds: AnswerBounds,
): Either.Either<T, ReportError> {
  const reads = schemaUrl(format, bounds.current);
  const malformedReport = (reason: string) =>
    Either.left<ReportError>({ kind: "malformed", reads, reason });
  if (!isDocumentObject(input)) return malformedReport(`a ${format} document is a JSON object`);
  if (!Object.hasOwn(input, "$schema")) {
    return malformedReport(`a ${format} document carries $schema`);
  }
  const named = parseSchemaUrl(input["$schema"]);
  if (named === undefined) {
    return malformedReport(`$schema ${JSON.stringify(input["$schema"])} is not a phax schema URL`);
  }
  if (named.formatId !== format) {
    return malformedReport(`${named.formatId} is not read by this phax — it reads ${reads}`);
  }
  const { release } = named;
  if (compareReleases(release, bounds.running) > 0) {
    return Either.left({
      kind: "newer",
      reads,
      message: `${format} ${release} is newer than this phax (${bounds.running}) — upgrade phax to read it`,
    });
  }
  if (compareReleases(release, bounds.current) < 0) {
    return Either.left({
      kind: "older",
      reads,
      message: `${format} ${release} is an older shape — this phax reads ${reads}`,
    });
  }
  const decoded = decode(input);
  if (Either.isLeft(decoded)) return malformedReport(describeReportIssue(decoded.left));
  return Either.right(decoded.right);
}

/**
 * Reads the parsed document a report step printed as a `gate-report`. See
 * `readReport` for the checks, in order.
 */
export function readGateReport(
  input: unknown,
  bounds: AnswerBounds = { current: CURRENT_STAMPS["gate-report"], running: PHAX_RELEASE },
): Either.Either<GateReportFile, ReportError> {
  return readReport("gate-report", decodeGateReportFile, input, bounds);
}

/**
 * Reads the parsed document a brief provider printed as a `brief-report`. See
 * `readReport` for the checks, in order.
 */
export function readBriefReport(
  input: unknown,
  bounds: AnswerBounds = { current: CURRENT_STAMPS["brief-report"], running: PHAX_RELEASE },
): Either.Either<BriefReportFile, ReportError> {
  return readReport("brief-report", decodeBriefReportFile, input, bounds);
}

/**
 * The one-line reason a report was not read. It always ends by naming the
 * URL the reader reads: a refused other format and an older shape already
 * do, and every other reason gets it appended.
 */
export function describeReportError(error: ReportError): string {
  const text = error.kind === "malformed" ? error.reason : error.message;
  return text.endsWith(error.reads) ? text : `${text}; this phax reads ${error.reads}`;
}

/** Reads a phase worktree's `.phax-context/brief-request.json`. Born with `$schema`. */
export const readBriefRequestFile: Reader<BriefRequest> = (file, input) =>
  readSchemaBornPersisted(input, {
    format: "brief-request",
    label: "brief request",
    file,
    decodeCurrent: decodeBriefRequestFile,
    fromCurrent: ({ $schema: _schema, ...request }) => request,
  });

/**
 * Reads a phase folder's `brief-NN.json`. Born with `$schema`. Only the
 * record's own `$schema` is dropped: its request and answer stay as recorded.
 */
export const readBriefRecordFile: Reader<BriefRecord> = (file, input) =>
  readSchemaBornPersisted(input, {
    format: "brief-record",
    label: "brief record",
    file,
    decodeCurrent: decodeBriefRecordFile,
    fromCurrent: ({ $schema: _schema, ...record }) => record,
  });

/**
 * Reads a phase's `file-reconciliation.json`. It never carried a `version`:
 * the pre-schema reconciliation is the in-memory value as it is.
 */
export const readPhaseFileReconciliationFile: Reader<PhaseFileReconciliation> = (file, input) =>
  readPersisted(input, {
    format: "phase-file-reconciliation",
    label: "phase file reconciliation",
    file,
    decodeCurrent: decodePhaseFileReconciliationFile,
    decodePreSchema: decodePhaseFileReconciliationPreSchema,
    fromCurrent: ({ $schema: _schema, ...reconciliation }) => reconciliation,
    fromPreSchema: Either.right,
  });

function fromRecordManifestFile({ $schema: _schema, ...manifest }: RecordManifestFile) {
  return manifest;
}

// A pre-schema manifest carries every fact phax needs; an absent `sourceSha`
// stays absent.
const readAuthoringRecordManifest: Reader<RecordManifest> = (file, input) =>
  readPersisted(input, {
    format: "authoring-record-manifest",
    label: "authoring record manifest",
    file,
    decodeCurrent: decodeRecordManifestFile,
    decodePreSchema: decodeAuthoringRecordManifestPreSchema,
    fromCurrent: fromRecordManifestFile,
    fromPreSchema: ({ version: _version, ...manifest }) => Either.right(manifest),
  });

function readPhaseRecordManifestAs(label: string): Reader<RecordManifest> {
  return (file, input) =>
    readPersisted(input, {
      format: "phase-record-manifest",
      label,
      file,
      decodeCurrent: decodeRecordManifestFile,
      decodePreSchema: decodePhaseRecordManifestPreSchema,
      fromCurrent: fromRecordManifestFile,
      fromPreSchema: ({ version: _version, ...manifest }) => Either.right(manifest),
    });
}

const readPhaseRecordManifest = readPhaseRecordManifestAs("phase record manifest");

// A non-object names no kind; it fails before either decoder runs.
const readAnyRecordManifest = readPhaseRecordManifestAs("record manifest");

/**
 * Reads any `record.json` on phax/records/v1. A `$schema` manifest is read by
 * the file union. A manifest without `$schema` is read by the authoring
 * pre-schema decoder when its `kind` is "authoring", and by the phase
 * pre-schema decoder otherwise, so a version-1 phase manifest is refused as
 * not in the pre-schema shape.
 */
export const readRecordManifestFile: Reader<RecordManifest> = (file, input) => {
  if (!isDocumentObject(input)) return readAnyRecordManifest(file, input);
  return input["kind"] === "authoring"
    ? readAuthoringRecordManifest(file, input)
    : readPhaseRecordManifest(file, input);
};
