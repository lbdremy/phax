import { Schema } from "effect";
import { schemaUrlField } from "./schemaUrl.js";
import { FullCommitShaSchema } from "./status.js";

const PhaseIdSchema = Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/));

const GateRequestPhaseSchema = Schema.Struct({
  id: PhaseIdSchema.annotations({ description: "The phase's id." }),
  files: Schema.Array(Schema.String).annotations({
    description:
      "The phase's planned files to create and to edit, deduplicated in plan order; optional files are excluded.",
  }),
});

const gateRequestFields = {
  phase: PhaseIdSchema.annotations({ description: "The gated phase." }),
  base: FullCommitShaSchema.annotations({
    description: "The full object name of the commit the gated phase's branch was created from.",
  }),
  terminal: Schema.Boolean.annotations({
    description: "True exactly when the gated phase is the run's terminal phase.",
  }),
  phases: Schema.Array(GateRequestPhaseSchema).annotations({
    description: "Every phase of the run, in execution order, with its planned files.",
  }),
};

/** A gate request: the facts phax hands a declaring gate step, without `$schema`. */
export type GateRequest = Schema.Schema.Type<Schema.Struct<typeof gateRequestFields>>;

/**
 * A `gate-request` document: what phax writes on a declaring gate step's
 * stdin and saves as `checks-attempt-NN.request.json`. Exactly five keys,
 * every one required; any other key is refused.
 */
export const GateRequestFileSchema = Schema.Struct({
  $schema: schemaUrlField("gate-request"),
  ...gateRequestFields,
});

export type GateRequestFile = Schema.Schema.Type<typeof GateRequestFileSchema>;

export const decodeGateRequestFile = Schema.decodeUnknownEither(GateRequestFileSchema, {
  onExcessProperty: "error",
});
