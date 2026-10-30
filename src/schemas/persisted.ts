// The bridge between a persisted file and phax's in-memory value: the only
// src/ module that imports the frozen decoders under src/schemas/history/,
// and, with each declaring module, the only one that
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
// then stepped to the current shape. Six formats also read an older
// `$schema` shape: a phax-plan stamped below its current stamp is read by the
// frozen 0.26.0 decoder when stamped 0.26.0 or later, and below that by the
// frozen 0.17.0 decoder and lifted with `mode: "headless"` and `oracle: null`
// on every phase, never given `testLines`, and `readPhaxPlanFile` reports the
// shape it read; an
// authoring record manifest stamped below its current
// stamp is read by the frozen 0.17.0 decoder, then stepped to the current
// shape, so the records already on phax/records/v1 stay listed; a spec or plan
// approval record stamped below its current stamp is read by its frozen 0.19.0
// decoder and lifted to an unattributed approval; a spec document stamped
// below its current stamp is read by the frozen 0.25.0 decoder when stamped
// 0.25.0 or later, by the frozen 0.17.0 decoder below that, and one written
// before `$schema` by the pre-schema decoder; each lifts every surface element
// with the summary placeholder, the two oldest also by the author's rationale
// marker (`liftMarkedQuestions`); a plan document stamped
// below its current stamp is read by the frozen 0.26.0 decoder when stamped
// 0.26.0 or later, by the frozen 0.25.0 decoder when stamped 0.25.0 or later
// (its `modelReason` carried over as `assignmentReason`), and by the frozen
// 0.20.0 decoder below that (empty preamble questions and
// `assignmentReason: null`); each then lifts every phase's `testStrategy`
// string through the test line grammar, or records the first departing line
// as a refused lift, which still reads. A run status or registry stamped
// below its current stamp is read by its frozen 0.17.0 decoder, and a phase
// status by its frozen 0.20.0 decoder, lifted with `mode: "headless"` and
// `stop: null`. A compliance review stamped below its current stamp is read by
// its frozen 0.17.0 decoder, and one written before `$schema` by the pre-schema
// decoder; neither gains a ledger (`unplannedChanges`, `unmetPromises`), and
// `readComplianceReviewFile` reports the shape it read. A phase, authoring or
// decision record manifest or an interactive session stamped below its current stamp is read by the frozen
// decoder of the release that wrote its shape, and every Vibe usage it carries
// lifts to unavailable (`liftFrozenTokenUsage`). `readDocumentSidecar`
// also reports the shape a spec or plan sidecar is stamped at. A format born with `$schema`
// has no pre-schema decoder, so a document of it without `$schema` is refused. On the
// way out, `withSchemaUrl` stamps the `$schema` a writer puts first with the
// format's current stamp (`currentSchemaUrl`, from `CURRENT_STAMPS`).
//
// It also reads the reports providers print: the `gate-report` a report step
// prints (`readGateReport`) and the `brief-report` a brief provider prints
// (`readBriefReport`) and the `architecture-report` an architecture provider
// prints (`readArchitectureReport`). Each reads only stamps from its format's current stamp
// up to the running version, refuses an older shape and any other format by
// name, and names the URL it reads.
import { Array as Arr, Either, type ParseResult } from "effect";
import {
  departureMessage,
  readTestStrategyText,
  type TestLineDeparture,
} from "../domain/plan/testLineGrammar.js";
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
  decodeBriefRecordFile,
  decodeBriefRequestFile,
  type BriefRecord,
  type BriefRequest,
} from "./brief.js";
import { decodeArchitectureReportFile, type ArchitectureReportFile } from "./architecture.js";
import { decodeBriefReportFile, type BriefReportFile } from "./briefReport.js";
import { decodeCodeReviewFile, type CodeReview } from "./codeReview.js";
import {
  decodeComplianceReviewFile,
  type AnyShapeComplianceReview,
  type ComplianceReview,
  type ComplianceReviewFile,
} from "./complianceReview.js";
import { decodeCostLedgerFile, type CostLedger } from "./costLedger.js";
import { decodeDecisionRecordManifestFile, liftFrozenDecisionManifest } from "./decisionRecord.js";
import { decodeReviewRecordManifestFile } from "./reviewRecord.js";
import { decodeFirstReadingFile, type FirstReadingFile } from "./firstReading.js";
import { formatFirstViolation, formatPlanDocumentViolation } from "./formatError.js";
import { decodeGateAttributionFile, type GateAttribution } from "./gateAttribution.js";
import { decodeGateReportFile, type GateReportFile } from "./gateReport.js";
import { decodeDecideVerdictsFile, type DecideVerdicts } from "./decideVerdicts.js";
import {
  decodePlanHandDecisionAnswerFile,
  decodeSpecHandDecisionAnswerFile,
  type HandDecisionAnswer,
} from "./handDecisionAnswer.js";
import { decodeAuthoringRecordManifestV0_17_0 } from "./history/authoring-record-manifest/0.17.0.js";
import { decodeAuthoringRecordManifestV0_23_0 } from "./history/authoring-record-manifest/0.23.0.js";
import { decodeAuthoringRecordManifestPreSchema } from "./history/authoring-record-manifest/pre-schema.js";
import { decodeComplianceReviewV0_17_0 } from "./history/compliance-review/0.17.0.js";
import {
  decodeComplianceReviewPreSchema,
  type ComplianceReviewPreSchema,
} from "./history/compliance-review/pre-schema.js";
import { decodeCostLedgerV0_25_0 } from "./history/cost-ledger/0.25.0.js";
import { decodeCostLedgerV0_26_0 } from "./history/cost-ledger/0.26.0.js";
import { decodeDecisionRecordManifestV0_25_0 } from "./history/decision-record-manifest/0.25.0.js";
import { decodeDecisionRecordManifestV0_28_0 } from "./history/decision-record-manifest/0.28.0.js";
import { decodeGateAttributionV0_26_0 } from "./history/gate-attribution/0.26.0.js";
import { decodeGateAttributionPreSchema } from "./history/gate-attribution/pre-schema.js";
import { decodePhaseFileReconciliationV0_17_0 } from "./history/phase-file-reconciliation/0.17.0.js";
import { decodePhaseFileReconciliationPreSchema } from "./history/phase-file-reconciliation/pre-schema.js";
import { decodeInteractiveSessionV0_26_0 } from "./history/interactive-session/0.26.0.js";
import { decodePhaseRecordManifestV0_17_0 } from "./history/phase-record-manifest/0.17.0.js";
import { decodePhaseRecordManifestV0_26_0 } from "./history/phase-record-manifest/0.26.0.js";
import { decodePhaseRecordManifestPreSchema } from "./history/phase-record-manifest/pre-schema.js";
import { decodePhaseStatusV0_20_0 } from "./history/phase-status/0.20.0.js";
import { decodePhaseStatusPreSchema } from "./history/phase-status/pre-schema.js";
import { decodePhaxPlanV0_17_0, type PhaxPlanV0_17_0 } from "./history/phax-plan/0.17.0.js";
import { decodePhaxPlanV0_26_0 } from "./history/phax-plan/0.26.0.js";
import { decodePhaxPlanV0_28_0 } from "./history/phax-plan/0.28.0.js";
import { decodePhaxPlanPreSchema, type PhaxPlanPreSchema } from "./history/phax-plan/pre-schema.js";
import { decodePlanApprovalRecordV0_19_0 } from "./history/plan-approval-record/0.19.0.js";
import { decodePlanApprovalsPreSchema } from "./history/plan-approvals/pre-schema.js";
import {
  decodePlanDocumentV0_20_0,
  type PlanDocumentV0_20_0,
} from "./history/plan-document/0.20.0.js";
import {
  decodePlanDocumentV0_25_0,
  type PlanDocumentV0_25_0,
} from "./history/plan-document/0.25.0.js";
import {
  decodePlanDocumentV0_26_0,
  type PlanDocumentV0_26_0,
} from "./history/plan-document/0.26.0.js";
import {
  decodePlanDocumentV0_28_0,
  type PlanDocumentV0_28_0,
} from "./history/plan-document/0.28.0.js";
import {
  decodePlanDocumentPreSchema,
  type PlanDocumentPreSchema,
} from "./history/plan-document/pre-schema.js";
import { decodeRegistryV0_17_0 } from "./history/registry/0.17.0.js";
import { decodeRegistryPreSchema } from "./history/registry/pre-schema.js";
import { decodeRunStatusV0_17_0 } from "./history/run-status/0.17.0.js";
import { decodeRunStatusPreSchema } from "./history/run-status/pre-schema.js";
import { decodeSpecApprovalRecordV0_19_0 } from "./history/spec-approval-record/0.19.0.js";
import { decodeSpecApprovalsPreSchema } from "./history/spec-approvals/pre-schema.js";
import {
  decodeSpecDocumentV0_17_0,
  type SpecDocumentV0_17_0,
} from "./history/spec-document/0.17.0.js";
import {
  decodeSpecDocumentV0_25_0,
  type SpecDocumentV0_25_0,
} from "./history/spec-document/0.25.0.js";
import {
  decodeSpecDocumentV0_27_0,
  type SpecDocumentV0_27_0,
} from "./history/spec-document/0.27.0.js";
import {
  decodeSpecDocumentPreSchema,
  type SpecDocumentPreSchema,
} from "./history/spec-document/pre-schema.js";
import { decodeInteractiveHandoffFile, type InteractiveHandoffFile } from "./interactiveHandoff.js";
import { decodeInteractiveSessionFile, type InteractiveSession } from "./interactiveSession.js";
import { decodeOracleRequestFile, type OracleRequest } from "./oracleRequest.js";
import {
  decodePhaxPlanFile,
  type PhaxPlan,
  type PhaxPlanFile,
  type PhaxPlanPhase,
} from "./phaxPlan.js";
import {
  decodePlanDocumentFile,
  type PlanDocument,
  type PlanDocumentFile,
} from "./planDocument.js";
import { liftMarkedQuestions } from "./questions.js";
import {
  decodePhaseFileReconciliationFile,
  type PhaseFileReconciliation,
} from "./reconciliation.js";
import { decodeRegistryFile, type Registry } from "./registry.js";
import { describeReportIssue } from "./report.js";
import { CURRENT_STAMPS, PHAX_RELEASE } from "./release.js";
import { decodeCodeReviewV0_29_0 } from "./history/code-review/0.29.0.js";
import { decodeReviewStopV0_26_0 } from "./history/review-stop/0.26.0.js";
import { decodeReviewStopFile, type ReviewStop } from "./reviewStop.js";
import { liftFrozenTokenUsage } from "./runRecord.js";
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
import {
  decodeSpecDocumentFile,
  SURFACE_SUMMARY_PLACEHOLDER,
  type SpecDocument,
  type SpecDocumentFile,
} from "./specDocument.js";
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
  /** How the current decoder's first violation reads; `formatFirstViolation` when absent. */
  readonly formatViolation?: ViolationFormatter;
}

