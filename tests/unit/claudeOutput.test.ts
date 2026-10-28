import { describe, expect, it } from "vitest";
import { scanClaudeOutcomeEvents } from "../../src/schemas/claudeOutput.js";

describe("scanClaudeOutcomeEvents", () => {
  it("reads the last result, the init's session id and the last api_retry error", () => {
    const events = scanClaudeOutcomeEvents([
      JSON.stringify({ type: "system", subtype: "init", session_id: "sess-init", tools: [] }),
      JSON.stringify({ type: "system", subtype: "api_retry", attempt: 1, error: "first" }),
      JSON.stringify({
        type: "system",
        subtype: "api_retry",
        attempt: 2,
        error: "Connection error.",
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
      },
      initSessionId: "sess-init",
      apiRetryError: "Connection error.",
    });
  });

  it("reads an api_retry error given as an object with a message", () => {
    const events = scanClaudeOutcomeEvents([
      JSON.stringify({
        type: "system",
        subtype: "api_retry",
        error: { message: "socket hang up" },
      }),
    ]);
    expect(events.apiRetryError).toBe("socket hang up");
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
      JSON.stringify({ type: "result", subtype: "success", is_error: "yes" }),
    ]);
    expect(events).toEqual({
      result: undefined,
      initSessionId: undefined,
      apiRetryError: undefined,
    });
  });
});
