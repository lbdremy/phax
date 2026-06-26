import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeCodeReviewSession } from "../../src/schemas/codeReviewSession.js";

const valid = {
  version: 1 as const,
  shortName: "my-run",
  runId: "run-abc-123",
  provider: "claude-code" as const,
  sessionId: "sess-uuid",
  worktreePath: "/tmp/worktree",
  createdAt: "2026-06-26T00:00:00.000Z",
  updatedAt: "2026-06-26T00:00:00.000Z",
};

describe("decodeCodeReviewSession", () => {
  it("decodes a fully-valid record", () => {
    const result = decodeCodeReviewSession(valid);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.shortName).toBe("my-run");
      expect(result.right.provider).toBe("claude-code");
    }
  });

  it("fails when a required field is missing", () => {
    const { sessionId: _, ...missing } = valid;
    const result = decodeCodeReviewSession(missing);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("fails when an unknown key is present", () => {
    const result = decodeCodeReviewSession({ ...valid, unknownKey: "oops" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("fails when provider is an unknown string", () => {
    const result = decodeCodeReviewSession({ ...valid, provider: "openai" });
    expect(Either.isLeft(result)).toBe(true);
  });
});
