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

/** One `system`/`api_retry` event as Claude Code 2.1.312 prints it. */
function apiRetry(attempt: number, error: string, status: number | null) {
  return {
    type: "system",
    subtype: "api_retry",
    attempt,
    max_retries: 10,
    retry_delay_ms: 500 * 2 ** (attempt - 1),
    error_status: status,
    error,
    session_id: CLAUDE_SESSION,
    uuid: `0d1e2f3a-4b5c-4d6e-8f70-81920a3b4c${String(attempt).padStart(2, "0")}`,
  };
}

/** `count` retries of a request that got no HTTP response. */
function connectionRetries(count: number) {
  return Array.from({ length: count }, (_, index) => apiRetry(index + 1, "unknown", null));
}

/** The synthetic API-error message and the error result Claude Code ends such a session with. */
function claudeApiError(text: string, category: string, status: number | null) {
  return [
    {
      type: "assistant",
      message: {
        id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
        model: "<synthetic>",
        role: "assistant",
        stop_reason: "stop_sequence",
        type: "message",
        content: [{ type: "text", text }],
      },
      parent_tool_use_id: null,
      session_id: CLAUDE_SESSION,
      error: category,
      is_api_error_message: true,
    },
    {
      type: "result",
      subtype: "success",
      is_error: true,
      num_turns: 1,
      duration_api_ms: 0,
      total_cost_usd: 0,
      stop_reason: "stop_sequence",
      terminal_reason: "api_error",
      api_error_status: status,
      result: text,
      session_id: CLAUDE_SESSION,
    },
  ];
}

/** A `rate_limit_event`; `resetsAt` in epoch seconds. */
function rateLimitEvent(status: string, resetsAt: number) {
  return {
    type: "rate_limit_event",
    rate_limit_info: { status, resetsAt, rateLimitType: "five_hour", isUsingOverage: false },
    uuid: "7e8f9a0b-1c2d-4e3f-9a4b-5c6d7e8f9a0b",
    session_id: CLAUDE_SESSION,
  };
}

