// The first reading: what a declared interactive phase's read-only first turn
// answers in its final message, once per turn. Born with `$schema`; every key
// is required and any other key is refused. From 0.32.0 it is a strict answer:
// its `$schema` is a const naming the current stamp (`answerSchemaUrlField`) and
// its strings are `strictString`'s pattern. phax decodes it at the boundary
// (`readFirstReadingAnswer`) and never writes it back as a document.
import { Schema } from "effect";
import { answerSchemaUrlField } from "./answerStamp.js";
import { NonEmptyString } from "./strictString.js";

const PhaseIdSchema = Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/));

/**
 * A `first-reading` document: the pattern the phase introduces, the earlier
 * phases that copied it and what to check. Exactly these keys; any other is
 * refused.
 */
export const FirstReadingFileSchema = Schema.Struct({
  $schema: answerSchemaUrlField("first-reading"),
  pattern: Schema.NonEmptyArray(NonEmptyString).annotations({
    description: "The pattern the phase introduces, one statement per item.",
  }),
  copiedBy: Schema.Array(
    Schema.Struct({
      phase: PhaseIdSchema.annotations({ description: "The phase that copied the pattern." }),
      what: NonEmptyString.annotations({ description: "What it copied." }),
    }),
  ),
  toCheck: Schema.Array(NonEmptyString).annotations({
    description: "What the person should check first.",
  }),
});

export type FirstReadingFile = Schema.Schema.Type<typeof FirstReadingFileSchema>;

/** A first reading, without `$schema`. */
export type FirstReading = Omit<FirstReadingFile, "$schema">;

export const decodeFirstReadingFile = Schema.decodeUnknownEither(FirstReadingFileSchema, {
  onExcessProperty: "error",
});

export const encodeFirstReadingFile = Schema.encodeSync(FirstReadingFileSchema);
