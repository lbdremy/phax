// The `finding-list` document: what `phax finding list <run> --json` prints,
// never saved (spec finding-ids-and-fates). Born with `$schema`: the run, whether
// its records could be read, and every finding of the run with its id, source,
// the review's own fields, its fate and its history. Every key is required and
// any other key is refused. Imports only `effect` and schema modules, because
// the schemas package publishes it.
import { Schema } from "effect";
import {
  CodeReviewEscapeSchema,
  CodeReviewFindingIdSchema,
  CodeReviewLensSchema,
  CodeReviewSeveritySchema,
} from "./codeReview.js";
import { ComplianceFindingIdSchema, DimensionSchema, SeveritySchema } from "./complianceReview.js";
import { FindingFateEntrySchema } from "./findingFateRecord.js";
import { refusalOverride } from "./refusal/adapter.js";
import { schemaUrlField } from "./schemaUrl.js";
import { RunStateSchema } from "./status.js";
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
}).annotate(strictKeys);
export type ComplianceFindingEntry = Schema.Schema.Type<typeof ComplianceFindingEntrySchema>;

const fields = {
  run: Schema.Struct({
    namespace: NonEmptyString,
    shortName: NonEmptyString,
    runId: NonEmptyString,
    state: RunStateSchema,
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
