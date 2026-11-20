// The `record.json` of one finding's fate record on `phax/records/v1` (spec
// finding-ids-and-fates). One record is one commit keyed `<runId>/finding/<id>/<NN>`;
// the latest record in branch order decides the fate. Born with `$schema`. The
// entry (the fate and its facts, without the envelope) is also the item of
// `finding-list`'s `history`. Imports only `effect` and schema modules, because
// the schemas package publishes it.
import { Schema } from "effect";
import { GRANT_PATTERN } from "./approvedBy.js";
import { PATH_CLASSES, PathClassSchema } from "./pathClass.js";
import { TimestampSchema } from "./questions.js";
import { refusalOverride } from "./refusal/adapter.js";
import { schemaUrlField } from "./schemaUrl.js";
import { NonEmptyString, isExportedPattern } from "./strictString.js";

const strictKeys = { parseOptions: { onExcessProperty: "error" } } as const;

/** A finding's id: `F<n>` for a code-review finding, `C<n>` for a compliance finding. */
const FindingIdSchema = Schema.String.check(isExportedPattern(/^[FC][1-9][0-9]*$/)).pipe(
  Schema.annotate({
    description: "A finding id: F<n> (code review) or C<n> (compliance review).",
    ...refusalOverride(
      (actual) => `${JSON.stringify(actual)} is not a finding id (expected the form F<n> or C<n>)`,
    ),
  }),
);

/** A git commit sha: lowercase hex, 40 (sha-1) or 64 (sha-256) characters. */
const CommitShaSchema = Schema.String.check(
  isExportedPattern(/^([0-9a-f]{40}|[0-9a-f]{64})$/),
).pipe(Schema.annotate({ description: "A git commit sha, lowercase hex of 40 or 64 characters." }));

const OperatorSchema = Schema.Struct({
  kind: Schema.Literal("operator"),
  name: NonEmptyString.annotate({ description: "The operator's git user.name." }),
}).annotate(strictKeys);

/** Who set a dismissal or a deferral: an operator only. */
const OperatorBySchema = OperatorSchema;

/** Who recorded a fix: an operator, or a machine by its grant. */
const FixedBySchema = Schema.Union([
  OperatorSchema,
  Schema.Struct({
    kind: Schema.Literal("machine"),
    grant: Schema.String.check(isExportedPattern(GRANT_PATTERN)).pipe(
      Schema.annotate({
        description: "The grant the machine declared with `--by machine:<grant>`.",
      }),
    ),
  }).annotate(strictKeys),
]);

const classesInOrder = Schema.makeFilter<ReadonlyArray<string>>(
  (classes) => {
    const expected = PATH_CLASSES.filter((cls) => classes.includes(cls));
    return (
      (classes.length === expected.length && classes.every((cls, i) => cls === expected[i])) ||
      `must list each class once, in the order ${PATH_CLASSES.join(", ")}`
    );
  },
  {
    description: `Each class once, in the order ${PATH_CLASSES.join(", ")} (the order checked by phax, not by this JSON Schema).`,
    toJsonSchema: () => ({ uniqueItems: true }),
  },
);

const PathClassesSchema = Schema.Array(PathClassSchema)
  .check(Schema.isMinLength(1))
  .check(classesInOrder)
  .annotate({
    description: `The classes of the fix commit's changed paths, each once, in the order ${PATH_CLASSES.join(", ")}.`,
  });

/** A fix: the commit, the classes of its paths, and who recorded it. */
const FixedFateEntrySchema = Schema.Struct({
  fate: Schema.Literal("fixed"),
  commit: CommitShaSchema,
  pathClasses: PathClassesSchema,
  by: FixedBySchema,
  at: TimestampSchema,
}).annotate(strictKeys);

/** The verdict of a dismissal: a decided verdict that chooses dismiss, by an operator. */
const FindingDismissalVerdictSchema = Schema.Struct({
  kind: Schema.Literal("decided"),
  chosen: Schema.Literal("dismiss"),
  abandoned: Schema.Tuple([Schema.Literal("fix"), Schema.Literal("defer")]),
  why: NonEmptyString,
  advocate: NonEmptyString.annotate({
    description: "The strongest case for fixing the finding: its suggestion or message.",
  }),
  principles: Schema.Tuple([]),
  reversibility: Schema.Literal("cheap"),
  by: OperatorBySchema,
  at: TimestampSchema,
  revised: Schema.Tuple([]),
}).annotate(strictKeys);

/** A dismissal: the finding is not worth fixing, decided by an operator. */
const DismissedFateEntrySchema = Schema.Struct({
  fate: Schema.Literal("dismissed"),
  verdict: FindingDismissalVerdictSchema,
}).annotate(strictKeys);

/** A deferral: another document takes the finding over, decided by an operator. */
const DeferredFateEntrySchema = Schema.Struct({
  fate: Schema.Literal("deferred"),
  to: NonEmptyString.annotate({
    description:
      "The repository-relative path of the brief, spec or NEXT_STEPS.md that takes the finding over, tracked when recorded.",
  }),
  why: NonEmptyString,
  by: OperatorBySchema,
  at: TimestampSchema,
}).annotate(strictKeys);

/** One fate record's entry: a fix, a dismissal or a deferral. */
export const FindingFateEntrySchema = Schema.Union([
  FixedFateEntrySchema,
  DismissedFateEntrySchema,
  DeferredFateEntrySchema,
]);
export type FindingFateEntry = Schema.Schema.Type<typeof FindingFateEntrySchema>;

const envelope = {
  kind: Schema.Literal("finding-fate"),
  runId: NonEmptyString,
  finding: FindingIdSchema,
};

/** A fate record's `record.json` as phax writes it: `$schema` first, then the envelope and the entry. */
export const FindingFateRecordManifestFileSchema = Schema.Union([
  Schema.Struct({
    $schema: schemaUrlField("finding-fate-record-manifest"),
    ...envelope,
    ...FixedFateEntrySchema.fields,
  }).annotate(strictKeys),
  Schema.Struct({
    $schema: schemaUrlField("finding-fate-record-manifest"),
    ...envelope,
    ...DismissedFateEntrySchema.fields,
  }).annotate(strictKeys),
  Schema.Struct({
    $schema: schemaUrlField("finding-fate-record-manifest"),
    ...envelope,
    ...DeferredFateEntrySchema.fields,
  }).annotate(strictKeys),
]);

export type FindingFateRecordManifestFile = Schema.Schema.Type<
  typeof FindingFateRecordManifestFileSchema
>;

/** A fate record in memory: the file's fields without `$schema`. */
export type FindingFateRecordManifest = FindingFateRecordManifestFile extends infer F
  ? F extends unknown
    ? Omit<F, "$schema">
    : never
  : never;

export const decodeFindingFateRecordManifestFile = Schema.decodeUnknownResult(
  FindingFateRecordManifestFileSchema,
  { onExcessProperty: "error", reportInput: true },
);

export const encodeFindingFateRecordManifest = Schema.encodeSync(
  FindingFateRecordManifestFileSchema,
);
