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

function parseLine(line: string): unknown | undefined {
  if (!line.trim()) return undefined;
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * What the session outcome reader takes from a Codex stream: the turn's end
 * (`turn.completed`, or `turn.failed` with its message), the last `error`
 * event's message, the thread id and the last agent message. An item other
 * than an agent message (a `command_execution`, say) is never decoded.
 */
const CodexTurnCompletedEventSchema = Schema.Struct({
  type: Schema.Literal("turn.completed"),
});

const CodexTurnFailedEventSchema = Schema.Struct({
  type: Schema.Literal("turn.failed"),
  error: Schema.optional(Schema.Struct({ message: Schema.optional(Schema.String) })),
});

const CodexErrorEventSchema = Schema.Struct({
  type: Schema.Literal("error"),
  message: Schema.String,
});

export const decodeCodexTurnCompletedEvent = Schema.decodeUnknownEither(
  CodexTurnCompletedEventSchema,
);
export const decodeCodexTurnFailedEvent = Schema.decodeUnknownEither(CodexTurnFailedEventSchema);
export const decodeCodexErrorEvent = Schema.decodeUnknownEither(CodexErrorEventSchema);

/** How the turn ended: the last `turn.completed` or `turn.failed` event. */
type CodexTurnEnd =
  | { readonly kind: "completed" }
  | { readonly kind: "failed"; readonly message: string | undefined };

/** The events of one Codex stream that decide how its session ended. */
interface CodexOutcomeEvents {
  /** The first `thread.started` event's thread id. */
  readonly threadId: string | undefined;
  /** The text of the last agent message. */
  readonly agentMessage: string | undefined;
  readonly turnEnd: CodexTurnEnd | undefined;
  /** The last `error` event's message. */
  readonly errorMessage: string | undefined;
}

export function scanCodexOutcomeEvents(lines: readonly string[]): CodexOutcomeEvents {
  let threadId: string | undefined;
  let agentMessage: string | undefined;
  let turnEnd: CodexTurnEnd | undefined;
  let errorMessage: string | undefined;
  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed === undefined) continue;
    const started = decodeThreadStarted(parsed);
    if (Either.isRight(started)) {
      threadId ??= started.right.thread_id;
      continue;
    }
    const item = decodeItemCompleted(parsed);
    if (Either.isRight(item)) {
      agentMessage = item.right.item.text;
      continue;
    }
    if (Either.isRight(decodeCodexTurnCompletedEvent(parsed))) {
      turnEnd = { kind: "completed" };
      continue;
    }
    const failed = decodeCodexTurnFailedEvent(parsed);
    if (Either.isRight(failed)) {
      turnEnd = { kind: "failed", message: failed.right.error?.message };
      continue;
    }
    const error = decodeCodexErrorEvent(parsed);
    if (Either.isRight(error)) errorMessage = error.right.message;
  }
  return { threadId, agentMessage, turnEnd, errorMessage };
}
