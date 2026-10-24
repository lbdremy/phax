import { describe, expect, it } from "vitest";
import { resolveProviderStoreRoots } from "../../../src/domain/session/storeRoots.js";

const HOME = "/home/ada";

describe("resolveProviderStoreRoots", () => {
  it.each([
    {
      name: "no variable set: every root under home",
      env: {},
      expected: { claude: "/home/ada/.claude", codex: "/home/ada/.codex", vibe: "/home/ada/.vibe" },
    },
    {
      name: "each variable set: each root is its variable",
      env: { CLAUDE_CONFIG_DIR: "/stores/claude", CODEX_HOME: "/stores/codex", VIBE_HOME: "/v" },
      expected: { claude: "/stores/claude", codex: "/stores/codex", vibe: "/v" },
    },
    {
      name: "an empty variable counts as unset",
      env: { CLAUDE_CONFIG_DIR: "", CODEX_HOME: "", VIBE_HOME: "" },
      expected: { claude: "/home/ada/.claude", codex: "/home/ada/.codex", vibe: "/home/ada/.vibe" },
    },
    {
      name: "one variable set, the others default",
      env: { CODEX_HOME: "/stores/codex", VIBE_HOME: undefined },
      expected: { claude: "/home/ada/.claude", codex: "/stores/codex", vibe: "/home/ada/.vibe" },
    },
  ])("$name", ({ env, expected }) => {
    expect(resolveProviderStoreRoots(env, HOME)).toEqual(expected);
  });

  it("an empty home gives no default root, while a set variable still counts", () => {
    expect(resolveProviderStoreRoots({ VIBE_HOME: "/v" }, "")).toEqual({
      claude: null,
      codex: null,
      vibe: "/v",
    });
  });
});
