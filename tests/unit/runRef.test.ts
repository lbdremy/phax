import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  runKey,
  formatQualifiedName,
  parseRunRef,
  parseRunKey,
  nextAvailableShortName,
} from "../../src/domain/runRef.js";
import type { ShortName } from "../../src/domain/branded.js";

describe("runKey", () => {
  it("joins namespace and shortName with a single dot", () => {
    expect(runKey("myproject", "fixbug")).toBe("myproject.fixbug");
    expect(runKey("louloupapers", "add-export")).toBe("louloupapers.add-export");
  });
});

describe("formatQualifiedName", () => {
  it("returns the same result as runKey", () => {
    expect(formatQualifiedName("ns", "run")).toBe(runKey("ns", "run"));
  });
});

describe("parseRunRef", () => {
  it("parses an unqualified short name", () => {
    const result = parseRunRef("fixbug");
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({ namespace: undefined, shortName: "fixbug" });
    }
  });

  it("parses a qualified name", () => {
    const result = parseRunRef("louloupapers.fixbug");
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({ namespace: "louloupapers", shortName: "fixbug" });
    }
  });

  it("rejects empty input", () => {
    expect(Result.isFailure(parseRunRef(""))).toBe(true);
  });

  it("rejects more than one dot", () => {
    const result = parseRunRef("a.b.c");
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatch(/more than one dot/);
    }
  });

  it("rejects an uppercase namespace", () => {
    const result = parseRunRef("Foo.bar");
    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects a leading dot (empty namespace)", () => {
    const result = parseRunRef(".bar");
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatch(/empty namespace/);
    }
  });

  it("rejects a trailing dot (empty short name)", () => {
    const result = parseRunRef("foo.");
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatch(/empty short-name/);
    }
  });

  it("rejects an invalid unqualified short name", () => {
    expect(Result.isFailure(parseRunRef("1invalid"))).toBe(true);
    expect(Result.isFailure(parseRunRef("HasUpper"))).toBe(true);
  });

  it("rejects an invalid short name in a qualified reference", () => {
    const result = parseRunRef("myns.1invalid");
    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects a valid namespace but invalid short name via dot", () => {
    const result = parseRunRef("good.Bad");
    expect(Result.isFailure(result)).toBe(true);
  });
});

function sn(s: string): ShortName {
  return s as ShortName;
}

describe("nextAvailableShortName", () => {
  it("returns base when not used", () => {
    const result = nextAvailableShortName(sn("fixbug"), () => false);
    expect(result).toBe("fixbug");
  });

  it("bumps to -2 when base is used", () => {
    const used = new Set(["fixbug"]);
    const result = nextAvailableShortName(sn("fixbug"), (n) => used.has(n));
    expect(result).toBe("fixbug-2");
  });

  it("bumps to -3 when base and -2 are used", () => {
    const used = new Set(["fixbug", "fixbug-2"]);
    const result = nextAvailableShortName(sn("fixbug"), (n) => used.has(n));
    expect(result).toBe("fixbug-3");
  });

  it("never returns a name the predicate marks as used", () => {
    const used = new Set(["fixbug", "fixbug-2", "fixbug-3", "fixbug-4"]);
    const result = nextAvailableShortName(sn("fixbug"), (n) => used.has(n));
    expect(result).toBe("fixbug-5");
    expect(used.has(result)).toBe(false);
  });

  it("two predicates scoped to different namespaces keep the same base independently", () => {
    // Namespace "alpha" has "fixbug" taken; namespace "beta" does not.
    const alphaUsed = new Set(["fixbug"]);
    const betaUsed = new Set<string>();

    const alphaResult = nextAvailableShortName(sn("fixbug"), (n) => alphaUsed.has(n));
    const betaResult = nextAvailableShortName(sn("fixbug"), (n) => betaUsed.has(n));

    expect(alphaResult).toBe("fixbug-2");
    expect(betaResult).toBe("fixbug"); // beta's namespace starts fresh
  });

  it("trims trailing dashes before appending suffix to stay within 64 chars", () => {
    const longBase = ("a".repeat(62) + "--") as ShortName; // 64 chars with trailing dashes
    const used = new Set<string>([longBase]);
    const result = nextAvailableShortName(longBase, (n) => used.has(n));
    expect(result.length).toBeLessThanOrEqual(64);
    expect(used.has(result)).toBe(false);
  });
});

describe("parseRunKey", () => {
  it("round-trips runKey output", () => {
    const key = runKey("myproject", "fixbug");
    const result = parseRunKey(key);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({ namespace: "myproject", shortName: "fixbug" });
    }
  });

  it("rejects an unqualified short name", () => {
    const result = parseRunKey("fixbug");
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatch(/unqualified/);
    }
  });

  it("rejects empty string", () => {
    expect(Result.isFailure(parseRunKey(""))).toBe(true);
  });

  it("rejects more than one dot", () => {
    expect(Result.isFailure(parseRunKey("a.b.c"))).toBe(true);
  });
});
