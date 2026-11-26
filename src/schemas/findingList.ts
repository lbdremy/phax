// The `finding-list` document: what `phax finding list <run> --json` prints,
// never saved (spec finding-ids-and-fates). Born with `$schema`: the run, whether
// its records could be read, and every finding of the run with its id, source,
// the review's own fields, its fate, its history and where its latest fix
// landed (spec finding-fix-identity §6, 0.44.0; the run names the base branch
// that resolution searched first). Every key is required and any other key is
// refused. The 0.40.0 shape, without `landed` and `run.baseBranch`, stays
// readable by the schemas package through src/schemas/history/finding-list/.
// Imports only `effect` and schema modules, because the schemas package
// publishes it.
import { Schema } from "effect";
import {
  CodeReviewEscapeSchema,
  CodeReviewFindingIdSchema,
  CodeReviewLensSchema,
  CodeReviewSeveritySchema,
} from "./codeReview.js";
import { ComplianceFindingIdSchema, DimensionSchema, SeveritySchema } from "./complianceReview.js";
import { FindingFateEntrySchema } from "./findingFateRecord.js";
import { refusalMessage, refusalOverride } from "./refusal/adapter.js";
import { schemaUrlField } from "./schemaUrl.js";
import { FullCommitShaSchema, RunStateSchema } from "./status.js";
import { NonEmptyString } from "./strictString.js";

const strictKeys = { parseOptions: { onExcessProperty: "error" } } as const;

export const FINDING_FATES = ["open", "fixed", "dismissed", "deferred", "unrecorded"] as const;

/** What became of a finding. `unrecorded`: a review persisted before ids existed. */
const FindingFateSchema = Schema.Literals(FINDING_FATES).annotate({
  description:
    "What became of the finding: open (no fate record), fixed, dismissed, deferred, or unrecorded (a review persisted before ids existed).",
  ...refusalOverride(
    (actual) =>
      `${JSON.stringify(actual)} is not a finding fate (expected one of ${FINDING_FATES.join(", ")})`,
  ),
});
export type FindingFate = Schema.Schema.Type<typeof FindingFateSchema>;

/** Whether the run's earlier reviews could be read from the records branch. */
const FindingListRecordsSchema = Schema.Literals(["read", "off", "unavailable"]).annotate({
  description:
    "read: the records branch was read; off: records are off, the run folder alone was read; unavailable: the records could not be read, the run folder alone was read.",
});
export type FindingListRecords = Schema.Schema.Type<typeof FindingListRecordsSchema>;

const historySchema = Schema.Array(FindingFateEntrySchema).annotate({
  description:
    "The finding's fate records, oldest first: each a fix, a dismissal or a deferral. The latest decides the fate.",
});

const landedSha = (description: string) =>
  FullCommitShaSchema.annotate({
    description,
    ...refusalOverride(
      (actual) =>
        `${JSON.stringify(actual)} is not a full commit sha (expected 40 or 64 lowercase hex digits)`,
    ),
  });

const recordedSha = landedSha("The commit the latest fixed record names.");

const landedBranch = NonEmptyString.annotate({
  description:
    "The branch the fix was found on: the base branch's label (main, or origin/main when only the remote-tracking branch exists) or the run's branch.",
});

const LANDED_BY = ["recorded", "key", "patch-id"] as const;

/** The fix is on the branch: one commit matched, at the first step that matched. */
const FoundLandedSchema = Schema.Struct({
  status: Schema.Literal("found"),
  by: Schema.Literals(LANDED_BY).annotate({
    description:
      "The step that matched: recorded (the branch reaches the recorded commit), key (one commit carries the Finding-Run and Finding trailers) or patch-id (one commit has the recorded commit's stable patch id).",
    ...refusalOverride(
      (actual) =>
        `${JSON.stringify(actual)} is not a resolution step (expected one of ${LANDED_BY.join(", ")})`,
    ),
  }),
  commit: landedSha("The commit the fix landed as: the recorded commit when found by recorded."),
  branch: landedBranch,
  recorded: recordedSha,
}).annotate({
  ...strictKeys,
  description: "The fix was found on a branch by one commit.",
});

/** Several commits of one branch matched the same step: phax does not guess. */
const AmbiguousLandedSchema = Schema.Struct({
  status: Schema.Literal("ambiguous"),
  commits: Schema.Array(landedSha("A commit that matched."))
    .check(
      Schema.isMinLength(
        2,
        refusalMessage(
          (actual) =>
            `an ambiguous resolution names at least two commits, actual ${JSON.stringify(actual)}`,
        ),
      ),
    )
    .annotate({ description: "Every commit that matched the step, oldest first: two or more." }),
  branch: landedBranch,
  recorded: recordedSha,
}).annotate({
  ...strictKeys,
  description: "Several commits of one branch matched the same step.",
});

