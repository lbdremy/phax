import { describe, expect, it } from "vitest";
import {
  mirroredAtTarget,
  nativeProtectedGlobs,
  protectedChanges,
  protectedList,
  reachesBelow,
  submoduleConflict,
  type ProtectedObservation,
} from "../../../src/domain/security/protectedPaths.js";

describe("nativeProtectedGlobs", () => {
  it("classifies literal and any-depth globs in list order, leaving the rest out", () => {
    const list = protectedList(
      [
        "**/steme.baseline.json",
        "config/*.json",
        "locks/[a].json",
        "a/**/b.json",
        "**/x/?.json",
        "**/config/limits.json",
        "docs/limits.json",
      ],
      "phax.json",
    )!;
    expect(nativeProtectedGlobs(list)).toEqual([
      { glob: "**/steme.baseline.json", form: "any-depth", path: "steme.baseline.json" },
      { glob: "**/config/limits.json", form: "any-depth", path: "config/limits.json" },
      { glob: "docs/limits.json", form: "literal", path: "docs/limits.json" },
      { glob: "phax.json", form: "literal", path: "phax.json" },
    ]);
  });
});

describe("protectedChanges precedence", () => {
  const list = protectedList(["**/steme.baseline.json"], "phax.json")!;
  const path = "packages/c/steme.baseline.json";
  const table: readonly [string, ProtectedObservation, string][] = [
    [
      "renamed beats the source's tracked missing",
      {
        entries: [{ status: "renamed", path: "moved.txt", oldPath: path }],
        tracked: [{ path, state: "missing" }],
        untracked: [],
        links: [],
      },
      "renamed",
    ],
    [
      "added and untracked give created",
      { entries: [{ status: "added", path }], tracked: [], untracked: [path], links: [] },
      "created",
    ],
    [
      "deleted with tracked content gives deleted",
      {
        entries: [{ status: "deleted", path }],
        tracked: [{ path, state: "content" }],
        untracked: [],
        links: [],
      },
      "deleted",
    ],
    [
      "modified with tracked missing gives deleted",
      {
        entries: [{ status: "modified", path }],
        tracked: [{ path, state: "missing" }],
        untracked: [],
        links: [],
      },
      "deleted",
    ],
  ];

  it.each(table)("%s, with one change per path", (_name, observation, kind) => {
    expect(protectedChanges(list, observation).map((c) => [c.path, c.kind])).toEqual([
      [path, kind],
    ]);
  });
});

describe("submoduleConflict", () => {
  it("requires a segment boundary and folds case", () => {
    expect(submoduleConflict(["vendor/lint-rules-extra/a.json"], ["vendor/lint-rules"])).toBe(
      undefined,
    );
    expect(submoduleConflict(["Vendor/lint-rules/a.json"], ["vendor/lint-rules"])).toEqual({
      index: 0,
      glob: "Vendor/lint-rules/a.json",
      submodule: "vendor/lint-rules",
    });
  });
});

describe("reachesBelow", () => {
  it.each([
    ["**/steme.baseline.json", "packages/e", true],
    ["**", "a", true],
    ["vendor/rules/x.json", "vendor", true],
    ["vendor/rules/x.json", "Vendor/Rules", true],
    ["vendor/rules/x.json", "vendor/rules/x.json", false],
    ["vendor/rules/x.json", "vendor/other", false],
    ["src/**", "src/foo/bar", true],
    ["src/*.json", "src/foo", false],
    ["a/*/b.json", "a/x", true],
    ["config/limits.json", "tools", false],
    ["phax.json", "pkg", false],
  ] as const)("%s below %s: %s", (glob, path, expected) => {
    expect(reachesBelow(glob, path)).toBe(expected);
  });
});

describe("mirroredAtTarget", () => {
  it.each([
    ["**/steme.baseline.json", "node_modules/pkg", true],
    ["**/config/limits.json", "node_modules/pkg", true],
    ["**/pkg/steme.baseline.json", "node_modules/PKG", false],
    ["**/a/**/b.json", "x", false],
    ["vendor/**", "vendor/x", false],
  ] as const)("%s at %s: %s", (glob, path, expected) => {
    expect(mirroredAtTarget(glob, path)).toBe(expected);
  });
});

const observe = (links: ProtectedObservation["links"]): ProtectedObservation => ({
  entries: [],
  tracked: [],
  untracked: [],
  links,
});

describe("protectedChanges on links", () => {
  const list = protectedList(["config/limits.json", "**/steme.baseline.json"], "phax.json")!;

  it("names each link the first reaching entry reaches below, by its type", () => {
    expect(
      protectedChanges(
        list,
        observe([
          { type: "symlink", path: "packages/e", source: "tree" },
          { type: "nested-repository", path: "vendor/n" },
          { type: "symlink", path: "config", source: "ignored", into: "elsewhere" },
        ]),
      ),
    ).toEqual([
      {
        path: "config",
        kind: "symlink",
        entry: "protectedPaths[0]",
        glob: "config/limits.json",
      },
      {
        path: "packages/e",
        kind: "symlink",
        entry: "protectedPaths[1]",
        glob: "**/steme.baseline.json",
      },
      {
        path: "vendor/n",
        kind: "nested-repository",
        entry: "protectedPaths[1]",
        glob: "**/steme.baseline.json",
      },
    ]);
  });

  it("lets an ignored link into the worktree through for a glob its target mirrors only", () => {
    const into = { type: "symlink", source: "ignored", into: "worktree" } as const;
    expect(protectedChanges(list, observe([{ ...into, path: "node_modules/pkg" }]))).toEqual([]);
    expect(
      protectedChanges(list, observe([{ ...into, path: "config" }])).map((c) => c.kind),
    ).toEqual(["symlink"]);
  });

  it("names a link once, by its own change, when an entry matches its path", () => {
    const changes = protectedChanges(list, {
      entries: [{ status: "added", path: "a/steme.baseline.json" }],
      tracked: [],
      untracked: [],
      links: [{ type: "symlink", path: "a/steme.baseline.json", source: "tree" }],
    });
    expect(changes.map((c) => [c.path, c.kind])).toEqual([["a/steme.baseline.json", "created"]]);
  });
});
