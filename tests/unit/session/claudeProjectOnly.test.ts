import { describe, expect, it } from "vitest";
import {
  CLAUDE_PROJECT_ONLY_FLAGS,
  projectOnlyEnvironment,
} from "../../../src/domain/session/claudeProjectOnly.js";

const SWITCH = "CLAUDE_CODE_DISABLE_AUTO_MEMORY";

describe("CLAUDE_PROJECT_ONLY_FLAGS", () => {
  it("is --setting-sources project", () => {
    expect([...CLAUDE_PROJECT_ONLY_FLAGS]).toEqual(["--setting-sources", "project"]);
  });
});

describe("projectOnlyEnvironment", () => {
  const cases: ReadonlyArray<{
    name: string;
    inherited: Record<string, string | undefined>;
    expected: Record<string, string>;
  }> = [
    { name: "an empty environment", inherited: {}, expected: { [SWITCH]: "1" } },
    {
      name: "unrelated variables",
      inherited: { PATH: "/bin", ANTHROPIC_API_KEY: "k", CLAUDE_CONFIG_DIR: "/c" },
      expected: { PATH: "/bin", ANTHROPIC_API_KEY: "k", CLAUDE_CONFIG_DIR: "/c", [SWITCH]: "1" },
    },
    { name: "the switch set to 0", inherited: { [SWITCH]: "0" }, expected: { [SWITCH]: "1" } },
    { name: "the switch set to 1", inherited: { [SWITCH]: "1" }, expected: { [SWITCH]: "1" } },
    { name: "the switch set to empty", inherited: { [SWITCH]: "" }, expected: { [SWITCH]: "1" } },
    {
      name: "the switch set to true",
      inherited: { [SWITCH]: "true" },
      expected: { [SWITCH]: "1" },
    },
    {
      name: "an undefined entry",
      inherited: { PATH: "/bin", GONE: undefined },
      expected: { PATH: "/bin", [SWITCH]: "1" },
    },
  ];

  it.each(cases)("$name", ({ inherited, expected }) => {
    const before = { ...inherited };
    const result = projectOnlyEnvironment(inherited);
    expect(result).toEqual(expected);
    expect(result[SWITCH]).toBe("1");
    expect(Object.values(result).every((value) => typeof value === "string")).toBe(true);
    expect(inherited).toEqual(before);
    expect(result).not.toBe(inherited);
  });
});