type ViolationFormatter = (input: unknown, err: ParseResult.ParseError) => string;

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
    readonly formatViolation?: ViolationFormatter;
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
    const message =
      spec.formatViolation === undefined
        ? formatFirstViolation(current.left)
        : spec.formatViolation(input, current.left);
    return Either.left(readError(file, format, message));
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

/**
 * Reads `~/.phax/registry.json`. The pre-schema registry carries every fact
 * phax needs. One stamped below the format's current stamp is read by the
 * frozen 0.17.0 decoder and lifted unchanged: its run states are a subset of
 * the current ones.
 */
export const readRegistryFile: Reader<Registry> = (file, input) => {
  if (isDocumentObject(input) && isStampedBelowCurrent("registry", input)) {
    const older = decodeRegistryV0_17_0(input);
    if (Either.isLeft(older)) {
      return Either.left(readError(file, "registry", formatFirstViolation(older.left)));
    }
    const { $schema: _schema, ...registry } = older.right;
    return Either.right(registry);
  }
  return readPersisted(input, {
    format: "registry",
    label: "run registry",
    file,
    decodeCurrent: decodeRegistryFile,
    decodePreSchema: decodeRegistryPreSchema,
    fromCurrent: ({ $schema: _schema, ...registry }) => registry,
    fromPreSchema: ({ version: _version, ...registry }) => Either.right(registry),
  });
};

/**
 * Reads a run's `run-status.json`. The pre-schema run status carries every
 * fact phax needs. One stamped below the format's current stamp is read by
 * the frozen 0.17.0 decoder and lifted with `hold: { selection: "none" }`: its
 * states are a subset of the current ones, and no earlier phax could hold a
 * run. A current-stamp document without `hold` stays refused.
 */
export const readRunStatusFile: Reader<RunStatus> = (file, input) => {
  if (isDocumentObject(input) && isStampedBelowCurrent("run-status", input)) {
    const older = decodeRunStatusV0_17_0(input);
    if (Either.isLeft(older)) {
      return Either.left(readError(file, "run-status", formatFirstViolation(older.left)));
    }
    const { $schema: _schema, ...status } = older.right;
    return Either.right({ ...status, hold: { selection: "none" } });
  }
  return readPersisted(input, {
    format: "run-status",
    label: "run status",
    file,
    decodeCurrent: decodeRunStatusFile,
    decodePreSchema: decodeRunStatusPreSchema,
    fromCurrent: ({ $schema: _schema, ...status }) => status,
    fromPreSchema: ({ version: _version, ...status }) =>
      Either.right({ ...status, hold: { selection: "none" } }),
  });
};

/**
 * Reads a phase's `status.json`. A pre-schema phase status never recorded
 * `base`, the commit its branch was created from, so it is refused rather than
 * given one re-derived from git. A status stamped below the format's current
 * stamp is read by the frozen 0.20.0 decoder, so one written by 0.17.0–0.19.x,
 * which lacks `base`, is refused too; one it reads is lifted with
 * `mode: "headless"` and `stop: null`, because no phax before it could run an
 * interactive phase or stop. A phase awaiting review enters that state only
 * with its waiting stop recorded, so one without it is refused.
 */
export const readPhaseStatusFile: Reader<PhaseStatus> = (file, input) =>
  Either.flatMap(readPhaseStatusShape(file, input), (status) =>
    status.state === "awaiting_review" && status.stop?.status !== "waiting"
      ? Either.left(
          readError(file, "phase-status", "a phase awaiting review records no waiting stop"),
        )
      : Either.right(status),
  );

const readPhaseStatusShape: Reader<PhaseStatus> = (file, input) => {
  if (isDocumentObject(input) && isStampedBelowCurrent("phase-status", input)) {
    const older = decodePhaseStatusV0_20_0(input);
    if (Either.isLeft(older)) {
      return Either.left(readError(file, "phase-status", formatFirstViolation(older.left)));
    }
    const { $schema: _schema, ...status } = older.right;
    return Either.right({ ...status, mode: "headless", stop: null });
  }
  return readPersisted(input, {
    format: "phase-status",
    label: "phase status",
    file,
    decodeCurrent: decodePhaseStatusFile,
    decodePreSchema: decodePhaseStatusPreSchema,
    fromCurrent: ({ $schema: _schema, ...status }) => status,
    fromPreSchema: () => Either.left({ fact: "base" }),
  });
};

/** The shape a run's `phax-plan.json` was read in. */
export type PhaxPlanShape = "current" | "0.26.0" | "0.17.0" | "pre-schema";

/**
 * The plan every shape of `phax-plan.json` satisfies: its phases carry no
 * `testLines`, because a plan an older phax extracted never stated them. The
 * display and sizing readers take it, so none is told a past run tested nothing.
 */
export interface AnyShapePhaxPlan {
  readonly run: PhaxPlan["run"];
  readonly phases: Arr.NonEmptyReadonlyArray<Omit<PhaxPlanPhase, "testLines">>;
}

