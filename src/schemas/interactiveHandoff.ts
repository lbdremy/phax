// The interactive handoff: what a declared interactive phase's closing turn
// answers in its final message (and what a person's
// `.phax-context/correction-handoff.md` is checked against). Born with
// `$schema`; every key is required and any other key is refused. From 0.32.0 it
// is a strict answer: its `$schema` is a const naming the current stamp
// (`answerSchemaUrlField`) and its strings are `strictString`'s pattern.
import { Schema } from "effect";
import { answerSchemaUrlField } from "./answerStamp.js";
import { NonEmptyString } from "./strictString.js";

const GuardSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("test", "lint", "gate-step").annotations({
      description: "What now guards the correction.",
    }),
    ref: NonEmptyString.annotations({
      description: "The test, lint rule or gate step that guards it.",
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal("none"),
    reason: NonEmptyString.annotations({ description: "Why nothing guards it." }),
  }),
);

/**
 * An `interactive-handoff` document: the corrections a person made at a stop,
 * the pattern from now on and what the next phases need to know. Exactly
 * these keys; any other is refused.
 */
export const InteractiveHandoffFileSchema = Schema.Struct({
  $schema: answerSchemaUrlField("interactive-handoff"),
  corrections: Schema.NonEmptyArray(
    Schema.Struct({
      what: NonEmptyString.annotations({ description: "What was corrected." }),
      guard: GuardSchema,
    }),
  ),
  patternFromNowOn: Schema.Array(NonEmptyString),
  nextPhasesNeedToKnow: Schema.Array(NonEmptyString),
});

export type InteractiveHandoffFile = Schema.Schema.Type<typeof InteractiveHandoffFileSchema>;

/** An interactive handoff, without `$schema`. */
export type InteractiveHandoff = Omit<InteractiveHandoffFile, "$schema">;

export const decodeInteractiveHandoffFile = Schema.decodeUnknownEither(
  InteractiveHandoffFileSchema,
  { onExcessProperty: "error" },
);

export const encodeInteractiveHandoffFile = Schema.encodeSync(InteractiveHandoffFileSchema);
