import { describe, expect, it } from "vitest";
import {
  FAILURE_KINDS,
  isTransientFailure,
  readClaudeOutcome,
  readCodexOutcome,
  readVibeOutcome,
} from "../../../src/domain/session/outcome.js";
import type {
  EndedSession,
  FailureKind,
  SessionEnd,
  SessionFailure,
  SessionOutcome,
  VibeExportRead,
} from "../../../src/domain/session/outcome.js";

// Oracles for the session outcome readers: each transcript below, written by
// hand as its provider prints it, and the outcome it must read as. Every test
// is marked `it.fails` until the readers land.

const CLAUDE_SESSION = "3f2b9c1e-6a4d-4e8f-9b21-7c5d0e8a1f42";
const CODEX_THREAD = "0199a7c2-5e3b-7d10-8f4a-2b6c9d1e0a37";
const VIBE_SESSION = "b8e0e3a1-9ad8-2100-46e7-4a199256f640";
const VIBE_EXPORT_PATH = "/tmp/phax-vibe-turn/export.json";

const exited = (code: number): SessionEnd => ({ kind: "exited", code });

function ended(lines: readonly unknown[], end: SessionEnd, stderr = ""): EndedSession {
  return { lines: lines.map((line) => JSON.stringify(line)), stderr, end };
}

function failureOf(outcome: SessionOutcome): SessionFailure {
  if (outcome.kind !== "failure") throw new Error(`expected a failure, read ${outcome.kind}`);
  return outcome.failure;
}

function exportText(exported: unknown): VibeExportRead {
  return { kind: "text", path: VIBE_EXPORT_PATH, text: JSON.stringify(exported) };
}

// ── Claude Code ─────────────────────────────────────────────────────────────

const claudeInit = {
  type: "system",
  subtype: "init",
  session_id: CLAUDE_SESSION,
  model: "claude-opus-5-5",
  tools: ["Read", "Edit", "Bash"],
};