/** A run's `phax-plan.json` as read: the current plan, or an older one without `testLines`. */
export type PhaxPlanRead =
  | { readonly shape: "current"; readonly plan: PhaxPlan }
  | { readonly shape: Exclude<PhaxPlanShape, "current">; readonly plan: AnyShapePhaxPlan };

/**
 * Lifts the phases of a phax-plan older than `mode`: each gains
 * `mode: "headless"` and `oracle: null` after `optionalFilesToEdit`. Every
 * phase an older phax ran was headless, and no oracle phase existed. No phase
 * gains `testLines`.
 */
function liftPhaxPlanPhases(phases: PhaxPlanV0_17_0["phases"]): AnyShapePhaxPlan["phases"] {
  return Arr.map(phases, (phase) => ({
    id: phase.id,
    title: phase.title,
    model: phase.model,
    effort: phase.effort,
    planMarkdownAnchor: phase.planMarkdownAnchor,
    plannedFilesToCreate: phase.plannedFilesToCreate,
    plannedFilesToEdit: phase.plannedFilesToEdit,
    optionalFilesToEdit: phase.optionalFilesToEdit,
    mode: "headless",
    oracle: null,
    commit: phase.commit,
  }));
}

/**
 * Reads a run's `phax-plan.json`, reporting the shape it read: a file at the
 * current stamp by the current decoder (`current`); one stamped 0.28.0 or
 * later, below the current stamp, by the frozen 0.28.0 decoder, whose plan is
 * the current in-memory one (`current` too, so an in-flight run resumes); one
 * stamped 0.26.0 or later by the frozen 0.26.0 decoder (`0.26.0`); one
 * stamped lower by the frozen 0.17.0 decoder (`0.17.0`); and one without
 * `$schema` by the pre-schema decoder (`pre-schema`). The two oldest are lifted
 * with `liftPhaxPlanPhases`; no older shape is given `testLines`. A caller that
 * hands the plan to a run accepts only `current`; one that only displays or
 * sizes it takes `.plan`, an `AnyShapePhaxPlan`, whatever the shape.
 */
export const readPhaxPlanFile: Reader<PhaxPlanRead> = (file, input) => {
  if (isDocumentObject(input) && isStampedBelowCurrent("phax-plan", input)) {
    // `isStampedBelowCurrent` has parsed the stamp, so the release is there.
    const release = parseSchemaUrl(input["$schema"])?.release ?? "0.0.0";
    if (compareReleases(release, "0.28.0") >= 0) {
      const v0_28_0 = decodePhaxPlanV0_28_0(input);
      if (Either.isLeft(v0_28_0)) {
        return Either.left(readError(file, "phax-plan", formatFirstViolation(v0_28_0.left)));
      }
      const { $schema: _schema, ...plan } = v0_28_0.right;
      return Either.right({ shape: "current", plan });
    }
    if (compareReleases(release, "0.26.0") >= 0) {
      const v0_26_0 = decodePhaxPlanV0_26_0(input);
      if (Either.isLeft(v0_26_0)) {
        return Either.left(readError(file, "phax-plan", formatFirstViolation(v0_26_0.left)));
      }
      const { $schema: _schema, ...plan } = v0_26_0.right;
      return Either.right({ shape: "0.26.0", plan });
    }
    const older = decodePhaxPlanV0_17_0(input);
    if (Either.isLeft(older)) {
      return Either.left(readError(file, "phax-plan", formatFirstViolation(older.left)));
    }
    const { $schema: _schema, run, phases } = older.right;
    return Either.right({
      shape: "0.17.0",
      plan: { run, phases: liftPhaxPlanPhases(phases) },
    });
  }
  return readPersisted<PhaxPlanFile, PhaxPlanPreSchema, PhaxPlanRead>(input, {
    format: "phax-plan",
    label: "phax-plan",
    file,
    decodeCurrent: decodePhaxPlanFile,
    decodePreSchema: decodePhaxPlanPreSchema,
    fromCurrent: ({ $schema: _schema, ...plan }) => ({ shape: "current", plan }),
    fromPreSchema: ({ run, phases }) =>
      Either.right({ shape: "pre-schema", plan: { run, phases: liftPhaxPlanPhases(phases) } }),
  });
};

/**
 * A compliance review as read, tagged with the shape it was written in. An
 * older shape has no ledger: it is never lifted with empty ones, because that
 * would invent the fact that its run had no unplanned change and no unmet
 * promise. A reader that needs a ledger refuses the older shapes by name.
 */
export type ComplianceReviewRead =
  | { readonly shape: "current"; readonly review: ComplianceReview }
  | { readonly shape: "0.17.0" | "pre-schema"; readonly review: AnyShapeComplianceReview };

/**
 * Reads a run's `compliance-review.json`. One stamped below the format's
 * current stamp is read by the frozen 0.17.0 decoder, and one written before
 * `$schema` by the pre-schema decoder; neither gains a ledger. The read
 * reports the shape it found.
 */
export const readComplianceReviewFile: Reader<ComplianceReviewRead> = (file, input) => {
  if (isDocumentObject(input) && isStampedBelowCurrent("compliance-review", input)) {
    const older = decodeComplianceReviewV0_17_0(input);
    if (Either.isLeft(older)) {
      return Either.left(readError(file, "compliance-review", formatFirstViolation(older.left)));
    }
    const { $schema: _schema, ...review } = older.right;
    return Either.right({ shape: "0.17.0", review });
  }
  return readPersisted<ComplianceReviewFile, ComplianceReviewPreSchema, ComplianceReviewRead>(
    input,
    {
      format: "compliance-review",
      label: "compliance review",
      file,
      decodeCurrent: decodeComplianceReviewFile,
      decodePreSchema: decodeComplianceReviewPreSchema,
      fromCurrent: ({ $schema: _schema, ...review }) => ({ shape: "current", review }),
      fromPreSchema: ({ version: _version, ...review }) =>
        Either.right({ shape: "pre-schema", review }),
    },
  );
};

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

// An approval record stamped below its format's current stamp was written
// before phax named the approver: it is read by the frozen 0.19.0 decoder and
// lifted to `approvedBy: { kind: "unattributed" }`, never to an operator. The
// file itself is never rewritten by a read.

/** Reads one plan's `docs/plans/approvals/<plan>.json`. Born with `$schema`. */
export const readPlanRecordFile: Reader<PlanRecord> = (file, input) => {
  if (isDocumentObject(input) && isStampedBelowCurrent("plan-approval-record", input)) {
    const older = decodePlanApprovalRecordV0_19_0(input);
    if (Either.isLeft(older)) {
      return Either.left(readError(file, "plan-approval-record", formatFirstViolation(older.left)));
    }
    const { $schema: _schema, ...record } = older.right;
    return Either.right({ ...record, approvedBy: { kind: "unattributed" } });
  }
  return readSchemaBornPersisted(input, {
    format: "plan-approval-record",
    label: "plan approval record",
    file,
    decodeCurrent: decodePlanRecordFile,
    fromCurrent: ({ $schema: _schema, ...record }) => record,
  });
};

/** Reads one spec's `docs/specs/approvals/<spec>.json`. Born with `$schema`. */
export const readSpecRecordFile: Reader<SpecRecord> = (file, input) => {
  if (isDocumentObject(input) && isStampedBelowCurrent("spec-approval-record", input)) {
    const older = decodeSpecApprovalRecordV0_19_0(input);
    if (Either.isLeft(older)) {
      return Either.left(readError(file, "spec-approval-record", formatFirstViolation(older.left)));
    }
    const { $schema: _schema, ...record } = older.right;
    return Either.right({ ...record, approvedBy: { kind: "unattributed" } });
  }
  return readSchemaBornPersisted(input, {
    format: "spec-approval-record",
    label: "spec approval record",
    file,
    decodeCurrent: decodeSpecRecordFile,
    fromCurrent: ({ $schema: _schema, ...record }) => record,
  });
};

// A spec or plan sidecar stamped below its format's current stamp, or written
// before `$schema`, is read by its frozen decoder and lifted to the current
// in-memory document; the file itself is never rewritten by a read.

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * A spec document in its 0.17.0 shape, as a 0.17.0 sidecar or one written
 * before `$schema` carried it: no `$schema`, no `version`.
 */
