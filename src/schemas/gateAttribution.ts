import { Schema } from "effect";
import { schemaUrlField } from "./schemaUrl.js";
import { isExportedPattern } from "./strictString.js";
import { SurfaceSchema } from "./surface.js";

/** A UTC instant with milliseconds, as `Date.prototype.toISOString` writes it. */
const InstantSchema = Schema.String.check(
  isExportedPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
);

/** A time phax measured: the instant it started and its whole-millisecond duration. */
const MeasuredTimeSchema = Schema.Struct({
  kind: Schema.Literal("measured"),
  startedAt: InstantSchema,
  durationMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type MeasuredTime = Schema.Schema.Type<typeof MeasuredTimeSchema>;

/** A time no one recorded: a document written before times were. */
const UnknownTimeSchema = Schema.Struct({ kind: Schema.Literal("unknown") });

/** The time of a step that never ran: a skipped acceptance step. */
const NotRunTimeSchema = Schema.Struct({ kind: Schema.Literal("not-run") });

/** The time of a step that started, of the attempt or of a protected-paths check. */
const RecordedTimeSchema = Schema.Union([MeasuredTimeSchema, UnknownTimeSchema]);

/** A step of the phase's configured gate: surface local | structural | product. */
const ConfiguredStepResultSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  surface: SurfaceSchema,
  result: Schema.Literals(["pass", "fail", "refused"]),
  time: RecordedTimeSchema,
});

/**
 * The acceptance step: carried only by the step phax appends at an acceptance
 * pair's gate. `skipped` records `phax resume --skip-acceptance`: the step was not
 * run, so its time is `not-run`; a step that ran has a recorded time.
 */
const AcceptanceStepResultSchema = Schema.Union([
  Schema.Struct({
    command: Schema.NonEmptyString,
    surface: Schema.Literal("acceptance"),
    result: Schema.Literals(["pass", "fail", "refused"]),
    time: RecordedTimeSchema,
  }),
  Schema.Struct({
    command: Schema.NonEmptyString,
    surface: Schema.Literal("acceptance"),
    result: Schema.Literal("skipped"),
    time: NotRunTimeSchema,
  }),
]);

export type AcceptanceStepResult = Schema.Schema.Type<typeof AcceptanceStepResultSchema>;

const GateStepResultSchema = Schema.Union([ConfiguredStepResultSchema, AcceptanceStepResultSchema]);

export type GateStepResult = Schema.Schema.Type<typeof GateStepResultSchema>;

/**
 * How a protected path changed in the phase, by what the observation shows:
 * `symlink` and `nested-repository` name a symbolic link or a nested
 * repository a protected glob could reach below, which the check cannot see
 * through.
 */
const ProtectedChangeKindSchema = Schema.Literals([
  "created",
  "edited",
  "deleted",
  "renamed",
  "symlink",
  "nested-repository",
]);

const ProtectedChangeSchema = Schema.Struct({
  path: Schema.NonEmptyString,
  kind: ProtectedChangeKindSchema,
  entry: Schema.NonEmptyString,
});

/**
 * The protected-paths check of an attempt: `null` when it was not run (no list
 * declared, or a stop's close), else a pass with no change or a fail with at
 * least one, each with the check's time.
 */
const ProtectedPathsResultSchema = Schema.NullOr(
  Schema.Union([
    Schema.Struct({
      result: Schema.Literal("pass"),
      changes: Schema.Tuple([]),
      time: RecordedTimeSchema,
    }),
    Schema.Struct({
      result: Schema.Literal("fail"),
      changes: Schema.NonEmptyArray(ProtectedChangeSchema),
      time: RecordedTimeSchema,
    }),
  ]),
);

export type ProtectedPathsResult = Schema.Schema.Type<typeof ProtectedPathsResultSchema>;

const gateAttributionFields = {
  phase: Schema.NonEmptyString,
  time: RecordedTimeSchema,
  steps: Schema.Array(GateStepResultSchema),
  protectedPaths: ProtectedPathsResultSchema,
};

const GateAttributionSchema = Schema.Struct(gateAttributionFields);

export type GateAttribution = Schema.Schema.Type<typeof GateAttributionSchema>;

/**
 * `gate-attribution.json` as phax writes it: `$schema` first, then the
 * attribution's fields. Unknown keys are ignored.
 */
export const GateAttributionFileSchema = Schema.Struct({
  $schema: schemaUrlField("gate-attribution"),
  ...gateAttributionFields,
});

export type GateAttributionFile = Schema.Schema.Type<typeof GateAttributionFileSchema>;

export const decodeGateAttributionFile = Schema.decodeUnknownResult(GateAttributionFileSchema, {
  reportInput: true,
});
export const encodeGateAttributionFile = Schema.encodeSync(GateAttributionFileSchema);
