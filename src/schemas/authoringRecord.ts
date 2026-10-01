import { Schema } from "effect";
import { ProviderIdSchema } from "./providerId.js";
import { RecordShapeSchema, RunRecordManifestSchema, TokenUsageSchema } from "./runRecord.js";

/**
 * An authoring session ends in one of two ways: its artifact commit landed, or
 * it did not (the agent failed, its document was rejected, or the commit
 * failed). There is no pause — a headless session is never resumed.
 */
export const AuthoringRecordOutcomeSchema = Schema.Literal("committed", "failed");

export type AuthoringRecordOutcome = Schema.Schema.Type<typeof AuthoringRecordOutcomeSchema>;

/**
 * The manifest (`record.json`) of one headless authoring session, keyed
 * `authoring/<authoringId>` on `phax/records/v1`. A distinct kind beside the
 * phase manifest (`RunRecordManifestSchema`), which stays unchanged. Like the
 * phase manifest, `sourceSha` is a back-reference to the artifact commit and
 * is absent when the session did not commit; the record's address is the
 * `Authoring-Id`.
 */
export const AuthoringRecordManifestSchema = Schema.Struct({
  version: Schema.Literal(1),
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
  usage: TokenUsageSchema,
});

export type AuthoringRecordManifest = Schema.Schema.Type<typeof AuthoringRecordManifestSchema>;

/**
 * An authoring record's `record.json` as phax writes it: today's schema until
 * the manifest gains `$schema`.
 * @alias
 */
export const AuthoringRecordManifestFileSchema = AuthoringRecordManifestSchema;

export const decodeAuthoringRecordManifestFile = Schema.decodeUnknownEither(
  AuthoringRecordManifestFileSchema,
  { onExcessProperty: "error" },
);

export const encodeAuthoringRecordManifest = Schema.encodeSync(AuthoringRecordManifestSchema);

/** Any `record.json` on the records branch: a phase record or an authoring record. */
export const RecordManifestSchema = Schema.Union(
  RunRecordManifestSchema,
  AuthoringRecordManifestSchema,
);

export type RecordManifest = Schema.Schema.Type<typeof RecordManifestSchema>;

/**
 * Any `record.json` as phax writes it: the union of the two file schemas.
 * @alias
 */
export const RecordManifestFileSchema = RecordManifestSchema;

export const decodeRecordManifestFile = Schema.decodeUnknownEither(RecordManifestFileSchema, {
  onExcessProperty: "error",
});

export function isAuthoringRecordManifest(
  manifest: RecordManifest,
): manifest is AuthoringRecordManifest {
  return "kind" in manifest && manifest.kind === "authoring";
}
