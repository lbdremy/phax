// The `gate-report` document a report step prints on stdout in answer to the
// gate request: checked (findings and review notes) or refused (a reason and a
// remedy). phax reads it through the bridge's `readGateReport` and saves it as
// printed; it never writes or rewrites one, so there is no encoder.
import { Schema } from "effect";
import { described, reportFindingFields, uniqueFindingIds } from "./report.js";
import { schemaUrlField } from "./schemaUrl.js";

const GateFindingSchema = Schema.Struct(reportFindingFields);

/** One finding of a checked gate report. */
export type GateFinding = Schema.Schema.Type<typeof GateFindingSchema>;

const ReviewNoteSchema = Schema.Struct({
  owner: described(
    Schema.NonEmptyString,
    "Who should look at the note: a person or a team, in the provider's words.",
  ),
  note: described(Schema.NonEmptyString, "What a person should look at, in one line."),
});

/** One review note of a checked gate report. */
export type ReviewNote = Schema.Schema.Type<typeof ReviewNoteSchema>;

const CheckedGateReportFileSchema = Schema.Struct({
  $schema: schemaUrlField("gate-report"),
  outcome: described(
    Schema.Literal("checked"),
    "The step ran its checks: findings and review notes follow.",
  ),
  findings: described(
    uniqueFindingIds(Schema.Array(GateFindingSchema)),
    "What fails, in the provider's order, which is its rank: each the rule it breaks, where, what was found and how to fix it. Any finding fails the step, whatever its exit code; an empty list passes it on exit 0. Checked by phax's parser: no two findings share an id.",
  ),
  review: described(
    Schema.Array(ReviewNoteSchema),
    "Notes for a person, in the provider's order. A note never fails the step and reaches only the reviewer, never the agent. May be empty.",
  ),
});

const RefusedGateReportFileSchema = Schema.Struct({
  $schema: schemaUrlField("gate-report"),
  outcome: described(
    Schema.Literal("refused"),
    "The step declined to run its checks: the phase stops for the operator, with no fix attempt.",
  ),
  reason: described(Schema.NonEmptyString, "Why the step declined to run, in one line."),
  remedy: described(
    Schema.NonEmptyString,
    "What the operator does so that the step runs, in one line.",
  ),
});

/**
 * A `gate-report` document: `$schema`, then exactly the keys of one outcome.
 * Any other key is refused, at any level.
 */
export const GateReportFileSchema = Schema.Union(
  CheckedGateReportFileSchema,
  RefusedGateReportFileSchema,
);

export type GateReportFile = Schema.Schema.Type<typeof GateReportFileSchema>;

type WithoutSchema<T> = T extends unknown ? Omit<T, "$schema"> : never;

/** A gate report, without `$schema`: checked or refused. */
export type GateReport = WithoutSchema<GateReportFile>;

export const decodeGateReportFile = Schema.decodeUnknownEither(GateReportFileSchema, {
  onExcessProperty: "error",
});
