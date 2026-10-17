// The Claude stream decoder: the init event's version and session, assistant
// usage with 1h cache writes, both windows of a rate-limit event, the last
// result that carries modelUsage, and lines it skips. Every stream is made up.
import { describe, expect, it } from "vitest";
import { parseClaudeStream } from "../../../src/schemas/claudeStream.js";

const line = (event: object): string => JSON.stringify(event);

const init = (extra: object = {}) =>
  line({
    type: "system",
    subtype: "init",
    session_id: "aaaaaaaa-0000-4000-8000-000000000001",
    claude_code_version: "2.1.280",
    tools: ["Read"],
    ...extra,
  });

const assistant = (id: string, model: string, usage: object) =>
  line({ type: "assistant", message: { id, model, role: "assistant", usage } });

describe("parseClaudeStream", () => {
  it("reads the init event's version as a triple and its session id", () => {
    const facts = parseClaudeStream([init()]);
    expect(facts.claudeCodeVersion).toEqual([2, 1, 280]);
    expect(facts.sessionId).toBe("aaaaaaaa-0000-4000-8000-000000000001");
    expect(facts.events).toEqual([]);
    expect(facts.result).toBeNull();
  });

  it("reads a version that is not an X.Y.Z triple, or none, as null", () => {
    expect(parseClaudeStream([init({ claude_code_version: "2.1" })]).claudeCodeVersion).toBeNull();
    expect(
      parseClaudeStream([init({ claude_code_version: undefined })]).claudeCodeVersion,
    ).toBeNull();
  });

  it("reads assistant usage, with 1h cache writes and missing counts as 0", () => {
    const facts = parseClaudeStream([
      assistant("msg_01", "claude-opus-5-5", {
        input_tokens: 3,
        output_tokens: 120,
        cache_read_input_tokens: 4000,
        cache_creation_input_tokens: 900,
        cache_creation: { ephemeral_1h_input_tokens: 600, ephemeral_5m_input_tokens: 300 },
        service_tier: "standard",
      }),
      assistant("msg_02", "claude-haiku-5-5", { output_tokens: 7 }),
    ]);
    expect(facts.events).toEqual([
      {
        kind: "message",
        id: "msg_01",
        model: "claude-opus-5-5",
        usage: {
          inputTokens: 3,
          outputTokens: 120,
          cacheReadTokens: 4000,
          cacheWriteTokens: 900,
          cacheWrite1hTokens: 600,
        },
      },
      {
        kind: "message",
        id: "msg_02",
        model: "claude-haiku-5-5",
        usage: {
          inputTokens: 0,
          outputTokens: 7,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cacheWrite1hTokens: 0,
        },
      },
    ]);
  });

  it("reads both windows of a rate-limit event, and nothing from one without unifiedWindows", () => {
    const facts = parseClaudeStream([
      line({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed",
          rateLimitType: "five_hour",
          unifiedWindows: {
            five_hour: { utilization: 0.38, resetsAt: 1792069800 },
            seven_day: { utilization: 0.22, resetsAt: 1792335600 },
            opus_weekly: { utilization: 0.5, resetsAt: 1792335600 },
          },
        },
      }),
      line({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } }),
    ]);
    expect(facts.events).toEqual([
      {
        kind: "rate-limit",
        readings: [
          { window: "five-hour", fraction: 0.38, resetsAtEpochSeconds: 1792069800 },
          { window: "seven-day", fraction: 0.22, resetsAtEpochSeconds: 1792335600 },
        ],
      },
    ]);
  });

  it("keeps messages and readings in stream order", () => {
    const facts = parseClaudeStream([
      assistant("msg_01", "claude-opus-5-5", { output_tokens: 1 }),
      line({
        type: "rate_limit_event",
        rate_limit_info: { unifiedWindows: { seven_day: { utilization: 0.1, resetsAt: 1 } } },
      }),
      assistant("msg_02", "claude-opus-5-5", { output_tokens: 2 }),
    ]);
    expect(facts.events.map((event) => event.kind)).toEqual(["message", "rate-limit", "message"]);
  });

  it("reads the last result that carries modelUsage, and ignores one without it", () => {
    const facts = parseClaudeStream([
      init(),
      line({
        type: "result",
        session_id: "aaaaaaaa-0000-4000-8000-000000000001",
        duration_ms: 1000,
        modelUsage: { "claude-opus-5-5": { inputTokens: 1, costUSD: 0.1 } },
      }),
      line({
        type: "result",
        subtype: "success",
        duration_ms: 52000,
        total_cost_usd: 8.71,
        modelUsage: {
          "claude-opus-5-5": {
            inputTokens: 40,
            outputTokens: 9000,
            cacheReadInputTokens: 3000000,
            cacheCreationInputTokens: 60000,
            costUSD: 8.7,
            costBasis: "list",
          },
          "claude-haiku-5-5": { outputTokens: 30, costUSD: 0.01 },
        },
      }),
      line({ type: "result", subtype: "error", duration_ms: 5 }),
    ]);
    expect(facts.result).toEqual({
      durationMs: 52000,
      modelUsage: {
        "claude-opus-5-5": {
          inputTokens: 40,
          outputTokens: 9000,
          cacheReadTokens: 3000000,
          cacheWriteTokens: 60000,
          costUsd: 8.7,
        },
        "claude-haiku-5-5": {
          inputTokens: 0,
          outputTokens: 30,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0.01,
        },
      },
    });
  });

  it("takes the result's session id when the stream has no init event", () => {
    const facts = parseClaudeStream([
      line({ type: "result", session_id: "bbbbbbbb-0000-4000-8000-000000000002", modelUsage: {} }),
    ]);
    expect(facts.sessionId).toBe("bbbbbbbb-0000-4000-8000-000000000002");
    expect(facts.claudeCodeVersion).toBeNull();
    expect(facts.result).toEqual({ durationMs: 0, modelUsage: {} });
  });

  it("skips garbage lines, unknown events and malformed known events", () => {
    const facts = parseClaudeStream([
      "",
      "not json at all",
      "{ truncated",
      "42",
      "null",
      line({ type: "user", message: { content: "hi" } }),
      line({ type: "assistant", message: { id: "msg_01" } }),
      line({
        type: "assistant",
        message: { id: "msg_02", model: "m", usage: { output_tokens: -3 } },
      }),
      line({
        type: "rate_limit_event",
        rate_limit_info: { unifiedWindows: { five_hour: { utilization: "high", resetsAt: 1 } } },
      }),
      line({ type: "system", subtype: "compact_boundary" }),
    ]);
    expect(facts).toEqual({ claudeCodeVersion: null, sessionId: null, events: [], result: null });
  });
});
