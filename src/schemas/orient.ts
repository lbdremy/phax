import { Schema } from "effect";

export const OrientSeveritySchema = Schema.Union(
  Schema.Literal("error"),
  Schema.Literal("warn"),
  Schema.Literal("info"),
);

export type OrientSeverity = Schema.Schema.Type<typeof OrientSeveritySchema>;

export const OrientRowSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  severity: OrientSeveritySchema,
  trigger: Schema.NonEmptyString,
});

export type OrientRow = Schema.Schema.Type<typeof OrientRowSchema>;

export const OrientIndexResponseSchema = Schema.Struct({
  rows: Schema.Array(OrientRowSchema),
});

export type OrientIndexResponse = Schema.Schema.Type<typeof OrientIndexResponseSchema>;

export const OrientExpandedRowSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  severity: OrientSeveritySchema,
  trigger: Schema.NonEmptyString,
  body: Schema.NonEmptyString,
});

export type OrientExpandedRow = Schema.Schema.Type<typeof OrientExpandedRowSchema>;

export const OrientExpandResponseSchema = Schema.Struct({
  row: Schema.NullOr(OrientExpandedRowSchema),
});

export type OrientExpandResponse = Schema.Schema.Type<typeof OrientExpandResponseSchema>;

export const decodeOrientIndexResponse = Schema.decodeUnknownEither(OrientIndexResponseSchema);
export const decodeOrientExpandResponse = Schema.decodeUnknownEither(OrientExpandResponseSchema);
