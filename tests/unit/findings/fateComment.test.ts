import { describe, expect, it } from "vitest";
import { renderFateComment } from "../../../src/domain/findings/fateComment.js";
import type { Landed } from "../../../src/domain/findings/landed.js";
import type { PrFinding } from "../../../src/domain/publish/prFindings.js";

const SHA = "abcdef0123456789abcdef0123456789abcdef01";
const NEW = "8b04d6e0123456789abcdef0123456789abcdef0";
const OTHER = "1234567890abcdef1234567890abcdef12345678";
const RUN = "gate-retry-1";
const at = "2026-01-01T00:00:00.000Z";
const operator = { kind: "operator", name: "Remy" } as const;

type Entry = PrFinding["history"][number];

const fixedIn = (pathClasses: Extract<Entry, { fate: "fixed" }>["pathClasses"]): Entry => ({
  fate: "fixed",
  commit: SHA,
  pathClasses,
  by: operator,
  at,
});
const fixed = fixedIn(["code", "tests"]);
const dismissed = (why: string): Entry => ({
  fate: "dismissed",
  verdict: {
    kind: "decided",
    chosen: "dismiss",
    abandoned: ["fix", "defer"],
    why,
    advocate: "fix it",
    principles: [],
    reversibility: "cheap",
    by: operator,
    at,
    revised: [],
  },
});
const deferred: Entry = {
  fate: "deferred",
  to: "docs/briefs/gate-retry-docs.md",
  why: "later",
  by: operator,
  at,
};

function codeFinding(
  fate: PrFinding["fate"],
  history: Entry[],
  landed: Landed | null = null,
  id = "F3",
): PrFinding {
  return {
    id,
    source: "code-review",
    severity: "bug",
    file: "src/a.ts",
    line: 12,
    message: "it breaks",
    lens: "surface",
    escape: "wrong-oracle",
    criterion: null,
    suggestion: "do it",
    fate,
    history,
    landed,
  };
}

describe("renderFateComment", () => {
  it("ac-comment: names the commit a fix was found as by key, its branch and the fate key", () => {
    const finding = codeFinding(
      "fixed",
      [fixedIn(["tests"])],
      { status: "found", by: "key", commit: NEW, branch: "main", recorded: SHA },
      "F2",
    );
    expect(renderFateComment(finding, "gate-retry-2026-11-18")?.split("\n")[1]).toBe(
      "Fixed by 8b04d6e on main (tests) · gate-retry-2026-11-18 F2",
    );
  });

  const head = "F3 fixed — `src/a.ts:12` — it breaks\n";
  it.each<[string, Landed | null, string]>([
    [
      "found by recorded sha",
      { status: "found", by: "recorded", commit: SHA, branch: "main", recorded: SHA },
      "Fixed by abcdef0 on main (code, tests) · gate-retry-1 F3",
    ],
    [
      "found by patch id on a remote-tracking branch",
      { status: "found", by: "patch-id", commit: NEW, branch: "origin/main", recorded: SHA },
      "Fixed by 8b04d6e on origin/main (code, tests) · gate-retry-1 F3",
    ],
    [
      "ambiguous",
      { status: "ambiguous", commits: [NEW, OTHER], branch: "main", recorded: SHA },
      "Fixed by abcdef0 (code, tests) · gate-retry-1 F3",
    ],
    [
      "not found",
      { status: "not-found", branches: ["main", "phax/x--phase-02"], recorded: SHA },
      "Fixed by abcdef0 (code, tests) · gate-retry-1 F3",
    ],
    ["unresolved (null)", null, "Fixed by abcdef0 (code, tests) · gate-retry-1 F3"],
  ])("names the fix of a finding %s", (_name, landed, second) => {
    expect(renderFateComment(codeFinding("fixed", [fixed], landed), RUN)).toBe(head + second);
  });

  it("answers the fix of a finding dismissed then fixed", () => {
    expect(renderFateComment(codeFinding("fixed", [dismissed("no"), fixed]), RUN)).toBe(
      "F3 fixed — `src/a.ts:12` — it breaks\nFixed by abcdef0 (code, tests) · gate-retry-1 F3",
    );
  });

  it("keeps a dismissal's reason on one line, without mentions", () => {
    expect(
      renderFateComment(codeFinding("dismissed", [dismissed("too\nsmall @octocat")]), RUN),
    ).toBe("F3 dismissed — `src/a.ts:12` — it breaks\nReason: too small `@octocat`");
  });

  it("names the document that takes a deferral over", () => {
    expect(renderFateComment(codeFinding("deferred", [deferred]), RUN)).toBe(
      "F3 deferred — `src/a.ts:12` — it breaks\nTaken over by `docs/briefs/gate-retry-docs.md`",
    );
  });

  it("writes a compliance finding's location in plain text", () => {
    const finding: PrFinding = {
      id: "C1",
      source: "compliance-review",
      severity: "concern",
      phaseId: "phase-02",
      dimension: "tests",
      message: "missing test",
      fate: "fixed",
      history: [fixed],
      landed: null,
    };
    expect(renderFateComment(finding, RUN)).toBe(
      "C1 fixed — phase-02 tests — missing test\nFixed by abcdef0 (code, tests) · gate-retry-1 C1",
    );
  });

  it("answers null for open and unrecorded findings, and for a mismatched history", () => {
    expect(renderFateComment(codeFinding("open", []), RUN)).toBeNull();
    expect(renderFateComment(codeFinding("unrecorded", []), RUN)).toBeNull();
    expect(renderFateComment(codeFinding("fixed", [deferred]), RUN)).toBeNull();
  });
});
