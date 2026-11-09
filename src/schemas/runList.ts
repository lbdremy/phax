// The `run-list` document: what `phax ls --json` prints. Born with `$schema`;
// every key of a row is required (null when unknown), and any other key is
// refused. The 0.30.0 shape, without `pullRequest`, is frozen in
// history/run-list/0.30.0.ts. A row's `stop` is the run's review-stop document while the run
// awaits review, so a review UI needs no second read.
import { Schema } from "effect";
import { ReviewStopFileSchema } from "./reviewStop.js";
import { schemaUrlField } from "./schemaUrl.js";
import { RunStateSchema } from "./status.js";

const strictKeys = { parseOptions: { onExcessProperty: "error" } } as const;

export const RunListRowSchema = Schema.Struct({
  qualifiedName: Schema.NonEmptyString.annotate({
    description: "The run's qualified name: `<namespace>.<short name>`.",
  }),
  namespace: Schema.String,
  shortName: Schema.NonEmptyString,
  state: RunStateSchema,
  branch: Schema.String,
  currentPhase: Schema.NullOr(Schema.String).annotate({
    description: "The phase the run reached as `<n>/<total>`, or null when unknown.",
  }),
  gateProfile: Schema.NullOr(Schema.String).annotate({
    description: "The run's gate profile, or null when unknown.",
  }),
  updatedAt: Schema.String.annotate({
    description: "The run's last update, as `YYYY-MM-DD HH:MM`.",
  }),
  lockState: Schema.Literals(["none", "active", "stale"]),
  recordsPending: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
    description: "The count of pending records, or null when records are off or not readable here.",
  }),
  archivePath: Schema.NullOr(Schema.String).annotate({
    description: "Where an archived run was moved, or null.",
  }),
  stop: Schema.NullOr(ReviewStopFileSchema).annotate({
    description:
      "The run's review-stop document while it awaits review; null when the run is not awaiting review, or when its review-stop document cannot be read.",
  }),
  pullRequest: Schema.NullOr(Schema.NonEmptyString).annotate({
    description:
      "The URL of the pull request phax opened for the run, or null when it opened none or its publication record cannot be read.",
  }),
}).annotate(strictKeys);

/** A `run-list` document: the rows of `phax ls --json`. */
export const RunListFileSchema = Schema.Struct({
  $schema: schemaUrlField("run-list"),
  runs: Schema.Array(RunListRowSchema),
}).annotate(strictKeys);

export type RunListRow = Schema.Schema.Type<typeof RunListRowSchema>;
export type RunListFile = Schema.Schema.Type<typeof RunListFileSchema>;
/** A run list without `$schema`. */
export type RunList = Omit<RunListFile, "$schema">;

export const decodeRunListFile = Schema.decodeUnknownResult(RunListFileSchema, {
  onExcessProperty: "error",
  reportInput: true,
});

export const encodeRunListFile = Schema.encodeSync(RunListFileSchema);
