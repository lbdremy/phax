// The frozen 0.40.0 shape of `finding-list`: the answer of `phax finding list
// --json` phax 0.40.0 through 0.43.x printed, never saved. `$schema` first,
// then the run, whether its records could be read, and every finding of the
// run with its id, source, the review's own fields, its fate and its history.
// A finding carries no `landed`, and the run names no base branch. Every key
// is required and any other key is refused, at any level. Never edit this
// module: packages/schemas/history.lock.json pins its bytes. In phax, only the
// tests may import it. The schemas package lists it as the format's 0.40.0
// release. It carries its own ids, closed sets and strict strings, so a later
// change to src/schemas/findingList.ts cannot move it.
import { Schema } from "effect";

// `Schema.isPattern` whose JSON Schema is the RegExp's source, whatever its
// flags: Effect 4 exports a pattern only for a RegExp with the `u` flag.
function isExportedPattern(regExp: RegExp, annotations?: Schema.Annotations.Filter) {
  return Schema.isPattern(regExp, {
    toJsonSchema: () => ({ pattern: regExp.source }),
    ...annotations,
  });
}

// The strict non-empty string: it refuses "" alone, and renders as a `pattern`.
const NonEmptyString = Schema.String.check(
  isExportedPattern(/^[\s\S]+$/, {
    identifier: "NonEmptyString",
    message: 'Expected a non empty string, actual ""',
  }),
);

// phax's own refusal text for a refused value, computed from it. The annotation key is the
// one src/schemas/refusal/adapter.ts reads, written out here because a frozen module imports
// only effect.
const refusalOverride = (message: (actual: unknown) => string) => ({
  phaxRefusalOverride: message,
});

const notOneOf = (noun: string, ids: readonly string[]) =>
  refusalOverride(
    (actual) => `${JSON.stringify(actual)} is not ${noun} (expected one of ${ids.join(", ")})`,
  );

const strictKeys = { parseOptions: { onExcessProperty: "error" } } as const;

const SchemaUrlSchema = Schema.String.check(
  isExportedPattern(
    /^https:\/\/docs\.phax\.run\/schemas\/finding-list\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
).pipe(
  Schema.annotate({
    description:
      "The finding-list format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/finding-list/<X.Y.Z>.json",
  }),
);

// ── the run

const RunStateSchema = Schema.Union([
  Schema.Literal("created"),
  Schema.Literal("running"),
  Schema.Literal("failed"),
  Schema.Literal("review_open"),
  Schema.Literal("completed"),
  Schema.Literal("stopped"),
  Schema.Literal("archived"),
  Schema.Literal("interrupted"),
  Schema.Literal("rate_limited"),
  Schema.Literal("awaiting_review"),
]);

const RecordsSchema = Schema.Literals(["read", "off", "unavailable"]).annotate({
  description:
    "read: the records branch was read; off: records are off, the run folder alone was read; unavailable: the records could not be read, the run folder alone was read.",
});

// ── the fate entries

const TimestampSchema = Schema.String.check(
  isExportedPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/),
).pipe(Schema.annotate({ description: "An ISO-8601 UTC timestamp." }));

const CommitShaSchema = Schema.String.check(
  isExportedPattern(/^([0-9a-f]{40}|[0-9a-f]{64})$/),
).pipe(Schema.annotate({ description: "A git commit sha, lowercase hex of 40 or 64 characters." }));

const PATH_CLASSES = ["code", "docs", "gate-config", "tests"] as const;

const PathClassSchema = Schema.Literals(PATH_CLASSES).annotate({
  description:
    "The class of a changed path: code (everything else), docs (documentation), gate-config (a gate tool's configuration or a CI workflow) or tests (test files and directories).",
  ...refusalOverride(
    (actual) =>
      `${JSON.stringify(actual)} is not a path class (expected one of ${PATH_CLASSES.join(", ")})`,
  ),
});

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

const OperatorSchema = Schema.Struct({
  kind: Schema.Literal("operator"),
  name: NonEmptyString.annotate({ description: "The operator's git user.name." }),
}).annotate(strictKeys);

const FixedBySchema = Schema.Union([
  OperatorSchema,
  Schema.Struct({
    kind: Schema.Literal("machine"),
    grant: Schema.String.check(isExportedPattern(/^[a-z0-9]+(-[a-z0-9]+)*$/)).pipe(
      Schema.annotate({
        description: "The grant the machine declared with `--by machine:<grant>`.",
      }),
    ),
  }).annotate(strictKeys),
]);

const FixedFateEntrySchema = Schema.Struct({
  fate: Schema.Literal("fixed"),
  commit: CommitShaSchema,
  pathClasses: PathClassesSchema,
  by: FixedBySchema,
  at: TimestampSchema,
}).annotate(strictKeys);

const DismissalVerdictSchema = Schema.Struct({
  kind: Schema.Literal("decided"),
  chosen: Schema.Literal("dismiss"),
  abandoned: Schema.Tuple([Schema.Literal("fix"), Schema.Literal("defer")]),
  why: NonEmptyString,
  advocate: NonEmptyString.annotate({
    description: "The strongest case for fixing the finding: its suggestion or message.",
  }),
  principles: Schema.Tuple([]),
  reversibility: Schema.Literal("cheap"),
  by: OperatorSchema,
  at: TimestampSchema,
  revised: Schema.Tuple([]),
}).annotate(strictKeys);

