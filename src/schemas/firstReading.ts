// The first reading: what a declared interactive phase's read-only first turn
// answers in its final message, once per turn. Born with `$schema`; every key
// is required and any other key is refused. phax decodes it at the boundary
// (`readFirstReadingAnswer`) and never writes it back as a document.
import { Schema } from "effect";
import { schemaUrlField } from "./schemaUrl.js";

const PhaseIdSchema = Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/));

/**
 * A `first-reading` document: the pattern the phase introduces, the earlier
 * phases that copied it and what to check. Exactly these keys; any other is
 * refused.
 */
export const FirstReadingFileSchema = Schema.Struct({
  $schema: schemaUrlField("first-reading"),
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

export type FirstReadingFile = Schema.Schema.Type<typeof FirstReadingFileSchema>;

/** A first reading, without `$schema`. */
export type FirstReading = Omit<FirstReadingFile, "$schema">;

export const decodeFirstReadingFile = Schema.decodeUnknownEither(FirstReadingFileSchema, {
  onExcessProperty: "error",
});

export const encodeFirstReadingFile = Schema.encodeSync(FirstReadingFileSchema);
