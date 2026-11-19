import { describe, expect, it } from "vitest";
import { renderFateComment } from "../../../src/domain/findings/fateComment.js";
import type { PrFinding } from "../../../src/domain/publish/prFindings.js";

const SHA = "abcdef0123456789abcdef0123456789abcdef01";
const at = "2026-01-01T00:00:00.000Z";
const operator = { kind: "operator", name: "Remy" } as const;

type Entry = PrFinding["history"][number];

const fixed: Entry = {
  fate: "fixed",
  commit: SHA,
  pathClasses: ["code", "tests"],
  by: operator,
  at,
};
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

function codeFinding(fate: PrFinding["fate"], history: Entry[]): PrFinding {
  return {
    id: "F3",
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
  };
}

describe("renderFateComment", () => {
  it("names the 7-character sha and the classes of a fix", () => {
    expect(renderFateComment(codeFinding("fixed", [fixed]))).toBe(
      "F3 fixed — `src/a.ts:12` — it breaks\nFixed by abcdef0 (code, tests)",
    );
  });

  it("answers the fix of a finding dismissed then fixed", () => {
    expect(renderFateComment(codeFinding("fixed", [dismissed("no"), fixed]))).toBe(
      "F3 fixed — `src/a.ts:12` — it breaks\nFixed by abcdef0 (code, tests)",
    );
  });

  it("keeps a dismissal's reason on one line, without mentions", () => {
    expect(renderFateComment(codeFinding("dismissed", [dismissed("too\nsmall @octocat")]))).toBe(
      "F3 dismissed — `src/a.ts:12` — it breaks\nReason: too small `@octocat`",
    );
  });

  it("names the document that takes a deferral over", () => {
    expect(renderFateComment(codeFinding("deferred", [deferred]))).toBe(
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
    };
    expect(renderFateComment(finding)).toBe(
      "C1 fixed — phase-02 tests — missing test\nFixed by abcdef0 (code, tests)",
    );
  });

  it("answers null for open and unrecorded findings, and for a mismatched history", () => {
    expect(renderFateComment(codeFinding("open", []))).toBeNull();
    expect(renderFateComment(codeFinding("unrecorded", []))).toBeNull();
    expect(renderFateComment(codeFinding("fixed", [deferred]))).toBeNull();
  });
});
