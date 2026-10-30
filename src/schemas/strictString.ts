// The strict non-empty string every answer schema uses in place of Effect's
// `Schema.NonEmptyString`. It accepts exactly the strings that one accepts
// (anything but ""), but its JSON Schema is a `pattern`, not `minLength`:
// Codex's strict structured output documents no `minLength`, while a pattern
// is inside it. Imports only effect, so the schemas package can carry it.
import { Schema } from "effect";

/** A string with at least one character; renders as a `pattern`, never `minLength`. */
export const NonEmptyString = Schema.String.pipe(
  Schema.pattern(/^[\s\S]+$/, {
    identifier: "NonEmptyString",
    message: (issue) => `Expected a non empty string, actual ${JSON.stringify(issue.actual)}`,
  }),
);