describe("readClaudeOutcome", () => {
  it.fails("reads a success result as the answer with the result's session id", () => {
    const outcome = readClaudeOutcome(
      ended(
        [
          claudeInit,
          {
            type: "assistant",
            message: { role: "assistant", content: [{ type: "text", text: "PONG" }] },
            session_id: CLAUDE_SESSION,
          },
          {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "PONG",
            session_id: CLAUDE_SESSION,
          },
        ],
        exited(0),
      ),
    );
    expect(outcome).toEqual({
      kind: "answer",
      provider: "claude-code",
      text: "PONG",
      sessionId: CLAUDE_SESSION,
    });
  });

  it.fails("reads an error_during_execution result as a provider-error naming the subtype", () => {
    const failure = failureOf(
      readClaudeOutcome(
        ended(
          [
            claudeInit,
            {
              type: "result",
              subtype: "error_during_execution",
              is_error: true,
              session_id: CLAUDE_SESSION,
            },
          ],
          exited(1),
        ),
      ),
    );
    expect(failure.provider).toEqual("claude-code");
    expect(failure.kind).toEqual("provider-error");
    expect(failure.sessionId).toEqual(CLAUDE_SESSION);
    expect(failure.resetAt).toEqual(null);
    expect(failure.message).toContain("error_during_execution");
  });

  it.fails("reads an error_max_turns result with no result text as max-turns", () => {
    const failure = failureOf(
      readClaudeOutcome(
        ended(
          [
            {
              type: "result",
              subtype: "error_max_turns",
              is_error: true,
              session_id: CLAUDE_SESSION,
            },
          ],
          exited(1),
        ),
      ),
    );
    expect(failure.kind).toEqual("max-turns");
    expect(failure.provider).toEqual("claude-code");
    expect(failure.sessionId).toEqual(CLAUDE_SESSION);
    expect(failure.resetAt).toEqual(null);
  });

  it.fails("reads the DNS outage, ten api_retry events then the synthetic API Error, as network", () => {
    const apiError =
      "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)";
    const retries = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((attempt) => ({
      type: "system",
      subtype: "api_retry",
      attempt,
      max_retries: 10,
      retry_delay_ms: 500 * 2 ** (attempt - 1),
      error_status: null,
      error: "Connection error.",
      session_id: CLAUDE_SESSION,
    }));
    const failure = failureOf(
      readClaudeOutcome(
        ended(
          [
            claudeInit,
            ...retries,
            {
              type: "assistant",
              message: {
                role: "assistant",
                model: "<synthetic>",
                content: [{ type: "text", text: apiError }],
              },
              session_id: CLAUDE_SESSION,
            },
            {
              type: "result",
              subtype: "success",
              is_error: true,
              result: apiError,
              session_id: CLAUDE_SESSION,
            },
          ],
          exited(1),
        ),
      ),
    );
    expect(failure.kind).toEqual("network");
    expect(failure.provider).toEqual("claude-code");
    expect(failure.sessionId).toEqual(CLAUDE_SESSION);
    expect(failure.resetAt).toEqual(null);
    expect(failure.message).toBe(apiError);
  });

  it.fails("never reads a 429 in tool output or model text as a limit", () => {
    const failure = failureOf(
      readClaudeOutcome(
        ended(
          [
            claudeInit,
            {
              type: "user",
              message: {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: "toolu_01",
                    content: "HTTP/1.1 429 Too Many Requests",
                  },
                ],
              },
              session_id: CLAUDE_SESSION,
            },
            {
              type: "assistant",
              message: {
                role: "assistant",
                content: [{ type: "text", text: "I hit a rate limit" }],
              },
              session_id: CLAUDE_SESSION,
            },
            {
              type: "result",
              subtype: "error_during_execution",
              is_error: true,
              session_id: CLAUDE_SESSION,
            },
          ],
          exited(1),
        ),
      ),
    );
    expect(failure.kind).toEqual("provider-error");
    expect(failure.sessionId).toEqual(CLAUDE_SESSION);
    expect(failure.resetAt).toEqual(null);
  });

  it.fails("lets the result's usage limit win over a different error on stderr", () => {
    const limit = "Claude AI usage limit reached|1793120400";
    const failure = failureOf(
      readClaudeOutcome(
        ended(
          [
            {
              type: "result",
              subtype: "success",
              is_error: true,
              result: limit,
              session_id: CLAUDE_SESSION,
            },
          ],
          exited(1),
          "Error: something else broke\n",
        ),
      ),
    );
    expect(failure.kind).toEqual("usage-limit");
    expect(failure.sessionId).toEqual(CLAUDE_SESSION);
    expect(failure.resetAt).toEqual(new Date(1793120400 * 1000).toISOString());
    expect(failure.message).toBe(limit);
  });

  it.fails("reads a 429 rate_limit_error API Error result as rate-limit", () => {
    const failure = failureOf(
      readClaudeOutcome(
        ended(
          [
            {
              type: "result",
              subtype: "success",
              is_error: true,
              result: 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}',
              session_id: CLAUDE_SESSION,
            },
          ],
          exited(1),
        ),
      ),
    );
    expect(failure.kind).toEqual("rate-limit");
    expect(failure.sessionId).toEqual(CLAUDE_SESSION);
  });

  it.fails("reads a session ended by SIGTERM with no output as killed", () => {
    const failure = failureOf(
      readClaudeOutcome(ended([], { kind: "signalled", signal: "SIGTERM" })),
    );
    expect(failure.kind).toEqual("killed");
    expect(failure.provider).toEqual("claude-code");
    expect(failure.sessionId).toEqual(null);
    expect(failure.resetAt).toEqual(null);
    expect(failure.message).toContain("SIGTERM");
  });

  it.fails("reads a silent exit 1 as unknown with no session id", () => {
    const failure = failureOf(readClaudeOutcome(ended([], exited(1))));
    expect(failure.kind).toEqual("unknown");
    expect(failure.provider).toEqual("claude-code");
    expect(failure.sessionId).toEqual(null);
    expect(failure.resetAt).toEqual(null);
  });

  it.fails("reads a connection refusal on stderr as network with the init's session id", () => {
    const failure = failureOf(
      readClaudeOutcome(
        ended([claudeInit], exited(1), "Error: connect ECONNREFUSED 127.0.0.1:443\n"),
      ),
    );
    expect(failure.kind).toEqual("network");
    expect(failure.sessionId).toEqual(CLAUDE_SESSION);
    expect(failure.message).toContain("ECONNREFUSED");
  });

  it.fails("reads an error result as a failure even when the process exited 0", () => {
    const failure = failureOf(
      readClaudeOutcome(
        ended(
          [
            {
              type: "result",
              subtype: "success",
              is_error: true,
              result: "API Error: 500 Internal server error",
              session_id: CLAUDE_SESSION,
            },
          ],
          exited(0),
        ),
      ),
    );
    expect(failure.kind).toEqual("provider-error");
    expect(failure.sessionId).toEqual(CLAUDE_SESSION);
    expect(failure.message).toBe("API Error: 500 Internal server error");
  });
});

