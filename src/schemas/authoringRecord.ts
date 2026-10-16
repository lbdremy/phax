import { Schema, type Types } from "effect";
import { DecisionRecordManifestFileSchema, type DecisionRecordManifest } from "./decisionRecord.js";
import { ProviderIdSchema } from "./providerId.js";
import {
  RecordShapeSchema,
  RunRecordManifestFileSchema,
  TokenUsageSchema,
  type RunRecordManifest,
} from "./runRecord.js";
import { schemaUrlField } from "./schemaUrl.js";

/**
 * An authoring session ends in one of two ways: its artifact commit landed, or
 * it did not (the agent failed, its document was rejected, or the commit
 * failed). There is no pause: a headless session is resumed at most once, to
 * retry a refused document, and never waits on a person.
 */
export const AuthoringRecordOutcomeSchema = Schema.Literal("committed", "failed");

export type AuthoringRecordOutcome = Schema.Schema.Type<typeof AuthoringRecordOutcomeSchema>;

/**
 * Whether the session was resumed to retry a refused document: `none` when
 * its first answer was the only one, `retried` once the resume was attempted
 * (even when the resume itself failed).
 */
export const AuthoringRecordRetrySchema = Schema.Literal("none", "retried");

export type AuthoringRecordRetry = Schema.Schema.Type<typeof AuthoringRecordRetrySchema>;

/**
 * The manifest (`record.json`) of one headless authoring session, keyed
 * `authoring/<authoringId>` on `phax/records/v1`. A distinct kind beside the
 * phase manifest (`RunRecordManifestFileSchema`). Like the phase manifest,
 * `sourceSha` is a back-reference to the artifact commit and is absent when
 * the session did not commit; the record's address is the `Authoring-Id`.
 */
const authoringRecordManifestFields = {
  kind: Schema.Literal("authoring"),
  authoringId: Schema.NonEmptyString,
  /** Repo-relative path of the artifact the session authored (or would have). */
  artifact: Schema.NonEmptyString,
  artifactKind: Schema.Literal("spec", "plan"),
  shape: RecordShapeSchema,
  sourceSha: Schema.optional(Schema.NonEmptyString),
  provider: ProviderIdSchema,
  model: Schema.NonEmptyString,
  effort: Schema.NonEmptyString,
  outcome: AuthoringRecordOutcomeSchema,
  retry: AuthoringRecordRetrySchema,
  /** Every turn of the session: the first answer and, when retried, the retry. */
  usage: TokenUsageSchema,
};

/** An authoring record manifest in memory: never a `version`, never a `$schema`. */
export type AuthoringRecordManifest = Types.Simplify<
  Schema.Struct.Type<typeof authoringRecordManifestFields>
>;

/**
 * An authoring record's `record.json` as phax writes it: `$schema` first, then
 * the manifest's fields. Unknown keys are rejected.
 */
export const AuthoringRecordManifestFileSchema = Schema.Struct({
  $schema: schemaUrlField("authoring-record-manifest"),
  ...authoringRecordManifestFields,
});

export type AuthoringRecordManifestFile = Schema.Schema.Type<
  typeof AuthoringRecordManifestFileSchema
>;

export const decodeAuthoringRecordManifestFile = Schema.decodeUnknownEither(
  AuthoringRecordManifestFileSchema,
  { onExcessProperty: "error" },
);

export const encodeAuthoringRecordManifest = Schema.encodeSync(AuthoringRecordManifestFileSchema);

/**
 * Any `record.json` on the records branch, in memory: a phase record, an
 * authoring record or a decision record.
 */
export type RecordManifest = RunRecordManifest | AuthoringRecordManifest | DecisionRecordManifest;

/** Any `record.json` as phax writes it: the union of the three file schemas. */
export const RecordManifestFileSchema = Schema.Union(
  RunRecordManifestFileSchema,
  AuthoringRecordManifestFileSchema,
  DecisionRecordManifestFileSchema,
);

export type RecordManifestFile = Schema.Schema.Type<typeof RecordManifestFileSchema>;

/**
 * The `record-manifest` union the schemas package renders: the file union.
 * @alias
 */
export const RecordManifestSchema = RecordManifestFileSchema;

export const decodeRecordManifestFile = Schema.decodeUnknownEither(RecordManifestFileSchema, {
  onExcessProperty: "error",
});

export function isAuthoringRecordManifest(
  manifest: RecordManifest,
): manifest is AuthoringRecordManifest {
  return "kind" in manifest && manifest.kind === "authoring";
}
