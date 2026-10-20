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
// then stepped to the current shape. Five formats also read an older
// `$schema` shape: an authoring record manifest stamped below its current
// stamp is read by the frozen 0.17.0 decoder, then stepped to the current
// shape, so the records already on phax/records/v1 stay listed; a spec or plan
// approval record stamped below its current stamp is read by its frozen 0.19.0
// decoder and lifted to an unattributed approval; a spec document stamped
// below its current stamp is read by the frozen 0.17.0 decoder, and one
// written before `$schema` by the pre-schema decoder, then lifted by the
// author's rationale marker (`liftMarkedQuestions`); a plan document stamped
// below its current stamp is read by the frozen 0.25.0 decoder when stamped
// 0.25.0 or later (its `modelReason` carried over as `assignmentReason`), and
// by the frozen 0.20.0 decoder below that, lifted with empty preamble
// questions and `assignmentReason: null`. `readDocumentSidecar`
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
import { decodeComplianceReviewFile, type ComplianceReview } from "./complianceReview.js";
import { decodeCostLedgerFile, type CostLedger } from "./costLedger.js";
import { decodeDecisionRecordManifestFile } from "./decisionRecord.js";
import { formatFirstViolation } from "./formatError.js";
import { decodeGateAttributionFile, type GateAttribution } from "./gateAttribution.js";
import { decodeGateReportFile, type GateReportFile } from "./gateReport.js";
import { decodeHandDecisionAnswerFile, type HandDecisionAnswer } from "./handDecisionAnswer.js";
import { decodeAuthoringRecordManifestV0_17_0 } from "./history/authoring-record-manifest/0.17.0.js";
import { decodeAuthoringRecordManifestPreSchema } from "./history/authoring-record-manifest/pre-schema.js";
import { decodeComplianceReviewPreSchema } from "./history/compliance-review/pre-schema.js";
import { decodeGateAttributionPreSchema } from "./history/gate-attribution/pre-schema.js";
import { decodePhaseFileReconciliationPreSchema } from "./history/phase-file-reconciliation/pre-schema.js";
import { decodePhaseRecordManifestPreSchema } from "./history/phase-record-manifest/pre-schema.js";
import { decodePhaseStatusPreSchema } from "./history/phase-status/pre-schema.js";
import { decodePhaxPlanPreSchema } from "./history/phax-plan/pre-schema.js";
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
  decodePlanDocumentPreSchema,
  type PlanDocumentPreSchema,
} from "./history/plan-document/pre-schema.js";
import { decodeRegistryPreSchema } from "./history/registry/pre-schema.js";
import { decodeRunStatusPreSchema } from "./history/run-status/pre-schema.js";
import { decodeSpecApprovalRecordV0_19_0 } from "./history/spec-approval-record/0.19.0.js";
import { decodeSpecApprovalsPreSchema } from "./history/spec-approvals/pre-schema.js";
import {
  decodeSpecDocumentV0_17_0,
  type SpecDocumentV0_17_0,
} from "./history/spec-document/0.17.0.js";
import {
  decodeSpecDocumentPreSchema,
  type SpecDocumentPreSchema,
} from "./history/spec-document/pre-schema.js";
import { decodePhaxPlanFile, type PhaxPlan } from "./phaxPlan.js";
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
 * A spec sidecar as read: the document at the current in-memory shape, and
 * the shape the file is stamped at. A sidecar below the current shape also
 * carries the value its frozen decoder read.
 */
export type SpecDocumentSidecar =
  | { readonly kind: "spec"; readonly shape: "current"; readonly document: SpecDocument }
  | {
      readonly kind: "spec";
      readonly shape: "0.17.0" | "pre-schema";
      readonly document: SpecDocument;
      readonly older: SpecDocumentV0_17_0Value;
    };

/**
 * A plan sidecar as read: the document at the current in-memory shape, and
 * the shape the file is stamped at. A sidecar below the current shape also
 * carries the value its frozen decoder read.
 */
export type PlanDocumentSidecar =
  | { readonly kind: "plan"; readonly shape: "current"; readonly document: PlanDocument }
  | {
      readonly kind: "plan";
      readonly shape: "0.25.0";
      readonly document: PlanDocument;
      readonly older: PlanDocumentV0_25_0Value;
    }
  | {
      readonly kind: "plan";
      readonly shape: "0.20.0" | "pre-schema";
      readonly document: PlanDocument;
      readonly older: PlanDocumentV0_20_0Value;
    };

