// The frozen 0.26.0 shape of `oracle-request`: the request phax wrote on the
// oracles provider's stdin, once per oracle step, from phax 0.26.0 to 0.32.x,
// and saved as `checks-attempt-NN.oracle-request.json`. `$schema` first (a
// release pattern, not a const), two explicit variants keyed by `verdict`
// (`authored` and `discharged`), every key required and any other key refused.
// Replaced at 0.33.0 by `acceptance-request`: phax writes it nowhere and reads
// it nowhere. Never edit this module: packages/schemas/history.lock.json pins
// its bytes. The schemas package lists it as the format's 0.26.0 release and as
// its current shape. It carries its own copy of the phase-id and full-sha
// patterns, so a later change to src/schemas/status.ts cannot move it.
import { Schema } from "effect";

// `Schema.isPattern` whose JSON Schema is the RegExp's source, whatever its
// flags: Effect 4 exports a pattern only for a RegExp with the `u` flag.
function isExportedPattern(regExp: RegExp, annotations?: Schema.Annotations.Filter) {
  return Schema.isPattern(regExp, {
    toJsonSchema: () => ({ pattern: regExp.source }),
    ...annotations,
  });
}

const SchemaUrlSchema = Schema.String.check(
  isExportedPattern(
    /^https:\/\/docs\.phax\.run\/schemas\/oracle-request\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
).pipe(
  Schema.annotate({
    description:
      "The oracle-request format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/oracle-request/<X.Y.Z>.json",
  }),
);

const PhaseIdSchema = Schema.String.check(isExportedPattern(/^phase-\d{2}$/));

const FullCommitShaSchema = Schema.String.check(
  isExportedPattern(/^[0-9a-f]{40}([0-9a-f]{24})?$/),
).pipe(
  Schema.annotate({
    description: "A commit's full object name: 40 lowercase hex digits (SHA-1) or 64 (SHA-256).",
  }),
);

const filesSchema = Schema.NonEmptyArray(Schema.NonEmptyString).annotate({
  description:
    "The oracle files the pair declares, working-tree-root-relative paths in declaration order.",
});

export const OracleRequestV0_26_0Schema = Schema.Union([
  Schema.Struct({
    $schema: SchemaUrlSchema,
    verdict: Schema.Literal("authored").annotate({
      description: "Which judgment the provider gives: the oracle phase's tests are authored.",
    }),
    phase: PhaseIdSchema.annotate({ description: "The gated phase." }),
    oraclePhase: PhaseIdSchema.annotate({ description: "The pair's oracle phase." }),
    base: FullCommitShaSchema.annotate({
      description: "The full object name of the commit the oracle phase's branch was created from.",
    }),
    files: filesSchema,
  }),
  Schema.Struct({
    $schema: SchemaUrlSchema,
    verdict: Schema.Literal("discharged").annotate({
      description:
        "Which judgment the provider gives: the discharging phase left no oracle marker.",
    }),
    phase: PhaseIdSchema.annotate({ description: "The gated phase, the pair's discharger." }),
    oraclePhase: PhaseIdSchema.annotate({ description: "The pair's oracle phase." }),
    base: FullCommitShaSchema.annotate({
      description: "The full object name of the commit the oracle phase's branch was created from.",
    }),
    oracleCommit: FullCommitShaSchema.annotate({
      description: "The full object name of the oracle phase's commit, the one to judge against.",
    }),
    files: filesSchema,
  }),
]);

export type OracleRequestV0_26_0 = Schema.Schema.Type<typeof OracleRequestV0_26_0Schema>;

export const decodeOracleRequestV0_26_0 = Schema.decodeUnknownResult(OracleRequestV0_26_0Schema, {
  onExcessProperty: "error",
  reportInput: true,
});
