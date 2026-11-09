import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  BranchNameSchema,
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
import { draft07JsonSchema } from "../../src/schemas/schemaUrl.js";

describe("decodeNamespace", () => {
  it("accepts valid slug names", () => {
    expect(Result.isSuccess(decodeNamespace("my-project"))).toBe(true);
    expect(Result.isSuccess(decodeNamespace("phax"))).toBe(true);
    expect(Result.isSuccess(decodeNamespace("louloupapers"))).toBe(true);
    expect(Result.isSuccess(decodeNamespace("a1-b2"))).toBe(true);
  });

  it("preserves the value on success", () => {
    const result = decodeNamespace("my-project");
    if (Result.isSuccess(result)) {
      expect(result.success).toBe("my-project");
    }
  });

  it("rejects a name containing a dot", () => {
    expect(Result.isFailure(decodeNamespace("my.project"))).toBe(true);
  });

  it("rejects a name with spaces", () => {
    expect(Result.isFailure(decodeNamespace("my project"))).toBe(true);
  });

  it("rejects uppercase characters", () => {
    expect(Result.isFailure(decodeNamespace("MyProject"))).toBe(true);
    expect(Result.isFailure(decodeNamespace("MY-PROJECT"))).toBe(true);
  });

  it("rejects a name starting with a digit", () => {
    expect(Result.isFailure(decodeNamespace("1project"))).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(Result.isFailure(decodeNamespace(""))).toBe(true);
  });

  it("rejects a string longer than 64 characters", () => {
    expect(Result.isFailure(decodeNamespace("a".repeat(65)))).toBe(true);
  });

  it("accepts a 64-character name", () => {
    expect(Result.isSuccess(decodeNamespace("a" + "b".repeat(63)))).toBe(true);
  });

  it("rejects underscores", () => {
    expect(Result.isFailure(decodeNamespace("my_project"))).toBe(true);
  });

  it("rejects non-string input", () => {
    expect(Result.isFailure(decodeNamespace(123))).toBe(true);
    expect(Result.isFailure(decodeNamespace(null))).toBe(true);
    expect(Result.isFailure(decodeNamespace(undefined))).toBe(true);
  });
});

describe("decodeShortName", () => {
  it("accepts a lowercase-start alphanumeric-with-dashes name", () => {
    expect(Result.isSuccess(decodeShortName("my-run"))).toBe(true);
    expect(Result.isSuccess(decodeShortName("abc"))).toBe(true);
    expect(Result.isSuccess(decodeShortName("a1-b2-c3"))).toBe(true);
  });

  it("preserves the value on success", () => {
    const result = decodeShortName("my-run");
    if (Result.isSuccess(result)) {
      expect(result.success).toBe("my-run");
    }
  });

  it("rejects a name starting with uppercase", () => {
    expect(Result.isFailure(decodeShortName("MyRun"))).toBe(true);
  });

  it("rejects a name starting with a digit", () => {
    expect(Result.isFailure(decodeShortName("1myrun"))).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(Result.isFailure(decodeShortName(""))).toBe(true);
  });

  it("rejects a string longer than 64 characters", () => {
    expect(Result.isFailure(decodeShortName("a".repeat(65)))).toBe(true);
  });

  it("accepts a 64-character name", () => {
    expect(Result.isSuccess(decodeShortName("a" + "b".repeat(63)))).toBe(true);
  });

  it("rejects names with underscores", () => {
    expect(Result.isFailure(decodeShortName("my_run"))).toBe(true);
  });

  it("rejects non-string input", () => {
    expect(Result.isFailure(decodeShortName(123))).toBe(true);
    expect(Result.isFailure(decodeShortName(null))).toBe(true);
    expect(Result.isFailure(decodeShortName(undefined))).toBe(true);
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
      expect(Result.isSuccess(decodeShortName(slug))).toBe(true);
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
    expect(Result.isSuccess(decodePhaseId("phase-01"))).toBe(true);
    expect(Result.isSuccess(decodePhaseId("phase-15"))).toBe(true);
    expect(Result.isSuccess(decodePhaseId("phase-99"))).toBe(true);
  });

  it("rejects non-zero-padded phase ids", () => {
    expect(Result.isFailure(decodePhaseId("phase-1"))).toBe(true);
  });

  it("rejects arbitrary strings", () => {
    expect(Result.isFailure(decodePhaseId("my-phase"))).toBe(true);
    expect(Result.isFailure(decodePhaseId(""))).toBe(true);
  });

  it("rejects non-string input", () => {
    expect(Result.isFailure(decodePhaseId(1))).toBe(true);
  });
});

describe("decodeRunId", () => {
  it("accepts any non-empty string", () => {
    expect(Result.isSuccess(decodeRunId("my-run-1234567890"))).toBe(true);
    expect(Result.isSuccess(decodeRunId("x"))).toBe(true);
  });

  it("rejects empty string", () => {
    expect(Result.isFailure(decodeRunId(""))).toBe(true);
  });

  it("rejects non-string", () => {
    expect(Result.isFailure(decodeRunId(null))).toBe(true);
  });
});

