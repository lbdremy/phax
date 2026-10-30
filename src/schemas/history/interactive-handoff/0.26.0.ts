// The frozen 0.26.0 shape of `interactive-handoff`: the answer a declared
// interactive phase's closing turn gave in phax 0.26.0 through 0.31.x,
// `$schema` first. Born with `$schema`; every key is required and any other key
// is refused. Never edit this module: packages/schemas/history.lock.json pins
// its bytes. In phax, only src/schemas/persisted.ts and the tests may import
// it; the schemas package lists it as the format's 0.26.0 release. It carries
// its own Effect NonEmptyString, so a later change to src/schemas/strictString.ts
// cannot move it.
import { Schema } from "effect";

const InteractiveHandoffSchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/interactive-handoff\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The interactive-handoff format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/interactive-handoff/<X.Y.Z>.json",
  }),
);

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

/** A 0.26.0 `interactive-handoff` document. Exactly these keys; any other is refused. */
export const InteractiveHandoffV0_26_0Schema = Schema.Struct({
  $schema: InteractiveHandoffSchemaUrlSchema,
  corrections: Schema.NonEmptyArray(
    Schema.Struct({
      what: Schema.NonEmptyString.annotations({ description: "What was corrected." }),
      guard: GuardSchema,
    }),
  ),
  patternFromNowOn: Schema.Array(Schema.NonEmptyString),
  nextPhasesNeedToKnow: Schema.Array(Schema.NonEmptyString),
});

export type InteractiveHandoffV0_26_0 = Schema.Schema.Type<typeof InteractiveHandoffV0_26_0Schema>;

export const decodeInteractiveHandoffV0_26_0 = Schema.decodeUnknownEither(
  InteractiveHandoffV0_26_0Schema,
  { onExcessProperty: "error" },
);
