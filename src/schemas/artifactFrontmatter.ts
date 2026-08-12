import { Schema } from "effect";
import { PlanStatusSchema, SpecStatusSchema } from "./artifactStatus.js";

export const SpecFrontmatterSchema = Schema.Struct({
  status: SpecStatusSchema,
  date: Schema.String,
  audience: Schema.String,
  scope: Schema.String,
});
export type SpecFrontmatter = Schema.Schema.Type<typeof SpecFrontmatterSchema>;

export const PlanApprovedSchema = Schema.Struct({
  date: Schema.String,
  baseline: Schema.NonEmptyString,
});

export const PlanFrontmatterSchema = Schema.Struct({
  status: PlanStatusSchema,
  "source-spec": Schema.NullOr(Schema.NonEmptyString),
  approved: Schema.optional(PlanApprovedSchema),
});
export type PlanFrontmatter = Schema.Schema.Type<typeof PlanFrontmatterSchema>;

export const decodeSpecFrontmatter = Schema.decodeUnknownEither(SpecFrontmatterSchema, {
  onExcessProperty: "error",
});
export const decodePlanFrontmatter = Schema.decodeUnknownEither(PlanFrontmatterSchema, {
  onExcessProperty: "error",
});