// ── Codex ───────────────────────────────────────────────────────────────────

const codexThread = { type: "thread.started", thread_id: CODEX_THREAD };
const codexTurnStarted = { type: "turn.started" };

describe("readCodexOutcome", () => {
  it.fails("reads a completed turn's agent message as the answer with the thread id", () => {
    const outcome = readCodexOutcome(
      ended(
        [
          codexThread,
          codexTurnStarted,
          { type: "item.completed", item: { id: "item_0", type: "agent_message", text: "DONE" } },
          {
            type: "turn.completed",
            usage: { input_tokens: 1200, cached_input_tokens: 0, output_tokens: 4 },
          },
        ],
        exited(0),
      ),
    );
    expect(outcome).toEqual({
      kind: "answer",
      provider: "codex-cli",
      text: "DONE",
      sessionId: CODEX_THREAD,
    });
  });

  it.fails("reads a stream disconnection in turn.failed as network with its exact message", () => {
    const message =
      "stream disconnected before completion: error sending request for url (https://api.openai.com/v1/responses)";
    const failure = failureOf(
      readCodexOutcome(
        ended(
          [codexThread, codexTurnStarted, { type: "turn.failed", error: { message } }],
          exited(1),
        ),
      ),
    );
    expect(failure.kind).toEqual("network");
    expect(failure.provider).toEqual("codex-cli");
    expect(failure.sessionId).toEqual(CODEX_THREAD);
    expect(failure.resetAt).toEqual(null);
    expect(failure.message).toBe(message);
  });

  it.fails("reads a usage limit error event as usage-limit", () => {
    const failure = failureOf(
      readCodexOutcome(
        ended(
          [{ type: "error", message: "You've hit your usage limit. Try again later." }],
          exited(1),
        ),
      ),
    );
    expect(failure.kind).toEqual("usage-limit");
    expect(failure.provider).toEqual("codex-cli");
    expect(failure.message).toContain("usage limit");
  });

  it.fails("reads a completed turn with no agent message as a provider-error with no answer", () => {
    const failure = failureOf(
      readCodexOutcome(
        ended(
          [
            codexThread,
            codexTurnStarted,
            {
              type: "turn.completed",
              usage: { input_tokens: 1200, cached_input_tokens: 0, output_tokens: 0 },
            },
          ],
          exited(0),
        ),
      ),
    );
    expect(failure.kind).toEqual("provider-error");
    expect(failure.sessionId).toEqual(CODEX_THREAD);
    expect(failure.message).toContain("no answer");
  });

  it.fails("reads an unsupported model in turn.failed as a provider-error with its own text", () => {
    const message = "unexpected status 400 Bad Request: model not supported";
    const failure = failureOf(
      readCodexOutcome(
        ended([codexThread, { type: "turn.failed", error: { message } }], exited(1)),
      ),
    );
    expect(failure.kind).toEqual("provider-error");
    expect(failure.sessionId).toEqual(CODEX_THREAD);
    expect(failure.resetAt).toEqual(null);
    expect(failure.message).toBe(message);
  });

  it.fails("never reads a 429 in command output as a limit", () => {
    const failure = failureOf(
      readCodexOutcome(
        ended(
          [
            codexThread,
            codexTurnStarted,
            {
              type: "item.completed",
              item: {
                id: "item_1",
                type: "command_execution",
                command: "curl -i https://example.test",
                aggregated_output: "HTTP/1.1 429 Too Many Requests",
                exit_code: 0,
                status: "completed",
              },
            },
            { type: "turn.failed", error: { message: "tool crashed" } },
          ],
          exited(1),
        ),
      ),
    );
    expect(failure.kind).toEqual("provider-error");
    expect(failure.sessionId).toEqual(CODEX_THREAD);
    expect(failure.message).toBe("tool crashed");
  });
});

