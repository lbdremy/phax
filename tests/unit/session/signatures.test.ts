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

  // Claude Code 2.1.312's plan-limit wordings, as its result text carries them.
  it.each([
    ["You've hit your session limit · resets 7:50pm (Europe/Paris)"],
    ["You’ve hit your weekly limit · resets Nov 3, 9am (Europe/Paris)"],
    ["You've hit your monthly spend limit."],
    ["You've reached your Fable limit."],
    ["You're out of usage credits · resets 7pm (Europe/Paris)"],
    ["You're out of extra usage"],
    ["Your org is out of usage · contact your admin"],
  ])("reads Claude Code's plan limit %j as usage-limit", (text) => {
    expect(classifyVerdictText(text)).toBe("usage-limit");
  });

  // Claude Code 2.1.312's connection wordings, from its API error formatter.
  it.each([
    ["API Error: Unable to connect to API"],
    ["API Error: Unable to connect to API (FailedToOpenSocket)"],
    ["API Error: Unable to connect to API. Check your internet connection"],
    ["API Error: Connection lost while your computer was asleep"],
    ["API Error: Connection closed before the response finished"],
    ["API Error: No response from API"],
    ["API Error: Connection dropped (EPIPE)"],
    ["API Error: Connection dropped (ERR_SOCKET_CLOSED)"],
    ["API Error: No internet route — check your connection or VPN (EHOSTDOWN)"],
    ["API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)"],
    ["API Error: Can't reach the API server — check your internet or DNS (EAI_AGAIN)"],
    ["API Error: Request timed out. Check your internet connection and proxy settings"],
  ])("reads Claude Code's connection wording %j as network", (text) => {
    expect(classifyVerdictText(text)).toBe("network");
  });

  it("does not read a TLS certificate refusal as network", () => {
    expect(
      classifyVerdictText("API Error: Unable to connect to API: SSL certificate has expired"),
    ).toBeNull();
    expect(
      classifyVerdictText("API Error: Unable to connect to API: Self-signed certificate detected"),
    ).toBeNull();
  });

  it.each([
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
  it.each([
    ["Your limit resets at 2026-10-27T17:00:00Z", "2026-10-27T17:00:00.000Z"],
    ["Usage limit reached. Try again at 2026-10-27T17:00:00Z", "2026-10-27T17:00:00.000Z"],
    ["Quota exceeded; available again: 2026-10-27T17:00:00Z", "2026-10-27T17:00:00.000Z"],
  ])("reads the reset time in %j", (text, expected) => {
    expect(extractResetAt(text)).toBe(expected);
  });

  it.each([
    ["You've hit your usage limit. Try again later."],
    ["You've hit your session limit · resets 7:50pm (Europe/Paris)"],
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
    const text = "Usage limit reached. Try again at 2026-10-27T17:00:00Z";
    const limit = failureFromText("codex-cli", text, "s1");
    expect(limit).toEqual({
      provider: "codex-cli",
      kind: "usage-limit",
      message: text,
      sessionId: "s1",
      resetAt: "2026-10-27T17:00:00.000Z",
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
      "codex-cli",
      "codex",
      { lines: [], stderr: "Error: ECONNRESET", end: { kind: "signalled", signal: "SIGKILL" } },
      "s1",
      "stream disconnected before completion: error sending request",
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
    const text = "stream disconnected before completion: error sending request";
    const failure = failureWithoutVerdict(
      "codex-cli",
      "codex",
      { lines: [], stderr: "Error: something else", end: exited(1) },
      null,
      text,
    );
    expect(failure).toMatchObject({ kind: "network", message: text });
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