export type SpecDocumentV0_17_0Value = Omit<SpecDocumentV0_17_0, "$schema">;

/**
 * A spec document in its 0.25.0 shape, as a 0.25.0 sidecar carried it: surface
 * elements with no `summary`, no `$schema`.
 */
export type SpecDocumentV0_25_0Value = Omit<SpecDocumentV0_25_0, "$schema">;

/**
 * A spec document in its 0.27.0 shape, as a 0.27.0 sidecar carried it: the
 * current in-memory document under a release-pattern `$schema`, which is dropped.
 */
export type SpecDocumentV0_27_0Value = Omit<SpecDocumentV0_27_0, "$schema">;

/**
 * A plan document in its 0.20.0 shape, as a 0.20.0 sidecar or one written
 * before `$schema` with `sourceSpec: null` carried it (its `completesSpec`
 * null): no `$schema`, no `version`.
 */
export type PlanDocumentV0_20_0Value = DistributiveOmit<PlanDocumentV0_20_0, "$schema">;

/**
 * A plan document in its 0.25.0 shape, as a 0.25.0 sidecar carried it: phases
 * with `modelReason`, no `$schema`, no `version`.
 */
export type PlanDocumentV0_25_0Value = DistributiveOmit<PlanDocumentV0_25_0, "$schema">;

/**
 * A plan document in its 0.26.0 shape, as a 0.26.0 sidecar carried it: each
 * phase's `testStrategy` a string, no `$schema`, no `version`.
 */
export type PlanDocumentV0_26_0Value = DistributiveOmit<PlanDocumentV0_26_0, "$schema">;

/**
 * A plan document in its 0.28.0 shape, as a 0.28.0 sidecar carried it: the
 * current in-memory document under a release-pattern `$schema`, which is dropped.
 */
export type PlanDocumentV0_28_0Value = DistributiveOmit<PlanDocumentV0_28_0, "$schema">;

/**
 * An older plan document lifted to the current in-memory shape, or the reason
 * it cannot be: every phase's `testStrategy` string is read as test lines, and
 * the first phase in plan order holding a departure refuses the lift with its
 * first departure. A refused lift is not a read error: the sidecar still reads.
 */
export type PlanDocumentLift =
  | { readonly kind: "lifted"; readonly document: PlanDocument }
  | {
      readonly kind: "refused";
      readonly phase: string;
      readonly departure: TestLineDeparture;
    };

/**
 * A spec sidecar as read: the document at the current in-memory shape, and
 * the shape the file is stamped at. A sidecar below the current shape also
 * carries the value its frozen decoder read.
 */
export type SpecDocumentSidecar =
  | { readonly kind: "spec"; readonly shape: "current"; readonly document: SpecDocument }
  | {
      readonly kind: "spec";
      readonly shape: "0.27.0";
      readonly document: SpecDocument;
      readonly older: SpecDocumentV0_27_0Value;
    }
  | {
      readonly kind: "spec";
      readonly shape: "0.25.0";
      readonly document: SpecDocument;
      readonly older: SpecDocumentV0_25_0Value;
    }
  | {
      readonly kind: "spec";
      readonly shape: "0.17.0" | "pre-schema";
      readonly document: SpecDocument;
      readonly older: SpecDocumentV0_17_0Value;
    };

/**
 * A plan sidecar as read, and the shape the file is stamped at: the document
 * at the current shape, or, below it, the value its frozen decoder read and
 * its lift to the current in-memory shape.
 */
export type PlanDocumentSidecar =
  | { readonly kind: "plan"; readonly shape: "current"; readonly document: PlanDocument }
  | {
      readonly kind: "plan";
      readonly shape: "0.28.0";
      readonly lift: PlanDocumentLift;
      readonly older: PlanDocumentV0_28_0Value;
    }
  | {
      readonly kind: "plan";
      readonly shape: "0.26.0";
      readonly lift: PlanDocumentLift;
      readonly older: PlanDocumentV0_26_0Value;
    }
  | {
      readonly kind: "plan";
      readonly shape: "0.25.0";
      readonly lift: PlanDocumentLift;
      readonly older: PlanDocumentV0_25_0Value;
    }
  | {
      readonly kind: "plan";
      readonly shape: "0.20.0" | "pre-schema";
      readonly lift: PlanDocumentLift;
      readonly older: PlanDocumentV0_20_0Value;
    };

export type DocumentSidecar = SpecDocumentSidecar | PlanDocumentSidecar;

// An older spec recorded no summary: each surface element is rebuilt in the
// current key order with the placeholder.
function liftSurface(surface: SpecDocumentV0_25_0Value["surface"]): SpecDocument["surface"] {
  return Arr.map(surface, (element) => ({
    surface: element.surface,
    summary: SURFACE_SUMMARY_PLACEHOLDER,
    binding: element.binding,
    before: element.before,
    after: element.after,
  }));
}

// The marker lift: a question whose rationale opens with the author's marker
// is arbitrated with a lifted verdict; every other question stays open.
function liftSpecDocument(older: SpecDocumentV0_17_0Value): SpecDocument {
  return {
    ...older,
    surface: liftSurface(older.surface),
    ...liftMarkedQuestions(older.openQuestions),
  };
}

// A 0.25.0 spec already carries its questions, kept as recorded.
function liftSpecDocumentV0_25_0(older: SpecDocumentV0_25_0Value): SpecDocument {
  return { ...older, surface: liftSurface(older.surface) };
}

/**
 * Steps a plan document older than `modelReason` to the 0.26.0 shape: each
 * phase gains `mode: "headless"`, `oracle: null` and `assignmentReason: null`,
 * rebuilt in the 0.26.0 key order, and the preamble, which carried no
 * questions, gets both arrays empty. This is the value phax 0.26.0 and 0.27.0
 * read such a sidecar as, and rendered.
 */
export function planDocumentV0_20_0AsV0_26_0(
  older: PlanDocumentV0_20_0Value,
): PlanDocumentV0_26_0Value {
  return {
    ...older,
    preamble: { ...older.preamble, openQuestions: [], arbitratedQuestions: [] },
    phases: Arr.map(older.phases, (phase) => ({
      id: phase.id,
      title: phase.title,
      objective: phase.objective,
      detailedInstructions: phase.detailedInstructions,
      planMarkdownAnchor: phase.planMarkdownAnchor,
      plannedFilesToCreate: phase.plannedFilesToCreate,
      plannedFilesToEdit: phase.plannedFilesToEdit,
      optionalFilesToEdit: phase.optionalFilesToEdit,
      mode: "headless",
      oracle: null,
      boundaryContracts: phase.boundaryContracts,
      testStrategy: phase.testStrategy,
      implementationOrder: phase.implementationOrder,
      excludedScope: phase.excludedScope,
      verification: phase.verification,
      expectedHandoff: phase.expectedHandoff,
      commit: phase.commit,
      assignmentReason: null,
      model: phase.model,
      effort: phase.effort,
    })),
  };
}

/**
 * Steps a 0.25.0 plan document to the 0.26.0 shape: `modelReason` becomes
 * `assignmentReason`, and each phase gains `mode: "headless"` and
 * `oracle: null`, rebuilt in the 0.26.0 key order. No phax before mode and
 * oracle ran an interactive or an oracle phase. Its preamble questions are
 * kept as recorded.
 */
function planDocumentV0_25_0AsV0_26_0(older: PlanDocumentV0_25_0Value): PlanDocumentV0_26_0Value {
  return {
    ...older,
    phases: Arr.map(older.phases, (phase) => ({
      id: phase.id,
      title: phase.title,
      objective: phase.objective,
      detailedInstructions: phase.detailedInstructions,
      planMarkdownAnchor: phase.planMarkdownAnchor,
      plannedFilesToCreate: phase.plannedFilesToCreate,
      plannedFilesToEdit: phase.plannedFilesToEdit,
      optionalFilesToEdit: phase.optionalFilesToEdit,
      mode: "headless",
      oracle: null,
      boundaryContracts: phase.boundaryContracts,
      testStrategy: phase.testStrategy,
      implementationOrder: phase.implementationOrder,
      excludedScope: phase.excludedScope,
      verification: phase.verification,
      expectedHandoff: phase.expectedHandoff,
      commit: phase.commit,
      assignmentReason: phase.modelReason,
      model: phase.model,
      effort: phase.effort,
    })),
  };
}