// ── Mistral Vibe ────────────────────────────────────────────────────────────

const vibePongStream = [
  { type: "effect", name: "session_started", sessionId: VIBE_SESSION, createdAt: 1793116135001 },
  {
    type: "message",
    role: "user",
    content: [{ type: "text", text: "Reply with PONG" }],
    messageId: "msg-1793116135400",
    sessionId: VIBE_SESSION,
    createdAt: 1793116135400,
  },
  {
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "PONG" }],
    messageId: "msg-1793116136395",
    sessionId: VIBE_SESSION,
    createdAt: 1793116136395,
  },
];

const vibeUsage = {
  input_tokens: 10987,
  output_tokens: 3,
  cached_input_tokens: 3200,
  total_tokens: 10990,
};

/** A failure export as Vibe 3.0.3 writes it; its usage and cost still count the turn. */
function vibeFailureExport(
  outcome: string,
  exitCode: number,
  error: { readonly message: string; readonly code: string | null } | null,
): unknown {
  return {
    schema_version: 1,
    session_id: VIBE_SESSION,
    usage: vibeUsage,
    cost_usd: 0.016503,
    outcome,
    exit_code: exitCode,
    error,
    vibe_version: "3.0.3",
    limits: { max_turns: null, max_price: null },
    config: { active_model: "mistral-medium-3.5" },
    steps: 1,
  };
}

