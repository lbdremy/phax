import { describe, expect, it } from "vitest";
import {
  commandWords,
  findDuplicateCommand,
  sameCommand,
} from "../../src/domain/gate/commandWords.js";

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

function steps(...commands: string[]) {
  return commands.map((command) => ({ command }));
}

describe("findDuplicateCommand", () => {
  it("names the first pair of steps with the same command, 1-based", () => {
    expect(
      findDuplicateCommand(steps("pnpm test", "node scripts/audit.mjs", "pnpm  test")),
    ).toEqual({ command: "pnpm test", first: 1, second: 3 });
  });

  it("finds nothing when every command is distinct", () => {
    expect(findDuplicateCommand(steps("pnpm test", "node scripts/audit.mjs"))).toBeUndefined();
    expect(findDuplicateCommand(steps("pnpm run test", "pnpm test"))).toBeUndefined();
    expect(findDuplicateCommand([])).toBeUndefined();
  });
});