/**
 * Lifts a 0.26.0 plan document to the current in-memory shape: every phase's
 * `testStrategy` string is read as test lines (`readTestStrategyText`), in
 * its place. The first phase in plan order with a departure refuses the lift,
 * naming its first departure; nothing else changes.
 */
export function liftPlanDocumentV0_26_0(older: PlanDocumentV0_26_0Value): PlanDocumentLift {
  const readings = Arr.map(older.phases, (phase) => readTestStrategyText(phase.testStrategy));
  for (const [i, reading] of readings.entries()) {
    const [departure] = reading.departures;
    if (departure !== undefined) {
      return { kind: "refused", phase: older.phases[i]?.id ?? `phases[${String(i)}]`, departure };
    }
  }
  const phases = Arr.map(older.phases, (phase, i) => ({
    ...phase,
    testStrategy: (readings[i]?.lines ?? []).map(({ line }) => line),
  }));
  return { kind: "lifted", document: { ...older, phases } };
}

function readSpecDocumentSidecar(
  file: string,
  input: unknown,
): Either.Either<SpecDocumentSidecar, PersistedReadError> {
  if (isDocumentObject(input) && isStampedBelowCurrent("spec-document", input)) {
    // `isStampedBelowCurrent` has parsed the stamp, so the release is there.
    const release = parseSchemaUrl(input["$schema"])?.release ?? "0.0.0";
    if (compareReleases(release, "0.27.0") >= 0) {
      const frozen = decodeSpecDocumentV0_27_0(input);
      if (Either.isLeft(frozen)) {
        return Either.left(readError(file, "spec-document", formatFirstViolation(frozen.left)));
      }
      // The 0.27.0 document is the current in-memory one: nothing to lift.
      const { $schema: _schema, ...value } = frozen.right;
      return Either.right({ kind: "spec", shape: "0.27.0", document: value, older: value });
    }
    if (compareReleases(release, "0.25.0") >= 0) {
      const frozen = decodeSpecDocumentV0_25_0(input);
      if (Either.isLeft(frozen)) {
        return Either.left(readError(file, "spec-document", formatFirstViolation(frozen.left)));
      }
      const { $schema: _schema, ...value } = frozen.right;
      return Either.right({
        kind: "spec",
        shape: "0.25.0",
        document: liftSpecDocumentV0_25_0(value),
        older: value,
      });
    }
    const older = decodeSpecDocumentV0_17_0(input);
    if (Either.isLeft(older)) {
      return Either.left(readError(file, "spec-document", formatFirstViolation(older.left)));
    }
    const { $schema: _schema, ...value } = older.right;
    return Either.right({
      kind: "spec",
      shape: "0.17.0",
      document: liftSpecDocument(value),
      older: value,
    });
  }
  return readPersisted<SpecDocumentFile, SpecDocumentPreSchema, SpecDocumentSidecar>(input, {
    format: "spec-document",
    label: "spec document",
    file,
    decodeCurrent: decodeSpecDocumentFile,
    decodePreSchema: decodeSpecDocumentPreSchema,
    fromCurrent: ({ $schema: _schema, ...document }) => ({
      kind: "spec",
      shape: "current",
      document,
    }),
    fromPreSchema: ({ version: _version, ...value }) =>
      Either.right({
        kind: "spec",
        shape: "pre-schema",
        document: liftSpecDocument(value),
        older: value,
      }),
  });
}

function readPlanDocumentSidecar(
  file: string,
  input: unknown,
): Either.Either<PlanDocumentSidecar, PersistedReadError> {
  if (isDocumentObject(input) && isStampedBelowCurrent("plan-document", input)) {
    // `isStampedBelowCurrent` has parsed the stamp, so the release is there.
    const release = parseSchemaUrl(input["$schema"])?.release ?? "0.0.0";
    if (compareReleases(release, "0.28.0") >= 0) {
      const frozen = decodePlanDocumentV0_28_0(input);
      if (Either.isLeft(frozen)) {
        return Either.left(
          readError(file, "plan-document", formatPlanDocumentViolation(input, frozen.left)),
        );
      }
      // The 0.28.0 document is the current in-memory one: its lift is itself.
      const { $schema: _schema, ...value } = frozen.right;
      return Either.right({
        kind: "plan",
        shape: "0.28.0",
        lift: { kind: "lifted", document: value },
        older: value,
      });
    }
    if (compareReleases(release, "0.26.0") >= 0) {
      const frozen = decodePlanDocumentV0_26_0(input);
      if (Either.isLeft(frozen)) {
        return Either.left(readError(file, "plan-document", formatFirstViolation(frozen.left)));
      }
      const { $schema: _schema, ...value } = frozen.right;
      return Either.right({
        kind: "plan",
        shape: "0.26.0",
        lift: liftPlanDocumentV0_26_0(value),
        older: value,
      });
    }
    if (compareReleases(release, "0.25.0") >= 0) {
      const frozen = decodePlanDocumentV0_25_0(input);
      if (Either.isLeft(frozen)) {
        return Either.left(readError(file, "plan-document", formatFirstViolation(frozen.left)));
      }
      const { $schema: _schema, ...value } = frozen.right;
      return Either.right({
        kind: "plan",
        shape: "0.25.0",
        lift: liftPlanDocumentV0_26_0(planDocumentV0_25_0AsV0_26_0(value)),
        older: value,
      });
    }
    const older = decodePlanDocumentV0_20_0(input);
    if (Either.isLeft(older)) {
      return Either.left(readError(file, "plan-document", formatFirstViolation(older.left)));
    }
    const { $schema: _schema, ...value } = older.right;
    return Either.right({
      kind: "plan",
      shape: "0.20.0",
      lift: liftPlanDocumentV0_26_0(planDocumentV0_20_0AsV0_26_0(value)),
      older: value,
    });
  }
  return readPersisted<PlanDocumentFile, PlanDocumentPreSchema, PlanDocumentSidecar>(input, {
    format: "plan-document",
    label: "plan document",
    file,
    decodeCurrent: decodePlanDocumentFile,
    decodePreSchema: decodePlanDocumentPreSchema,
    fromCurrent: ({ $schema: _schema, ...document }) => ({
      kind: "plan",
      shape: "current",
      document,
    }),
    fromPreSchema: ({ version: _version, sourceSpec, ...doc }) => {
      if (sourceSpec !== null) return Either.left({ fact: "completesSpec" });
      const value: PlanDocumentV0_20_0Value = { ...doc, sourceSpec, completesSpec: null };
      return Either.right({
        kind: "plan",
        shape: "pre-schema",
        lift: liftPlanDocumentV0_26_0(planDocumentV0_20_0AsV0_26_0(value)),
        older: value,
      });
    },
    formatViolation: formatPlanDocumentViolation,
  });
}

/**
 * Reads a spec's or plan's JSON sidecar, reporting the shape it is stamped
 * at. Never throws; never rewrites the file. In order:
 * - a spec stamped 0.27.0 or later, below its current stamp, is read by the
 *   frozen 0.27.0 decoder, its document the current in-memory one; one stamped
 *   0.25.0 or later by the frozen 0.25.0 decoder; one stamped below 0.25.0 by the frozen 0.17.0
 *   decoder, and one written before `$schema` by the pre-schema decoder, both
 *   lifted by `liftMarkedQuestions`. Every lift sets the summary placeholder
 *   on each surface element;
 * - a plan stamped 0.28.0 or later, below its current stamp, is read by the
 *   frozen 0.28.0 decoder, its lift the document itself; one stamped 0.26.0 or
 *   later by the frozen 0.26.0 decoder; one stamped 0.25.0 or later by the frozen 0.25.0
 *   decoder, stepped with each `modelReason` carried over as
 *   `assignmentReason`; one stamped below 0.25.0 by the frozen 0.20.0
 *   decoder, so one stamped 0.17.0–0.19.x, which lacks `completesSpec`, is
 *   refused naming it; a plan written before `$schema` steps to
 *   `completesSpec: null` beside `sourceSpec: null` and is refused, naming
 *   `completesSpec`, beside a spec path; the last two step with empty
 *   preamble question arrays and `assignmentReason: null` on every phase.
 *   Each then carries a `lift` (`liftPlanDocumentV0_26_0`): every phase's
 *   `testStrategy` string read as test lines, or refused at the first
 *   departing line. A refused lift still reads;
 * - any other sidecar is read by the current file decoder, shape `current`;
 *   a plan's violation under a test line names the phase and the line
 *   (`formatPlanDocumentViolation`).
 */
