// The oracle request: what phax writes on the oracles provider's stdin, once
// per oracle step, and saves as `checks-attempt-NN.oracle-request.json`. Born
// with `$schema`, two explicit variants keyed by `verdict`, every key required
// and any other key refused. phax writes the request and never reads it back.
import { Schema } from "effect";
import { schemaUrlField } from "./schemaUrl.js";
import { FullCommitShaSchema } from "./status.js";

const PhaseIdSchema = Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/));

const filesSchema = Schema.NonEmptyArray(Schema.NonEmptyString).annotations({
  description:
    "The oracle files the pair declares, working-tree-root-relative paths in declaration order.",
});

/**
 * An `oracle-request` document: the oracle step's request. `authored` asks the
 * provider to judge the oracle phase's tests; `discharged` asks it to judge
 * that the discharging phase left no marker in the oracle files, against the
 * oracle phase's commit. Exactly the keys of its variant; any other is refused.
 */
export const OracleRequestFileSchema = Schema.Union(
  Schema.Struct({
    $schema: schemaUrlField("oracle-request"),
    verdict: Schema.Literal("authored").annotations({
      description: "Which judgment the provider gives: the oracle phase's tests are authored.",
    }),
    phase: PhaseIdSchema.annotations({ description: "The gated phase." }),
    oraclePhase: PhaseIdSchema.annotations({ description: "The pair's oracle phase." }),
    base: FullCommitShaSchema.annotations({
      description: "The full object name of the commit the oracle phase's branch was created from.",
    }),
    files: filesSchema,
  }),
  Schema.Struct({
    $schema: schemaUrlField("oracle-request"),
    verdict: Schema.Literal("discharged").annotations({
      description:
        "Which judgment the provider gives: the discharging phase left no oracle marker.",
    }),
    phase: PhaseIdSchema.annotations({ description: "The gated phase, the pair's discharger." }),
    oraclePhase: PhaseIdSchema.annotations({ description: "The pair's oracle phase." }),
    base: FullCommitShaSchema.annotations({
      description: "The full object name of the commit the oracle phase's branch was created from.",
    }),
    oracleCommit: FullCommitShaSchema.annotations({
      description: "The full object name of the oracle phase's commit, the one to judge against.",
    }),
    files: filesSchema,
  }),
);

export type OracleRequestFile = Schema.Schema.Type<typeof OracleRequestFileSchema>;

/** An oracle request, without `$schema`. */
export type OracleRequest = OracleRequestFile extends infer V
  ? V extends { readonly $schema: string }
    ? Omit<V, "$schema">
    : never
  : never;

export const decodeOracleRequestFile = Schema.decodeUnknownEither(OracleRequestFileSchema, {
  onExcessProperty: "error",
});

export const encodeOracleRequestFile = Schema.encodeSync(OracleRequestFileSchema);
