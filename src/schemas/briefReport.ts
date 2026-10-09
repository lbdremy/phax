// The `brief-report` document a brief provider prints on stdout in answer to
// the brief request: the rules over the requested paths and the findings
// there, each with its due. It has no outcome: a provider that declines to run
// exits non-zero. phax reads it through the bridge's `readBriefReport` and a
// brief record keeps it as printed; there is no encoder.
import { Schema } from "effect";
import { ReportGuideSchema, described, reportFindingFields, uniqueFindingIds } from "./report.js";
import { schemaUrlField } from "./schemaUrl.js";

const BriefRuleSchema = Schema.Struct({
  rule: described(
    Schema.NonEmptyString,
    "What a file at these paths must or must not do, in plain words.",
  ),
  files: described(
    Schema.NonEmptyArray(Schema.NonEmptyString),
    "The requested paths the rule covers, relative to the working tree, including files not written yet. At least one.",
  ),
  guide: described(
    Schema.NullOr(ReportGuideSchema),
    "How to comply with the rule: a summary and a file to read, or null when the provider gives none.",
  ),
});

/** One rule of a brief report. */
export type BriefRule = Schema.Schema.Type<typeof BriefRuleSchema>;

const BriefFindingSchema = Schema.Struct({
  ...reportFindingFields,
  due: described(
    Schema.NullOr(Schema.Literal("this-phase", "later")),
    "The provider's word on when the finding must be closed: this-phase, later, or null when the request carried no phase facts. phax never computes or checks it.",
  ),
});

/** One finding of a brief report. */
export type BriefFinding = Schema.Schema.Type<typeof BriefFindingSchema>;

/**
 * A `brief-report` document: `$schema`, `rules` and `findings`. Any other key
 * is refused, at any level.
 */
export const BriefReportFileSchema = Schema.Struct({
  $schema: schemaUrlField("brief-report"),
  rules: described(
    Schema.Array(BriefRuleSchema),
    "The rules over the requested paths, in the provider's order, which is its rank. May be empty.",
  ),
  findings: described(
    uniqueFindingIds(Schema.Array(BriefFindingSchema)),
    "What fails at the requested paths, in the provider's order, which is its rank: each the rule it breaks, where, what was found, how to fix it and when. May be empty. Checked by phax's parser: no two findings share an id.",
  ),
});

export type BriefReportFile = Schema.Schema.Type<typeof BriefReportFileSchema>;

/** A brief report, without `$schema`. */
export type BriefReport = Omit<BriefReportFile, "$schema">;

export const decodeBriefReportFile = Schema.decodeUnknownEither(BriefReportFileSchema, {
  onExcessProperty: "error",
});