describe("readClaudeOutcome", () => {
  it("reads a success result as the answer with the result's session id", () => {
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

  it("reads an error_during_execution result as a provider-error naming the subtype", () => {
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

  it("reads an error_max_turns result with no result text as max-turns", () => {
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

  it("reads the DNS outage, ten api_retry events then the synthetic API Error, as network", () => {
    const apiError =
      "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)";
    const failure = failureOf(
      readClaudeOutcome(
        ended(
          [claudeInit, ...connectionRetries(10), ...claudeApiError(apiError, "server_error", null)],
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

  it("reads an API error with no HTTP status as network, whatever its wording", () => {
    const apiError = "API Error: the line went quiet";
    const failure = failureOf(
      readClaudeOutcome(
        ended([claudeInit, ...claudeApiError(apiError, "unknown", null)], exited(1)),
      ),
    );
    expect(failure).toMatchObject({ kind: "network", message: apiError });
  });

  it("reads an API error with an HTTP status and no known wording as provider-error", () => {
    const apiError = "API Error: 500 the server had a bad day";
    const failure = failureOf(
      readClaudeOutcome(
        ended([claudeInit, ...claudeApiError(apiError, "server_error", 500)], exited(1)),
      ),
    );
    expect(failure).toMatchObject({ kind: "provider-error", message: apiError });
  });

  it("reads a 429 API error with no limit wording as rate-limit", () => {
    const apiError = "API Error: please slow down";
    const failure = failureOf(
      readClaudeOutcome(
        ended([claudeInit, ...claudeApiError(apiError, "rate_limit", 429)], exited(1)),
      ),
    );
    expect(failure).toMatchObject({ kind: "rate-limit", message: apiError, resetAt: null });
  });

  it("reads a billing_error API error as usage-limit", () => {
    const apiError = "API Error: your account needs attention";
    const failure = failureOf(
      readClaudeOutcome(
        ended([claudeInit, ...claudeApiError(apiError, "billing_error", 400)], exited(1)),
      ),
    );
    expect(failure.kind).toBe("usage-limit");
  });

  it("reads Claude Code's plan limit as usage-limit, its reset time from the rejected rate-limit event", () => {
    const limit = "You've hit your session limit · resets 7:50pm (Europe/Paris)";
    const failure = failureOf(
      readClaudeOutcome(
        ended(
          [
            claudeInit,
            rateLimitEvent("allowed_warning", 1793116800),
            rateLimitEvent("rejected", 1793120400),
            ...claudeApiError(limit, "rate_limit", 429),
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

  it("reads a session that ended while retrying a connection failure as network", () => {
    const failure = failureOf(
      readClaudeOutcome(ended([claudeInit, ...connectionRetries(3)], exited(1), "")),
    );
    expect(failure.kind).toBe("network");
    expect(failure.sessionId).toBe(CLAUDE_SESSION);
    expect(failure.message).toContain("attempt 3 of 10");
  });

  it("reads a session that ended while retrying a rate limit as rate-limit", () => {
    const failure = failureOf(
      readClaudeOutcome(
        ended(
          [
            claudeInit,
            apiRetry(1, "rate_limit", 429),
            rateLimitEvent("rejected", 1793120400),
            apiRetry(2, "rate_limit", 429),
          ],
          exited(1),
        ),
      ),
    );
    expect(failure).toMatchObject({
      kind: "rate-limit",
      resetAt: new Date(1793120400 * 1000).toISOString(),
    });
  });

  it("lets stderr word a session that ended while retrying a server error", () => {
    const failure = failureOf(
      readClaudeOutcome(
        ended([claudeInit, apiRetry(4, "server_error", 500)], exited(1), "Error: boom\n"),
      ),
    );
    expect(failure).toMatchObject({ kind: "provider-error", message: "Error: boom" });
  });

  it("lets stderr win over a retry the session got past", () => {
    const failure = failureOf(
      readClaudeOutcome(
        ended(
          [
            claudeInit,
            apiRetry(1, "unknown", null),
            {
              type: "assistant",
              message: { role: "assistant", content: [{ type: "text", text: "Reading files" }] },
              session_id: CLAUDE_SESSION,
            },
          ],
          exited(1),
          "Error: the tool host crashed\n",
        ),
      ),
    );
    expect(failure).toMatchObject({
      kind: "provider-error",
      message: "Error: the tool host crashed",
    });
  });

  it("reads a session killed while retrying as killed", () => {
    const failure = failureOf(
      readClaudeOutcome(
        ended([claudeInit, ...connectionRetries(2)], { kind: "signalled", signal: "SIGTERM" }),
      ),
    );
    expect(failure.kind).toBe("killed");
  });

  it("never reads a 429 in tool output or model text as a limit", () => {
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

  it("reads a 429 rate_limit_error API Error result as rate-limit", () => {
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

  it("reads a session ended by SIGTERM with no output as killed", () => {
    const failure = failureOf(
      readClaudeOutcome(ended([], { kind: "signalled", signal: "SIGTERM" })),
    );
    expect(failure.kind).toEqual("killed");
    expect(failure.provider).toEqual("claude-code");
    expect(failure.sessionId).toEqual(null);
    expect(failure.resetAt).toEqual(null);
    expect(failure.message).toContain("SIGTERM");
  });

  it("reads a silent exit 1 as unknown with no session id", () => {
    const failure = failureOf(readClaudeOutcome(ended([], exited(1))));
    expect(failure.kind).toEqual("unknown");
    expect(failure.provider).toEqual("claude-code");
    expect(failure.sessionId).toEqual(null);
    expect(failure.resetAt).toEqual(null);
  });

  it("reads a connection refusal on stderr as network with the init's session id", () => {
    const failure = failureOf(
      readClaudeOutcome(
        ended([claudeInit], exited(1), "Error: connect ECONNREFUSED 127.0.0.1:443\n"),
      ),
    );
    expect(failure.kind).toEqual("network");
    expect(failure.sessionId).toEqual(CLAUDE_SESSION);
    expect(failure.message).toContain("ECONNREFUSED");
  });

  it("reads an error result as a failure even when the process exited 0", () => {
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
  it("reads a completed turn's agent message as the answer with the thread id", () => {
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

  it("reads a stream disconnection in turn.failed as network with its exact message", () => {
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

  it("reads a usage limit error event as usage-limit", () => {
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

  it("reads a completed turn with no agent message as a provider-error with no answer", () => {
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

  it("reads a completed turn whose agent message is blank as a provider-error with no answer", () => {
    const failure = failureOf(
      readCodexOutcome(
        ended(
          [
            codexThread,
            codexTurnStarted,
            { type: "item.completed", item: { id: "item_0", type: "agent_message", text: " \n " } },
            { type: "turn.completed", usage: { input_tokens: 900, output_tokens: 2 } },
          ],
          exited(0),
        ),
      ),
    );
    expect(failure).toMatchObject({ kind: "provider-error", sessionId: CODEX_THREAD });
    expect(failure.message).toContain("no answer was found");
  });

  it("reads a stream that exits 0 with no turn end as a provider-error with no answer", () => {
    const failure = failureOf(
      readCodexOutcome(
        ended(
          [
            codexThread,
            codexTurnStarted,
            { type: "item.completed", item: { id: "item_0", type: "agent_message", text: "half" } },
          ],
          exited(0),
        ),
      ),
    );
    expect(failure).toMatchObject({ kind: "provider-error", sessionId: CODEX_THREAD });
    expect(failure.message).toContain("no answer was found");
  });

  it("reads a session interrupted while waiting for the network as network", () => {
    const failure = failureOf(
      readCodexOutcome(
        ended(
          [
            codexThread,
            codexTurnStarted,
            {
              type: "error",
              message:
                "Reconnecting... 5/5 (stream disconnected before completion: Connection refused (os error 61))",
            },
            {
              type: "error",
              message:
                "Reconnecting... waiting for network (Connection failed: error sending request)",
            },
          ],
          { kind: "exited", code: 130 },
        ),
      ),
    );
    expect(failure).toMatchObject({ kind: "network", sessionId: CODEX_THREAD });
    expect(failure.message).toContain("waiting for network");
  });

  it("reads an unsupported model in turn.failed as a provider-error with its own text", () => {
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

  it("never reads a 429 in command output as a limit", () => {
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
  it("reads a finished export as the stream's last assistant text with the export's session id", () => {
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

  it("reads a config_error with invalid_api_key as a provider-error naming key and code", () => {
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

  it("reads a backend_error the model refused as a provider-error with its text", () => {
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

  it("reads a backend_error carrying a DNS failure as network", () => {
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

  it("reads the rate_limit error code as rate-limit", () => {
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

  it("reads a turn_limit outcome as max-turns with the export's session id", () => {
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

  it("reads a terminated outcome as killed", () => {
    const failure = failureOf(
      readVibeOutcome(ended([], exited(3)), exportText(vibeFailureExport("terminated", 3, null))),
    );
    expect(failure.kind).toEqual("killed");
    expect(failure.sessionId).toEqual(VIBE_SESSION);
  });

  it("reads a deadline outcome as killed", () => {
    const failure = failureOf(
      readVibeOutcome(ended([], exited(3)), exportText(vibeFailureExport("deadline", 3, null))),
    );
    expect(failure.kind).toEqual("killed");
    expect(failure.sessionId).toEqual(VIBE_SESSION);
  });

  it("decodes a failure export whose nullable fields are all null and reads it as network", () => {
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

  it("reads a completion's rate limit on stderr when no export was requested", () => {
    const failure = failureOf(
      readVibeOutcome(ended([], exited(1), "Error: 429 rate limited\n"), {
        kind: "not-requested",
      }),
    );
    expect(failure.kind).toEqual("rate-limit");
    expect(failure.provider).toEqual("mistral-vibe");
    expect(failure.sessionId).toEqual(null);
  });

  it("reads an absent export as a provider-error naming its path", () => {
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

  it("is true exactly for network, rate-limit and usage-limit", () => {
    expect(FAILURE_KINDS.map((kind) => [kind, isTransientFailure(kind)])).toEqual(
      FAILURE_KINDS.map((kind) => [kind, transient.includes(kind)]),
    );
  });
});
