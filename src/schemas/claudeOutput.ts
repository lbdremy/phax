import { Either, Schema } from "effect";

export const ClaudeResultEventSchema = Schema.Struct({
  type: Schema.Literal("result"),
  subtype: Schema.String,
  result: Schema.String,
  session_id: Schema.String,
  is_error: Schema.Boolean,
});

export type ClaudeResultEvent = Schema.Schema.Type<typeof ClaudeResultEventSchema>;

export const decodeClaudeResultEvent = Schema.decodeUnknownEither(ClaudeResultEventSchema);

export function findResultEvent(
  lines: readonly string[],
): { sessionId: string; finalText: string } | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line?.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      const decoded = decodeClaudeResultEvent(parsed);
      if (Either.isRight(decoded)) {
        return { sessionId: decoded.right.session_id, finalText: decoded.right.result };
      }
    } catch {
      // not a valid JSON line, skip
    }
  }
  return undefined;
}