export type DocumentSidecar = SpecDocumentSidecar | PlanDocumentSidecar;

// The marker lift: a question whose rationale opens with the author's marker
// is arbitrated with a lifted verdict; every other question stays open.
function liftSpecDocument(older: SpecDocumentV0_17_0Value): SpecDocument {
  return { ...older, ...liftMarkedQuestions(older.openQuestions) };
}

/**
 * Lifts the phases of a plan document older than `modelReason`: each gains
 * `assignmentReason: null`, rebuilt in the current key order.
 */
function liftPlanDocumentPhases(
  phases: PlanDocumentV0_20_0Value["phases"],
): PlanDocument["phases"] {
  return Arr.map(phases, (phase) => ({
    id: phase.id,
    title: phase.title,
    objective: phase.objective,
    detailedInstructions: phase.detailedInstructions,
    planMarkdownAnchor: phase.planMarkdownAnchor,
    plannedFilesToCreate: phase.plannedFilesToCreate,
    plannedFilesToEdit: phase.plannedFilesToEdit,
    optionalFilesToEdit: phase.optionalFilesToEdit,
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
  }));
}

/**
 * Lifts the phases of a 0.25.0 plan document: `modelReason` becomes
 * `assignmentReason`, rebuilt in the current key order.
 */
function liftPlanDocumentV0_25_0Phases(
  phases: PlanDocumentV0_25_0Value["phases"],
): PlanDocument["phases"] {
  return Arr.map(phases, (phase) => ({
    id: phase.id,
    title: phase.title,
    objective: phase.objective,
    detailedInstructions: phase.detailedInstructions,
    planMarkdownAnchor: phase.planMarkdownAnchor,
    plannedFilesToCreate: phase.plannedFilesToCreate,
    plannedFilesToEdit: phase.plannedFilesToEdit,
    optionalFilesToEdit: phase.optionalFilesToEdit,
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
  }));
}

// A 0.25.0 plan already carries its preamble questions, kept as recorded.
function liftPlanDocumentV0_25_0(older: PlanDocumentV0_25_0Value): PlanDocument {
  return { ...older, phases: liftPlanDocumentV0_25_0Phases(older.phases) };
}

// A plan written before questions carried none: both arrays lift empty.
function liftPlanDocument(older: PlanDocumentV0_20_0Value): PlanDocument {
  return {
    ...older,
    preamble: { ...older.preamble, openQuestions: [], arbitratedQuestions: [] },
    phases: liftPlanDocumentPhases(older.phases),
  };
}

function readSpecDocumentSidecar(
  file: string,
  input: unknown,
): Either.Either<SpecDocumentSidecar, PersistedReadError> {
  if (isDocumentObject(input) && isStampedBelowCurrent("spec-document", input)) {
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
    if (compareReleases(release, "0.25.0") >= 0) {
      const frozen = decodePlanDocumentV0_25_0(input);
      if (Either.isLeft(frozen)) {
        return Either.left(readError(file, "plan-document", formatFirstViolation(frozen.left)));
      }
      const { $schema: _schema, ...value } = frozen.right;
      return Either.right({
        kind: "plan",
        shape: "0.25.0",
        document: liftPlanDocumentV0_25_0(value),
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
      document: liftPlanDocument(value),
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
        document: liftPlanDocument(value),
        older: value,
      });
    },
  });
}

/**
 * Reads a spec's or plan's JSON sidecar, reporting the shape it is stamped
 * at. Never throws; never rewrites the file. In order:
 * - a spec stamped below its current stamp is read by the frozen 0.17.0
 *   decoder, and a spec written before `$schema` by the pre-schema decoder;
 *   either is lifted by `liftMarkedQuestions`;
 * - a plan stamped 0.25.0 or later, below its current stamp, is read by the
 *   frozen 0.25.0 decoder and lifted with each `modelReason` carried over as
 *   `assignmentReason`; a plan stamped below 0.25.0 is read by the frozen
 *   0.20.0 decoder, so one stamped 0.17.0–0.19.x, which lacks `completesSpec`,
 *   is refused naming it; a plan written before `$schema` steps to
 *   `completesSpec: null` beside `sourceSpec: null` and is refused, naming
 *   `completesSpec`, beside a spec path; either lifts with empty preamble
 *   question arrays and `assignmentReason: null` on every phase;
 * - any other sidecar is read by the current file decoder, shape `current`.
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
 * Decodes a parsed hand decision answer with its current file decoder only
 * and drops `$schema`. For an answer whose stamp the caller has already
 * checked: a decide session's final message over a hand-authored artifact.
 * Unknown keys are refused.
 */
