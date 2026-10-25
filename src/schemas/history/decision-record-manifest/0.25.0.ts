// The frozen 0.25.0 shape of `decision-record-manifest`: the record.json phax
// 0.25.0 through 0.27.x wrote for a decide session, `$schema` first, when
// interactive decide was the only mode. `mode` is `interactive`, and the
// outcome is committed, declined, undecided or failed. Born with `$schema`;
// every key is required and any other key is refused. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it; the schemas package lists it as the
// format's 0.25.0 release.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/decision-record-manifest\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The decision-record-manifest format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/decision-record-manifest/<X.Y.Z>.json",
  }),
);

const ProviderIdSchema = Schema.Union(
  Schema.Literal("claude-code"),
  Schema.Literal("codex-cli"),
  Schema.Literal("mistral-vibe"),
);

const RecordShapeSchema = Schema.Union(Schema.Literal("full"), Schema.Literal("skeleton"));

const TokenUsageSchema = Schema.Union(
  Schema.Struct({
    available: Schema.Literal(true),
    usage: Schema.Union(
      Schema.Struct({
        provider: Schema.Literal("claude-code"),
        inputTokens: Schema.Number,
        cacheCreationInputTokens: Schema.Number,
        cacheReadInputTokens: Schema.Number,
        outputTokens: Schema.Number,
        totalCostUsd: Schema.Number,
      }),
      Schema.Struct({
        provider: Schema.Literal("codex-cli"),
        inputTokens: Schema.Number,
        cachedInputTokens: Schema.Number,
        outputTokens: Schema.Number,
        reasoningOutputTokens: Schema.Number,
      }),
      Schema.Struct({
        provider: Schema.Literal("mistral-vibe"),
        inputTokens: Schema.Number,
        outputTokens: Schema.Number,
        sessionCostUsd: Schema.Number,
        toolCallsAgreed: Schema.Number,
        toolCallsRejected: Schema.Number,
        toolCallsFailed: Schema.Number,
        toolCallsSucceeded: Schema.Number,
      }),
    ),
  }),
  Schema.Struct({ available: Schema.Literal(false) }),
);

const FingerprintSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{64}$/),
  Schema.annotations({ description: "The sha256 hex of the source's text." }),
);

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

const decisionRecordManifestFields = {
  kind: Schema.Literal("decision"),
  decisionId: Schema.String.pipe(
    Schema.pattern(/^[^/\s]+\/\d{2,}$/),
    Schema.annotations({ description: "`<stamp>-<slug>/<NN>`, the Decision-Id trailer." }),
  ),
  artifact: Schema.NonEmptyString,
  artifactKind: Schema.Literal("spec", "plan"),
  mode: Schema.Literal("interactive"),
  session: Schema.Literal("new", "resumed-authoring"),
  doctrine: Schema.Array(DoctrineSourceSchema),
  questions: Schema.Array(Schema.NonEmptyString),
  arbitrated: CountSchema,
  departed: CountSchema,
  sourceSha: Schema.NonEmptyString,
  shape: RecordShapeSchema,
  provider: ProviderIdSchema,
  model: Schema.NonEmptyString,
  effort: Schema.NonEmptyString,
};

const usageField = { usage: TokenUsageSchema };

export const DecisionRecordManifestV0_25_0Schema = Schema.Union(
  Schema.Struct({
    $schema: SchemaUrlSchema,
    ...decisionRecordManifestFields,
    outcome: Schema.Literal("committed"),
    commit: Schema.NonEmptyString,
    ...usageField,
  }),
  Schema.Struct({
    $schema: SchemaUrlSchema,
    ...decisionRecordManifestFields,
    outcome: Schema.Literal("declined", "undecided", "failed"),
    commit: Schema.Null,
    ...usageField,
  }),
);

export type DecisionRecordManifestV0_25_0 = Schema.Schema.Type<
  typeof DecisionRecordManifestV0_25_0Schema
>;

export const decodeDecisionRecordManifestV0_25_0 = Schema.decodeUnknownEither(
  DecisionRecordManifestV0_25_0Schema,
  { onExcessProperty: "error" },
);