/** No step matched on any branch looked for. */
const NotFoundLandedSchema = Schema.Struct({
  status: Schema.Literal("not-found"),
  branches: Schema.Array(
    NonEmptyString.annotate({ description: "A branch the fix was looked for on." }),
  )
    .check(
      Schema.isMinLength(
        1,
        refusalMessage(
          (actual) =>
            `a not-found resolution names at least one branch, actual ${JSON.stringify(actual)}`,
        ),
      ),
    )
    .annotate({
      description:
        "Every branch looked for, in search order: the base branch, then the run's branch whenever the run has one, even when it no longer resolves.",
    }),
  recorded: recordedSha,
}).annotate({
  ...strictKeys,
  description: "The fix was found on no branch looked for.",
});

/** Where a fixed finding's latest fix landed, resolved when the list was read. */
const FindingLandedSchema = Schema.Union([
  FoundLandedSchema,
  AmbiguousLandedSchema,
  NotFoundLandedSchema,
]).annotate({
  description:
    "Where the latest fix landed: found, ambiguous or not-found, on the base branch then the run's branch, among commits made since the run started.",
});
export type FindingLanded = Schema.Schema.Type<typeof FindingLandedSchema>;

const landedSchema = Schema.NullOr(FindingLandedSchema).annotate({
  description:
    "The resolution of the latest fix of a fixed finding, read when the list was made; null for every other fate.",
});

export const CodeReviewFindingEntrySchema = Schema.Struct({
  id: CodeReviewFindingIdSchema,
  source: Schema.Literal("code-review"),
  severity: CodeReviewSeveritySchema,
  file: NonEmptyString.annotate({
    description: "The path the finding is about, as the reviewer gave it.",
  }),
  line: Schema.Int.check(Schema.isGreaterThan(0)).annotate({
    description: "The 1-based line the finding is about.",
    ...refusalOverride((actual) => `must be a positive integer, actual ${JSON.stringify(actual)}`),
  }),
  message: NonEmptyString,
  lens: CodeReviewLensSchema,
  escape: CodeReviewEscapeSchema,
  criterion: Schema.NullOr(NonEmptyString).annotate({
    description: "The acceptance criterion id the finding is about, or null.",
  }),
  suggestion: NonEmptyString,
  fate: FindingFateSchema,
  history: historySchema,
  landed: landedSchema,
}).annotate(strictKeys);
export type CodeReviewFindingEntry = Schema.Schema.Type<typeof CodeReviewFindingEntrySchema>;

export const ComplianceFindingEntrySchema = Schema.Struct({
  id: ComplianceFindingIdSchema,
  source: Schema.Literal("compliance-review"),
  severity: SeveritySchema,
  phaseId: NonEmptyString,
  dimension: DimensionSchema,
  message: Schema.String,
  fate: FindingFateSchema,
  history: historySchema,
  landed: landedSchema,
}).annotate(strictKeys);
export type ComplianceFindingEntry = Schema.Schema.Type<typeof ComplianceFindingEntrySchema>;

const fields = {
  run: Schema.Struct({
    namespace: NonEmptyString,
    shortName: NonEmptyString,
    runId: NonEmptyString,
    state: RunStateSchema,
    baseBranch: NonEmptyString.annotate({
      description:
        "The label of the base branch the resolution searched first: publish.baseBranch, else main; origin/main (publish.remote) when only the remote-tracking branch exists.",
    }),
  }).annotate(strictKeys),
  records: FindingListRecordsSchema,
  findings: Schema.Array(
    Schema.Union([CodeReviewFindingEntrySchema, ComplianceFindingEntrySchema]),
  ),
};

/** A finding list without `$schema`. */
export type FindingListDocument = Schema.Schema.Type<Schema.Struct<typeof fields>>;

/** A `finding-list` document: the answer of `phax finding list --json`. */
export const FindingListFileSchema = Schema.Struct({
  $schema: schemaUrlField("finding-list"),
  ...fields,
}).annotate(strictKeys);

export type FindingListFile = Schema.Schema.Type<typeof FindingListFileSchema>;

export const decodeFindingListFile = Schema.decodeUnknownResult(FindingListFileSchema, {
  onExcessProperty: "error",
  reportInput: true,
});

export const encodeFindingListFile = Schema.encodeSync(FindingListFileSchema);
