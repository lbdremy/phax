import { describe, expect, it } from "vitest";
import {
  NETWORK_SIGNATURES,
  classifyVerdictText,
  extractResetAt,
  failureFromText,
  failureWithoutVerdict,
  normalizeResetAt,
  stderrMessage,
} from "../../../src/domain/session/signatures.js";

describe("classifyVerdictText", () => {
  it.each(NETWORK_SIGNATURES.map((signature) => [signature]))(
    "reads the network signature %s as network",
    (signature) => {
      expect(classifyVerdictText(`Error: ${signature} while calling the model`)).toBe("network");
    },
  );

  it.each(NETWORK_SIGNATURES.map((signature) => [signature]))(
    "reads %s as network whatever its case",
    (signature) => {
      expect(classifyVerdictText(signature.toUpperCase())).toBe("network");
      expect(classifyVerdictText(signature.toLowerCase())).toBe("network");
    },
  );

  it("reads a typographic apostrophe in Can't reach the API server", () => {
    expect(classifyVerdictText("API Error: Can’t reach the API server")).toBe("network");
  });

  it.each([
    ["Claude AI usage limit reached|1793120400", "usage-limit"],
    ["You've hit your usage limit. Try again later.", "usage-limit"],
    ["You reached your monthly limit", "usage-limit"],
    ["quota exceeded for this project", "usage-limit"],
    ["Quota reached", "usage-limit"],
    ["rate limit exceeded", "rate-limit"],
    ["Request was rate-limited", "rate-limit"],
    ["rate_limited", "rate-limit"],
    ["Too many requests", "rate-limit"],
    ["HTTP 429", "rate-limit"],
    ['API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}', "rate-limit"],
  ])("reads %s as %s", (text, expected) => {
    expect(classifyVerdictText(text)).toBe(expected);
  });

  it("checks usage-limit signatures before rate-limit and network ones", () => {
    expect(classifyVerdictText("429 usage limit reached, connection error")).toBe("usage-limit");
    expect(classifyVerdictText("429 Too Many Requests, ECONNRESET")).toBe("rate-limit");
  });

  it.each([
    [""],
    ["API Error: 500 Internal server error"],
    ["unexpected status 400 Bad Request: model not supported"],
    ["tool crashed"],
    ["I will reset the counter and try again"],
    ["listening on port 14290"],
    ["see issue #4290"],
    ["the limit of the loop is ten"],
    ["Invalid API key (from env var MISTRAL_API_KEY)"],
    ["API error occurred: Status 400. reasoning_effort low is not supported for this model"],
  ])("reads %j as none of them", (text) => {
    expect(classifyVerdictText(text)).toBeNull();
  });
});

describe("normalizeResetAt", () => {
  it("reads ten digits as epoch seconds and thirteen as milliseconds", () => {
    expect(normalizeResetAt("1793120400")).toBe("2026-10-27T17:00:00.000Z");
    expect(normalizeResetAt("1793120400000")).toBe("2026-10-27T17:00:00.000Z");
  });

  it("reads an ISO or RFC date as an ISO instant", () => {
    expect(normalizeResetAt("2026-10-27T17:00:00Z")).toBe("2026-10-27T17:00:00.000Z");
    expect(normalizeResetAt("Tue, 27 Oct 2026 17:00:00 GMT")).toBe("2026-10-27T17:00:00.000Z");
  });

  it("gives null for text that is no date", () => {
    expect(normalizeResetAt("")).toBeNull();
    expect(normalizeResetAt("soon")).toBeNull();
    expect(normalizeResetAt("whenever it is ready")).toBeNull();
  });
});

describe("extractResetAt", () => {
  it("reads the epoch after a pipe as an ISO instant", () => {
    expect(extractResetAt("Claude AI usage limit reached|1793120400")).toBe(
      new Date(1793120400 * 1000).toISOString(),
    );
  });

  it.each([
    ["Your limit resets at 2026-10-27T17:00:00Z", "2026-10-27T17:00:00.000Z"],
    ["Usage limit reached. Try again at 2026-10-27T17:00:00Z", "2026-10-27T17:00:00.000Z"],
    ["Quota exceeded; available again: 2026-10-27T17:00:00Z", "2026-10-27T17:00:00.000Z"],
  ])("reads the reset time in %j", (text, expected) => {
    expect(extractResetAt(text)).toBe(expected);
  });

  it.each([
    ["You've hit your usage limit. Try again later."],
    ["rate limit exceeded"],
    ["resets whenever"],
    [""],
  ])("gives null for %j, which names no reset time", (text) => {
    expect(extractResetAt(text)).toBeNull();
  });
});

describe("stderrMessage", () => {
  it("joins the first three non-empty lines with a space", () => {
    expect(stderrMessage("\n  one \n\ntwo\nthree\nfour\n")).toBe("one two three");
  });

  it("is empty for blank stderr", () => {
    expect(stderrMessage(" \n\n")).toBe("");
  });
});

describe("failureFromText", () => {
  it("carries the reset time of a limit and none for other kinds", () => {
    const limit = failureFromText("claude-code", "usage limit reached|1793120400", "s1");
    expect(limit).toEqual({
      provider: "claude-code",
      kind: "usage-limit",
      message: "usage limit reached|1793120400",
      sessionId: "s1",
      resetAt: new Date(1793120400 * 1000).toISOString(),
    });
    expect(
      failureFromText("codex-cli", "ECONNRESET, resets at 2026-10-27T17:00:00Z", null),
    ).toMatchObject({
      kind: "network",
      resetAt: null,
    });
  });

  it("uses the fallback kind for text that matches no signature", () => {
    expect(failureFromText("codex-cli", "tool crashed", null, "max-turns").kind).toBe("max-turns");
    expect(failureFromText("codex-cli", "tool crashed", null).kind).toBe("provider-error");
  });
});

const exited = (code: number) => ({ kind: "exited", code }) as const;

describe("failureWithoutVerdict", () => {
  it("reads a signal or a timeout as killed, before any error text", () => {
    const signalled = failureWithoutVerdict(
      "claude-code",
      "claude",
      { lines: [], stderr: "Error: ECONNRESET", end: { kind: "signalled", signal: "SIGKILL" } },
      "s1",
      "Connection error.",
    );
    expect(signalled).toMatchObject({ kind: "killed", sessionId: "s1" });
    expect(signalled.message).toContain("SIGKILL");
    const timedOut = failureWithoutVerdict(
      "codex-cli",
      "codex",
      { lines: [], stderr: "", end: { kind: "timed-out" } },
      null,
      undefined,
    );
    expect(timedOut).toMatchObject({ kind: "killed" });
    expect(timedOut.message).toContain("timed out");
  });

  it("reads the error event's text before stderr", () => {
    const failure = failureWithoutVerdict(
      "claude-code",
      "claude",
      { lines: [], stderr: "Error: something else", end: exited(1) },
      null,
      "Connection error.",
    );
    expect(failure).toMatchObject({ kind: "network", message: "Connection error." });
  });

  it("reads stderr's first lines, then falls to unknown", () => {
    const fromStderr = failureWithoutVerdict(
      "codex-cli",
      "codex",
      { lines: [], stderr: "Error: boom\nat somewhere\n", end: exited(1) },
      null,
      undefined,
    );
    expect(fromStderr).toMatchObject({
      kind: "provider-error",
      message: "Error: boom at somewhere",
    });
    const silent = failureWithoutVerdict(
      "codex-cli",
      "codex",
      { lines: [], stderr: "  \n", end: exited(3) },
      null,
      "   ",
    );
    expect(silent.kind).toBe("unknown");
    expect(silent.message).toContain("3");
  });
});
