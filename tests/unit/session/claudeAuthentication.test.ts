import { describe, expect, it } from "vitest";
import {
  CLAUDE_NOT_AUTHENTICATED_SIGNATURES,
  isClaudeNotAuthenticatedText,
  NOT_AUTHENTICATED_REMEDY_LINES,
} from "../../../src/domain/session/claudeAuthentication.js";
import {
  readClaudeOutcome,
  readCodexOutcome,
  type EndedSession,
  type SessionFailure,
} from "../../../src/domain/session/outcome.js";

// Claude Code's lost authentication, read from the verdicts it prints.

const SESSION = "3f2b9c1e-6a4d-4e8f-9b21-7c5d0e8a1f42";
const init = { type: "system", subtype: "init", session_id: SESSION };

function errorResult(text: string, extra: Record<string, unknown> = {}): unknown {
  return {
    type: "result",
    subtype: "success",
    is_error: true,
    session_id: SESSION,
    result: text,
    ...extra,
  };
}

function ended(lines: readonly unknown[], stderr = "", code = 1): EndedSession {
  return {
    lines: lines.map((line) => JSON.stringify(line)),
    stderr,
    end: { kind: "exited", code },
  };
}

function claudeFailure(session: EndedSession): SessionFailure {
  const outcome = readClaudeOutcome(session);
  if (outcome.kind !== "failure") throw new Error(`expected a failure, read ${outcome.kind}`);
  return outcome.failure;
}

describe("a Claude error result in a not-authenticated wording", () => {
  it.each([
    ...CLAUDE_NOT_AUTHENTICATED_SIGNATURES.map((signature) => `Failed: ${signature}.`),
    "Invalid API key · Please run /login",
    "INVALID API KEY",
  ])("reads %j as not-authenticated with the provider's text", (text) => {
    const failure = claudeFailure(ended([init, errorResult(text)]));

    expect(failure).toMatchObject({
      provider: "claude-code",
      kind: "not-authenticated",
      message: text,
      sessionId: SESSION,
      resetAt: null,
    });
  });

  it("reads the authentication_failed synthetic message category as not-authenticated", () => {
    const failure = claudeFailure(
      ended([
        init,
        {
          type: "assistant",
          error: "authentication_failed",
          is_api_error_message: true,
          message: { content: [{ type: "text", text: "Something went wrong" }] },
        },
        errorResult("Something went wrong"),
      ]),
    );

    expect(failure.kind).toBe("not-authenticated");
    expect(failure.message).toBe("Something went wrong");
  });

  it("reads api_error_status 401 as not-authenticated", () => {
    const failure = claudeFailure(
      ended([init, errorResult("API Error: request refused", { api_error_status: 401 })]),
    );

    expect(failure.kind).toBe("not-authenticated");
  });
});

describe("a Claude session with no result", () => {
  it("reads a stderr-only not-authenticated verdict as not-authenticated", () => {
    const failure = claudeFailure(ended([], "Invalid API key · Please run /login\n"));

    expect(failure).toMatchObject({
      kind: "not-authenticated",
      message: "Invalid API key · Please run /login",
    });
  });

  it("reads an unrelated stderr as before", () => {
    expect(claudeFailure(ended([], "something broke\n")).kind).toBe("provider-error");
  });
});

describe("other Claude failures read as before", () => {
  it.each([
    [
      "a rate limit with 429",
      errorResult("API Error: rate limited", { api_error_status: 429 }),
      "rate-limit",
    ],
    ["a usage limit", errorResult("You've hit your session limit · resets 7:50pm"), "usage-limit"],
    ["a network failure", errorResult("Unable to connect to API (ECONNREFUSED)"), "network"],
    ["an unrelated error", errorResult("The model refused"), "provider-error"],
  ])("%s", (_name, result, kind) => {
    expect(claudeFailure(ended([init, result])).kind).toBe(kind);
  });
});

describe("the wordings are Claude's alone", () => {
  it("Codex reading Invalid API key stays a provider-error", () => {
    const outcome = readCodexOutcome(
      ended([{ type: "error", message: "Invalid API key · Please run /login" }]),
    );

    expect(outcome.kind === "failure" && outcome.failure.kind).toBe("provider-error");
  });

  it("matches case-insensitively", () => {
    expect(isClaudeNotAuthenticatedText("please RUN /login")).toBe(true);
    expect(isClaudeNotAuthenticatedText("all good")).toBe(false);
  });

  it("words exactly two remedy lines", () => {
    expect(NOT_AUTHENTICATED_REMEDY_LINES).toHaveLength(2);
    expect(NOT_AUTHENTICATED_REMEDY_LINES[1]).toContain("claude /login");
    expect(NOT_AUTHENTICATED_REMEDY_LINES[1]).toContain("ANTHROPIC_API_KEY");
  });
});
