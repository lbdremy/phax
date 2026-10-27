import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeRecordManifestFile } from "../../src/schemas/authoringRecord.js";
import {
  currentSchemaUrl,
  readRecordManifestFile,
  withSchemaUrl,
} from "../../src/schemas/persisted.js";
import {
  REVIEW_RECORD_FILES,
  ReviewRecordKindSchema,
  decodeReviewRecordManifestFile,
  encodeReviewRecordManifest,
  isReviewRecordManifest,
  type ReviewRecordKind,
  type ReviewRecordManifest,
} from "../../src/schemas/reviewRecord.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

// The review record manifest (spec headless-code-review §5.25): born with
// `$schema`, every key required, one shape for both reviews.

const REVIEWS: readonly ReviewRecordKind[] = ["compliance-review", "code-review"];

function manifest(review: ReviewRecordKind): ReviewRecordManifest {
  return { kind: "review", runId: "2610270900-example", review };
}

function file(review: ReviewRecordKind): Record<string, unknown> {
  return {
    ...encodeReviewRecordManifest(withSchemaUrl("review-record-manifest", manifest(review))),
  };
}

describe("the review record manifest", () => {
  it.each(REVIEWS)("decodes a %s manifest and writes $schema first", (review) => {
    const written = file(review);
    expect(Object.keys(written)).toEqual(["$schema", "kind", "runId", "review"]);
    expect(written["$schema"]).toBe(currentSchemaUrl("review-record-manifest"));
    expect(written["$schema"]).toBe(schemaUrl("review-record-manifest", "0.29.0"));
    expect(Either.isRight(decodeReviewRecordManifestFile(written))).toBe(true);
  });

  it("names each review's file by its kind", () => {
    expect(REVIEW_RECORD_FILES).toEqual({
      "compliance-review": "compliance-review.json",
      "code-review": "code-review.json",
    });
    expect(Object.keys(REVIEW_RECORD_FILES).toSorted()).toEqual(
      [...ReviewRecordKindSchema.literals].toSorted(),
    );
  });

  it.each([
    ["an unknown key", { ...file("compliance-review"), shape: "full" }],
    ["a missing runId", { ...file("compliance-review"), runId: undefined }],
    ["an empty runId", { ...file("compliance-review"), runId: "" }],
    ["a missing review", { ...file("code-review"), review: undefined }],
    ["a review outside the two kinds", { ...file("code-review"), review: "style-review" }],
    ["a wrong kind", { ...file("code-review"), kind: "decision" }],
    ["no $schema", { ...file("code-review"), $schema: undefined }],
  ])("refuses %s", (_label, input) => {
    expect(Either.isLeft(decodeReviewRecordManifestFile(input))).toBe(true);
  });

  it("is told apart by its kind, and read by the bridge reader without its $schema", () => {
    expect(isReviewRecordManifest(manifest("code-review"))).toBe(true);
    expect(isReviewRecordManifest({ kind: "decision" })).toBe(false);
    expect(isReviewRecordManifest({})).toBe(false);
    for (const review of REVIEWS) {
      const read = readRecordManifestFile("record.json", file(review));
      expect(Either.isRight(read) && read.right).toEqual(manifest(review));
      expect(Either.isRight(decodeRecordManifestFile(file(review)))).toBe(true);
    }
  });

  it("is born with $schema: the reader refuses a manifest without one", () => {
    const { $schema: _schema, ...bare } = file("compliance-review");
    expect(Either.isLeft(readRecordManifestFile("record.json", bare))).toBe(true);
  });
});
