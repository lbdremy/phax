import { Either, ParseResult, Predicate, Schema } from "effect";
import { PlanStatusSchema, SpecStatusSchema } from "./artifactStatus.js";

export const ApprovedStampSchema = Schema.Struct({
  date: Schema.String,
  baseline: Schema.NonEmptyString,
});

export const SpecFrontmatterSchema = Schema.Struct({
  status: SpecStatusSchema,
  date: Schema.String,
  audience: Schema.String,
  scope: Schema.String,
  approved: Schema.optional(ApprovedStampSchema),
});
export type SpecFrontmatter = Schema.Schema.Type<typeof SpecFrontmatterSchema>;

// A plan without a source spec completes none, so it carries no `completes-spec`.
export const SpecLessPlanFrontmatterSchema = Schema.Struct({
  status: PlanStatusSchema,
  "source-spec": Schema.Null,
  approved: Schema.optional(ApprovedStampSchema),
});

// A plan naming a source spec states whether its run completes that spec.
export const SpecBoundPlanFrontmatterSchema = Schema.Struct({
  status: PlanStatusSchema,
  "source-spec": Schema.NonEmptyString,
  "completes-spec": Schema.propertySignature(
    Schema.Boolean.annotations({
      message: (issue) =>
        `must be true or false, actual ${JSON.stringify(issue.actual)} — true when this plan is its spec's last, false when more plans follow`,
    }),
  ).annotations({
    missingMessage: () =>
      "is missing — a plan with a source-spec must say completes-spec: true (its run completes the spec) or false (more plans follow)",
  }),
  approved: Schema.optional(ApprovedStampSchema),
});

export const PlanFrontmatterSchema = Schema.Union(
  SpecLessPlanFrontmatterSchema,
  SpecBoundPlanFrontmatterSchema,
);
export type PlanFrontmatter = Schema.Schema.Type<typeof PlanFrontmatterSchema>;

export const decodeSpecFrontmatter = Schema.decodeUnknownEither(SpecFrontmatterSchema, {
  onExcessProperty: "error",
});

const decodeSpecLessPlanFrontmatter = Schema.decodeUnknownEither(SpecLessPlanFrontmatterSchema, {
  onExcessProperty: "error",
});
const decodeSpecBoundPlanFrontmatter = Schema.decodeUnknownEither(SpecBoundPlanFrontmatterSchema, {
  onExcessProperty: "error",
});

// Picks the variant from `source-spec` before decoding, so a failure reports
// only the chosen variant's issues instead of every union member's. A
// `completes-spec` beside `source-spec: null` is named as inconsistent rather
// than as a merely unexpected key.
export function decodePlanFrontmatter(
  value: unknown,
): Either.Either<PlanFrontmatter, ParseResult.ParseError> {
  if (!Predicate.isRecord(value)) return decodeSpecLessPlanFrontmatter(value);
  const sourceSpec = value["source-spec"];
  if (sourceSpec === null && "completes-spec" in value) {
    return Either.left(
      ParseResult.parseError(
        new ParseResult.Pointer(
          "completes-spec",
          value,
          new ParseResult.Unexpected(
            value["completes-spec"],
            "is inconsistent with source-spec: null — a plan without a source spec completes none; remove the key",
          ),
        ),
      ),
    );
  }
  return sourceSpec === null || sourceSpec === undefined
    ? decodeSpecLessPlanFrontmatter(value)
    : decodeSpecBoundPlanFrontmatter(value);
}
