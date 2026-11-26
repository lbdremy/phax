import { describe, expect, it } from "vitest";
import { codeSpan, withoutMentions } from "../../../src/domain/publish/markdownSafe.js";
import {
  findingLocation,
  renderPrFindingsSection,
  splitPrFindings,
  type PrFinding,
} from "../../../src/domain/publish/prFindings.js";
import type { FindingFate } from "../../../src/schemas/findingList.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const at = "2026-01-01T00:00:00.000Z";
const operator = { kind: "operator", name: "Remy" } as const;

type History = PrFinding["history"];

const historyFor = (fate: FindingFate, to: string): History => {
  if (fate === "fixed") {
    return [{ fate: "fixed", commit: SHA, pathClasses: ["code"], by: operator, at }];
  }
  if (fate === "dismissed") {
    return [
      {
        fate: "dismissed",
        verdict: {
          kind: "decided",
          chosen: "dismiss",
          abandoned: ["fix", "defer"],
          why: "not worth it",
          advocate: "fix it",
          principles: [],
          reversibility: "cheap",
          by: operator,
          at,
          revised: [],
        },
      },
    ];
  }
  if (fate === "deferred") return [{ fate: "deferred", to, why: "later", by: operator, at }];
  return [];
};

function code(
  n: number,
  fate: FindingFate,
  over: { file?: string; message?: string; to?: string } = {},
): PrFinding {
  return {
    id: `F${n}`,
    source: "code-review",
    severity: "bug",
    file: over.file ?? `src/a${n}.ts`,
    line: n,
    message: over.message ?? `message ${n}`,
    lens: "surface",
    escape: "wrong-oracle",
    criterion: null,
    suggestion: "do it",
    fate,
    history: historyFor(fate, over.to ?? "docs/briefs/later.md"),
    landed: null,
  };
}

function compliance(n: number, fate: FindingFate): PrFinding {
  return {
    id: `C${n}`,
    source: "compliance-review",
    severity: "concern",
    phaseId: "phase-02",
    dimension: "tests",
    message: `compliance ${n}`,
    fate,
    history: historyFor(fate, "docs/briefs/later.md"),
    landed: null,
  };
}

const all = { open: 99, deferred: 99 };
const read = (findings: PrFinding[], records: "read" | "off" | "unavailable" = "read") =>
  ({ kind: "read", records, findings }) as const;