export function decodeCurrentHandDecisionAnswer(
  input: unknown,
): Either.Either<HandDecisionAnswer, ParseResult.ParseError> {
  return Either.map(
    decodeHandDecisionAnswerFile(input),
    ({ $schema: _schema, ...answer }) => answer,
  );
}

/** Reads a spec's JSON sidecar as the current in-memory document; see `readDocumentSidecar`. */
export const readSpecDocumentFile: Reader<SpecDocument> = (file, input) =>
  Either.map(readSpecDocumentSidecar(file, input), (sidecar) => sidecar.document);

/** Reads a plan's JSON sidecar as the current in-memory document; see `readDocumentSidecar`. */
export const readPlanDocumentFile: Reader<PlanDocument> = (file, input) =>
  Either.map(readPlanDocumentSidecar(file, input), (sidecar) => sidecar.document);

type GateStepResult = GateAttribution["steps"][number];

function isPassOrFail(step: { readonly result: string }): step is GateStepResult & {
  readonly result: "pass" | "fail";
} {
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

/** The three report formats, each read only under its own `$schema`. */
export type ReportFormatId = "gate-report" | "brief-report" | "architecture-report";

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

/** Reads a run's `cost-ledger.json`. Born with `$schema`. */
export const readCostLedgerFile: Reader<CostLedger> = (file, input) =>
  readSchemaBornPersisted(input, {
    format: "cost-ledger",
    label: "cost ledger",
    file,
    decodeCurrent: decodeCostLedgerFile,
    fromCurrent: ({ $schema: _schema, ...ledger }) => ledger,
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

// An authoring manifest written before `retry` (pre-schema, or stamped below
// the format's current stamp and read by the frozen 0.17.0 decoder) is
// upgraded with `retry: "none"`: no phax before it ever resumed a headless
// session. An absent `sourceSha` stays absent.
const readAuthoringRecordManifest: Reader<RecordManifest> = (file, input) => {
  if (isDocumentObject(input) && isStampedBelowCurrent("authoring-record-manifest", input)) {
    const older = decodeAuthoringRecordManifestV0_17_0(input);
    if (Either.isLeft(older)) {
      return Either.left(
        readError(file, "authoring-record-manifest", formatFirstViolation(older.left)),
      );
    }
    const { $schema: _schema, ...manifest } = older.right;
    return Either.right({ ...manifest, retry: "none" });
  }
  return readPersisted(input, {
    format: "authoring-record-manifest",
    label: "authoring record manifest",
    file,
    decodeCurrent: decodeRecordManifestFile,
    decodePreSchema: decodeAuthoringRecordManifestPreSchema,
    fromCurrent: fromRecordManifestFile,
    fromPreSchema: ({ version: _version, ...manifest }) =>
      Either.right({ ...manifest, retry: "none" }),
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

// Born with `$schema`: a decision manifest without one is unreadable.
const readDecisionRecordManifest: Reader<RecordManifest> = (file, input) =>
  readSchemaBornPersisted(input, {
    format: "decision-record-manifest",
    label: "decision record manifest",
    file,
    decodeCurrent: decodeDecisionRecordManifestFile,
    fromCurrent: ({ $schema: _schema, ...manifest }) => manifest,
  });

/**
 * Reads any `record.json` on phax/records/v1, by its `kind`: "decision" is
 * read as a decision manifest (born with `$schema`), "authoring" as an
 * authoring manifest, anything else as a phase manifest. A `$schema` manifest
 * is read by the file union. A manifest without `$schema` is read by the
 * authoring pre-schema decoder when its `kind` is "authoring", and by the
 * phase pre-schema decoder otherwise, so a version-1 phase manifest is refused
 * as not in the pre-schema shape.
 */
export const readRecordManifestFile: Reader<RecordManifest> = (file, input) => {
  if (!isDocumentObject(input)) return readAnyRecordManifest(file, input);
  if (input["kind"] === "decision") return readDecisionRecordManifest(file, input);
  return input["kind"] === "authoring"
    ? readAuthoringRecordManifest(file, input)
    : readPhaseRecordManifest(file, input);
};
