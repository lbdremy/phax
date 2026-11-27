import { decodeCodexStreamLine } from "../../schemas/codexOutput.js";
import type { SessionFailure } from "./outcome.js";
import { classifyVerdictText } from "./signatures.js";

/**
 * The Codex network watchdog's rule. codex-cli 0.165, its API unreachable,
 * emits `Reconnecting... N/5` up to 5/5 and then `Reconnecting... waiting for
 * network` every ~50 s without end, never `turn.failed`. phax counts the
 * consecutive network `error` events on stdout and, at the threshold, ends the
 * process and reports a `network` failure.
 *
 * A network event is an `error` event whose message starts with
 * `Reconnecting...` or reads as `network` in the signature table. Any other
 * stdout line (another event, an `error` that is not a network one, a line that
 * does not decode) resets the count.
 */

/** Codex's 5 numbered reconnects plus 3 `waiting for network` events: about 2.5 to 3 minutes. */
const CODEX_NETWORK_EVENT_LIMIT = 8;

const RECONNECTING_PREFIX = "Reconnecting...";

/** What the watch has seen so far of one live Codex stream. */
export interface CodexNetworkWatch {
  /** Consecutive network events up to the last line. */
  readonly count: number;
  /** True once `count` reached the threshold. */
  readonly tripped: boolean;
  /** The last network event's message. */
  readonly lastMessage: string | undefined;
  /** The first `thread.started` event's thread id. */
  readonly threadId: string | undefined;
}

export const CODEX_NETWORK_WATCH_START: CodexNetworkWatch = {
  count: 0,
  tripped: false,
  lastMessage: undefined,
  threadId: undefined,
};

function isNetworkMessage(message: string): boolean {
  return message.startsWith(RECONNECTING_PREFIX) || classifyVerdictText(message) === "network";
}

/** The watch after one complete stdout line. */
export function stepCodexNetworkWatch(watch: CodexNetworkWatch, line: string): CodexNetworkWatch {
  const event = decodeCodexStreamLine(line);
  if (event.kind === "error" && isNetworkMessage(event.message)) {
    const count = watch.count + 1;
    return {
      ...watch,
      count,
      tripped: count >= CODEX_NETWORK_EVENT_LIMIT,
      lastMessage: event.message,
    };
  }
  const threadId =
    event.kind === "thread-started" ? (watch.threadId ?? event.threadId) : watch.threadId;
  return { ...watch, count: 0, tripped: false, threadId };
}

/** The `network` failure a tripped watch reports. */
export function codexNetworkFailure(watch: CodexNetworkWatch): SessionFailure {
  return {
    provider: "codex-cli",
    kind: "network",
    message:
      watch.lastMessage ??
      `codex reported ${CODEX_NETWORK_EVENT_LIMIT} network errors in a row and was stopped`,
    sessionId: watch.threadId ?? null,
    resetAt: null,
  };
}
