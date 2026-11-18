import { describe, expect, it } from "vitest";
import { renderFindingList } from "../../../src/cli/definitions/finding.js";
import type { FindingListFile } from "../../../src/schemas/findingList.js";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";

const code = (
  id: string,
  fate: "open" | "unrecorded",
  file: string,
  line: number,
  message: string,
): FindingListFile["findings"][number] => ({
  id,
  source: "code-review",
  severity: "concern",
  file,
  line,
  message,
  lens: "core",
  escape: "omission",
  criterion: null,
  suggestion: "Cover it with a test.",
  fate,
  history: [],
});

const compliance = (
  id: string,
  fate: "open" | "unrecorded",
  message: string,
): FindingListFile["findings"][number] => ({
  id,
  source: "compliance-review",
  severity: "deviation",
  phaseId: "phase-02",
  dimension: "tests",
  message,
  fate,
  history: [],
});

const listOf = (findings: FindingListFile["findings"]): FindingListFile => ({
  $schema: currentSchemaUrl("finding-list"),
  run: { namespace: "ns", shortName: "gate-retry", runId: "gate-retry-1", state: "review_open" },
  records: "read",
  findings,
});

describe("renderFindingList", () => {
  it("prints the header with the state and the non-zero fate counts, then one aligned row per finding", () => {
    const text = renderFindingList(
      listOf([
        code("F1", "unrecorded", "src/a.ts", 12, "The flag is ignored."),
        code("F10", "open", "src/longer/b.ts", 4, "The error is swallowed."),
        compliance("C1", "open", "No test."),
      ]),
    );
    expect(text.split("\n")).toEqual([
      "gate-retry (review_open) — 3 findings: 2 open, 1 unrecorded",
      "",
      "F1   concern    unrecorded  src/a.ts:12        The flag is ignored.",
      "F10  concern    open        src/longer/b.ts:4  The error is swallowed.",
      "C1   deviation  open        phase-02 tests     No test.",
    ]);
  });

  it("orders the counts open, fixed, dismissed, deferred, unrecorded and leaves zero counts out", () => {
    const text = renderFindingList(
      listOf([
        code("F1", "unrecorded", "src/a.ts", 1, "one"),
        code("F2", "open", "src/a.ts", 2, "two"),
      ]),
    );
    expect(text.split("\n")[0]).toBe("gate-retry (review_open) — 2 findings: 1 open, 1 unrecorded");
  });

  it("keeps a multi-line message on its row", () => {
    const text = renderFindingList(listOf([compliance("C1", "open", "First line.\nSecond line.")]));
    expect(text.split("\n")).toHaveLength(3);
    expect(text).toContain("First line. Second line.");
  });

  it("names a single finding in the singular", () => {
    const text = renderFindingList(listOf([code("F1", "open", "src/a.ts", 3, "one")]));
    expect(text.split("\n")).toEqual([
      "gate-retry (review_open) — 1 finding: 1 open",
      "",
      "F1  concern  open  src/a.ts:3  one",
    ]);
  });

  it("adds detail lines under a fixed, dismissed and deferred finding, aligned to the fate column", () => {
    const by = { kind: "operator", name: "Ada" } as const;
    const at = "2026-11-01T10:00:00.000Z";
    const fix = (sha: string, pathClasses: readonly ["code"] | readonly ["code", "tests"]) =>
      ({ fate: "fixed", commit: sha.repeat(40), pathClasses, by, at }) as const;
    const fixed = {
      ...code("F1", "open", "src/a.ts", 1, "one"),
      fate: "fixed" as const,
      history: [fix("a", ["code"]), fix("b", ["code", "tests"])],
    };
    const dismissed = {
      ...code("F2", "open", "src/a.ts", 2, "two"),
      fate: "dismissed" as const,
      history: [
        {
          fate: "dismissed" as const,
          verdict: {
            kind: "decided" as const,
            chosen: "dismiss" as const,
            abandoned: ["fix", "defer"] as ["fix", "defer"],
            why: "Not worth it.",
            advocate: "Fix it.",
            principles: [] as [],
            reversibility: "cheap" as const,
            by,
            at,
            revised: [] as [],
          },
        },
      ],
    };
    const deferred = {
      ...code("F3", "open", "src/a.ts", 3, "three"),
      fate: "deferred" as const,
      history: [{ fate: "deferred" as const, to: "docs/next.md", why: "Later.", by, at }],
    };
    const lines = renderFindingList(
      listOf([fixed, dismissed, deferred, code("F4", "open", "src/a.ts", 4, "four")]),
    ).split("\n");
    expect(lines.slice(2)).toEqual([
      "F1  concern  fixed      src/a.ts:1  one",
      "             aaaaaaa (code)",
      "             bbbbbbb (code, tests)",
      "F2  concern  dismissed  src/a.ts:2  two",
      "             Ada: Not worth it.",
      "F3  concern  deferred   src/a.ts:3  three",
      "             → docs/next.md",
      "F4  concern  open       src/a.ts:4  four",
    ]);
  });

  it("says there is no finding for a run with none", () => {
    expect(renderFindingList(listOf([]))).toBe("gate-retry (review_open) — no findings");
  });
});
