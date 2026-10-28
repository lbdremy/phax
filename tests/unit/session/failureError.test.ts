import { describe, expect, it } from "vitest";
import {
  AgentSessionFailedError,
  RateLimitError,
  UsageLimitError,
} from "../../../src/domain/errors.js";
import {
  sessionFailureError,
  sessionFailureLine,
} from "../../../src/domain/session/failureError.js";
import { FAILURE_KINDS, type SessionFailure } from "../../../src/domain/session/outcome.js";

const files = {
  agentErrorLog: "/runs/r/phase-02/agent-error.log",
  transcript: "/runs/r/phase-02/output.jsonl",
};

const failureOf = (
  kind: SessionFailure["kind"],
  resetAt: string | null = null,
): SessionFailure => ({
  provider: "claude-code",
  kind,
  message: "API Error: something went wrong",
  sessionId: "8c1e4f2a-3b7d-4e1a-9f0c-2d6b5a7e9c31",
  resetAt,
});

describe("sessionFailureLine", () => {
  it("names the provider, the kind and the provider's own message", () => {
    expect(sessionFailureLine(failureOf("network"))).toBe(
      "claude-code session failed (network): API Error: something went wrong",
    );
  });
});

describe("sessionFailureError", () => {
  it.each(FAILURE_KINDS.filter((kind) => kind !== "rate-limit" && kind !== "usage-limit"))(
    "raises AgentSessionFailedError for a %s failure, carrying the failure and both files",
    (kind) => {
      const failure = failureOf(kind);

      const error = sessionFailureError(failure, files);

      expect(error).toBeInstanceOf(AgentSessionFailedError);
      expect(error).toMatchObject({
        _tag: "AgentSessionFailedError",
        message: `claude-code session failed (${kind}): API Error: something went wrong`,
        failure,
        agentErrorLog: files.agentErrorLog,
        transcript: files.transcript,
      });
    },
  );

  it("raises a RateLimitError for a rate-limit failure, its raw message the provider's", () => {
    const error = sessionFailureError(failureOf("rate-limit", "2026-10-28T17:00:00.000Z"), files);

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({
      message: "claude-code session failed (rate-limit): API Error: something went wrong",
      rawMessage: "API Error: something went wrong",
      resetAt: "2026-10-28T17:00:00.000Z",
      agentErrorLog: files.agentErrorLog,
      transcript: files.transcript,
    });
  });

  it("raises a UsageLimitError for a usage-limit failure with no reset time", () => {
    const error = sessionFailureError(failureOf("usage-limit"), {
      agentErrorLog: null,
      transcript: null,
    });

    expect(error).toBeInstanceOf(UsageLimitError);
    expect(error).toMatchObject({ agentErrorLog: null, transcript: null });
    expect((error as UsageLimitError).resetAt).toBeUndefined();
  });
});
