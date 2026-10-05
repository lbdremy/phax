// The bridge between a persisted file and phax's in-memory value: the only
// src/ module that imports the frozen pre-schema decoders under
// src/schemas/history/, and, with each declaring module, the only one that
// names a file decoder. It is pure: callers read the bytes and parse the JSON,
// and pass the file path only so it appears in messages. It never imports
// packages/.
//
// First, it refuses a document whose `$schema` names a release newer than the
// running one: reading it would drop the fields that release added, and the
// next write would lose them. Releases compare as semver, through the
// `compareReleases` the schemas package also uses.
//
// Otherwise it resolves a document the way the schemas package's
// `defineFormat` does: a document with `$schema` is read only by phax's
// current file decoder; a
// document without `$schema` is read only by the frozen pre-schema decoder,
// then stepped to the current shape. A format born with `$schema` has no
// pre-schema decoder, so a document of it without `$schema` is refused. On the
// way out, `withSchemaUrl` stamps the `$schema` a writer puts first.
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
import { decodeComplianceReviewFile, type ComplianceReview } from "./complianceReview.js";
import { formatFirstViolation } from "./formatError.js";
import { decodeGateAttributionFile, type GateAttribution } from "./gateAttribution.js";
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
import { PHAX_RELEASE } from "./release.js";
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
        `${label} written by phax ${named.release} is newer than this phax (${PHAX_RELEASE}) — upgrade phax to read it`,
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
 * `value` as the file phax writes: `$schema` first, naming `formatId` at the
 * running release, then the value's own keys.
 */
export function withSchemaUrl<T extends object>(
  formatId: FormatId,
  value: T,
): { readonly $schema: string } & T {
  return { $schema: schemaUrl(formatId, PHAX_RELEASE), ...value };
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

/** Reads a phase's `status.json`. The pre-schema phase status carries every fact phax needs. */
export const readPhaseStatusFile: Reader<PhaseStatus> = (file, input) =>
  readPersisted(input, {
    format: "phase-status",
    label: "phase status",
    file,
    decodeCurrent: decodePhaseStatusFile,
    decodePreSchema: decodePhaseStatusPreSchema,
    fromCurrent: ({ $schema: _schema, ...status }) => status,
    fromPreSchema: ({ version: _version, ...status }) => Either.right(status),
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

/** Reads a plan's JSON sidecar. The pre-schema sidecar carries every fact phax needs. */
export const readPlanDocumentFile: Reader<PlanDocument> = (file, input) =>
  readPersisted(input, {
    format: "plan-document",
    label: "plan document",
    file,
    decodeCurrent: decodePlanDocumentFile,
    decodePreSchema: decodePlanDocumentPreSchema,
    fromCurrent: ({ $schema: _schema, ...doc }) => doc,
    fromPreSchema: ({ version: _version, ...doc }) => Either.right(doc),
  });

/**
 * Reads a phase's `gate-attribution.json`. It never carried a `version`: the
 * pre-schema attribution is the in-memory value as it is.
 */
export const readGateAttributionFile: Reader<GateAttribution> = (file, input) =>
  readPersisted(input, {
    format: "gate-attribution",
    label: "gate attribution",
    file,
    decodeCurrent: decodeGateAttributionFile,
    decodePreSchema: decodeGateAttributionPreSchema,
    fromCurrent: ({ $schema: _schema, ...attribution }) => attribution,
    fromPreSchema: Either.right,
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
