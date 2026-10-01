// The bridge between a persisted file and phax's in-memory value: the only
// src/ module that imports the frozen pre-schema decoders under
// src/schemas/history/, and, with each declaring module, the only one that
// names a file decoder. It is pure: callers read the bytes and parse the JSON,
// and pass the file path only so it appears in messages. It never imports
// packages/.
//
// It resolves a document the way the schemas package's `defineFormat` does: a
// document with `$schema` is read only by phax's current file decoder; a
// document without `$schema` is read only by the frozen pre-schema decoder,
// then stepped to the current shape.
import { Either, type ParseResult } from "effect";
import { decodeApprovalRecordFile, type ApprovalRecordFile } from "./approvalRecord.js";
import { decodeRecordManifestFile, type RecordManifest } from "./authoringRecord.js";
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
import type { FormatId } from "./schemaUrl.js";
import { decodeSpecApprovalRecordFile, type SpecApprovalRecordFile } from "./specApprovalRecord.js";
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
  readonly format: FormatId;
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
 * 2. a document with its own `$schema` key is read only by `decodeCurrent`;
 * 3. a document without `$schema` is read only by `decodePreSchema`, then
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
  if (Object.hasOwn(input, "$schema")) {
    const current = spec.decodeCurrent(input);
    if (Either.isLeft(current)) {
      return Either.left(readError(file, format, formatFirstViolation(current.left)));
    }
    return Either.right(spec.fromCurrent(current.right));
  }
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

// Until a format's family phase changes its shape, its pre-schema and current
// shapes are the same: both steps keep the value as it is.
function same<T>(value: T): T {
  return value;
}

function sameRight<T>(value: T): Either.Either<T, MissingFact> {
  return Either.right(value);
}

type Reader<T> = (file: string, input: unknown) => Either.Either<T, PersistedReadError>;

function reader<InMemory>(
  format: FormatId,
  label: string,
  decodeCurrent: Decode<InMemory>,
  decodePreSchema: Decode<InMemory>,
): Reader<InMemory> {
  return (file, input) =>
    readPersisted(input, {
      format,
      label,
      file,
      decodeCurrent,
      decodePreSchema,
      fromCurrent: same,
      fromPreSchema: sameRight,
    });
}

/** Reads `~/.phax/registry.json`. */
export const readRegistryFile: Reader<Registry> = reader(
  "registry",
  "run registry",
  decodeRegistryFile,
  decodeRegistryPreSchema,
);

/** Reads a run's `run-status.json`. */
export const readRunStatusFile: Reader<RunStatus> = reader(
  "run-status",
  "run status",
  decodeRunStatusFile,
  decodeRunStatusPreSchema,
);

/** Reads a phase's `status.json`. */
export const readPhaseStatusFile: Reader<PhaseStatus> = reader(
  "phase-status",
  "phase status",
  decodePhaseStatusFile,
  decodePhaseStatusPreSchema,
);

/** Reads a run's `phax-plan.json`. */
export const readPhaxPlanFile: Reader<PhaxPlan> = reader(
  "phax-plan",
  "phax-plan",
  decodePhaxPlanFile,
  decodePhaxPlanPreSchema,
);

/** Reads a run's `compliance-review.json`. */
export const readComplianceReviewFile: Reader<ComplianceReview> = reader(
  "compliance-review",
  "compliance review",
  decodeComplianceReviewFile,
  decodeComplianceReviewPreSchema,
);

/** Reads `docs/plans/approvals.json`. */
export const readPlanApprovalsFile: Reader<ApprovalRecordFile> = reader(
  "plan-approvals",
  "plan approvals ledger",
  decodeApprovalRecordFile,
  decodePlanApprovalsPreSchema,
);

/** Reads `docs/specs/approvals.json`. */
export const readSpecApprovalsFile: Reader<SpecApprovalRecordFile> = reader(
  "spec-approvals",
  "spec approvals ledger",
  decodeSpecApprovalRecordFile,
  decodeSpecApprovalsPreSchema,
);

/** Reads a spec's JSON sidecar. */
export const readSpecDocumentFile: Reader<SpecDocument> = reader(
  "spec-document",
  "spec document",
  decodeSpecDocumentFile,
  decodeSpecDocumentPreSchema,
);

/** Reads a plan's JSON sidecar. */
export const readPlanDocumentFile: Reader<PlanDocument> = reader(
  "plan-document",
  "plan document",
  decodePlanDocumentFile,
  decodePlanDocumentPreSchema,
);

/** Reads a phase's `gate-attribution.json`. */
export const readGateAttributionFile: Reader<GateAttribution> = reader(
  "gate-attribution",
  "gate attribution",
  decodeGateAttributionFile,
  decodeGateAttributionPreSchema,
);

/** Reads a phase's `file-reconciliation.json`. */
export const readPhaseFileReconciliationFile: Reader<PhaseFileReconciliation> = reader(
  "phase-file-reconciliation",
  "phase file reconciliation",
  decodePhaseFileReconciliationFile,
  decodePhaseFileReconciliationPreSchema,
);

const readAuthoringRecordManifest: Reader<RecordManifest> = reader(
  "authoring-record-manifest",
  "authoring record manifest",
  decodeRecordManifestFile,
  decodeAuthoringRecordManifestPreSchema,
);

const readPhaseRecordManifest: Reader<RecordManifest> = reader(
  "phase-record-manifest",
  "phase record manifest",
  decodeRecordManifestFile,
  decodePhaseRecordManifestPreSchema,
);

// A non-object names no kind; it fails before either decoder runs.
const readAnyRecordManifest: Reader<RecordManifest> = reader(
  "phase-record-manifest",
  "record manifest",
  decodeRecordManifestFile,
  decodePhaseRecordManifestPreSchema,
);

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
