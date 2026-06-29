import { Schema } from "effect";
import { ExtractedPhaxPlanSchema } from "./phaxPlan.js";

export const ExtractedPlanCacheEntrySchema = Schema.Struct({
  version: Schema.Literal(1),
  key: Schema.NonEmptyString,
  planMdSha256: Schema.NonEmptyString,
  model: Schema.NonEmptyString,
  effort: Schema.NonEmptyString,
  extractorVersion: Schema.Number,
  extractedAt: Schema.NonEmptyString,
  extracted: ExtractedPhaxPlanSchema,
});

export type ExtractedPlanCacheEntry = Schema.Schema.Type<typeof ExtractedPlanCacheEntrySchema>;

export const decodeExtractedPlanCacheEntry = Schema.decodeUnknownEither(
  ExtractedPlanCacheEntrySchema,
  { onExcessProperty: "error" },
);

export const encodeExtractedPlanCacheEntry = Schema.encodeSync(ExtractedPlanCacheEntrySchema);
