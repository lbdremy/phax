// The frozen 0.26.0 shape of `first-reading`: the answer a declared interactive
// phase's read-only first turn gave in phax 0.26.0 through 0.31.x, `$schema`
// first. Born with `$schema`; every key is required and any other key is
// refused. Never edit this module: packages/schemas/history.lock.json pins its
// bytes. In phax, only src/schemas/persisted.ts and the tests may import it;
// the schemas package lists it as the format's 0.26.0 release. It carries its
// own Effect NonEmptyString, so a later change to src/schemas/strictString.ts
// cannot move it.
import { Schema } from "effect";

const FirstReadingSchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/first-reading\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The first-reading format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/first-reading/<X.Y.Z>.json",
  }),
);

const PhaseIdSchema = Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/));

/** A 0.26.0 `first-reading` document. Exactly these keys; any other is refused. */
export const FirstReadingV0_26_0Schema = Schema.Struct({
  $schema: FirstReadingSchemaUrlSchema,
  pattern: Schema.NonEmptyArray(Schema.NonEmptyString).annotations({
    description: "The pattern the phase introduces, one statement per item.",
  }),
  copiedBy: Schema.Array(
    Schema.Struct({
      phase: PhaseIdSchema.annotations({ description: "The phase that copied the pattern." }),
      what: Schema.NonEmptyString.annotations({ description: "What it copied." }),
    }),
  ),
  toCheck: Schema.Array(Schema.NonEmptyString).annotations({
    description: "What the person should check first.",
  }),
});

export type FirstReadingV0_26_0 = Schema.Schema.Type<typeof FirstReadingV0_26_0Schema>;

export const decodeFirstReadingV0_26_0 = Schema.decodeUnknownEither(FirstReadingV0_26_0Schema, {
  onExcessProperty: "error",
});
