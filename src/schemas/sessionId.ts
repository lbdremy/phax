// A provider session id phax may join into a path: the transcript copies of a
// stop's close and the provider stores' lookups build paths from it.
import { Schema } from "effect";
import { SAFE_SESSION_ID } from "../domain/sessionId.js";

/** A session id that starts with a letter or digit and holds only letters, digits, `.`, `_` and `-`. */
export const SafeSessionIdSchema = Schema.String.pipe(
  Schema.pattern(SAFE_SESSION_ID),
  Schema.annotations({
    identifier: "SafeSessionId",
    description:
      "A provider session id: a letter or digit, then letters, digits, `.`, `_` or `-`. `.`, `..` and any slash are refused.",
  }),
);
