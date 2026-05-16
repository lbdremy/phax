import { describe, expect, it } from "vitest";
import {
  classifyRateLimit,
  findResultEvent,
  hasErroredResultEvent,
} from "../../src/schemas/claudeOutput.js";

function resultLine(opts: { isError: boolean; result?: string }): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    result: opts.result ?? "",
    session_id: "sess-abc",
    is_error: opts.isError,
  });
}

describe("classifyRateLimit", () => {
  it("returns undefined when output is empty", () => {
    expect(classifyRateLimit("", [])).toBeUndefined();
  });

  it("returns undefined for an ordinary error with no limit signature", () => {
    expect(classifyRateLimit("TypeError: undefined is not a function", [])).toBeUndefined();
  });

  it("classifies a rate limit from stderr", () => {
    const result = classifyRateLimit("Error: rate limit exceeded", []);
    expect(result?.kind).toBe("rate_limit");
  });

  it("classifies an HTTP 429 as a rate limit", () => {
    const result = classifyRateLimit("request failed with status 429", []);
    expect(result?.kind).toBe("rate_limit");
  });

  it("classifies a usage limit from stderr", () => {
    const result = classifyRateLimit("usage limit reached for this account", []);
    expect(result?.kind).toBe("usage_limit");
  });

  it("prefers usage_limit over rate_limit when both signatures appear", () => {
    const result = classifyRateLimit("rate limit / usage limit reached", []);
    expect(result?.kind).toBe("usage_limit");
  });

  it("classifies a rate limit found in a result event line", () => {
    const result = classifyRateLimit("", [resultLine({ isError: true, result: "rate limit hit" })]);
    expect(result?.kind).toBe("rate_limit");
  });

  it("extracts a reset time when the message reports one", () => {
    const result = classifyRateLimit("rate limit exceeded, resets at 2026-05-16T12:00:00Z", []);
    expect(result?.kind).toBe("rate_limit");
    expect(result?.resetAt).toContain("2026-05-16T12:00:00Z");
  });

  it("leaves resetAt undefined when no reset time is reported", () => {
    const result = classifyRateLimit("rate limit exceeded", []);
    expect(result?.resetAt).toBeUndefined();
  });
});

describe("hasErroredResultEvent", () => {
  it("is true when a result event is flagged is_error", () => {
    expect(hasErroredResultEvent([resultLine({ isError: true })])).toBe(true);
  });

  it("is false when the result event succeeded", () => {
    expect(hasErroredResultEvent([resultLine({ isError: false })])).toBe(false);
  });

  it("is false for non-result lines", () => {
    expect(hasErroredResultEvent(['{"type":"assistant"}', "not json"])).toBe(false);
  });
});

describe("findResultEvent", () => {
  it("returns the session id and final text of the last result event", () => {
    const found = findResultEvent([resultLine({ isError: false, result: "done" })]);
    expect(found).toEqual({ sessionId: "sess-abc", finalText: "done" });
  });
});
