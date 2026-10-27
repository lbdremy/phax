import { Schema } from "effect";
import { schemaUrlField } from "./schemaUrl.js";

/**
 * The run-level reviews a review entry can carry. `code-review` joins the set
 * with the headless code review; nothing writes it before then.
 */
export const ReviewRecordKindSchema = Schema.Literal("compliance-review", "code-review");

export type ReviewRecordKind = Schema.Schema.Type<typeof ReviewRecordKindSchema>;

export const isReviewRecordKind = Schema.is(ReviewRecordKindSchema);

/** The review's own file, named by its kind: the one artifact a review entry carries. */
export const REVIEW_RECORD_FILES: { readonly [K in ReviewRecordKind]: string } = {
  "compliance-review": "compliance-review.json",
  "code-review": "code-review.json",
};

/**
 * The manifest (`record.json`) of one review entry, keyed `<runId>/<review>` on
 * `phax/records/v1` beside the run's phase records. A distinct kind beside the
 * phase, authoring and decision manifests. It records no shape, usage or source
 * sha: the review's own file is the entry's only other file.
 */
const reviewRecordManifestFields = {
  kind: Schema.Literal("review"),
  runId: Schema.NonEmptyString,
  review: ReviewRecordKindSchema,
};

/** A review record manifest in memory: never a `$schema`. */
export type ReviewRecordManifest = Schema.Struct.Type<typeof reviewRecordManifestFields>;

/**
 * A review record's `record.json` as phax writes it: `$schema` first, then the
 * manifest's fields. Born with `$schema`. Every key is required and unknown
 * keys are rejected.
 */
export const ReviewRecordManifestFileSchema = Schema.Struct({
  $schema: schemaUrlField("review-record-manifest"),
  ...reviewRecordManifestFields,
});

export type ReviewRecordManifestFile = Schema.Schema.Type<typeof ReviewRecordManifestFileSchema>;

export const decodeReviewRecordManifestFile = Schema.decodeUnknownEither(
  ReviewRecordManifestFileSchema,
  { onExcessProperty: "error" },
);

export const encodeReviewRecordManifest = Schema.encodeSync(ReviewRecordManifestFileSchema);

export function isReviewRecordManifest(manifest: object): manifest is ReviewRecordManifest {
  return "kind" in manifest && manifest.kind === "review";
}
