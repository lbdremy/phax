import { describe, expect, it } from "vitest";
import {
  nativeProtectedGlobs,
  protectedChanges,
  protectedList,
  protectedTrackedPaths,
  submoduleConflict,
  type ProtectedObservation,
} from "../../../src/domain/security/protectedPaths.js";

describe("protectedTrackedPaths", () => {
  it("keeps the base paths some entry matches, case-folded, in input order", () => {
    const list = protectedList(["**/steme.baseline.json"], "phax.json")!;
    expect(protectedTrackedPaths(list, ["a/steme.baseline.json", "src/x.ts", "PHAX.json"])).toEqual(
      ["a/steme.baseline.json", "PHAX.json"],
    );
  });
});

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
      },
      "renamed",
    ],
    [
      "added and untracked give created",
      { entries: [{ status: "added", path }], tracked: [], untracked: [path] },
      "created",
    ],
    [
      "deleted with tracked content gives deleted",
      {
        entries: [{ status: "deleted", path }],
        tracked: [{ path, state: "content" }],
        untracked: [],
      },
      "deleted",
    ],
    [
      "modified with tracked missing gives deleted",
      {
        entries: [{ status: "modified", path }],
        tracked: [{ path, state: "missing" }],
        untracked: [],
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
