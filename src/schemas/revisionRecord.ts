import { Schema } from "effect";
import { ProviderIdSchema } from "./providerId.js";
import { RecordShapeSchema, TokenUsageSchema } from "./runRecord.js";
import { schemaUrlField } from "./schemaUrl.js";
import { isExportedPattern } from "./strictString.js";

/**
 * Why a failed revision failed: the failed session's kind, `answer-refused` (a
 * document refused, retried or not), `artifact-changed` (the artifact changed
 * during the session) or `commit-failed` (the revised artifact could not be
 * written or committed). The revision record's own literal schema, with the
 * same members as the decision record's; a type test keeps the two equal.
 */
export const RevisionFailureSchema = Schema.Literals([
  "network",
  "rate-limit",
  "usage-limit",
  "not-authenticated",
  "provider-error",
  "max-turns",
  "killed",
  "unknown",
  "answer-refused",
  "artifact-changed",
  "commit-failed",
]);

export type RevisionFailure = Schema.Schema.Type<typeof RevisionFailureSchema>;

/**
 * How a revise that ran a writer session ended: the revised artifact landed in
 * one commit (`committed`), the writer's document rendered the same body so
 * nothing was written (`unchanged`), or it failed. Only a `committed` record
 * names a commit.
 */
export const RevisionRecordOutcomeSchema = Schema.Literals(["committed", "unchanged", "failed"]);

export type RevisionRecordOutcome = Schema.Schema.Type<typeof RevisionRecordOutcomeSchema>;

/** Whether the session resumed the artifact's kept authoring session or started a new one. */
const RevisionSessionSchema = Schema.Literals(["new", "resumed-authoring"]);

/** Who asked for the revision: an operator by name, or a machine by its grant. */
const RevisionRequesterSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("operator"), name: Schema.NonEmptyString }),
  Schema.Struct({ kind: Schema.Literal("machine"), grant: Schema.NonEmptyString }),
]);

/**
 * The manifest (`record.json`) of one revise writer session, keyed
 * `revision/<revisionId>` on `phax/records/v1`. A distinct kind beside the
 * phase, authoring, decision and review manifests. `sourceSha` is HEAD when the
 * session started; `commit` is the revise commit, present only when it landed.
 * It carries no provider session id, so a resumed authoring session's id never
 * reaches the records branch.
 */
const revisionRecordManifestFields = {
  kind: Schema.Literal("revision"),
  /** `<authoringId>/<NN>`: the record key's tail and the `Revision-Id` trailer. */
  revisionId: Schema.String.check(isExportedPattern(/^[^/\s]+\/\d{2,}$/)).pipe(
    Schema.annotate({ description: "`<authoringId>/<NN>`, the Revision-Id trailer." }),
  ),
  /** Repo-relative path of the artifact revised. */
  artifact: Schema.NonEmptyString,
  artifactKind: Schema.Literals(["spec", "plan"]),
  session: RevisionSessionSchema,
  requester: RevisionRequesterSchema,
  /** The ids of the open questions the revision appended. */
  newQuestions: Schema.Array(Schema.NonEmptyString),
  sourceSha: Schema.NonEmptyString,
  shape: RecordShapeSchema,
  provider: ProviderIdSchema,
  /** The concrete model the session ran. */
  model: Schema.NonEmptyString,
  /** The model asked for, by flag or configuration: routing may have chosen another. */
  requestedModel: Schema.NonEmptyString,
  effort: Schema.NonEmptyString,
  /** The session's turns: the first answer and, when retried, the retry. */
  usage: TokenUsageSchema,
};

const CommittedFields = {
  ...revisionRecordManifestFields,
  outcome: Schema.Literal("committed"),
  commit: Schema.NonEmptyString,
};

const UnchangedFields = {
  ...revisionRecordManifestFields,
  outcome: Schema.Literal("unchanged"),
  commit: Schema.Null,
};

const FailedFields = {
  ...revisionRecordManifestFields,
  outcome: Schema.Literal("failed"),
  commit: Schema.Null,
  failure: RevisionFailureSchema,
};

/**
 * A revision record's `record.json` as phax writes it: `$schema` first, then
 * the manifest's fields. Born with `$schema`. Unknown keys are rejected, and
 * `commit` is a string exactly when the outcome is `committed`.
 */
export const RevisionRecordManifestFileSchema = Schema.Union([
  Schema.Struct({ $schema: schemaUrlField("revision-record-manifest"), ...CommittedFields }),
  Schema.Struct({ $schema: schemaUrlField("revision-record-manifest"), ...UnchangedFields }),
  Schema.Struct({ $schema: schemaUrlField("revision-record-manifest"), ...FailedFields }),
]);

export type RevisionRecordManifestFile = Schema.Schema.Type<
  typeof RevisionRecordManifestFileSchema
>;

/** A revision record manifest in memory: the file's fields without `$schema`. */
export type RevisionRecordManifest = RevisionRecordManifestFile extends infer F
  ? F extends unknown
    ? Omit<F, "$schema">
    : never
  : never;

export const decodeRevisionRecordManifestFile = Schema.decodeUnknownResult(
  RevisionRecordManifestFileSchema,
  { onExcessProperty: "error", reportInput: true },
);

export const encodeRevisionRecordManifest = Schema.encodeSync(RevisionRecordManifestFileSchema);

export function isRevisionRecordManifest(manifest: object): manifest is RevisionRecordManifest {
  return "kind" in manifest && manifest.kind === "revision";
}
