// The `artifact-status` document: what `phax artifact status <path> --json`
// prints, never saved. Born at 0.34.0 with `$schema`; every key is required
// (a `kind` stands where a fact is absent) and any other key is refused.
// Imports only `effect` and schema modules, because the schemas package
// publishes it.
import { Schema } from "effect";
import { ApprovedBySchema } from "./approvedBy.js";
import { schemaUrlField } from "./schemaUrl.js";

const strictKeys = { parseOptions: { onExcessProperty: "error" } } as const;

const StatusNameSchema = Schema.Literal("Draft", "Approved", "Stale", "Abandoned", "Completed");

const QuestionIdsSchema = Schema.Array(Schema.NonEmptyString);

const ApprovalSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({ kind: Schema.Literal("unrecorded") }).annotations({
    description:
      "The artifact is approved but no approval record backs it: run `phax artifact approve` to record one.",
  }),
  Schema.Struct({
    kind: Schema.Literal("recorded"),
    date: Schema.NonEmptyString.annotations({ description: "The approval's date." }),
    baseline: Schema.NonEmptyString.annotations({
      description: "The baseline the approval stamped.",
    }),
    approver: ApprovedBySchema.annotations({
      description: "The arbiter as the approval record stores it.",
    }),
    editedSinceApproval: Schema.Boolean.annotations({
      description: "Whether the artifact's text differs from the one the approval recorded.",
    }),
  }).annotations(strictKeys),
);

const AgreementSchema = Schema.Union(
  Schema.Literal("in-sync", "diverged"),
  Schema.Struct({
    kind: Schema.Literal("invalid"),
    message: Schema.NonEmptyString,
  }).annotations(strictKeys),
  Schema.Struct({
    kind: Schema.Literal("stamped"),
    format: Schema.Literal("spec-document", "plan-document"),
    shape: Schema.NonEmptyString.annotations({
      description:
        "The shape the sidecar is stamped at: a release, or `pre-schema`. It is below the format's current shape, so it is not compared.",
    }),
  }).annotations(strictKeys),
);

const AuthoringSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("interactive") }),
  Schema.Struct({
    kind: Schema.Literal("headless"),
    sidecar: Schema.NonEmptyString.annotations({
      description: "The sidecar's repo-relative path.",
    }),
    agreement: AgreementSchema.annotations({
      description: "Whether the artifact's body is still the rendering of its sidecar.",
    }),
  }).annotations(strictKeys),
);

const QuestionsSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("departs"),
    line: Schema.Int.pipe(Schema.greaterThanOrEqualTo(1)).annotations({
      description: "The 1-based line of the hand-authored §9 that departs from the format.",
    }),
    text: Schema.String,
  }).annotations(strictKeys),
  Schema.Struct({
    kind: Schema.Literal("parsed"),
    open: QuestionIdsSchema,
    arbitrated: QuestionIdsSchema,
    lifted: QuestionIdsSchema.annotations({
      description: "The arbitrated questions whose verdict was lifted.",
    }),
  }).annotations(strictKeys),
);

/** An `artifact-status` document: the answer of `phax artifact status --json`. */
export const ArtifactStatusFileSchema = Schema.Struct({
  $schema: schemaUrlField("artifact-status"),
  path: Schema.NonEmptyString.annotations({ description: "The artifact's repo-relative path." }),
  kind: Schema.Literal("spec", "plan"),
  status: StatusNameSchema,
  legalTransitions: Schema.Array(StatusNameSchema).annotations({
    description: "The statuses the artifact may move to, in the order phax lists them.",
  }),
  approval: ApprovalSchema,
  authoring: AuthoringSchema,
  questions: QuestionsSchema,
}).annotations(strictKeys);

export type ArtifactStatusFile = Schema.Schema.Type<typeof ArtifactStatusFileSchema>;
/** An artifact status without `$schema`. */
export type ArtifactStatusDocument = Omit<ArtifactStatusFile, "$schema">;

export const decodeArtifactStatusFile = Schema.decodeUnknownResult(ArtifactStatusFileSchema, {
  onExcessProperty: "error",
});

export const encodeArtifactStatusFile = Schema.encodeSync(ArtifactStatusFileSchema);
