import { describe, expect, it } from "vitest";
import { commandWords, sameCommand } from "../../src/domain/gate/commandWords.js";

describe("commandWords", () => {
  it("splits on runs of whitespace and ignores the ends", () => {
    expect(commandWords("  pnpm   test\t--run ")).toEqual(["pnpm", "test", "--run"]);
    expect(commandWords("   ")).toEqual([]);
  });
});

describe("sameCommand", () => {
  it("holds for commands that split into the same words", () => {
    expect(sameCommand("pnpm  test", "pnpm test")).toBe(true);
    expect(sameCommand(" pnpm test ", "pnpm test")).toBe(true);
  });

  it("fails for commands with other words", () => {
    expect(sameCommand("pnpm run test", "pnpm test")).toBe(false);
    expect(sameCommand("pnpm test", "pnpm test --run")).toBe(false);
    expect(sameCommand("node scripts/b.mjs", "node scripts/c.mjs")).toBe(false);
  });
});
