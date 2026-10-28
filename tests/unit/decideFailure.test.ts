import { describe, expect, it } from "vitest";
import { decisionFailureOf } from "../../src/app/decideFailure.js";
import {
  AgentInvocationError,
  AgentSessionFailedError,
  ArtifactCommitFailedError,
  DecideDocumentError,
  DecideRefusedError,
  RateLimitError,
  UsageLimitError,
} from "../../src/domain/errors.js";
import { FAILURE_KINDS } from "../../src/domain/session/outcome.js";

const sessionFailed = (kind: (typeof FAILURE_KINDS)[number]) =>
  new AgentSessionFailedError({
    message: `claude-code session failed (${kind}): boom`,
    failure: { provider: "claude-code", kind, message: "boom", sessionId: null, resetAt: null },
    agentErrorLog: null,
    transcript: null,
  });

describe("decisionFailureOf", () => {
  it.each(FAILURE_KINDS)("a session failure of kind %s gives that kind", (kind) => {
    expect(decisionFailureOf(sessionFailed(kind))).toBe(kind);
  });

  it.each([
    ["a rate limit", new RateLimitError({ message: "m", rawMessage: "r" }), "rate-limit"],
    ["a usage limit", new UsageLimitError({ message: "m", rawMessage: "r" }), "usage-limit"],
    ["a refused answer", new DecideDocumentError({ path: "", message: "twice" }), "answer-refused"],
    [
      "the artifact changing during the session",
      new DecideRefusedError({ reason: "changed", message: "changed" }),
      "artifact-changed",
    ],
    [
      "a failed commit",
      new ArtifactCommitFailedError({
        paths: ["a.md"],
        cause: "hook",
        commitMessage: { subject: "s", body: "b" },
      }),
      "commit-failed",
    ],
    [
      "any other refusal",
      new DecideRefusedError({ reason: "model", message: "no model" }),
      "unknown",
    ],
    ["a spawn failure", new AgentInvocationError({ message: "spawn" }), "unknown"],
    ["a non-error value", "boom", "unknown"],
  ] as const)("%s gives %s", (_name, error, expected) => {
    expect(decisionFailureOf(error)).toBe(expected);
  });
});
