import { describe, expect, it } from "vitest";
import {
  PERSON_HANDOFF_PATH,
  worktreeChangeVerdict,
  type ChangedPath,
} from "../../../src/domain/interactive/worktreeChange.js";

const base = {
  before: "tree-a",
  after: "tree-a",
  changed: [] as readonly ChangedPath[],
  personHandoffBefore: null,
  personHandoffAfter: null,
};

describe("worktreeChangeVerdict", () => {
  it("is unchanged for the same tree and no handoff file", () => {
    expect(worktreeChangeVerdict(base)).toEqual({ kind: "unchanged" });
  });

  it("is unchanged for an unchanged handoff file present on both sides", () => {
    expect(
      worktreeChangeVerdict({ ...base, personHandoffBefore: "abc", personHandoffAfter: "abc" }),
    ).toEqual({ kind: "unchanged" });
  });

  it("lists the changed paths, sorted", () => {
    expect(
      worktreeChangeVerdict({
        ...base,
        after: "tree-b",
        changed: [
          { status: "M", path: "src/export/invoiceRow.ts" },
          { status: "A", path: "src/export/labels.ts" },
          { status: "D", path: "docs/old.md" },
        ],
      }),
    ).toEqual({
      kind: "changed",
      paths: ["docs/old.md", "src/export/invoiceRow.ts", "src/export/labels.ts"],
      personHandoff: "unchanged",
    });
  });

  it("filters out every path under .phax-context/", () => {
    const verdict = worktreeChangeVerdict({
      ...base,
      after: "tree-b",
      changed: [
        { status: "A", path: ".phax-context/notes.md" },
        { status: "M", path: "src/a.ts" },
      ],
    });
    expect(verdict).toEqual({ kind: "changed", paths: ["src/a.ts"], personHandoff: "unchanged" });
  });

  it("is unchanged when the tree differs only under .phax-context/", () => {
    expect(
      worktreeChangeVerdict({
        ...base,
        after: "tree-b",
        changed: [{ status: "A", path: ".phax-context/notes.md" }],
      }),
    ).toEqual({ kind: "unchanged" });
  });

  it("ignores the path list when the trees are the same", () => {
    expect(
      worktreeChangeVerdict({ ...base, changed: [{ status: "M", path: "src/a.ts" }] }),
    ).toEqual({ kind: "unchanged" });
  });

  it.each([
    ["created", null, "new", "created"],
    ["modified", "old", "new", "modified"],
    ["deleted", "old", null, "deleted"],
  ] as const)(
    "reads a %s person's handoff file as a change whose only path is the file",
    (_label, before, after, expected) => {
      expect(
        worktreeChangeVerdict({ ...base, personHandoffBefore: before, personHandoffAfter: after }),
      ).toEqual({ kind: "changed", paths: [PERSON_HANDOFF_PATH], personHandoff: expected });
    },
  );

  it("adds the handoff file to the paths of a tree change", () => {
    expect(
      worktreeChangeVerdict({
        ...base,
        after: "tree-b",
        changed: [{ status: "M", path: "src/a.ts" }],
        personHandoffAfter: "new",
      }),
    ).toEqual({
      kind: "changed",
      paths: [".phax-context/correction-handoff.md", "src/a.ts"],
      personHandoff: "created",
    });
  });
});
