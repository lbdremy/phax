import { describe, expect, it } from "vitest";
import { scanClaudeOutcomeEvents } from "../../src/schemas/claudeOutput.js";

const retry = (attempt: number, error: string, status: number | null) =>
  JSON.stringify({
    type: "system",
    subtype: "api_retry",
    attempt,
    max_retries: 10,
    retry_delay_ms: 600,
    error_status: status,
    error,
    session_id: "sess-init",
  });

describe("scanClaudeOutcomeEvents", () => {
  it("reads the last result, the init's session id and the API error's structured fields", () => {
    const events = scanClaudeOutcomeEvents([
      JSON.stringify({ type: "system", subtype: "init", session_id: "sess-init", tools: [] }),
      retry(1, "unknown", null),
      retry(2, "unknown", null),
      JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: { status: "rejected", resetsAt: 1793120400, rateLimitType: "five_hour" },
      }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", model: "<synthetic>", content: [] },
        error: "rate_limit",
        is_api_error_message: true,
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "a",
        session_id: "s1",
      }),
      JSON.stringify({
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        session_id: "s2",
        errors: ["too many turns"],
        terminal_reason: "max_turns",
        api_error_status: null,
        total_cost_usd: 1.5,
      }),
    ]);
    expect(events).toEqual({
      result: {
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        session_id: "s2",
        errors: ["too many turns"],
        terminal_reason: "max_turns",
        api_error_status: null,
      },
      initSessionId: "sess-init",
      trailingApiRetry: undefined,
      apiErrorCategory: "rate_limit",
      rejectedResetsAt: 1793120400,
    });
  });

  it("keeps the last api_retry only when no other event follows it", () => {
    const trailing = scanClaudeOutcomeEvents([
      retry(1, "unknown", null),
      retry(2, "rate_limit", 429),
    ]);
    expect(trailing.trailingApiRetry).toMatchObject({
      attempt: 2,
      error: "rate_limit",
      error_status: 429,
    });
    const recovered = scanClaudeOutcomeEvents([
      retry(1, "unknown", null),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [] } }),
    ]);
    expect(recovered.trailingApiRetry).toBeUndefined();
  });

  it("ignores a rate_limit_event that is not rejected", () => {
    const events = scanClaudeOutcomeEvents([
      JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed", resetsAt: 1793120400 },
      }),
    ]);
    expect(events.rejectedResetsAt).toBeUndefined();
  });

  it("decodes a result with no result text", () => {
    const events = scanClaudeOutcomeEvents([
      JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true }),
    ]);
    expect(events.result).toEqual({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
    });
  });

  it("skips blank lines, text that is not JSON and events it does not read", () => {
    const events = scanClaudeOutcomeEvents([
      "",
      "not json",
      "{",
      "null",
      "42",
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [] } }),
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "system", subtype: "api_retry", error: 7 }),
      JSON.stringify({ type: "rate_limit_event", rate_limit_info: "rejected" }),
      JSON.stringify({ type: "result", subtype: "success", is_error: "yes" }),
    ]);
    expect(events).toEqual({
      result: undefined,
      initSessionId: undefined,
      trailingApiRetry: undefined,
      apiErrorCategory: undefined,
      rejectedResetsAt: undefined,
    });
  });
});
