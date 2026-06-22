import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeBranchName,
  decodeClaudeSessionId,
  decodeGateProfileId,
  decodeNamespace,
  decodePhaseId,
  decodeRunId,
  decodeShortName,
  decodeWorkspaceId,
  decodeWorktreePath,
  slugifyShortName,
} from "../../src/domain/branded.js";

describe("decodeNamespace", () => {
  it("accepts valid slug names", () => {
    expect(Either.isRight(decodeNamespace("my-project"))).toBe(true);
    expect(Either.isRight(decodeNamespace("phax"))).toBe(true);
    expect(Either.isRight(decodeNamespace("louloupapers"))).toBe(true);
    expect(Either.isRight(decodeNamespace("a1-b2"))).toBe(true);
  });

  it("preserves the value on success", () => {
    const result = decodeNamespace("my-project");
    if (Either.isRight(result)) {
      expect(result.right).toBe("my-project");
    }
  });

  it("rejects a name containing a dot", () => {
    expect(Either.isLeft(decodeNamespace("my.project"))).toBe(true);
  });

  it("rejects a name with spaces", () => {
    expect(Either.isLeft(decodeNamespace("my project"))).toBe(true);
  });

  it("rejects uppercase characters", () => {
    expect(Either.isLeft(decodeNamespace("MyProject"))).toBe(true);
    expect(Either.isLeft(decodeNamespace("MY-PROJECT"))).toBe(true);
  });

  it("rejects a name starting with a digit", () => {
    expect(Either.isLeft(decodeNamespace("1project"))).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(Either.isLeft(decodeNamespace(""))).toBe(true);
  });

  it("rejects a string longer than 64 characters", () => {
    expect(Either.isLeft(decodeNamespace("a".repeat(65)))).toBe(true);
  });

  it("accepts a 64-character name", () => {
    expect(Either.isRight(decodeNamespace("a" + "b".repeat(63)))).toBe(true);
  });

  it("rejects underscores", () => {
    expect(Either.isLeft(decodeNamespace("my_project"))).toBe(true);
  });

  it("rejects non-string input", () => {
    expect(Either.isLeft(decodeNamespace(123))).toBe(true);
    expect(Either.isLeft(decodeNamespace(null))).toBe(true);
    expect(Either.isLeft(decodeNamespace(undefined))).toBe(true);
  });
});

describe("decodeShortName", () => {
  it("accepts a lowercase-start alphanumeric-with-dashes name", () => {
    expect(Either.isRight(decodeShortName("my-run"))).toBe(true);
    expect(Either.isRight(decodeShortName("abc"))).toBe(true);
    expect(Either.isRight(decodeShortName("a1-b2-c3"))).toBe(true);
  });

  it("preserves the value on success", () => {
    const result = decodeShortName("my-run");
    if (Either.isRight(result)) {
      expect(result.right).toBe("my-run");
    }
  });

  it("rejects a name starting with uppercase", () => {
    expect(Either.isLeft(decodeShortName("MyRun"))).toBe(true);
  });

  it("rejects a name starting with a digit", () => {
    expect(Either.isLeft(decodeShortName("1myrun"))).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(Either.isLeft(decodeShortName(""))).toBe(true);
  });

  it("rejects a string longer than 64 characters", () => {
    expect(Either.isLeft(decodeShortName("a".repeat(65)))).toBe(true);
  });

  it("accepts a 64-character name", () => {
    expect(Either.isRight(decodeShortName("a" + "b".repeat(63)))).toBe(true);
  });

  it("rejects names with underscores", () => {
    expect(Either.isLeft(decodeShortName("my_run"))).toBe(true);
  });

  it("rejects non-string input", () => {
    expect(Either.isLeft(decodeShortName(123))).toBe(true);
    expect(Either.isLeft(decodeShortName(null))).toBe(true);
    expect(Either.isLeft(decodeShortName(undefined))).toBe(true);
  });
});

