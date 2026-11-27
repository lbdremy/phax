import { Result, Schema } from "effect";

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
 *
 * On a network loss codex-cli 0.165.0 never ends the turn: it emits
 *   {"type":"error","message":"Reconnecting... 2/5 (stream disconnected before completion: …)"}
 * up to 5/5, then repeats
 *   {"type":"error","message":"Reconnecting... waiting for network (Connection failed: …)"}
 * for as long as it runs, with no `turn.failed`. phax's watchdog
 * (`src/domain/session/codexNetworkWatch.ts`) ends it after a run of such
 * events and reports a `network` failure; an interrupt before that ends it too,
 * and the session is then read from the last `error` event.
 */

const CodexThreadStartedEventSchema = Schema.Struct({
  type: Schema.Literal("thread.started"),
  thread_id: Schema.String,
});

const CodexAgentMessageItemSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("agent_message"),
  text: Schema.String,
});

const CodexItemCompletedAgentMessageEventSchema = Schema.Struct({
  type: Schema.Literal("item.completed"),
  item: CodexAgentMessageItemSchema,
});

const decodeThreadStarted = Schema.decodeUnknownResult(CodexThreadStartedEventSchema, {
  reportInput: true,
});
const decodeItemCompleted = Schema.decodeUnknownResult(CodexItemCompletedAgentMessageEventSchema, {
  reportInput: true,
});

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

const decodeCodexTurnCompletedEvent = Schema.decodeUnknownResult(CodexTurnCompletedEventSchema, {
  reportInput: true,
});
const decodeCodexTurnFailedEvent = Schema.decodeUnknownResult(CodexTurnFailedEventSchema, {
  reportInput: true,
});
const decodeCodexErrorEvent = Schema.decodeUnknownResult(CodexErrorEventSchema, {
  reportInput: true,
});

/** How the turn ended: the last `turn.completed` or `turn.failed` event. */
type CodexTurnEnd =
  | { readonly kind: "completed" }
  | { readonly kind: "failed"; readonly message: string | undefined };

/** The events of one Codex stream that decide how its session ended. */
interface CodexOutcomeEvents {
  /** The first `thread.started` event's thread id. */
  readonly threadId: string | undefined;
  /** The text of the last agent message that is not blank. */
  readonly agentMessage: string | undefined;
  readonly turnEnd: CodexTurnEnd | undefined;
  /** The last `error` event's message. */
  readonly errorMessage: string | undefined;
}

/**
 * One live stdout line as the network watchdog reads it: the thread it
 * started, an `error` event's message, or anything else (another event, or a
 * line that does not decode).
 */
type CodexStreamLine =
  | { readonly kind: "thread-started"; readonly threadId: string }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "other" };

export function decodeCodexStreamLine(line: string): CodexStreamLine {
  const parsed = parseLine(line);
  if (parsed === undefined) return { kind: "other" };
  const started = decodeThreadStarted(parsed);
  if (Result.isSuccess(started))
    return { kind: "thread-started", threadId: started.success.thread_id };
  const error = decodeCodexErrorEvent(parsed);
  if (Result.isSuccess(error)) return { kind: "error", message: error.success.message };
  return { kind: "other" };
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
    if (Result.isSuccess(started)) {
      threadId ??= started.success.thread_id;
      continue;
    }
    const item = decodeItemCompleted(parsed);
    if (Result.isSuccess(item)) {
      // A blank agent message is no answer.
      if (item.success.item.text.trim().length > 0) agentMessage = item.success.item.text;
      continue;
    }
    if (Result.isSuccess(decodeCodexTurnCompletedEvent(parsed))) {
      turnEnd = { kind: "completed" };
      continue;
    }
    const failed = decodeCodexTurnFailedEvent(parsed);
    if (Result.isSuccess(failed)) {
      turnEnd = { kind: "failed", message: failed.success.error?.message };
      continue;
    }
    const error = decodeCodexErrorEvent(parsed);
    if (Result.isSuccess(error)) errorMessage = error.success.message;
  }
  return { threadId, agentMessage, turnEnd, errorMessage };
}
