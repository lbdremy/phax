import { Schema } from "effect";
import { OrientRowSchema } from "./orient.js";

const OrientBriefOkSchema = Schema.Struct({
  kind: Schema.Literal("ok"),
  files: Schema.Array(Schema.NonEmptyString),
  rows: Schema.Array(OrientRowSchema),
  rowCount: Schema.Number,
  wovenRowCount: Schema.Number,
});

const OrientBriefFailedSchema = Schema.Struct({
  kind: Schema.Literal("failed"),
  files: Schema.Array(Schema.NonEmptyString),
  error: Schema.NonEmptyString,
});

const OrientBriefNotConfiguredSchema = Schema.Struct({
  kind: Schema.Literal("not-configured"),
});

export const OrientBriefSchema = Schema.Union(
  OrientBriefOkSchema,
  OrientBriefFailedSchema,
  OrientBriefNotConfiguredSchema,
);

export type OrientBrief = Schema.Schema.Type<typeof OrientBriefSchema>;

export const decodeOrientBrief = Schema.decodeUnknownEither(OrientBriefSchema, {
  onExcessProperty: "error",
});
export const encodeOrientBrief = Schema.encodeSync(OrientBriefSchema);
