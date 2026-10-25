// The `decide-verdicts` document `phax artifact decide <artifact> --verdicts`
// reads: the decisions a person has already made, one per question, each with
// the option chosen and the person's note. Born with `$schema`; phax reads it
// and never writes one. Every key is required, any other key is refused at
// any level, `verdicts` is non-empty and `note` is a non-empty string or null.
// Whether each verdict names a question of the artifact, and whether a
// departing one carries a note, is phax's check against the artifact, not
// this schema's.
import { JSONSchema, Schema } from "effect";
import { schemaUrlField } from "./schemaUrl.js";

// A question or option id, as the §9 format reads it back: no whitespace.
const IdSchema = Schema.String.pipe(Schema.pattern(/^\S+$/));

const DecideVerdictSchema = Schema.Struct({
  question: IdSchema.annotations({ description: "The id of a question of the artifact." }),
  chosen: IdSchema.annotations({
    description:
      "The id of the option chosen: one of the question's option ids, or the reserved `other`.",
  }),
  note: Schema.NullOr(Schema.NonEmptyString).annotations({
    description:
      "The person's note: why this option, or what `other` means. null when there is none. phax refuses a null note on a verdict that departs from the question's recommendation, `other` included, a check this schema does not express.",
  }),
});

/** A `decide-verdicts` document: `$schema`, the artifact it is for, and the verdicts. */
export const DecideVerdictsFileSchema = Schema.Struct({
  $schema: schemaUrlField("decide-verdicts"),
  artifact: Schema.NonEmptyString.annotations({
    description:
      "The repo-relative path of the artifact the verdicts are for. phax compares it with the artifact argument and never reads the artifact from it.",
  }),
  verdicts: Schema.NonEmptyArray(DecideVerdictSchema).annotations({
    description: "The verdicts, at most one per question.",
  }),
}).annotations({ title: "phax decide verdicts" });

export type DecideVerdictsFile = Schema.Schema.Type<typeof DecideVerdictsFileSchema>;

/** A verdicts document as phax holds it: without `$schema`. */
export type DecideVerdicts = Omit<DecideVerdictsFile, "$schema">;

export const decodeDecideVerdictsFile = Schema.decodeUnknownEither(DecideVerdictsFileSchema, {
  onExcessProperty: "error",
});

/** The JSON Schema of a verdicts document: what a person writes for `--verdicts`. */
export function getDecideVerdictsFileJsonSchema(): object {
  return JSONSchema.make(DecideVerdictsFileSchema);
}
