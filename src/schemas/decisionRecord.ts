import { Schema, type Types } from "effect";
import { ProviderIdSchema } from "./providerId.js";
import { RecordShapeSchema, TokenUsageSchema } from "./runRecord.js";
import { schemaUrlField } from "./schemaUrl.js";

/**
 * How a decide session that spawned ended: its decisions landed in one commit
 * (`committed`), the operator refused the body diff (`declined`), the revised
 * document arbitrated nothing (`undecided`), or it failed (a refused document,
 * a limit, a change during the session, a failed write or commit). Only a
 * `committed` record names a commit.
 */
export const DecisionRecordOutcomeSchema = Schema.Literal(
  "committed",
  "declined",
  "undecided",
  "failed",
);

export type DecisionRecordOutcome = Schema.Schema.Type<typeof DecisionRecordOutcomeSchema>;

/** Whether the session resumed the artifact's kept authoring session or started a new one. */
export const DecisionRecordSessionSchema = Schema.Literal("new", "resumed-authoring");

const FingerprintSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{64}$/),
  Schema.annotations({ description: "The sha256 hex of the source's text." }),
);

/** Where the session's doctrine came from: the doctrine skill, then the `--doctrine` file. */
const DoctrineSourceSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("skill"),
    name: Schema.NonEmptyString,
    source: Schema.Literal("bundled", "project"),
    fingerprint: FingerprintSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("file"),
    path: Schema.NonEmptyString,
    fingerprint: FingerprintSchema,
  }),
);

const CountSchema = Schema.Int.pipe(Schema.nonNegative());

/**
 * The manifest (`record.json`) of one decide session, keyed
 * `decision/<decisionId>` on `phax/records/v1`. A distinct kind beside the
 * phase and authoring manifests. `sourceSha` is HEAD when the session started;
 * `commit` is the decide commit, present only when it landed. It carries no
 * provider session id, so a resumed authoring session's id never reaches the
 * records branch.
 */
const decisionRecordManifestFields = {
  kind: Schema.Literal("decision"),
  /** `<stamp>-<slug>/<NN>`: the record key's tail and the `Decision-Id` trailer. */
  decisionId: Schema.String.pipe(
    Schema.pattern(/^[^/\s]+\/\d{2,}$/),
    Schema.annotations({ description: "`<stamp>-<slug>/<NN>`, the Decision-Id trailer." }),
  ),
  /** Repo-relative path of the artifact decided. */
  artifact: Schema.NonEmptyString,
  artifactKind: Schema.Literal("spec", "plan"),
  mode: Schema.Literal("interactive"),
  session: DecisionRecordSessionSchema,
  doctrine: Schema.Array(DoctrineSourceSchema),
  /** The question ids presented, in presentation order. */
  questions: Schema.Array(Schema.NonEmptyString),
  /** How many questions the session arbitrated, and how many of those verdicts departed. */
  arbitrated: CountSchema,
  departed: CountSchema,
  sourceSha: Schema.NonEmptyString,
  shape: RecordShapeSchema,
  provider: ProviderIdSchema,
  model: Schema.NonEmptyString,
  effort: Schema.NonEmptyString,
};

/** The handback turns: the first answer and, when retried, the retry. */
const usageField = { usage: TokenUsageSchema };

const CommittedDecisionFields = {
  ...decisionRecordManifestFields,
  outcome: Schema.Literal("committed"),
  commit: Schema.NonEmptyString,
  ...usageField,
};

const UncommittedDecisionFields = {
  ...decisionRecordManifestFields,
  outcome: Schema.Literal("declined", "undecided", "failed"),
  commit: Schema.Null,
  ...usageField,
};

/** A decision record manifest in memory: never a `$schema`. */
export type DecisionRecordManifest =
  | Types.Simplify<Schema.Struct.Type<typeof CommittedDecisionFields>>
  | Types.Simplify<Schema.Struct.Type<typeof UncommittedDecisionFields>>;

/**
 * A decision record's `record.json` as phax writes it: `$schema` first, then
 * the manifest's fields. Born with `$schema`. Unknown keys are rejected, and
 * `commit` is a string exactly when the outcome is `committed`.
 */
export const DecisionRecordManifestFileSchema = Schema.Union(
  Schema.Struct({
    $schema: schemaUrlField("decision-record-manifest"),
    ...CommittedDecisionFields,
  }),
  Schema.Struct({
    $schema: schemaUrlField("decision-record-manifest"),
    ...UncommittedDecisionFields,
  }),
);

export type DecisionRecordManifestFile = Schema.Schema.Type<
  typeof DecisionRecordManifestFileSchema
>;

export const decodeDecisionRecordManifestFile = Schema.decodeUnknownEither(
  DecisionRecordManifestFileSchema,
  { onExcessProperty: "error" },
);

export const encodeDecisionRecordManifest = Schema.encodeSync(DecisionRecordManifestFileSchema);

export function isDecisionRecordManifest(manifest: object): manifest is DecisionRecordManifest {
  return "kind" in manifest && manifest.kind === "decision";
}