export function readDocumentSidecar(
  kind: "spec",
  file: string,
  input: unknown,
): Either.Either<SpecDocumentSidecar, PersistedReadError>;
export function readDocumentSidecar(
  kind: "plan",
  file: string,
  input: unknown,
): Either.Either<PlanDocumentSidecar, PersistedReadError>;
export function readDocumentSidecar(
  kind: "spec" | "plan",
  file: string,
  input: unknown,
): Either.Either<DocumentSidecar, PersistedReadError> {
  return kind === "spec"
    ? readSpecDocumentSidecar(file, input)
    : readPlanDocumentSidecar(file, input);
}

/**
 * The shape a spec's or plan's parsed sidecar is stamped at when it is below
 * its format's current one: `pre-schema` for an object without `$schema`, or
 * the release its `$schema` names. Null for anything else — a current or
 * newer stamp, another format, or not an object. Reads the stamp only, so a
 * refused older shape (a plan stamped 0.19.0) is named too.
 */
export function olderDocumentStamp(kind: "spec" | "plan", input: unknown): string | null {
  if (!isDocumentObject(input)) return null;
  if (!Object.hasOwn(input, "$schema")) return "pre-schema";
  const format = kind === "spec" ? "spec-document" : "plan-document";
  if (!isStampedBelowCurrent(format, input)) return null;
  return parseSchemaUrl(input["$schema"])?.release ?? null;
}

/** A spec or plan document at the current in-memory shape, tagged with its kind. */
export type CurrentDocument =
  | { readonly kind: "spec"; readonly document: SpecDocument }
  | { readonly kind: "plan"; readonly document: PlanDocument };

/**
 * Decodes a parsed spec or plan sidecar with its kind's current file decoder
 * only — never an older shape, never lifted — and drops `$schema`. For an
 * answer whose stamp the caller has already checked: a decide session's
 * revised document. Unknown keys are refused; the decoder's question,
 * phase and traceability checks run.
 */
export function decodeCurrentDocumentSidecar(
  kind: "spec" | "plan",
  input: unknown,
): Either.Either<CurrentDocument, ParseResult.ParseError> {
  if (kind === "spec") {
    return Either.map(decodeSpecDocumentFile(input), ({ $schema: _schema, ...document }) => ({
      kind: "spec" as const,
      document,
    }));
  }
  return Either.map(decodePlanDocumentFile(input), ({ $schema: _schema, ...document }) => ({
    kind: "plan" as const,
    document,
  }));
}

/**
 * Decodes a parsed hand decision answer with its kind's format only
 * (`spec-hand-decision-answer` or `plan-hand-decision-answer`, the current
 * file decoder) and drops `$schema`. For an answer whose stamp the caller has
 * already checked: a decide session's final message over a hand-authored
 * artifact. Unknown keys are refused, so a spec verdict's `phase` is named,
 * and so is a plan verdict without one.
 */
export function decodeCurrentHandDecisionAnswer(
  input: unknown,
  kind: "spec" | "plan",
): Either.Either<HandDecisionAnswer, ParseResult.ParseError> {
  if (kind === "spec") {
    return Either.map(
      decodeSpecHandDecisionAnswerFile(input),
      ({ $schema: _schema, ...answer }): HandDecisionAnswer => answer,
    );
  }
  return Either.map(
    decodePlanHandDecisionAnswerFile(input),
    ({ $schema: _schema, ...answer }): HandDecisionAnswer => answer,
  );
}

/**
 * Decodes a parsed decide verdicts file with its current file decoder only
 * and drops `$schema`. For a file whose stamp the caller has already
 * checked: the file a person writes for `phax artifact decide --verdicts`.
 * Unknown keys are refused.
 */
export function decodeCurrentDecideVerdicts(
  input: unknown,
): Either.Either<DecideVerdicts, ParseResult.ParseError> {
  return Either.map(decodeDecideVerdictsFile(input), ({ $schema: _schema, ...file }) => file);
}

/** Reads a spec's JSON sidecar as the current in-memory document; see `readDocumentSidecar`. */
export const readSpecDocumentFile: Reader<SpecDocument> = (file, input) =>
  Either.map(readSpecDocumentSidecar(file, input), (sidecar) => sidecar.document);

/**
 * Reads a plan's JSON sidecar as the current in-memory document; see
 * `readDocumentSidecar`. An older sidecar whose lift is refused fails, naming
 * the sidecar, the phase and the departing line.
 */
export const readPlanDocumentFile: Reader<PlanDocument> = (file, input) =>
  Either.flatMap(readPlanDocumentSidecar(file, input), (sidecar) => {
    if (sidecar.shape === "current") return Either.right(sidecar.document);
    const { lift } = sidecar;
    if (lift.kind === "lifted") return Either.right(lift.document);
    return Either.left(
      readError(
        file,
        "plan-document",
        `${lift.phase} testStrategy cannot be read as test lines: ${departureMessage(lift.departure)}`,
      ),
    );
  });

function isPassOrFail<S extends { readonly result: string }>(
  step: S,
): step is S & { readonly result: "pass" | "fail" } {
  return step.result === "pass" || step.result === "fail";
}

/**
 * Reads a phase's `gate-attribution.json`. It never carried a `version`: a
 * pre-schema attribution whose every step result is `pass` or `fail` is the
 * in-memory value, with `protectedPaths: null`; any other is refused. One
 * stamped below the current stamp is read by the frozen 0.26.0 decoder, which
 * every earlier stamp's files also satisfy, and lifted with `protectedPaths: null`.
 */
export const readGateAttributionFile: Reader<GateAttribution> = (file, input) => {
  if (isDocumentObject(input) && isStampedBelowCurrent("gate-attribution", input)) {
    const older = decodeGateAttributionV0_26_0(input);
    if (Either.isLeft(older)) {
      return Either.left(readError(file, "gate-attribution", formatFirstViolation(older.left)));
    }
    const { $schema: _schema, ...attribution } = older.right;
    return Either.right({ ...attribution, protectedPaths: null });
  }
  return readPersisted(input, {
    format: "gate-attribution",
    label: "gate attribution",
    file,
    decodeCurrent: decodeGateAttributionFile,
    decodePreSchema: decodeGateAttributionPreSchema,
    fromCurrent: ({ $schema: _schema, ...attribution }) => attribution,
    fromPreSchema: ({ phase, steps }) =>
      steps.every(isPassOrFail)
        ? Either.right({ phase, steps, protectedPaths: null })
        : Either.left({ fact: "a pass or fail result for every step" }),
  });
};

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
 * The report and answer formats a provider prints, each read only under its
 * own `$schema`: the three reports, and the two answers of a declared
 * interactive phase's turns.
 */
export type ReportFormatId =
  | "gate-report"
  | "brief-report"
  | "architecture-report"
  | "first-reading"
  | "interactive-handoff";

/**
 * Why a gate, brief or architecture report was not read. `reads` is the `$schema`
 * URL the reader reads: the format at its current stamp.
 */
export type ReportError =
  | { readonly kind: "malformed"; readonly reads: string; readonly reason: string }
  | { readonly kind: "newer"; readonly reads: string; readonly message: string }
  | { readonly kind: "older"; readonly reads: string; readonly message: string };

