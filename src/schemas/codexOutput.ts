import { Either, Schema } from "effect";

/**
 * Real `codex exec --json` events observed from codex-cli 0.136.0:
 *
 *   {"type":"thread.started","thread_id":"<uuid>"}
 *   {"type":"turn.started"}
 *   {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
 *   {"type":"turn.completed","usage":{...}}
 *
 * Failure cases additionally emit (exit code is still 0):
 *   {"type":"error","message":"..."}
 *   {"type":"turn.failed","error":{"message":"..."}}
 */

export const CodexThreadStartedEventSchema = Schema.Struct({
  type: Schema.Literal("thread.started"),
  thread_id: Schema.String,
});

export const CodexAgentMessageItemSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("agent_message"),
  text: Schema.String,
});

export const CodexItemCompletedAgentMessageEventSchema = Schema.Struct({
  type: Schema.Literal("item.completed"),
  item: CodexAgentMessageItemSchema,
});

export type CodexThreadStartedEvent = Schema.Schema.Type<typeof CodexThreadStartedEventSchema>;
export type CodexItemCompletedAgentMessageEvent = Schema.Schema.Type<
  typeof CodexItemCompletedAgentMessageEventSchema
>;

const decodeThreadStarted = Schema.decodeUnknownEither(CodexThreadStartedEventSchema);
const decodeItemCompleted = Schema.decodeUnknownEither(CodexItemCompletedAgentMessageEventSchema);

const ERROR_EVENT_TYPES: ReadonlySet<string> = new Set([
  "error",
  "turn.failed",
  "thread.error",
  "item.failed",
]);

function parseLine(line: string): unknown | undefined {
  if (!line.trim()) return undefined;
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

export function findCodexResultEvent(
  lines: readonly string[],
): { sessionId: string; finalText: string } | undefined {
  let sessionId: string | undefined;
  let finalText: string | undefined;

  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed === undefined) continue;
    if (sessionId === undefined) {
      const decoded = decodeThreadStarted(parsed);
      if (Either.isRight(decoded)) {
        sessionId = decoded.right.thread_id;
        continue;
      }
    }
    const itemDecoded = decodeItemCompleted(parsed);
    if (Either.isRight(itemDecoded)) {
      finalText = itemDecoded.right.item.text;
    }
  }

  if (sessionId === undefined) return undefined;
  return { sessionId, finalText: finalText ?? "" };
}

export function hasCodexErroredResultEvent(lines: readonly string[]): boolean {
  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed === undefined) continue;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      typeof (parsed as { type: unknown }).type === "string" &&
      ERROR_EVENT_TYPES.has((parsed as { type: string }).type)
    ) {
      return true;
    }
  }
  return false;
}
