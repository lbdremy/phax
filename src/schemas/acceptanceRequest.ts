// The acceptance request: what phax writes on the acceptance provider's stdin,
// once per acceptance step, and saves as
// `checks-attempt-NN.acceptance-request.json`. Born at 0.33.0 with `$schema`,
// two explicit variants keyed by `verdict`, every key required and any other
// key refused. It replaces `oracle-request`, frozen at 0.26.0 under
// src/schemas/history/. phax reads a request back only to finish a stop's
// close whose commit already landed (`readAcceptanceRequestFile`).
import { Schema } from "effect";
import { schemaUrlField } from "./schemaUrl.js";
import { FullCommitShaSchema } from "./status.js";

const PhaseIdSchema = Schema.String.check(Schema.isPattern(/^phase-\d{2}$/));

const filesSchema = Schema.NonEmptyArray(Schema.NonEmptyString).annotate({
  description:
    "The acceptance test files the pair declares, working-tree-root-relative paths in declaration order.",
});

/**
 * An `acceptance-request` document: the acceptance step's request. `authored`
 * asks the provider to judge the acceptance phase's tests; `passed` asks it to
 * judge that the passing phase left no marker in the acceptance test files,
 * against the acceptance phase's commit. Exactly the keys of its variant; any
 * other is refused.
 */
export const AcceptanceRequestFileSchema = Schema.Union([
  Schema.Struct({
    $schema: schemaUrlField("acceptance-request"),
    verdict: Schema.Literal("authored").annotate({
      description: "Which judgment the provider gives: the acceptance phase's tests are authored.",
    }),
    phase: PhaseIdSchema.annotate({ description: "The gated phase." }),
    acceptancePhase: PhaseIdSchema.annotate({ description: "The pair's acceptance phase." }),
    base: FullCommitShaSchema.annotate({
      description:
        "The full object name of the commit the acceptance phase's branch was created from.",
    }),
    files: filesSchema,
  }),
  Schema.Struct({
    $schema: schemaUrlField("acceptance-request"),
    verdict: Schema.Literal("passed").annotate({
      description:
        "Which judgment the provider gives: the passing phase left no acceptance marker.",
    }),
    phase: PhaseIdSchema.annotate({ description: "The gated phase, the pair's passing phase." }),
    acceptancePhase: PhaseIdSchema.annotate({ description: "The pair's acceptance phase." }),
    base: FullCommitShaSchema.annotate({
      description:
        "The full object name of the commit the acceptance phase's branch was created from.",
    }),
    acceptanceCommit: FullCommitShaSchema.annotate({
      description:
        "The full object name of the acceptance phase's commit, the one to judge against.",
    }),
    files: filesSchema,
  }),
]);

export type AcceptanceRequestFile = Schema.Schema.Type<typeof AcceptanceRequestFileSchema>;

/** An acceptance request, without `$schema`. */
export type AcceptanceRequest = AcceptanceRequestFile extends infer V
  ? V extends { readonly $schema: string }
    ? Omit<V, "$schema">
    : never
  : never;

export const decodeAcceptanceRequestFile = Schema.decodeUnknownResult(AcceptanceRequestFileSchema, {
  onExcessProperty: "error",
  reportInput: true,
});

export const encodeAcceptanceRequestFile = Schema.encodeSync(AcceptanceRequestFileSchema);
