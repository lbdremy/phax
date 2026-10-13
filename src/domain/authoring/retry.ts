import { Either } from "effect";
import type { ArtifactKind } from "../artifact/status.js";
import { extractJsonDocumentText } from "./jsonText.js";

// A headless authoring session whose final message is refused (not JSON, or
// refused by the document decoder) is resumed once, in the same session, to
// ask for the whole document again. This module states the refusals and
// builds the retry's texts; the use case does the resuming. Pure: no I/O.

/** The retry prompt's filename inside an authoring session folder. */
export const RETRY_PROMPT_FILENAME = "retry-prompt.md";

/** The retry's transcript, beside the first answer's `output.jsonl`, which it never reopens. */
export const RETRY_TRANSCRIPT_FILENAME = "retry-output.jsonl";

/**
 * The session's final message parsed as JSON (one surrounding fence stripped,
 * or the last balanced object amid prose, as `extractJsonDocumentText` picks),
 * or the refusal: the parser's error and the position where parsing failed in
 * the text that was parsed, then the message's first 200 characters.
 */
export function parseFinalMessageJson(finalText: string): Either.Either<unknown, string> {
  const text = extractJsonDocumentText(finalText);
  try {
    return Either.right(JSON.parse(text) as unknown);
  } catch (error) {
    const { message, position } = describeParseError(text, error);
    return Either.left(
      `the session's final message is not JSON (${message} at position ${position}): ${finalText.slice(0, 200)}`,
    );
  }
}

/**
 * The prompt that resumes a session whose final message was refused. It names
 * the refusal and asks for the whole document again; it repeats neither the
 * schema nor the brief, which the resumed session already holds.
 */
export function buildRetryPrompt(kind: ArtifactKind, refusal: string): string {
  return [
    "Your final message was refused, and phax wrote nothing.",
    "",
    `Refusal: ${kind} document rejected — ${refusal}`,
    "",
    `Return the whole ${kind} document again as your final message: one JSON object valid against the schema you were given, with no code fence and no commentary. This is your only retry.`,
    "",
  ].join("\n");
}

/** The warning printed before the retry runs, naming the first refusal. */
export function retryWarning(kind: ArtifactKind, refusal: string): string {
  return `${kind} document refused — ${refusal}\n  resuming the session once to ask for the whole document again`;
}

/** The error of a session whose first answer and retry were both refused. */
export function refusedTwiceMessage(kind: ArtifactKind, first: string, retry: string): string {
  return `${kind} document rejected twice — first answer: ${first}; retry: ${retry}`;
}

// The engine's message, without the position it may carry, and the position.
// V8 names a position for most errors ("… in JSON at position 7 (line 1
// column 8)") but not all ("Unexpected end of JSON input", "Unexpected token
// '}', "…" is not valid JSON"); those get the position of the first syntax
// error a well-formedness scan finds in the same text.
function describeParseError(
  text: string,
  error: unknown,
): { readonly message: string; readonly position: number } {
  const raw = error instanceof Error ? error.message : String(error);
  const positioned =
    /^([\s\S]*?)(?: in JSON)? at position (\d+)(?: \(line \d+ column \d+\))?$/.exec(raw);
  if (positioned !== null) {
    return { message: oneLine(positioned[1] ?? raw), position: Number(positioned[2]) };
  }
  const excerpted = /^(Unexpected token [\s\S]+?), [\s\S]* is not valid JSON$/.exec(raw);
  return {
    message: oneLine(excerpted?.[1] ?? raw),
    position: firstSyntaxErrorPosition(text),
  };
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/**
 * The 0-based index of the first character at which `text` stops being one
 * well-formed JSON value (RFC 8259), or `text.length` when it ends too early.
 * Only called on text `JSON.parse` refused.
 */
function firstSyntaxErrorPosition(text: string): number {
  let i = 0;
  let failedAt: number | undefined;

  const fail = (): false => {
    failedAt ??= i;
    return false;
  };
  const skipWhitespace = () => {
    while (i < text.length && " \t\n\r".includes(text.charAt(i))) i++;
  };

  const literal = (word: string): boolean => {
    for (const expected of word) {
      if (text.charAt(i) !== expected) return fail();
      i++;
    }
    return true;
  };

  const digits = (): boolean => {
    if (!isDigit(text.charAt(i))) return fail();
    while (isDigit(text.charAt(i))) i++;
    return true;
  };

  const number = (): boolean => {
    if (text.charAt(i) === "-") i++;
    if (text.charAt(i) === "0") i++;
    else if (!digits()) return false;
    if (text.charAt(i) === ".") {
      i++;
      if (!digits()) return false;
    }
    if (text.charAt(i) === "e" || text.charAt(i) === "E") {
      i++;
      if (text.charAt(i) === "+" || text.charAt(i) === "-") i++;
      if (!digits()) return false;
    }
    return true;
  };

  const string = (): boolean => {
    i++; // the opening quote
    while (i < text.length) {
      const ch = text.charAt(i);
      if (ch === '"') {
        i++;
        return true;
      }
      if (ch < " ") return fail();
      if (ch === "\\") {
        i++;
        const escaped = text.charAt(i);
        if (escaped === "u") {
          i++;
          for (let n = 0; n < 4; n++) {
            if (!/[0-9a-fA-F]/.test(text.charAt(i))) return fail();
            i++;
          }
        } else if ('"\\/bfnrt'.includes(escaped) && escaped !== "") {
          i++;
        } else {
          return fail();
        }
      } else {
        i++;
      }
    }
    return fail();
  };

  const array = (): boolean => {
    i++; // [
    skipWhitespace();
    if (text.charAt(i) === "]") {
      i++;
      return true;
    }
    for (;;) {
      if (!value()) return false;
      skipWhitespace();
      const ch = text.charAt(i);
      if (ch === "]") {
        i++;
        return true;
      }
      if (ch !== ",") return fail();
      i++;
    }
  };

  const object = (): boolean => {
    i++; // {
    skipWhitespace();
    if (text.charAt(i) === "}") {
      i++;
      return true;
    }
    for (;;) {
      skipWhitespace();
      if (text.charAt(i) !== '"') return fail();
      if (!string()) return false;
      skipWhitespace();
      if (text.charAt(i) !== ":") return fail();
      i++;
      if (!value()) return false;
      skipWhitespace();
      const ch = text.charAt(i);
      if (ch === "}") {
        i++;
        return true;
      }
      if (ch !== ",") return fail();
      i++;
    }
  };

  function value(): boolean {
    skipWhitespace();
    const ch = text.charAt(i);
    if (ch === "{") return object();
    if (ch === "[") return array();
    if (ch === '"') return string();
    if (ch === "-" || isDigit(ch)) return number();
    if (ch === "t") return literal("true");
    if (ch === "f") return literal("false");
    if (ch === "n") return literal("null");
    return fail();
  }

  if (value()) {
    skipWhitespace();
    if (i < text.length) fail();
  }
  return failedAt ?? text.length;
}
