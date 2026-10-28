import { describe, expect, it } from "vitest";
import { resolveProviderStoreRoots } from "../../../src/domain/session/storeRoots.js";

const HOME = "/home/ada";

describe("resolveProviderStoreRoots", () => {
  it.each([
    {
      name: "no variable set: every root under home",
      env: {},
      expected: { claude: "/home/ada/.claude", codex: "/home/ada/.codex" },
    },
    {
      name: "each variable set: each root is its variable",
      env: { CLAUDE_CONFIG_DIR: "/stores/claude", CODEX_HOME: "/stores/codex" },
      expected: { claude: "/stores/claude", codex: "/stores/codex" },
    },
    {
      name: "an empty variable counts as unset",
      env: { CLAUDE_CONFIG_DIR: "", CODEX_HOME: "" },
      expected: { claude: "/home/ada/.claude", codex: "/home/ada/.codex" },
    },
    {
      name: "one variable set, the other defaults",
      env: { CODEX_HOME: "/stores/codex", CLAUDE_CONFIG_DIR: undefined },
      expected: { claude: "/home/ada/.claude", codex: "/stores/codex" },
    },
  ])("$name", ({ env, expected }) => {
    expect(resolveProviderStoreRoots(env, HOME)).toEqual(expected);
  });

  it("an empty home gives no default root, while a set variable still counts", () => {
    expect(resolveProviderStoreRoots({ CODEX_HOME: "/c" }, "")).toEqual({
      claude: null,
      codex: "/c",
    });
  });

  it("never names a vibe root, whatever VIBE_HOME holds", () => {
    expect(resolveProviderStoreRoots({ VIBE_HOME: "/v" }, HOME)).toEqual({
      claude: "/home/ada/.claude",
      codex: "/home/ada/.codex",
    });
  });
});
