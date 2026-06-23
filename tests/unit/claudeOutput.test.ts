import { describe, expect, it } from "vitest";
import {
  classifyRateLimit,
  findResultEvent,
  hasErroredResultEvent,
  normalizeResetAt,
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
    expect(result?.resetAt).toBe("2026-05-16T12:00:00.000Z");
  });

  it("leaves resetAt undefined when no reset time is reported", () => {
    const result = classifyRateLimit("rate limit exceeded", []);
    expect(result?.resetAt).toBeUndefined();
  });

  it("leaves resetAt undefined when reset message contains a non-date word", () => {
    const result = classifyRateLimit("usage limit reached, reset date", []);
    expect(result?.kind).toBe("usage_limit");
    expect(result?.resetAt).toBeUndefined();
  });

  it("extracts epoch seconds from the Claude Code pipe format", () => {
    const epochSeconds = 1719835200;
    const result = classifyRateLimit(`usage limit reached|${epochSeconds}`, []);
    expect(result?.kind).toBe("usage_limit");
    expect(result?.resetAt).toBe(new Date(epochSeconds * 1000).toISOString());
  });

  it("extracts epoch milliseconds from the pipe format", () => {
    const epochMs = 1719835200000;
    const result = classifyRateLimit(`usage limit reached|${epochMs}`, []);
    expect(result?.kind).toBe("usage_limit");
    expect(result?.resetAt).toBe(new Date(epochMs).toISOString());
  });
});

describe("normalizeResetAt", () => {
  it("returns undefined for empty string", () => {
    expect(normalizeResetAt("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(normalizeResetAt("   ")).toBeUndefined();
  });

  it("returns undefined for non-date word", () => {
    expect(normalizeResetAt("date")).toBeUndefined();
  });

  it("returns undefined for vague words", () => {
    expect(normalizeResetAt("soon")).toBeUndefined();
    expect(normalizeResetAt("later")).toBeUndefined();
  });

  it("normalizes an ISO timestamp to ISO string", () => {
    expect(normalizeResetAt("2026-05-16T12:00:00Z")).toBe("2026-05-16T12:00:00.000Z");
  });

  it("normalizes a 10-digit Unix epoch (seconds)", () => {
    const epoch = 1719835200;
    expect(normalizeResetAt(String(epoch))).toBe(new Date(epoch * 1000).toISOString());
  });

  it("normalizes a 13-digit Unix epoch (milliseconds)", () => {
    const epochMs = 1719835200000;
    expect(normalizeResetAt(String(epochMs))).toBe(new Date(epochMs).toISOString());
  });

  it("returns undefined for a partial epoch (9 digits)", () => {
    expect(normalizeResetAt("171983520")).toBeUndefined();
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
