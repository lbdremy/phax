import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractClaudeUsage,
  extractCodexUsage,
  extractVibeUsage,
} from "../../src/domain/records/usage.js";

const here = dirname(fileURLToPath(import.meta.url));
const codexFixturePath = join(here, "providers", "fixtures", "codex-exec-sample.jsonl");

function claudeResultLine(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    result: "done",
    session_id: "sess-abc",
    is_error: false,
    total_cost_usd: 0.12,
    usage: {
      input_tokens: 41203,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 512,
      output_tokens: 8117,
    },
    ...overrides,
  });
}

describe("extractClaudeUsage", () => {
  it("extracts usage from the result event's usage object and total_cost_usd", () => {
    const usage = extractClaudeUsage([claudeResultLine()]);
    expect(usage).toEqual({
      provider: "claude-code",
      inputTokens: 41203,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 512,
      outputTokens: 8117,
      totalCostUsd: 0.12,
    });
  });

  it("scans backward past assistant/tool lines to find the terminal result event", () => {
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: [] } }),
      JSON.stringify({ type: "user", message: { content: [] } }),
      claudeResultLine(),
    ];
    expect(extractClaudeUsage(lines)?.inputTokens).toBe(41203);
  });

  it("returns undefined when no result event is present", () => {
    const lines = [JSON.stringify({ type: "assistant", message: { content: [] } })];
    expect(extractClaudeUsage(lines)).toBeUndefined();
  });

  it("returns undefined for a result event missing usage fields", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "done",
      session_id: "sess-abc",
      is_error: false,
    });
    expect(extractClaudeUsage([line])).toBeUndefined();
  });

  it("skips malformed JSON lines rather than throwing", () => {
    expect(extractClaudeUsage(["not json", claudeResultLine()])?.outputTokens).toBe(8117);
  });
});

describe("extractCodexUsage", () => {
  it("extracts usage from turn.completed in a real fixture transcript", () => {
    const lines = readFileSync(codexFixturePath, "utf8").split("\n").filter(Boolean);
    const usage = extractCodexUsage(lines);
    expect(usage).toEqual({
      provider: "codex-cli",
      inputTokens: 31299,
      cachedInputTokens: 2432,
      outputTokens: 5,
      reasoningOutputTokens: 0,
    });
  });

  it("returns undefined when no turn.completed event is present", () => {
    const lines = [JSON.stringify({ type: "thread.started", thread_id: "abc" })];
    expect(extractCodexUsage(lines)).toBeUndefined();
  });

  it("returns undefined for a turn.completed event missing usage fields", () => {
    const lines = [JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10 } })];
    expect(extractCodexUsage(lines)).toBeUndefined();
  });
});

describe("extractVibeUsage", () => {
  it("extracts usage from the session meta.json .stats object", () => {
    const metaJson = JSON.stringify({
      session_id: "session_123_abc",
      stats: {
        session_prompt_tokens: 1000,
        session_completion_tokens: 200,
        session_cost: 0.05,
        tool_calls_agreed: 3,
        tool_calls_rejected: 1,
        tool_calls_failed: 0,
        tool_calls_succeeded: 2,
      },
    });
    const usage = extractVibeUsage(metaJson);
    expect(usage).toEqual({
      provider: "mistral-vibe",
      inputTokens: 1000,
      outputTokens: 200,
      sessionCostUsd: 0.05,
      toolCallsAgreed: 3,
      toolCallsRejected: 1,
      toolCallsFailed: 0,
      toolCallsSucceeded: 2,
    });
  });

  it("extracts usage from a real vibe 2.13.0 stats shape, ignoring extra fields", () => {
    // Captured verbatim from a live ~/.vibe/logs/session/<id>/meta.json.
    const metaJson = JSON.stringify({
      session_id: "session_123_abc",
      stats: {
        steps: 4,
        session_prompt_tokens: 25418,
        session_completion_tokens: 179,
        tool_calls_agreed: 2,
        tool_calls_rejected: 0,
        tool_calls_failed: 0,
        tool_calls_succeeded: 2,
        context_tokens: 8653,
        last_turn_prompt_tokens: 8596,
        last_turn_completion_tokens: 57,
        last_turn_duration: 8.81681000000026,
        tokens_per_second: 6.464923254555596,
        input_price_per_million: 1.5,
        output_price_per_million: 7.5,
        session_total_llm_tokens: 25597,
        last_turn_total_tokens: 8653,
        session_cost: 0.039469500000000005,
      },
    });
    expect(extractVibeUsage(metaJson)).toEqual({
      provider: "mistral-vibe",
      inputTokens: 25418,
      outputTokens: 179,
      sessionCostUsd: 0.039469500000000005,
      toolCallsAgreed: 2,
      toolCallsRejected: 0,
      toolCallsFailed: 0,
      toolCallsSucceeded: 2,
    });
  });

  it("returns undefined when .stats is absent (usage could not be captured)", () => {
    const metaJson = JSON.stringify({ session_id: "session_123_abc" });
    expect(extractVibeUsage(metaJson)).toBeUndefined();
  });

  it("returns undefined for malformed JSON rather than throwing", () => {
    expect(extractVibeUsage("{not json")).toBeUndefined();
  });

  it("returns undefined for a .stats object missing a required field", () => {
    const metaJson = JSON.stringify({
      session_id: "session_123_abc",
      stats: { session_prompt_tokens: 1000, session_completion_tokens: 200 },
    });
    expect(extractVibeUsage(metaJson)).toBeUndefined();
  });
});