describe("readVibeOutcome", () => {
  it.fails("reads a finished export as the stream's last assistant text with the export's session id", () => {
    const outcome = readVibeOutcome(
      ended(vibePongStream, exited(0)),
      exportText({
        schema_version: 1,
        session_id: VIBE_SESSION,
        usage: vibeUsage,
        cost_usd: 0.016503,
        outcome: "finished",
        exit_code: 0,
        error: null,
        vibe_version: "3.0.3",
      }),
    );
    expect(outcome).toEqual({
      kind: "answer",
      provider: "mistral-vibe",
      text: "PONG",
      sessionId: VIBE_SESSION,
    });
  });

  it.fails("reads a config_error with invalid_api_key as a provider-error naming key and code", () => {
    const failure = failureOf(
      readVibeOutcome(
        ended([], exited(1)),
        exportText({
          schema_version: 1,
          session_id: null,
          usage: null,
          cost_usd: null,
          outcome: "config_error",
          exit_code: 1,
          error: {
            message: "Invalid API key (from env var MISTRAL_API_KEY)",
            code: "invalid_api_key",
          },
          vibe_version: "3.0.3",
          steps: null,
          config: null,
        }),
      ),
    );
    expect(failure.kind).toEqual("provider-error");
    expect(failure.provider).toEqual("mistral-vibe");
    expect(failure.sessionId).toEqual(null);
    expect(failure.resetAt).toEqual(null);
    expect(failure.message).toContain("Invalid API key");
    expect(failure.message).toContain("invalid_api_key");
  });

  it.fails("reads a backend_error the model refused as a provider-error with its text", () => {
    const failure = failureOf(
      readVibeOutcome(
        ended([], exited(2)),
        exportText(
          vibeFailureExport("infrastructure_failure", 2, {
            message:
              "API error occurred: Status 400. reasoning_effort low is not supported for this model",
            code: "backend_error",
          }),
        ),
      ),
    );
    expect(failure.kind).toEqual("provider-error");
    expect(failure.sessionId).toEqual(VIBE_SESSION);
    expect(failure.message).toContain("reasoning_effort low is not supported");
  });

  it.fails("reads a backend_error carrying a DNS failure as network", () => {
    const failure = failureOf(
      readVibeOutcome(
        ended([], exited(2)),
        exportText(
          vibeFailureExport("infrastructure_failure", 2, {
            message: "[Errno 8] nodename nor servname provided, or not known",
            code: "backend_error",
          }),
        ),
      ),
    );
    expect(failure.kind).toEqual("network");
    expect(failure.provider).toEqual("mistral-vibe");
    expect(failure.sessionId).toEqual(VIBE_SESSION);
    expect(failure.message).toContain("nodename nor servname");
  });

  it.fails("reads the rate_limit error code as rate-limit", () => {
    const failure = failureOf(
      readVibeOutcome(
        ended([], exited(2)),
        exportText(
          vibeFailureExport("infrastructure_failure", 2, {
            message: "Too many requests",
            code: "rate_limit",
          }),
        ),
      ),
    );
    expect(failure.kind).toEqual("rate-limit");
    expect(failure.sessionId).toEqual(VIBE_SESSION);
  });

  it.fails("reads a turn_limit outcome as max-turns with the export's session id", () => {
    const failure = failureOf(
      readVibeOutcome(
        ended(vibePongStream, exited(3)),
        exportText(vibeFailureExport("turn_limit", 3, null)),
      ),
    );
    expect(failure.kind).toEqual("max-turns");
    expect(failure.sessionId).toEqual(VIBE_SESSION);
    expect(failure.resetAt).toEqual(null);
  });

  it.fails("reads a terminated outcome as killed", () => {
    const failure = failureOf(
      readVibeOutcome(ended([], exited(3)), exportText(vibeFailureExport("terminated", 3, null))),
    );
    expect(failure.kind).toEqual("killed");
    expect(failure.sessionId).toEqual(VIBE_SESSION);
  });

  it.fails("reads a deadline outcome as killed", () => {
    const failure = failureOf(
      readVibeOutcome(ended([], exited(3)), exportText(vibeFailureExport("deadline", 3, null))),
    );
    expect(failure.kind).toEqual("killed");
    expect(failure.sessionId).toEqual(VIBE_SESSION);
  });

  it.fails("decodes a failure export whose nullable fields are all null and reads it as network", () => {
    const failure = failureOf(
      readVibeOutcome(
        ended([], exited(2)),
        exportText({
          schema_version: 1,
          session_id: null,
          usage: null,
          cost_usd: null,
          outcome: "infrastructure_failure",
          exit_code: 2,
          error: { message: "All connection attempts failed", code: "backend_error" },
          vibe_version: "3.0.3",
          steps: null,
          config: null,
        }),
      ),
    );
    expect(failure.kind).toEqual("network");
    expect(failure.sessionId).toEqual(null);
    expect(failure.message).toContain("All connection attempts failed");
  });

  it.fails("reads a completion's rate limit on stderr when no export was requested", () => {
    const failure = failureOf(
      readVibeOutcome(ended([], exited(1), "Error: 429 rate limited\n"), {
        kind: "not-requested",
      }),
    );
    expect(failure.kind).toEqual("rate-limit");
    expect(failure.provider).toEqual("mistral-vibe");
    expect(failure.sessionId).toEqual(null);
  });

  it.fails("reads an absent export as a provider-error naming its path", () => {
    const failure = failureOf(
      readVibeOutcome(ended(vibePongStream, exited(0)), {
        kind: "absent",
        path: VIBE_EXPORT_PATH,
      }),
    );
    expect(failure.kind).toEqual("provider-error");
    expect(failure.message).toContain(VIBE_EXPORT_PATH);
  });
});

// ── Transient kinds ─────────────────────────────────────────────────────────

describe("isTransientFailure", () => {
  const transient: readonly FailureKind[] = ["network", "rate-limit", "usage-limit"];

  it.fails("is true exactly for network, rate-limit and usage-limit", () => {
    expect(FAILURE_KINDS.map((kind) => [kind, isTransientFailure(kind)])).toEqual(
      FAILURE_KINDS.map((kind) => [kind, transient.includes(kind)]),
    );
  });
});
