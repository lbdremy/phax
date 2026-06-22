import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { runKey, formatQualifiedName, parseRunRef, parseRunKey } from "../../src/domain/runRef.js";

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
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({ namespace: undefined, shortName: "fixbug" });
    }
  });

  it("parses a qualified name", () => {
    const result = parseRunRef("louloupapers.fixbug");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({ namespace: "louloupapers", shortName: "fixbug" });
    }
  });

  it("rejects empty input", () => {
    expect(Either.isLeft(parseRunRef(""))).toBe(true);
  });

  it("rejects more than one dot", () => {
    const result = parseRunRef("a.b.c");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatch(/more than one dot/);
    }
  });

  it("rejects an uppercase namespace", () => {
    const result = parseRunRef("Foo.bar");
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a leading dot (empty namespace)", () => {
    const result = parseRunRef(".bar");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatch(/empty namespace/);
    }
  });

  it("rejects a trailing dot (empty short name)", () => {
    const result = parseRunRef("foo.");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatch(/empty short-name/);
    }
  });

  it("rejects an invalid unqualified short name", () => {
    expect(Either.isLeft(parseRunRef("1invalid"))).toBe(true);
    expect(Either.isLeft(parseRunRef("HasUpper"))).toBe(true);
  });

  it("rejects an invalid short name in a qualified reference", () => {
    const result = parseRunRef("myns.1invalid");
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a valid namespace but invalid short name via dot", () => {
    const result = parseRunRef("good.Bad");
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("parseRunKey", () => {
  it("round-trips runKey output", () => {
    const key = runKey("myproject", "fixbug");
    const result = parseRunKey(key);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({ namespace: "myproject", shortName: "fixbug" });
    }
  });

  it("rejects an unqualified short name", () => {
    const result = parseRunKey("fixbug");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatch(/unqualified/);
    }
  });

  it("rejects empty string", () => {
    expect(Either.isLeft(parseRunKey(""))).toBe(true);
  });

  it("rejects more than one dot", () => {
    expect(Either.isLeft(parseRunKey("a.b.c"))).toBe(true);
  });
});
