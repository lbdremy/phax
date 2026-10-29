import { describe, expect, it } from "vitest";
import {
  claudeProtectedDenyRules,
  matchProtected,
  protectedChanges,
  protectedEnforcement,
  protectedList,
  submoduleConflict,
  vibeProtectedDenylist,
} from "../../../src/domain/security/protectedPaths.js";
import type {
  ObservedEntry,
  ProtectedChange,
  ProtectedChangeKind,
  ProtectedEnforcement,
  ProtectedEntry,
  ProtectedList,
  ProtectedObservation,
  SubmoduleConflict,
  TrackedState,
} from "../../../src/domain/security/protectedPaths.js";

type ProviderId = Parameters<typeof protectedEnforcement>[1];
type SecurityMode = Parameters<typeof protectedEnforcement>[2];

// Oracles for the protected-path contract, discharged by phase-02. Each test
// is marked `it.fails` until the functions land. Lists are written inline, as
// `protectedList` would build them with config path `phax.json`.

const BASELINE: ProtectedEntry = { glob: "**/steme.baseline.json", entry: "protectedPaths[0]" };
const PHAX_JSON: ProtectedEntry = { glob: "phax.json", entry: "phax.json" };
const BASELINE_LIST: ProtectedList = [BASELINE, PHAX_JSON];

function change(
  path: string,
  kind: ProtectedChangeKind,
  entry: string,
  glob: string,
): ProtectedChange {
  return { path, kind, entry, glob };
}

describe("protectedList", () => {
  it("appends the loaded phax.json after the declared globs", () => {
    expect(protectedList(["**/steme.baseline.json"], "phax.json")).toEqual([
      { glob: "**/steme.baseline.json", entry: "protectedPaths[0]" },
      { glob: "phax.json", entry: "phax.json" },
    ]);
  });

  it("does not append phax.json when a declared glob is exactly its path", () => {
    expect(protectedList(["phax.json", "a.json"], "phax.json")).toEqual([
      { glob: "phax.json", entry: "protectedPaths[0]" },
      { glob: "a.json", entry: "protectedPaths[1]" },
    ]);
  });

  it("names a nested loaded config by its repo-relative path", () => {
    expect(protectedList(["a.json"], "pkg/phax.json")).toEqual([
      { glob: "a.json", entry: "protectedPaths[0]" },
      { glob: "pkg/phax.json", entry: "pkg/phax.json" },
    ]);
  });

  it("is null when nothing is declared", () => {
    expect(protectedList(undefined, "phax.json")).toEqual(null);
  });
});

describe("matchProtected", () => {
  it("matches a case variant of a protected path to its entry", () => {
    expect(matchProtected(BASELINE_LIST, "packages/a/STEME.Baseline.json")).toEqual(BASELINE);
  });

  it("matches a case variant of phax.json to the implied entry", () => {
    expect(matchProtected(BASELINE_LIST, "PHAX.JSON")).toEqual(PHAX_JSON);
  });

  it("matches nothing for a path no glob matches", () => {
    expect(matchProtected(BASELINE_LIST, "src/a.ts")).toEqual(undefined);
  });
});

describe("protectedChanges", () => {
  it("names created, deleted and renamed protected paths once each, sorted", () => {
    const entries: readonly ObservedEntry[] = [
      { status: "added", path: "packages/a/steme.baseline.json" },
      { status: "deleted", path: "packages/b/steme.baseline.json" },
      {
        status: "renamed",
        oldPath: "packages/c/steme.baseline.json",
        path: "packages/c/old.json",
      },
      { status: "renamed", oldPath: "packages/d/x.json", path: "packages/d/steme.baseline.json" },
    ];
    const tracked: { path: string; state: TrackedState }[] = [
      { path: "packages/b/steme.baseline.json", state: "missing" },
    ];
    const observation: ProtectedObservation = { entries, tracked, untracked: [], links: [] };
    expect(protectedChanges(BASELINE_LIST, observation)).toEqual([
      change("packages/a/steme.baseline.json", "created", "protectedPaths[0]", BASELINE.glob),
      change("packages/b/steme.baseline.json", "deleted", "protectedPaths[0]", BASELINE.glob),
      change("packages/c/steme.baseline.json", "renamed", "protectedPaths[0]", BASELINE.glob),
      change("packages/d/steme.baseline.json", "renamed", "protectedPaths[0]", BASELINE.glob),
    ]);
  });

  it("counts a type change as edited and an untracked non-ASCII variant as created", () => {
    const list: ProtectedList = [
      BASELINE,
      { glob: "**/règles.json", entry: "protectedPaths[1]" },
      PHAX_JSON,
    ];
    const observation: ProtectedObservation = {
      entries: [{ status: "type-changed", path: "packages/a/steme.baseline.json" }],
      tracked: [{ path: "packages/a/steme.baseline.json", state: "type" }],
      untracked: ["packages/b/RÈGLES.json"],
      links: [],
    };
    expect(protectedChanges(list, observation)).toEqual([
      change("packages/a/steme.baseline.json", "edited", "protectedPaths[0]", BASELINE.glob),
      change("packages/b/RÈGLES.json", "created", "protectedPaths[1]", "**/règles.json"),
    ]);
  });

  it("names a tracked file whose content differs although no entry shows it", () => {
    const observation: ProtectedObservation = {
      entries: [],
      tracked: [{ path: "packages/a/steme.baseline.json", state: "content" }],
      untracked: [],
      links: [],
    };
    expect(protectedChanges(BASELINE_LIST, observation)).toEqual([
      change("packages/a/steme.baseline.json", "edited", "protectedPaths[0]", BASELINE.glob),
    ]);
  });

  it("names an untracked ignored protected file and no other ignored file", () => {
    const list: ProtectedList = [{ glob: "**/allow.json", entry: "protectedPaths[0]" }, PHAX_JSON];
    const observation: ProtectedObservation = {
      entries: [],
      tracked: [],
      untracked: ["generated/allow.json", "node_modules/x/index.js"],
      links: [],
    };
    expect(protectedChanges(list, observation)).toEqual([
      change("generated/allow.json", "created", "protectedPaths[0]", "**/allow.json"),
    ]);
  });

  it("names a change to phax.json with its implied entry", () => {
    const list: ProtectedList = [{ glob: "**/x.json", entry: "protectedPaths[0]" }, PHAX_JSON];
    const observation: ProtectedObservation = {
      entries: [{ status: "modified", path: "phax.json" }],
      tracked: [],
      untracked: [],
      links: [],
    };
    expect(protectedChanges(list, observation)).toEqual([
      { path: "phax.json", kind: "edited", entry: "phax.json", glob: "phax.json" },
    ]);
  });

  it("yields nothing for changes to paths no glob matches", () => {
    const observation: ProtectedObservation = {
      entries: [{ status: "modified", path: "src/a.ts" }],
      tracked: [],
      untracked: ["dist/b.js"],
      links: [],
    };
    expect(protectedChanges(BASELINE_LIST, observation)).toEqual([]);
  });

  it("names a path once when an entry and its tracked state agree", () => {
    const observation: ProtectedObservation = {
      entries: [{ status: "modified", path: "packages/a/steme.baseline.json" }],
      tracked: [{ path: "packages/a/steme.baseline.json", state: "content" }],
      untracked: [],
      links: [],
    };
    expect(protectedChanges(BASELINE_LIST, observation)).toEqual([
      change("packages/a/steme.baseline.json", "edited", "protectedPaths[0]", BASELINE.glob),
    ]);
  });
});

