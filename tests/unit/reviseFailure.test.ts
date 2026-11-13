import { describe, expect, it } from "vitest";
import { revisionFailureOf } from "../../src/app/reviseFailure.js";
import { exitCodeForAuthoringError, exitCodeForError } from "../../src/cli/commands/runLayers.js";
import {
  AgentInvocationError,
  AgentSessionFailedError,
  ArtifactCommitFailedError,
  DecideDocumentError,
  RateLimitError,
  ReviseDocumentError,
  ReviseRefusedError,
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

describe("revisionFailureOf", () => {
  it.each(FAILURE_KINDS)("a session failure of kind %s gives that kind", (kind) => {
    expect(revisionFailureOf(sessionFailed(kind))).toBe(kind);
  });

  it.each([
    ["a rate limit", new RateLimitError({ message: "m", rawMessage: "r" }), "rate-limit"],
    ["a usage limit", new UsageLimitError({ message: "m", rawMessage: "r" }), "usage-limit"],
    ["a refused answer", new ReviseDocumentError({ path: "", message: "twice" }), "answer-refused"],
    [
      "the artifact changing during the session",
      new ReviseRefusedError({ reason: "changed", message: "Revise refused: changed" }),
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
      new ReviseRefusedError({ reason: "model", message: "Revise refused: no model" }),
      "unknown",
    ],
    ["decide's refused answer", new DecideDocumentError({ path: "", message: "x" }), "unknown"],
    ["a spawn failure", new AgentInvocationError({ message: "spawn" }), "unknown"],
    ["a non-error value", "boom", "unknown"],
  ] as const)("%s gives %s", (_name, error, expected) => {
    expect(revisionFailureOf(error)).toBe(expected);
  });
});

describe("the exit codes of revise's errors", () => {
  const refused = new ReviseRefusedError({ reason: "dirty", message: "Revise refused: dirty" });
  const document = new ReviseDocumentError({ path: "", message: "twice" });

  it("ReviseRefusedError exits 12 and ReviseDocumentError exits 5", () => {
    expect(exitCodeForError(refused)).toBe(12);
    expect(exitCodeForError(document)).toBe(5);
  });

  it("the authoring mapping defers to the same codes", () => {
    expect(exitCodeForAuthoringError(refused)).toBe(12);
    expect(exitCodeForAuthoringError(document)).toBe(5);
  });
});