describe("slugifyShortName", () => {
  it("slugifies prose the model returns instead of a slug", () => {
    expect(slugifyShortName("Deno Runtime and Distribution")).toBe("deno-runtime-and-distribution");
  });

  it("produces output that always passes the ShortName brand", () => {
    for (const raw of [
      "Deno Runtime and Distribution",
      "16 Deno Runtime",
      "  Trailing & symbols!!  ",
      "Café Münster",
      "multi   space\tand_underscores",
    ]) {
      const slug = slugifyShortName(raw);
      expect(slug.length).toBeGreaterThan(0);
      expect(Either.isRight(decodeShortName(slug))).toBe(true);
    }
  });

  it("strips leading non-letters so the brand's ^[a-z] holds", () => {
    expect(slugifyShortName("16-deno-runtime")).toBe("deno-runtime");
    expect(slugifyShortName("123")).toBe("");
  });

  it("collapses runs of non-alphanumerics into single hyphens", () => {
    expect(slugifyShortName("a -- b__c")).toBe("a-b-c");
  });

  it("strips diacritics", () => {
    expect(slugifyShortName("Café Münster")).toBe("cafe-munster");
  });

  it("trims to 64 chars with no trailing hyphen", () => {
    const slug = slugifyShortName("a ".repeat(50));
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("returns empty string when nothing usable remains", () => {
    expect(slugifyShortName("!!! 123 ???")).toBe("");
    expect(slugifyShortName("")).toBe("");
  });
});

describe("decodePhaseId", () => {
  it("accepts phase-01 through phase-99", () => {
    expect(Either.isRight(decodePhaseId("phase-01"))).toBe(true);
    expect(Either.isRight(decodePhaseId("phase-15"))).toBe(true);
    expect(Either.isRight(decodePhaseId("phase-99"))).toBe(true);
  });

  it("rejects non-zero-padded phase ids", () => {
    expect(Either.isLeft(decodePhaseId("phase-1"))).toBe(true);
  });

  it("rejects arbitrary strings", () => {
    expect(Either.isLeft(decodePhaseId("my-phase"))).toBe(true);
    expect(Either.isLeft(decodePhaseId(""))).toBe(true);
  });

  it("rejects non-string input", () => {
    expect(Either.isLeft(decodePhaseId(1))).toBe(true);
  });
});

describe("decodeRunId", () => {
  it("accepts any non-empty string", () => {
    expect(Either.isRight(decodeRunId("my-run-1234567890"))).toBe(true);
    expect(Either.isRight(decodeRunId("x"))).toBe(true);
  });

  it("rejects empty string", () => {
    expect(Either.isLeft(decodeRunId(""))).toBe(true);
  });

  it("rejects non-string", () => {
    expect(Either.isLeft(decodeRunId(null))).toBe(true);
  });
});

describe("decodeBranchName", () => {
  it("accepts valid branch names", () => {
    expect(Either.isRight(decodeBranchName("main"))).toBe(true);
    expect(Either.isRight(decodeBranchName("feature/my-thing"))).toBe(true);
  });

  it("rejects empty string", () => {
    expect(Either.isLeft(decodeBranchName(""))).toBe(true);
  });
});

describe("decodeWorktreePath", () => {
  it("accepts non-empty path strings", () => {
    expect(Either.isRight(decodeWorktreePath("/home/user/.phax/worktrees/run/phase-01"))).toBe(
      true,
    );
  });

  it("rejects empty string", () => {
    expect(Either.isLeft(decodeWorktreePath(""))).toBe(true);
  });
});

describe("decodeClaudeSessionId", () => {
  it("accepts non-empty session ids", () => {
    expect(Either.isRight(decodeClaudeSessionId("sess_abc123"))).toBe(true);
  });

  it("rejects empty string", () => {
    expect(Either.isLeft(decodeClaudeSessionId(""))).toBe(true);
  });
});

describe("decodeGateProfileId", () => {
  it("accepts non-empty gate profile ids", () => {
    expect(Either.isRight(decodeGateProfileId("fast"))).toBe(true);
    expect(Either.isRight(decodeGateProfileId("full"))).toBe(true);
  });

  it("rejects empty string", () => {
    expect(Either.isLeft(decodeGateProfileId(""))).toBe(true);
  });
});

describe("decodeWorkspaceId", () => {
  it("accepts non-empty workspace ids", () => {
    expect(Either.isRight(decodeWorkspaceId("frontend"))).toBe(true);
  });

  it("rejects empty string", () => {
    expect(Either.isLeft(decodeWorkspaceId(""))).toBe(true);
  });
});