/**
 * Reads the parsed document a report step, a brief provider or an architecture
 * provider printed, as `format`. Never throws. In order:
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
  const article = /^[aeiou]/.test(format) ? "an" : "a";
  if (!isDocumentObject(input))
    return malformedReport(`${article} ${format} document is a JSON object`);
  if (!Object.hasOwn(input, "$schema")) {
    return malformedReport(`${article} ${format} document carries $schema`);
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
 * Reads the parsed document an architecture provider printed as an
 * `architecture-report`. See `readReport` for the checks, in order.
 */
export function readArchitectureReport(
  input: unknown,
  bounds: AnswerBounds = { current: CURRENT_STAMPS["architecture-report"], running: PHAX_RELEASE },
): Either.Either<ArchitectureReportFile, ReportError> {
  return readReport("architecture-report", decodeArchitectureReportFile, input, bounds);
}

/**
 * Reads the parsed document a declared interactive phase's first turn
 * answered as a `first-reading`. See `readReport` for the checks, in order.
 */
export function readFirstReadingAnswer(
  input: unknown,
  bounds: AnswerBounds = { current: CURRENT_STAMPS["first-reading"], running: PHAX_RELEASE },
): Either.Either<FirstReadingFile, ReportError> {
  return readReport("first-reading", decodeFirstReadingFile, input, bounds);
}

/**
 * Reads the parsed document a declared interactive phase's closing turn
 * answered as an `interactive-handoff`. See `readReport` for the checks, in
 * order.
 */
