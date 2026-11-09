// The `artifact-status` document: what `phax artifact status <path> --json`
// prints, never saved. Born at 0.34.0 with `$schema`; every key is required
// (a `kind` stands where a fact is absent) and any other key is refused.
// Imports only `effect` and schema modules, because the schemas package
// publishes it.
import { Schema } from "effect";
import { ApprovedBySchema } from "./approvedBy.js";
import { schemaUrlField } from "./schemaUrl.js";

const strictKeys = { parseOptions: { onExcessProperty: "error" } } as const;

const StatusNameSchema = Schema.Literals(["Draft", "Approved", "Stale", "Abandoned", "Completed"]);

const QuestionIdsSchema = Schema.Array(Schema.NonEmptyString);

const ApprovalSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({ kind: Schema.Literal("unrecorded") }).annotate({
    description:
      "The artifact is approved but no approval record backs it: run `phax artifact approve` to record one.",
  }),
  Schema.Struct({
    kind: Schema.Literal("recorded"),
    date: Schema.NonEmptyString.annotate({ description: "The approval's date." }),
    baseline: Schema.NonEmptyString.annotate({
      description: "The baseline the approval stamped.",
    }),
    approver: ApprovedBySchema.annotate({
      description: "The arbiter as the approval record stores it.",
    }),
    editedSinceApproval: Schema.Boolean.annotate({
      description: "Whether the artifact's text differs from the one the approval recorded.",
    }),
  }).annotate(strictKeys),
]);

const AgreementSchema = Schema.Union([
  Schema.Literals(["in-sync", "diverged"]),
  Schema.Struct({
    kind: Schema.Literal("invalid"),
    message: Schema.NonEmptyString,
  }).annotate(strictKeys),
  Schema.Struct({
    kind: Schema.Literal("stamped"),
    format: Schema.Literals(["spec-document", "plan-document"]),
    shape: Schema.NonEmptyString.annotate({
      description:
        "The shape the sidecar is stamped at: a release, or `pre-schema`. It is below the format's current shape, so it is not compared.",
    }),
  }).annotate(strictKeys),
]);

const AuthoringSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("interactive") }),
  Schema.Struct({
    kind: Schema.Literal("headless"),
    sidecar: Schema.NonEmptyString.annotate({
      description: "The sidecar's repo-relative path.",
    }),
    agreement: AgreementSchema.annotate({
      description: "Whether the artifact's body is still the rendering of its sidecar.",
    }),
  }).annotate(strictKeys),
]);

const QuestionsSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("departs"),
    line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
      description: "The 1-based line of the hand-authored §9 that departs from the format.",
    }),
    text: Schema.String,
  }).annotate(strictKeys),
  Schema.Struct({
    kind: Schema.Literal("parsed"),
    open: QuestionIdsSchema,
    arbitrated: QuestionIdsSchema,
    lifted: QuestionIdsSchema.annotate({
      description: "The arbitrated questions whose verdict was lifted.",
    }),
  }).annotate(strictKeys),
]);

/** An `artifact-status` document: the answer of `phax artifact status --json`. */
export const ArtifactStatusFileSchema = Schema.Struct({
  $schema: schemaUrlField("artifact-status"),
  path: Schema.NonEmptyString.annotate({ description: "The artifact's repo-relative path." }),
  kind: Schema.Literals(["spec", "plan"]),
  status: StatusNameSchema,
  legalTransitions: Schema.Array(StatusNameSchema).annotate({
    description: "The statuses the artifact may move to, in the order phax lists them.",
  }),
  approval: ApprovalSchema,
  authoring: AuthoringSchema,
  questions: QuestionsSchema,
}).annotate(strictKeys);

export type ArtifactStatusFile = Schema.Schema.Type<typeof ArtifactStatusFileSchema>;
/** An artifact status without `$schema`. */
export type ArtifactStatusDocument = Omit<ArtifactStatusFile, "$schema">;

export const decodeArtifactStatusFile = Schema.decodeUnknownResult(ArtifactStatusFileSchema, {
  onExcessProperty: "error",
  reportInput: true,
});

export const encodeArtifactStatusFile = Schema.encodeSync(ArtifactStatusFileSchema);
