import { describe, expect, it } from "vitest";
import { matchesAnyGlob, matchesGlob } from "../../../src/domain/architecture/glob.js";

describe("matchesGlob", () => {
  it.each([
    ["docs/**", "docs/a.md", true],
    ["docs/**", "docs/.vitepress/config.ts", true],
    ["docs/**", "docs/guides/deep/page.md", true],
    ["docs/**", "docs", true],
    ["docs/**", "site/docs/a.md", false],
    ["src/**/refund.ts", "src/refund.ts", true],
    ["src/**/refund.ts", "src/core/decide/refund.ts", true],
    ["src/**/refund.ts", "src/core/refunds.ts", false],
    ["**", "anything/at/all.ts", true],
    ["**/*.md", "README.md", true],
    ["**/*.md", "docs/a/b.md", true],
  ])("** as a whole segment: %s against %s is %s", (glob, path, expected) => {
    expect(matchesGlob(glob, path)).toBe(expected);
  });

  it.each([
    ["*.md", "README.md", true],
    ["*.md", "docs/a.md", false],
    ["*.md", ".md", true],
    ["src/*/schemas/**", "src/http/schemas/refund.ts", true],
    ["src/*/schemas/**", "src/http/v1/schemas/refund.ts", false],
    ["src/*/schemas/**", "src/schemas/refund.ts", false],
    ["src/core/decide/*", "src/core/decide/refund.ts", true],
    ["src/core/decide/*", "src/core/decide/inner/refund.ts", false],
    ["a*b*c", "abc", true],
    ["a*b*c", "aXXbYYc", true],
    ["a*b*c", "aXXbYY", false],
  ])("* within a segment: %s against %s is %s", (glob, path, expected) => {
    expect(matchesGlob(glob, path)).toBe(expected);
  });

  it.each([
    ["phase-0?.md", "phase-01.md", true],
    ["phase-0?.md", "phase-1.md", false],
    ["phase-0?.md", "phase-012.md", false],
    ["a?b", "a/b", false],
    ["caf?", "café", true],
  ])("? is one character other than /: %s against %s is %s", (glob, path, expected) => {
    expect(matchesGlob(glob, path)).toBe(expected);
  });

  it("is case-sensitive", () => {
    expect(matchesGlob("README.md", "readme.md")).toBe(false);
    expect(matchesGlob("src/Core/**", "src/core/a.ts")).toBe(false);
    expect(matchesGlob("src/Core/**", "src/Core/a.ts")).toBe(true);
  });

  it.each([
    ["[ab].ts", "[ab].ts", true],
    ["[ab].ts", "a.ts", false],
    ["!(x).ts", "!(x).ts", true],
    ["!(x).ts", "y.ts", false],
    ["a.ts", "aXts", false],
    ["a+b.ts", "a+b.ts", true],
    ["a+b.ts", "aab.ts", false],
    ["^a$.ts", "^a$.ts", true],
  ])("every other character is literal: %s against %s is %s", (glob, path, expected) => {
    expect(matchesGlob(glob, path)).toBe(expected);
  });

  it("does not treat a leading dot specially", () => {
    expect(matchesGlob("*", ".env")).toBe(true);
    expect(matchesGlob("docs/*.ts", "docs/.config.ts")).toBe(true);
    expect(matchesGlob("?env", ".env")).toBe(true);
  });

  it("matches a literal glob only against the same path", () => {
    expect(matchesGlob("src/a.ts", "src/a.ts")).toBe(true);
    expect(matchesGlob("src/a.ts", "src/a.ts/b")).toBe(false);
    expect(matchesGlob("src/a.ts/b", "src/a.ts")).toBe(false);
  });

  // A glob comes from phax.json or the provider's report, so a pathological one
  // must not hang lint or the run's start preflight.
  it("answers a pathological glob without exponential backtracking", () => {
    const started = performance.now();
    expect(matchesGlob("*a*a*a*a*a*a*a*a*a*a*a*a*b", "a".repeat(200))).toBe(false);
    expect(matchesGlob(Array(30).fill("**").join("/") + "/z", Array(200).fill("a").join("/"))).toBe(
      false,
    );
    expect(matchesGlob("**/x/**/x/**/x/**/x/**/z", Array(100).fill("x").join("/"))).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("matches with stars and doubled ** the same as before", () => {
    expect(matchesGlob("*a*b", "xaxxb")).toBe(true);
    expect(matchesGlob("*a*b", "xaxxbc")).toBe(false);
    expect(matchesGlob("a*", "a")).toBe(true);
    expect(matchesGlob("**/**/z", "z")).toBe(true);
    expect(matchesGlob("src/**/**/x.ts", "src/a/b/x.ts")).toBe(true);
  });
});

describe("matchesAnyGlob", () => {
  it("is true when any path matches any glob", () => {
    expect(matchesAnyGlob(["docs/**", "*.md"], ["src/a.ts", "README.md"])).toBe(true);
  });

  it("is false when no path matches", () => {
    expect(matchesAnyGlob(["docs/**", "*.md"], ["src/a.ts", "src/b/c.md"])).toBe(false);
  });

  it("is false for no paths", () => {
    expect(matchesAnyGlob(["**"], [])).toBe(false);
  });
});