describe("renderPrFindingsSection", () => {
  const cases: ReadonlyArray<{
    name: string;
    input: Parameters<typeof renderPrFindingsSection>[0];
    keep?: { open: number; deferred: number };
    expected: string;
  }> = [
    {
      name: "the example: open, deferred, fixed and dismissed",
      input: read([
        code(4, "open"),
        code(5, "deferred", { to: "docs/briefs/gate-retry-docs.md" }),
        code(1, "fixed"),
        code(2, "fixed"),
        code(3, "dismissed"),
        compliance(1, "open"),
      ]),
      expected: [
        "## Review findings",
        "",
        "Open (2)",
        "- F4 bug — `src/a4.ts:4` — message 4",
        "- C1 concern — phase-02 tests — compliance 1",
        "",
        "Deferred (1)",
        "- F5 bug — `src/a5.ts:5` — message 5 → `docs/briefs/gate-retry-docs.md`",
        "",
        "Fixed: 2 · Dismissed: 1",
      ].join("\n"),
    },
    {
      name: "no finding",
      input: read([]),
      expected: "## Review findings\n\nNo findings.",
    },
    {
      name: "only fixed findings",
      input: read([code(1, "fixed"), code(2, "fixed")]),
      expected: "## Review findings\n\nFixed: 2 · Dismissed: 0",
    },
    {
      name: "an unrecorded finding",
      input: read([code(1, "unrecorded"), code(2, "fixed")]),
      expected: "## Review findings\n\nFixed: 1 · Dismissed: 0 · Unrecorded: 1",
    },
    {
      name: "records unavailable",
      input: read([code(1, "open")], "unavailable"),
      expected: [
        "## Review findings",
        "",
        "The fates could not be read from phax/records/v1, so every finding shows as open: `phax finding list demo` reads them again.",
        "",
        "Open (1)",
        "- F1 bug — `src/a1.ts:1` — message 1",
        "",
        "Fixed: 0 · Dismissed: 0",
      ].join("\n"),
    },
    {
      name: "unreadable",
      input: { kind: "unreadable", reason: "bad\nfile @octocat" },
      expected:
        "## Review findings\n\nThe findings could not be read (bad file `@octocat`): `phax finding list demo` names the cause.",
    },
    {
      name: "three open findings cut to one",
      input: read([code(1, "open"), code(2, "open"), code(3, "open")]),
      keep: { open: 1, deferred: 0 },
      expected: [
        "## Review findings",
        "",
        "Open (3)",
        "- F1 bug — `src/a1.ts:1` — message 1",
        "- …and 2 more open findings",
        "",
        "Fixed: 0 · Dismissed: 0",
      ].join("\n"),
    },
    {
      name: "one deferred finding cut to none",
      input: read([code(1, "deferred")]),
      keep: { open: 0, deferred: 0 },
      expected: [
        "## Review findings",
        "",
        "Deferred (1)",
        "- …and 1 more deferred finding",
        "",
        "Fixed: 0 · Dismissed: 0",
      ].join("\n"),
    },
    {
      name: "a message with a newline and a mention",
      input: read([code(1, "open", { message: "first\nsecond @octocat" })]),
      expected: [
        "## Review findings",
        "",
        "Open (1)",
        "- F1 bug — `src/a1.ts:1` — first second `@octocat`",
        "",
        "Fixed: 0 · Dismissed: 0",
      ].join("\n"),
    },
    {
      name: "a file path with a backtick",
      input: read([code(1, "open", { file: "src/we`ird.ts" })]),
      expected: [
        "## Review findings",
        "",
        "Open (1)",
        "- F1 bug — `` src/we`ird.ts:1 `` — message 1",
        "",
        "Fixed: 0 · Dismissed: 0",
      ].join("\n"),
    },
  ];

  it.each(cases)("$name", ({ input, keep, expected }) => {
    expect(renderPrFindingsSection(input, keep ?? all, "demo")).toBe(expected);
  });
});

describe("splitPrFindings and findingLocation", () => {
  it("splits by fate, keeping the given order", () => {
    const split = splitPrFindings([
      code(1, "open"),
      code(2, "fixed"),
      code(3, "dismissed"),
      code(4, "deferred"),
      code(5, "unrecorded"),
      compliance(1, "open"),
    ]);
    expect(split.open.map((f) => f.id)).toEqual(["F1", "C1"]);
    expect(split.deferred.map((f) => f.id)).toEqual(["F4"]);
    expect([split.fixed, split.dismissed, split.unrecorded]).toEqual([1, 1, 1]);
  });

  it("writes a code span for code review and plain text for compliance", () => {
    expect(findingLocation(code(3, "open"))).toBe("`src/a3.ts:3`");
    expect(findingLocation(compliance(1, "open"))).toBe("phase-02 tests");
  });
});

describe("markdownSafe", () => {
  it("fences a code span by the longest backtick run", () => {
    expect(codeSpan("a")).toBe("`a`");
    expect(codeSpan("a`b")).toBe("`` a`b ``");
    expect(codeSpan("a``b")).toBe("``` a``b ```");
  });

  it("renders mentions as code and leaves spans and emails alone", () => {
    expect(withoutMentions("hi @octocat and @org/team")).toBe("hi `@octocat` and `@org/team`");
    expect(withoutMentions("`@octocat` a@b.co")).toBe("`@octocat` a@b.co");
  });
});
