import { Either, Schema } from "effect";

export const VibeResultEventSchema = Schema.Struct({
  type: Schema.Literal("result"),
  session_id: Schema.String,
  result: Schema.String,
  is_error: Schema.Boolean,
});

export type VibeResultEvent = Schema.Schema.Type<typeof VibeResultEventSchema>;

export const decodeVibeResultEvent = Schema.decodeUnknownEither(VibeResultEventSchema);

export function findVibeResultEvent(
  lines: readonly string[],
): { sessionId: string; finalText: string } | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line?.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      const decoded = decodeVibeResultEvent(parsed);
      if (Either.isRight(decoded)) {
        return { sessionId: decoded.right.session_id, finalText: decoded.right.result };
      }
    } catch {
      // not a valid JSON line, skip
    }
  }
  return undefined;
}

export function hasVibeErroredResultEvent(lines: readonly string[]): boolean {
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const decoded = decodeVibeResultEvent(JSON.parse(line) as unknown);
      if (Either.isRight(decoded) && decoded.right.is_error) return true;
    } catch {
      // not a valid JSON line, skip
    }
  }
  return false;
}