describe("decodeBranchName", () => {
  it("accepts valid branch names", () => {
    expect(Result.isSuccess(decodeBranchName("main"))).toBe(true);
    expect(Result.isSuccess(decodeBranchName("feature/my-thing"))).toBe(true);
  });

  it("accepts branch names with dots and slashes", () => {
    expect(Result.isSuccess(decodeBranchName("release/1.2.3"))).toBe(true);
    expect(Result.isSuccess(decodeBranchName("phax/plan-43--phase-01"))).toBe(true);
  });

  it("accepts a branch name with a dash in non-leading position", () => {
    expect(Result.isSuccess(decodeBranchName("fix-bug"))).toBe(true);
  });

  it("rejects empty string", () => {
    expect(Result.isFailure(decodeBranchName(""))).toBe(true);
  });

  it("rejects a leading dash (argument-injection vector)", () => {
    expect(Result.isFailure(decodeBranchName("-x"))).toBe(true);
    expect(Result.isFailure(decodeBranchName("--upload-pack=x"))).toBe(true);
  });

  it("rejects a leading space", () => {
    expect(Result.isFailure(decodeBranchName(" name"))).toBe(true);
  });

  it("rejects whitespace anywhere in the name", () => {
    expect(Result.isFailure(decodeBranchName("name with space"))).toBe(true);
    expect(Result.isFailure(decodeBranchName("name\twith\ttab"))).toBe(true);
  });

  it("rejects control characters", () => {
    expect(Result.isFailure(decodeBranchName("name\x00null"))).toBe(true);
    expect(Result.isFailure(decodeBranchName("\x01start"))).toBe(true);
  });
});

describe("BranchNameSchema's JSON Schema", () => {
  const jsonSchema = draft07JsonSchema(BranchNameSchema) as {
    readonly pattern: string;
    readonly minLength: number;
    readonly maxLength: number;
  };
  const pattern = new RegExp(jsonSchema.pattern);

  it("carries the pattern and both length bounds", () => {
    expect(jsonSchema.pattern).toBe("^[^\\x00-\\x20\\x7f-][^\\x00-\\x20\\x7f]*$");
    expect(jsonSchema.minLength).toBe(1);
    expect(jsonSchema.maxLength).toBe(255);
  });

  it.each([
    ["the empty name", ""],
    ["a leading dash", "-x"],
    ["a space", "a b"],
    ["a tab", "a\tb"],
    ["a DEL", "\x7f"],
    ["a DEL after a letter", "x\x7f"],
    ["a NUL", "a\x00"],
    ["a slash", "feat/x"],
    ["a dash and a dot", "a-b.c"],
    ["a non-ASCII letter", "résumé"],
    ["a 255-character name", "a".repeat(255)],
    ["a 256-character name", "a".repeat(256)],
  ])("agrees with the decoder on %s", (_label, name) => {
    const bySchema =
      name.length >= jsonSchema.minLength &&
      name.length <= jsonSchema.maxLength &&
      pattern.test(name);
    expect(bySchema).toBe(Result.isSuccess(decodeBranchName(name)));
    // JSON Schema validators may compile patterns in unicode mode.
    expect(new RegExp(jsonSchema.pattern, "u").test(name)).toBe(pattern.test(name));
  });
});

describe("decodeWorktreePath", () => {
  it("accepts non-empty path strings", () => {
    expect(Result.isSuccess(decodeWorktreePath("/home/user/.phax/worktrees/run/phase-01"))).toBe(
      true,
    );
  });

  it("rejects empty string", () => {
    expect(Result.isFailure(decodeWorktreePath(""))).toBe(true);
  });
});

describe("decodeClaudeSessionId", () => {
  it("accepts non-empty session ids", () => {
    expect(Result.isSuccess(decodeClaudeSessionId("sess_abc123"))).toBe(true);
  });

  it("rejects empty string", () => {
    expect(Result.isFailure(decodeClaudeSessionId(""))).toBe(true);
  });
});

describe("decodeGateProfileId", () => {
  it("accepts non-empty gate profile ids", () => {
    expect(Result.isSuccess(decodeGateProfileId("fast"))).toBe(true);
    expect(Result.isSuccess(decodeGateProfileId("full"))).toBe(true);
  });

  it("rejects empty string", () => {
    expect(Result.isFailure(decodeGateProfileId(""))).toBe(true);
  });
});

describe("decodeWorkspaceId", () => {
  it("accepts non-empty workspace ids", () => {
    expect(Result.isSuccess(decodeWorkspaceId("frontend"))).toBe(true);
  });

  it("rejects empty string", () => {
    expect(Result.isFailure(decodeWorkspaceId(""))).toBe(true);
  });
});
