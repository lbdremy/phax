// The interactive handoff: what a declared interactive phase's closing turn
// answers in its final message (and what a person's
// `.phax-context/correction-handoff.md` is checked against). Born with
// `$schema`; every key is required and any other key is refused.
import { Schema } from "effect";
import { schemaUrlField } from "./schemaUrl.js";

const GuardSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("test", "lint", "gate-step").annotations({
      description: "What now guards the correction.",
    }),
    ref: Schema.NonEmptyString.annotations({
      description: "The test, lint rule or gate step that guards it.",
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal("none"),
    reason: Schema.NonEmptyString.annotations({ description: "Why nothing guards it." }),
  }),
);

/**
 * An `interactive-handoff` document: the corrections a person made at a stop,
 * the pattern from now on and what the next phases need to know. Exactly
 * these keys; any other is refused.
 */
export const InteractiveHandoffFileSchema = Schema.Struct({
  $schema: schemaUrlField("interactive-handoff"),
  corrections: Schema.NonEmptyArray(
    Schema.Struct({
      what: Schema.NonEmptyString.annotations({ description: "What was corrected." }),
      guard: GuardSchema,
    }),
  ),
  patternFromNowOn: Schema.Array(Schema.NonEmptyString),
  nextPhasesNeedToKnow: Schema.Array(Schema.NonEmptyString),
});

export type InteractiveHandoffFile = Schema.Schema.Type<typeof InteractiveHandoffFileSchema>;

/** An interactive handoff, without `$schema`. */
export type InteractiveHandoff = Omit<InteractiveHandoffFile, "$schema">;

export const decodeInteractiveHandoffFile = Schema.decodeUnknownEither(
  InteractiveHandoffFileSchema,
  { onExcessProperty: "error" },
);

export const encodeInteractiveHandoffFile = Schema.encodeSync(InteractiveHandoffFileSchema);