const DismissedFateEntrySchema = Schema.Struct({
  fate: Schema.Literal("dismissed"),
  verdict: DismissalVerdictSchema,
}).annotate(strictKeys);

const DeferredFateEntrySchema = Schema.Struct({
  fate: Schema.Literal("deferred"),
  to: NonEmptyString.annotate({
    description:
      "The repository-relative path of the brief, spec or NEXT_STEPS.md that takes the finding over, tracked when recorded.",
  }),
  why: NonEmptyString,
  by: OperatorSchema,
  at: TimestampSchema,
}).annotate(strictKeys);

const FateEntrySchema = Schema.Union([
  FixedFateEntrySchema,
  DismissedFateEntrySchema,
  DeferredFateEntrySchema,
]);

const historySchema = Schema.Array(FateEntrySchema).annotate({
  description:
    "The finding's fate records, oldest first: each a fix, a dismissal or a deferral. The latest decides the fate.",
});

const FINDING_FATES = ["open", "fixed", "dismissed", "deferred", "unrecorded"] as const;

const FindingFateSchema = Schema.Literals(FINDING_FATES).annotate({
  description:
    "What became of the finding: open (no fate record), fixed, dismissed, deferred, or unrecorded (a review persisted before ids existed).",
  ...refusalOverride(
    (actual) =>
      `${JSON.stringify(actual)} is not a finding fate (expected one of ${FINDING_FATES.join(", ")})`,
  ),
});

// ── the code review finding

const SEVERITY_IDS = ["bug", "deviation", "concern", "info"] as const;
const LENS_IDS = [
  "surface",
  "acceptance",
  "boundary",
  "core",
  "edge",
  "tests",
  "architecture",
  "docs",
] as const;
const ESCAPE_IDS = [
  "wrong-oracle",
  "same-author",
  "weakened",
  "fake-drift",
  "unexplored-input",
  "omission",
  "untestable",
] as const;

const CodeReviewFindingIdSchema = Schema.String.check(
  isExportedPattern(/^F[1-9][0-9]*$/),
).annotate({
  description: "The finding's id in its run: F<n>, n from 1, given by phax.",
  ...refusalOverride(
    (actual) => `${JSON.stringify(actual)} is not a code review finding id (expected F<n>)`,
  ),
});

const CodeReviewFindingEntrySchema = Schema.Struct({
  id: CodeReviewFindingIdSchema,
  source: Schema.Literal("code-review"),
  severity: Schema.Literals(SEVERITY_IDS).annotate(notOneOf("a severity", SEVERITY_IDS)),
  file: NonEmptyString.annotate({
    description: "The path the finding is about, as the reviewer gave it.",
  }),
  line: Schema.Int.check(Schema.isGreaterThan(0)).annotate({
    description: "The 1-based line the finding is about.",
    ...refusalOverride((actual) => `must be a positive integer, actual ${JSON.stringify(actual)}`),
  }),
  message: NonEmptyString,
  lens: Schema.Literals(LENS_IDS).annotate(notOneOf("a lens", LENS_IDS)),
  escape: Schema.Literals(ESCAPE_IDS).annotate(notOneOf("an escape", ESCAPE_IDS)),
  criterion: Schema.NullOr(NonEmptyString).annotate({
    description: "The acceptance criterion id the finding is about, or null.",
  }),
  suggestion: NonEmptyString,
  fate: FindingFateSchema,
  history: historySchema,
}).annotate(strictKeys);

// ── the compliance finding

const ComplianceFindingIdSchema = Schema.String.check(
  isExportedPattern(/^C[1-9][0-9]*$/),
).annotate({
  description: "The finding's id in its run: C<n>, n from 1, given by phax.",
  ...refusalOverride(
    (actual) => `${JSON.stringify(actual)} is not a compliance finding id (expected C<n>)`,
  ),
});

const ComplianceFindingEntrySchema = Schema.Struct({
  id: ComplianceFindingIdSchema,
  source: Schema.Literal("compliance-review"),
  severity: Schema.Literals(["info", "deviation", "concern"]),
  phaseId: NonEmptyString,
  dimension: Schema.Literals([
    "objective",
    "excluded-scope",
    "files",
    "tests",
    "boundaries",
    "commit",
    "handoff",
  ]),
  message: Schema.String,
  fate: FindingFateSchema,
  history: historySchema,
}).annotate(strictKeys);

// ── the document

export const FindingListV0_40_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  run: Schema.Struct({
    namespace: NonEmptyString,
    shortName: NonEmptyString,
    runId: NonEmptyString,
    state: RunStateSchema,
  }).annotate(strictKeys),
  records: RecordsSchema,
  findings: Schema.Array(
    Schema.Union([CodeReviewFindingEntrySchema, ComplianceFindingEntrySchema]),
  ),
}).annotate(strictKeys);

export type FindingListV0_40_0 = Schema.Schema.Type<typeof FindingListV0_40_0Schema>;

export const decodeFindingListV0_40_0 = Schema.decodeUnknownResult(FindingListV0_40_0Schema, {
  onExcessProperty: "error",
  reportInput: true,
});