export function readInteractiveHandoffAnswer(
  input: unknown,
  bounds: AnswerBounds = { current: CURRENT_STAMPS["interactive-handoff"], running: PHAX_RELEASE },
): Either.Either<InteractiveHandoffFile, ReportError> {
  return readReport("interactive-handoff", decodeInteractiveHandoffFile, input, bounds);
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

// A session stamped below the format's current stamp is read by the frozen
// 0.26.0 decoder; its builder usage, when it is a Vibe usage, lifts to
// unavailable.
/** Reads a declared interactive phase's `interactive-session.json`. Born with `$schema`. */
export const readInteractiveSessionFile: Reader<InteractiveSession> = (file, input) => {
  if (isDocumentObject(input) && isStampedBelowCurrent("interactive-session", input)) {
    const older = decodeInteractiveSessionV0_26_0(input);
    if (Either.isLeft(older)) {
      return Either.left(readError(file, "interactive-session", formatFirstViolation(older.left)));
    }
    const { $schema: _schema, builderUsage, ...session } = older.right;
    return Either.right({
      ...session,
      builderUsage: builderUsage === null ? null : liftFrozenTokenUsage(builderUsage),
    });
  }
  return readSchemaBornPersisted(input, {
    format: "interactive-session",
    label: "interactive session",
    file,
    decodeCurrent: decodeInteractiveSessionFile,
    fromCurrent: ({ $schema: _schema, ...session }) => session,
  });
};

/**
 * Reads a gate attempt's `checks-attempt-NN.oracle-request.json`. Born with
 * `$schema`. Read back only by a close finished from a commit that already
 * landed, to recover whether its gate ran the `authored` step.
 */
export const readOracleRequestFile: Reader<OracleRequest> = (file, input) =>
  readSchemaBornPersisted(input, {
    format: "oracle-request",
    label: "oracle request",
    file,
    decodeCurrent: decodeOracleRequestFile,
    fromCurrent: ({ $schema: _schema, ...request }) => request,
  });

// A review stop stamped below the format's current stamp is read by the frozen
// 0.26.0 decoder; its value is valid in the current shape as it is (the
// current `lastClose` only gains the `network` result).
/** Reads a run's `review-stop.json`. Born with `$schema`. */
export const readReviewStopFile: Reader<ReviewStop> = (file, input) => {
  if (isDocumentObject(input) && isStampedBelowCurrent("review-stop", input)) {
    const older = decodeReviewStopV0_26_0(input);
    if (Either.isLeft(older)) {
      return Either.left(readError(file, "review-stop", formatFirstViolation(older.left)));
    }
    const { $schema: _schema, ...stop } = older.right;
    return Either.right(stop);
  }
  return readSchemaBornPersisted(input, {
    format: "review-stop",
    label: "review stop",
    file,
    decodeCurrent: decodeReviewStopFile,
    fromCurrent: ({ $schema: _schema, ...stop }) => stop,
  });
};

// A cost ledger stamped 0.26.0 or later, below the format's current stamp, is
// read by the frozen 0.26.0 decoder; one stamped lower by the frozen 0.25.0
// decoder (which refuses first-turn and closing-turn entries). Both are lifted
// unchanged: the roles they name are a subset of the current ones.
/** Reads a run's `cost-ledger.json`. Born with `$schema`. */
export const readCostLedgerFile: Reader<CostLedger> = (file, input) => {
  if (isDocumentObject(input) && isStampedBelowCurrent("cost-ledger", input)) {
    // `isStampedBelowCurrent` has parsed the stamp, so the release is there.
    const release = parseSchemaUrl(input["$schema"])?.release ?? "0.0.0";
    const older =
      compareReleases(release, "0.26.0") >= 0
        ? decodeCostLedgerV0_26_0(input)
        : decodeCostLedgerV0_25_0(input);
    if (Either.isLeft(older)) {
      return Either.left(readError(file, "cost-ledger", formatFirstViolation(older.left)));
    }
    const { $schema: _schema, ...ledger } = older.right;
    return Either.right(ledger);
  }
  return readSchemaBornPersisted(input, {
    format: "cost-ledger",
    label: "cost ledger",
    file,
    decodeCurrent: decodeCostLedgerFile,
    fromCurrent: ({ $schema: _schema, ...ledger }) => ledger,
  });
};

// A code review stamped below the format's current stamp is the 0.29.0 file of
// an older run folder, read by the frozen 0.29.0 decoder; its findings are valid
// in the current shape as they are.
/** Reads a run's `code-review.json`. Born with `$schema`. */
export const readCodeReviewFile: Reader<CodeReview> = (file, input) => {
  if (isDocumentObject(input) && isStampedBelowCurrent("code-review", input)) {
    const older = decodeCodeReviewV0_29_0(input);
    if (Either.isLeft(older)) {
      return Either.left(readError(file, "code-review", formatFirstViolation(older.left)));
    }
    const { $schema: _schema, ...review } = older.right;
    return Either.right(review);
  }
  return readSchemaBornPersisted(input, {
    format: "code-review",
    label: "code review",
    file,
    decodeCurrent: decodeCodeReviewFile,
    fromCurrent: ({ $schema: _schema, ...review }) => review,
  });
};

/**
 * Reads a phase's `file-reconciliation.json`. It never carried a `version`:
 * the pre-schema reconciliation is the in-memory value as it is. One written
 * before `reviewCorrections` (pre-schema, or stamped below the format's
 * current stamp and read by the frozen 0.17.0 decoder) is upgraded with
 * `reviewCorrections: []`: no phax before it could run an interactive stop.
 */
export const readPhaseFileReconciliationFile: Reader<PhaseFileReconciliation> = (file, input) => {
  if (isDocumentObject(input) && isStampedBelowCurrent("phase-file-reconciliation", input)) {
    const older = decodePhaseFileReconciliationV0_17_0(input);
    if (Either.isLeft(older)) {
      return Either.left(
        readError(file, "phase-file-reconciliation", formatFirstViolation(older.left)),
      );
    }
    const { $schema: _schema, ...reconciliation } = older.right;
    return Either.right({ ...reconciliation, reviewCorrections: [] });
  }
  return readPersisted(input, {
    format: "phase-file-reconciliation",
    label: "phase file reconciliation",
    file,
    decodeCurrent: decodePhaseFileReconciliationFile,
    decodePreSchema: decodePhaseFileReconciliationPreSchema,
    fromCurrent: ({ $schema: _schema, ...reconciliation }) => reconciliation,
    fromPreSchema: (reconciliation) => Either.right({ ...reconciliation, reviewCorrections: [] }),
  });
};

function fromRecordManifestFile({ $schema: _schema, ...manifest }: RecordManifestFile) {
  return manifest;
}

// An authoring manifest stamped below the format's current stamp is read by
// the frozen 0.23.0 decoder when stamped 0.23.0 or later, else by the frozen
// 0.17.0 decoder. One written before `retry` (pre-schema, or read by the
// 0.17.0 decoder) is upgraded with `retry: "none"`: no phax before it ever
// resumed a headless session. Every lift turns a Vibe usage into unavailable.
// An absent `sourceSha` stays absent.
const readAuthoringRecordManifest: Reader<RecordManifest> = (file, input) => {
  if (isDocumentObject(input) && isStampedBelowCurrent("authoring-record-manifest", input)) {
    // `isStampedBelowCurrent` has parsed the stamp, so the release is there.
    const release = parseSchemaUrl(input["$schema"])?.release ?? "0.0.0";
    if (compareReleases(release, "0.23.0") >= 0) {
      const older = decodeAuthoringRecordManifestV0_23_0(input);
      if (Either.isLeft(older)) {
        return Either.left(
          readError(file, "authoring-record-manifest", formatFirstViolation(older.left)),
        );
      }
      const { $schema: _schema, usage, ...manifest } = older.right;
      return Either.right({ ...manifest, usage: liftFrozenTokenUsage(usage) });
    }
    const older = decodeAuthoringRecordManifestV0_17_0(input);
    if (Either.isLeft(older)) {
      return Either.left(
        readError(file, "authoring-record-manifest", formatFirstViolation(older.left)),
      );
    }
    const { $schema: _schema, usage, ...manifest } = older.right;
    return Either.right({ ...manifest, usage: liftFrozenTokenUsage(usage), retry: "none" });
  }
  return readPersisted(input, {
    format: "authoring-record-manifest",
    label: "authoring record manifest",
    file,
    decodeCurrent: decodeRecordManifestFile,
    decodePreSchema: decodeAuthoringRecordManifestPreSchema,
    fromCurrent: fromRecordManifestFile,
    fromPreSchema: ({ version: _version, usage, ...manifest }) =>
      Either.right({ ...manifest, usage: liftFrozenTokenUsage(usage), retry: "none" }),
  });
};

/** Whether `input`'s own `$schema` names `format` at a release below its current stamp. */
function isStampedBelowCurrent(
  format: FormatId,
  input: Readonly<Record<string, unknown>>,
): boolean {
  if (!Object.hasOwn(input, "$schema")) return false;
  const named = parseSchemaUrl(input["$schema"]);
  return (
    named !== undefined &&
    named.formatId === format &&
    compareReleases(named.release, CURRENT_STAMPS[format]) < 0
  );
}

// A phase manifest stamped below the format's current stamp is read by the
// frozen 0.26.0 decoder when stamped 0.26.0 or later, else by the frozen
// 0.17.0 decoder. One written before `oracle` (pre-schema, or read by the
// 0.17.0 decoder) is upgraded with `oracle: null`, `mode: "headless"` and
// `stop: null`: no phax before it could run an oracle phase or stop a phase.
// Every lift turns a Vibe usage into unavailable.
function readPhaseRecordManifestAs(label: string): Reader<RecordManifest> {
  return (file, input) => {
    if (isDocumentObject(input) && isStampedBelowCurrent("phase-record-manifest", input)) {
      // `isStampedBelowCurrent` has parsed the stamp, so the release is there.
      const release = parseSchemaUrl(input["$schema"])?.release ?? "0.0.0";
      if (compareReleases(release, "0.26.0") >= 0) {
        const older = decodePhaseRecordManifestV0_26_0(input);
        if (Either.isLeft(older)) {
          return Either.left(
            readError(file, "phase-record-manifest", formatFirstViolation(older.left)),
          );
        }
        const { $schema: _schema, usage, ...manifest } = older.right;
        return Either.right({ ...manifest, usage: liftFrozenTokenUsage(usage) });
      }
      const older = decodePhaseRecordManifestV0_17_0(input);
      if (Either.isLeft(older)) {
        return Either.left(
          readError(file, "phase-record-manifest", formatFirstViolation(older.left)),
        );
      }
      const { $schema: _schema, usage, ...manifest } = older.right;
      return Either.right({
        ...manifest,
        usage: liftFrozenTokenUsage(usage),
        oracle: null,
        mode: "headless",
        stop: null,
      });
    }
    return readPersisted(input, {
      format: "phase-record-manifest",
      label,
      file,
      decodeCurrent: decodeRecordManifestFile,
      decodePreSchema: decodePhaseRecordManifestPreSchema,
      fromCurrent: fromRecordManifestFile,
      fromPreSchema: ({ version: _version, usage, ...manifest }) =>
        Either.right({
          ...manifest,
          usage: liftFrozenTokenUsage(usage),
          oracle: null,
          mode: "headless",
          stop: null,
        }),
    });
  };
}

const readPhaseRecordManifest = readPhaseRecordManifestAs("phase record manifest");

// A non-object names no kind; it fails before either decoder runs.
const readAnyRecordManifest = readPhaseRecordManifestAs("record manifest");

// Born with `$schema`: a decision manifest without one is unreadable. One
// stamped below the format's current stamp is read by the frozen 0.28.0
// decoder when stamped 0.28.0 or later, else by the frozen 0.25.0 decoder; an
// 0.25.0 manifest is an interactive record, valid as it is. Every lift turns a
// Vibe usage into unavailable, and a failed record, which named no failure
// before 0.30.0, gets `failure: null`.
const readDecisionRecordManifest: Reader<RecordManifest> = (file, input) => {
  if (isDocumentObject(input) && isStampedBelowCurrent("decision-record-manifest", input)) {
    // `isStampedBelowCurrent` has parsed the stamp, so the release is there.
    const release = parseSchemaUrl(input["$schema"])?.release ?? "0.0.0";
    const older =
      compareReleases(release, "0.28.0") >= 0
        ? decodeDecisionRecordManifestV0_28_0(input)
        : decodeDecisionRecordManifestV0_25_0(input);
    if (Either.isLeft(older)) {
      return Either.left(
        readError(file, "decision-record-manifest", formatFirstViolation(older.left)),
      );
    }
    const { $schema: _schema, ...manifest } = older.right;
    return Either.right(liftFrozenDecisionManifest(manifest));
  }
  return readSchemaBornPersisted(input, {
    format: "decision-record-manifest",
    label: "decision record manifest",
    file,
    decodeCurrent: decodeDecisionRecordManifestFile,
    fromCurrent: ({ $schema: _schema, ...manifest }) => manifest,
  });
};

// Born with `$schema`, with no older shape: a review manifest without one is
// unreadable.
const readReviewRecordManifest: Reader<RecordManifest> = (file, input) =>
  readSchemaBornPersisted(input, {
    format: "review-record-manifest",
    label: "review record manifest",
    file,
    decodeCurrent: decodeReviewRecordManifestFile,
    fromCurrent: ({ $schema: _schema, ...manifest }) => manifest,
  });

/**
 * Reads any `record.json` on phax/records/v1, by its `kind`: "review" is read
 * as a review manifest and "decision" as a decision manifest (both born with
 * `$schema`), "authoring" as an
 * authoring manifest, anything else as a phase manifest. A `$schema` manifest
 * is read by the file union. A manifest without `$schema` is read by the
 * authoring pre-schema decoder when its `kind` is "authoring", and by the
 * phase pre-schema decoder otherwise, so a version-1 phase manifest is refused
 * as not in the pre-schema shape.
 */
export const readRecordManifestFile: Reader<RecordManifest> = (file, input) => {
  if (!isDocumentObject(input)) return readAnyRecordManifest(file, input);
  if (input["kind"] === "review") return readReviewRecordManifest(file, input);
  if (input["kind"] === "decision") return readDecisionRecordManifest(file, input);
  return input["kind"] === "authoring"
    ? readAuthoringRecordManifest(file, input)
    : readPhaseRecordManifest(file, input);
};
