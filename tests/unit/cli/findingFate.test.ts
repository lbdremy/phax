import { describe, expect, it } from "vitest";
import { renderFindingFix, type FindingFixOutput } from "../../../src/cli/definitions/finding.js";

const SHA = "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432";

const answer = (overrides: Partial<FindingFixOutput>): FindingFixOutput => ({
  run: { namespace: "phax", shortName: "gate-retry", runId: "run-1", state: "review_open" },
  commit: {
    sha: SHA,
    made: true,
    subject: "fix(review): F2, F5 of gate-retry",
    paths: [
      { path: "src/app/gate.ts", pathClass: "code" },
      { path: "tests/gate.test.ts", pathClass: "tests" },
    ],
  },
  recorded: [
    { finding: "F2", key: "run-1/finding/F2/01", recordCommit: "a".repeat(40) },
    { finding: "F5", key: "run-1/finding/F5/01", recordCommit: "b".repeat(40) },
  ],
  findings: [],
  ...overrides,
});

describe("renderFindingFix", () => {
  it("prints the commit, its paths with their classes, then one recorded line per finding", () => {
    expect(renderFindingFix(answer({})).split("\n")).toEqual([
      "✓ committed 9f8e7d6 fix(review): F2, F5 of gate-retry",
      "  paths: src/app/gate.ts (code), tests/gate.test.ts (tests)",
      "✓ recorded F2 fixed on phax/records/v1",
      "✓ recorded F5 fixed on phax/records/v1",
    ]);
  });

  it("names the commit and its classes on each recorded line when it was already there", () => {
    const backfilled = answer({
      commit: {
        sha: SHA,
        made: false,
        subject: null,
        paths: [
          { path: "tests/gate.test.ts", pathClass: "tests" },
          { path: "src/app/gate.ts", pathClass: "code" },
          { path: "docs/gates.md", pathClass: "docs" },
        ],
      },
      recorded: [{ finding: "F3", key: "run-1/finding/F3/01", recordCommit: "c".repeat(40) }],
    });
    expect(renderFindingFix(backfilled).split("\n")).toEqual([
      "✓ recorded F3 fixed by 9f8e7d6 (code, docs, tests) on phax/records/v1",
    ]);
  });
});
