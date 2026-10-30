import { Either } from "effect";
import { parseFinalMessageJson } from "../authoring/retry.js";
import type { StructuredValue } from "./outcome.js";

/**
 * The parsed answer document of a structured call. A structured value
 * (Claude Code's `structured_output`) is the answer as is and the text beside
 * it is never parsed; without one, the final message is parsed as JSON, so a
 * prose or empty message (Vibe's, say) is the not-JSON refusal.
 */
export function answerJson(result: {
  readonly finalText: string;
  readonly structured: StructuredValue | null;
}): Either.Either<unknown, string> {
  if (result.structured !== null) return Either.right(result.structured.value);
  return parseFinalMessageJson(result.finalText);
}