describe("native rule forms", () => {
  const mixed: ProtectedList = [
    BASELINE,
    { glob: "config/*.json", entry: "protectedPaths[1]" },
    { glob: "locks/[a].json", entry: "protectedPaths[2]" },
    PHAX_JSON,
  ];

  it("gives Claude one Edit rule per literal or any-depth glob", () => {
    expect(claudeProtectedDenyRules("/wt", mixed)).toEqual([
      "Edit(//wt/**/steme.baseline.json)",
      "Edit(//wt/phax.json)",
    ]);
  });

  it("drops trailing slashes from the worktree root in Claude rules", () => {
    expect(claudeProtectedDenyRules("/wt/", mixed)).toEqual([
      "Edit(//wt/**/steme.baseline.json)",
      "Edit(//wt/phax.json)",
    ]);
  });

  it("gives Vibe one entry per literal glob and two per any-depth glob", () => {
    const list: ProtectedList = [
      BASELINE,
      { glob: "config/*.json", entry: "protectedPaths[1]" },
      PHAX_JSON,
    ];
    expect(vibeProtectedDenylist("/wt", list)).toEqual([
      "/wt/steme.baseline.json",
      "/wt/**/steme.baseline.json",
      "/wt/phax.json",
    ]);
  });
});

describe("protectedEnforcement", () => {
  const partialList: ProtectedList = [
    BASELINE,
    { glob: "config/*.json", entry: "protectedPaths[1]" },
    PHAX_JSON,
  ];
  const table: readonly (readonly [
    ProtectedList,
    ProviderId,
    SecurityMode,
    ProtectedEnforcement,
  ])[] = [
    [BASELINE_LIST, "claude-code", "secure", "enforced"],
    [BASELINE_LIST, "mistral-vibe", "secure", "enforced"],
    [BASELINE_LIST, "codex-cli", "secure", "commit-check-only"],
    [BASELINE_LIST, "claude-code", "unsafe", "commit-check-only"],
    [BASELINE_LIST, "mistral-vibe", "unsafe", "commit-check-only"],
    [BASELINE_LIST, "claude-code", "isolated", "commit-check-only"],
    [partialList, "claude-code", "secure", "partial"],
    [partialList, "mistral-vibe", "secure", "partial"],
  ];

  it("follows provider, mode and the list's native forms", () => {
    expect(
      table.map(([list, provider, mode]) => protectedEnforcement(list, provider, mode)),
    ).toEqual(table.map(([, , , expected]) => expected));
  });
});

describe("submoduleConflict", () => {
  it("refuses a glob whose leading literal segments reach a submodule", () => {
    const expected: SubmoduleConflict = {
      index: 1,
      glob: "vendor/lint-rules/allow.json",
      submodule: "vendor/lint-rules",
    };
    expect(
      submoduleConflict(["**/allow.json", "vendor/lint-rules/allow.json"], ["vendor/lint-rules"]),
    ).toEqual(expected);
  });

  it("refuses a glob that is exactly the submodule path", () => {
    expect(submoduleConflict(["vendor/lint-rules"], ["vendor/lint-rules"])).toEqual({
      index: 0,
      glob: "vendor/lint-rules",
      submodule: "vendor/lint-rules",
    });
  });

  it("refuses a case variant reaching a submodule", () => {
    expect(submoduleConflict(["Vendor/Lint-Rules/a.json"], ["vendor/lint-rules"])).toEqual({
      index: 0,
      glob: "Vendor/Lint-Rules/a.json",
      submodule: "vendor/lint-rules",
    });
  });

  it("accepts globs above, beside or independent of a submodule", () => {
    expect(
      [["vendor/**"], ["vendor/lint-rules-extra/a.json"], ["**/allow.json"]].map((declared) =>
        submoduleConflict(declared, ["vendor/lint-rules"]),
      ),
    ).toEqual([undefined, undefined, undefined]);
  });
});
