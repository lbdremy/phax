import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeAdjustPlanSession } from "../../src/schemas/adjustPlanSession.js";

const valid = {
  version: 1 as const,
  planPath: "docs/plans/40-foo.md",
  landedRunKey: "my-feature.phase-01",
  provider: "claude-code" as const,
  sessionId: "sess-uuid-1234",
  cwd: "/home/user/repo",
  createdAt: "2026-06-29T00:00:00.000Z",
  updatedAt: "2026-06-29T00:00:00.000Z",
};

describe("decodeAdjustPlanSession", () => {
  it("decodes a fully-valid record", () => {
    const result = decodeAdjustPlanSession(valid);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.planPath).toBe("docs/plans/40-foo.md");
      expect(result.right.provider).toBe("claude-code");
      expect(result.right.version).toBe(1);
    }
  });

  it("fails when a required field is missing", () => {
    const { sessionId: _, ...missing } = valid;
    const result = decodeAdjustPlanSession(missing);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("fails when an unknown key is present", () => {
    const result = decodeAdjustPlanSession({ ...valid, unknownKey: "oops" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("fails when provider is an unknown string", () => {
    const result = decodeAdjustPlanSession({ ...valid, provider: "openai" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("accepts mistral-vibe and codex-cli providers", () => {
    expect(Either.isRight(decodeAdjustPlanSession({ ...valid, provider: "mistral-vibe" }))).toBe(
      true,
    );
    expect(Either.isRight(decodeAdjustPlanSession({ ...valid, provider: "codex-cli" }))).toBe(true);
  });

  it("fails when planPath is empty", () => {
    const result = decodeAdjustPlanSession({ ...valid, planPath: "" });
    expect(Either.isLeft(result)).toBe(true);
  });
});
