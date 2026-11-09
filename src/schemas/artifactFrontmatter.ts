import { Result, Predicate, Schema, SchemaIssue } from "effect";
import { PlanStatusSchema, SpecStatusSchema } from "./artifactStatus.js";
import { refusalMessage } from "./refusal/adapter.js";

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
  "completes-spec": Schema.Boolean.annotate(
    refusalMessage(
      (actual) =>
        `must be true or false, actual ${JSON.stringify(actual)} — true when this plan is its spec's last, false when more plans follow`,
    ),
  ).annotateKey({
    messageMissingKey:
      "is missing — a plan with a source-spec must say completes-spec: true (its run completes the spec) or false (more plans follow)",
  }),
  approved: Schema.optional(ApprovedStampSchema),
});

export const PlanFrontmatterSchema = Schema.Union([
  SpecLessPlanFrontmatterSchema,
  SpecBoundPlanFrontmatterSchema,
]);
export type PlanFrontmatter = Schema.Schema.Type<typeof PlanFrontmatterSchema>;

export const decodeSpecFrontmatter = Schema.decodeUnknownResult(SpecFrontmatterSchema, {
  onExcessProperty: "error",
  reportInput: true,
});

const decodeSpecLessPlanFrontmatter = Schema.decodeUnknownResult(SpecLessPlanFrontmatterSchema, {
  onExcessProperty: "error",
  reportInput: true,
});
const decodeSpecBoundPlanFrontmatter = Schema.decodeUnknownResult(SpecBoundPlanFrontmatterSchema, {
  onExcessProperty: "error",
  reportInput: true,
});

// The key phax refuses beside `source-spec: null`, with its own words.
const InconsistentCompletesSpec = Schema.Never.annotate({
  messageUnexpectedKey:
    "is inconsistent with source-spec: null — a plan without a source spec completes none; remove the key",
});

// Picks the variant from `source-spec` before decoding, so a failure reports
// only the chosen variant's issues instead of every union member's. A
// `completes-spec` beside `source-spec: null` is named as inconsistent rather
// than as a merely unexpected key.
export function decodePlanFrontmatter(
  value: unknown,
): Result.Result<PlanFrontmatter, Schema.SchemaError> {
  if (!Predicate.isRecord(value)) return decodeSpecLessPlanFrontmatter(value);
  const sourceSpec = value["source-spec"];
  if (sourceSpec === null && "completes-spec" in value) {
    return Result.fail(
      new Schema.SchemaError(
        new SchemaIssue.Pointer(
          ["completes-spec"],
          new SchemaIssue.UnexpectedKey(InconsistentCompletesSpec.ast, value["completes-spec"], {
            reportInput: true,
          }),
        ),
      ),
    );
  }
  return sourceSpec === null || sourceSpec === undefined
    ? decodeSpecLessPlanFrontmatter(value)
    : decodeSpecBoundPlanFrontmatter(value);
}
