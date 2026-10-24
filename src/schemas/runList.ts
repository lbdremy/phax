// The `run-list` document: what `phax ls --json` prints. Born with `$schema`;
// every key of a row is required (null when unknown), and any other key is
// refused. A row's `stop` is the run's review-stop document while the run
// awaits review, so a review UI needs no second read.
import { Schema } from "effect";
import { ReviewStopFileSchema } from "./reviewStop.js";
import { schemaUrlField } from "./schemaUrl.js";
import { RunStateSchema } from "./status.js";

const strictKeys = { parseOptions: { onExcessProperty: "error" } } as const;

export const RunListRowSchema = Schema.Struct({
  qualifiedName: Schema.NonEmptyString.annotations({
    description: "The run's qualified name: `<namespace>.<short name>`.",
  }),
  namespace: Schema.String,
  shortName: Schema.NonEmptyString,
  state: RunStateSchema,
  branch: Schema.String,
  currentPhase: Schema.NullOr(Schema.String).annotations({
    description: "The phase the run reached as `<n>/<total>`, or null when unknown.",
  }),
  gateProfile: Schema.NullOr(Schema.String).annotations({
    description: "The run's gate profile, or null when unknown.",
  }),
  updatedAt: Schema.String.annotations({
    description: "The run's last update, as `YYYY-MM-DD HH:MM`.",
  }),
  lockState: Schema.Literal("none", "active", "stale"),
  recordsPending: Schema.NullOr(Schema.Int.pipe(Schema.greaterThanOrEqualTo(0))).annotations({
    description: "The count of pending records, or null when records are off or not readable here.",
  }),
  archivePath: Schema.NullOr(Schema.String).annotations({
    description: "Where an archived run was moved, or null.",
  }),
  stop: Schema.NullOr(ReviewStopFileSchema).annotations({
    description:
      "The run's review-stop document while it awaits review; null when the run is not awaiting review, or when its review-stop document cannot be read.",
  }),
}).annotations(strictKeys);

/** A `run-list` document: the rows of `phax ls --json`. */
export const RunListFileSchema = Schema.Struct({
  $schema: schemaUrlField("run-list"),
  runs: Schema.Array(RunListRowSchema),
}).annotations(strictKeys);

export type RunListRow = Schema.Schema.Type<typeof RunListRowSchema>;
export type RunListFile = Schema.Schema.Type<typeof RunListFileSchema>;
/** A run list without `$schema`. */
export type RunList = Omit<RunListFile, "$schema">;

export const decodeRunListFile = Schema.decodeUnknownEither(RunListFileSchema, {
  onExcessProperty: "error",
});

export const encodeRunListFile = Schema.encodeSync(RunListFileSchema);
