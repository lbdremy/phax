import type { ProviderId } from "../routing/types.js";
import { readClaudeOutcome } from "./claudeOutcome.js";
import { readCodexOutcome } from "./codexOutcome.js";
import { readVibeOutcome } from "./vibeOutcome.js";

/**
 * The session outcome contract: how an ended provider session (Claude Code,
 * Codex, Mistral Vibe) reads as an answer or a failure. Pure — the adapters
 * spawn the provider and read its files; the readers here only judge.
 *
 * Reading order, the same for every provider:
 *
 * 1. The provider's final result event decides: a Claude `result` event, a
 *    Codex `turn.failed` or `turn.completed`, or a Vibe export with an
 *    outcome. Its verdict wins over the exit code: an error result fails a
 *    session that exited 0, and a success verdict answers a session that then
 *    exited non-zero. A Codex `turn.completed` with no agent message fails as
 *    `provider-error` (no answer was found).
 * 2. With none, a process that ended on a signal or a timeout is `killed`.
 * 3. Otherwise the transcript's last error event: a Claude `system`/`api_retry`
 *    error, a Codex `error` event.
 * 4. Otherwise stderr's first non-empty lines, at most three, joined by a space.
 * 5. Otherwise `unknown`, with no session id unless an init or thread event
 *    gave one.
 *
 * Tool output (Claude `user` tool_result content, Codex `command_execution`
 * output) and model text (assistant messages) are never read to classify or
 * to word a failure. The failure's message is the deciding source's own text.
 *
 * The kind is read from that text: usage-limit signatures before rate-limit,
 * then network signatures; otherwise `provider-error`, or `max-turns` for a
 * turn-limit verdict (Claude `error_max_turns`, Vibe `turn_limit`). Vibe's
 * `terminated` and `deadline` outcomes are `killed`, its `rate_limit` code is
 * `rate-limit` and its `invalid_api_key` code is `provider-error`; any other
 * Vibe failure is classified from its error message. `resetAt` is the limit's
 * reset time as an ISO string when the provider reported one, else null.
 *
 * The session id comes from the result event, else from the Claude
 * `system`/`init` event, the Codex `thread.started` event or the Vibe export.
 */

/** Why a session failed. */
export type FailureKind =
  | "network"
  | "rate-limit"
  | "usage-limit"
  | "provider-error"
  | "max-turns"
  | "killed"
  | "unknown";

/** Every failure kind, in declaration order. */
export const FAILURE_KINDS: readonly FailureKind[] = [
  "network",
  "rate-limit",
  "usage-limit",
  "provider-error",
  "max-turns",
  "killed",
  "unknown",
];

/** A failed session: its kind, the provider's own message and what it reported. */
export interface SessionFailure {
  readonly provider: ProviderId;
  readonly kind: FailureKind;
  readonly message: string;
  readonly sessionId: string | null;
  readonly resetAt: string | null;
}

/** What an ended session reads as. */
export type SessionOutcome =
  | {
      readonly kind: "answer";
      readonly provider: ProviderId;
      readonly text: string;
      readonly sessionId: string | null;
    }
  | { readonly kind: "failure"; readonly failure: SessionFailure };

/** How the provider process ended. */
export type SessionEnd =
  | { readonly kind: "exited"; readonly code: number }
  | { readonly kind: "signalled"; readonly signal: string }
  | { readonly kind: "timed-out" };

/** An ended session as the adapter saw it. */
export interface EndedSession {
  /** Stdout, one JSON line each. */
  readonly lines: readonly string[];
  readonly stderr: string;
  readonly end: SessionEnd;
}

/** What reading Vibe's `export.json` gave the adapter. */
export type VibeExportRead =
  | { readonly kind: "not-requested" }
  | { readonly kind: "absent"; readonly path: string }
  | { readonly kind: "unreadable"; readonly path: string; readonly detail: string }
  | { readonly kind: "text"; readonly path: string; readonly text: string };

/** Whether a failure of this kind may pass if retried later. */
export function isTransientFailure(kind: FailureKind): boolean {
  return kind === "network" || kind === "rate-limit" || kind === "usage-limit";
}

// The readers: Claude Code (`--output-format stream-json`), Codex
// (`codex exec --json`) and Mistral Vibe (its stream and its `export.json`).
export { readClaudeOutcome, readCodexOutcome, readVibeOutcome };
