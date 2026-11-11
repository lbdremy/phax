// The strict non-empty string every answer schema uses in place of Effect's
// `Schema.NonEmptyString`. It accepts exactly the strings that one accepts
// (anything but ""), but its JSON Schema is a `pattern`, not `minLength`:
// Codex's strict structured output documents no `minLength`, while a pattern
// is inside it. Imports only effect, so the schemas package can carry it.
import { Schema } from "effect";

/**
 * `Schema.isPattern` whose JSON Schema is the RegExp's source, whatever its
 * flags. Effect exports a pattern only for a RegExp with the `u` flag; phax's
 * patterns are written without it, so that decoding keeps their UTF-16
 * semantics, and each source compiles alike under JSON Schema's regex dialect.
 */
export function isExportedPattern(regExp: RegExp, annotations?: Schema.Annotations.Filter) {
  return Schema.isPattern(regExp, {
    toJsonSchema: () => ({ pattern: regExp.source }),
    ...annotations,
  });
}

/** A string with at least one character; renders as a `pattern`, never `minLength`. */
export const NonEmptyString = Schema.String.check(
  isExportedPattern(/^[\s\S]+$/, {
    identifier: "NonEmptyString",
    // The pattern refuses the empty string alone, so the refused value is always "".
    message: 'Expected a non empty string, actual ""',
  }),
);
