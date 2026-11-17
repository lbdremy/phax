import { describe, expect, it } from "vitest";
import {
  assignCodeReviewIds,
  assignComplianceReviewIds,
  numberRunFindings,
  type RunReview,
} from "../../../src/domain/findings/runFindings.js";
import type { CodeReview, PersistedCodeReview } from "../../../src/schemas/codeReview.js";
import type {
  AnyShapeComplianceReview,
  ComplianceReview,
  PersistedComplianceReview,
} from "../../../src/schemas/complianceReview.js";

const codeFinding = (message: string) => ({
  severity: "bug" as const,
  file: "src/example.ts",
  line: 1,
  message,
  lens: "edge" as const,
  escape: "omission" as const,
  criterion: null,
  suggestion: "Fix it.",
});

/** An answer of code findings, named by their messages. */
const answered = (...messages: string[]): CodeReview => ({
  findings: messages.map(codeFinding),
});

/** A persisted review whose findings carry the given ids. */
const persistedCode = (...ids: string[]): PersistedCodeReview => ({
  findings: ids.map((id) => ({ id, ...codeFinding(`finding ${id}`) })),
});

const complianceFinding = (message: string) => ({
  dimension: "files" as const,
  severity: "deviation" as const,
  message,
});

/** A compliance review whose phases hold the given finding messages, named by phase. */
const complianceOf = (phases: Record<string, readonly string[]>): ComplianceReview => ({
  verdict: "conformant-with-deviations",
  summary: "Summary.",
  perPhase: Object.entries(phases).map(([phaseId, messages]) => ({
    phaseId,
    verdict: "conformant-with-deviations" as const,
    findings: messages.map(complianceFinding),
  })),
  unplannedChanges: [],
  unmetPromises: [],
  attentionPoints: [],
  pointers: [],
});

const persistedCompliance = (
  phases: Record<string, readonly string[]>,
  ids: readonly string[],
): PersistedComplianceReview => {
  let next = 0;
  return {
    ...complianceOf({}),
    perPhase: Object.entries(phases).map(([phaseId, messages]) => ({
      phaseId,
      verdict: "conformant-with-deviations" as const,
      findings: messages.map((message) => ({
        id: ids[next++] ?? "C999",
        ...complianceFinding(message),
      })),
    })),
  };
};

const codeAbsent = (review: CodeReview): RunReview => ({
  source: "code-review",
  ids: "absent",
  review,
});
const codePersisted = (review: PersistedCodeReview): RunReview => ({
  source: "code-review",
  ids: "persisted",
  review,
});
const complianceAbsent = (review: AnyShapeComplianceReview): RunReview => ({
  source: "compliance-review",
  ids: "absent",
  review,
});
const compliancePersisted = (review: PersistedComplianceReview): RunReview => ({
  source: "compliance-review",
  ids: "persisted",
  review,
});

/** What a fold gave: each finding as `id/origin`, and the highest numbers. */
const summary = (reviews: readonly RunReview[]) => {
  const { findings, highest } = numberRunFindings(reviews);
  return { findings: findings.map((f) => `${f.id}/${f.origin}`), highest };
};

describe("numberRunFindings", () => {
  const table: ReadonlyArray<readonly [string, readonly RunReview[], ReturnType<typeof summary>]> =
    [
      ["no review", [], { findings: [], highest: { F: 0, C: 0 } }],
      [
        "an empty code review",
        [codePersisted({ findings: [] })],
        { findings: [], highest: { F: 0, C: 0 } },
      ],
      [
        "a persisted code review keeps its ids",
        [codePersisted(persistedCode("F1", "F2", "F3"))],
        { findings: ["F1/persisted", "F2/persisted", "F3/persisted"], highest: { F: 3, C: 0 } },
      ],
      [
        "an id-less code review is lifted by position",
        [codeAbsent(answered("a", "b", "c"))],
        { findings: ["F1/lifted", "F2/lifted", "F3/lifted"], highest: { F: 3, C: 0 } },
      ],
      [
        "two id-less code reviews lift F1-F3 then F4-F5",
        [codeAbsent(answered("a", "b", "c")), codeAbsent(answered("d", "e"))],
        {
          findings: ["F1/lifted", "F2/lifted", "F3/lifted", "F4/lifted", "F5/lifted"],
          highest: { F: 5, C: 0 },
        },
      ],
      [
        "a persisted code review after a lifted one",
        [codeAbsent(answered("a", "b")), codePersisted(persistedCode("F3", "F4"))],
        {
          findings: ["F1/lifted", "F2/lifted", "F3/persisted", "F4/persisted"],
          highest: { F: 4, C: 0 },
        },
      ],
      [
        "an id-less code review after a persisted one continues after its highest id",
        [codePersisted(persistedCode("F1", "F2")), codeAbsent(answered("a"))],
        { findings: ["F1/persisted", "F2/persisted", "F3/lifted"], highest: { F: 3, C: 0 } },
      ],
      [
        "a lifted review after a persisted one whose highest id is not its last",
        [codePersisted(persistedCode("F7", "F2")), codeAbsent(answered("a"))],
        { findings: ["F2/persisted", "F7/persisted", "F8/lifted"], highest: { F: 8, C: 0 } },
      ],
      [
        "compliance ids across perPhase in document order",
        [complianceAbsent(complianceOf({ "phase-01": ["a"], "phase-02": ["b", "c"] }))],
        { findings: ["C1/lifted", "C2/lifted", "C3/lifted"], highest: { F: 0, C: 3 } },
      ],
      [
        "a persisted compliance review keeps its ids",
        [
          compliancePersisted(
            persistedCompliance({ "phase-01": ["a"], "phase-02": ["b", "c"] }, ["C1", "C2", "C3"]),
          ),
        ],
        { findings: ["C1/persisted", "C2/persisted", "C3/persisted"], highest: { F: 0, C: 3 } },
      ],
      [
        "an id-less compliance review after a persisted one",
        [
          compliancePersisted(persistedCompliance({ "phase-01": ["a", "b"] }, ["C1", "C2"])),
          complianceAbsent(complianceOf({ "phase-01": ["c"], "phase-02": ["d"] })),
        ],
        {
          findings: ["C1/persisted", "C2/persisted", "C3/lifted", "C4/lifted"],
          highest: { F: 0, C: 4 },
        },
      ],
      [
        "a compliance review with no finding",
        [complianceAbsent(complianceOf({ "phase-01": [], "phase-02": [] }))],
        { findings: [], highest: { F: 0, C: 0 } },
      ],
      [
        "each kind is numbered on its own, and F comes before C",
        [
          complianceAbsent(complianceOf({ "phase-01": ["a", "b"] })),
          codeAbsent(answered("x", "y", "z")),
          compliancePersisted(persistedCompliance({ "phase-01": ["c"] }, ["C3"])),
        ],
        {
          findings: [
            "F1/lifted",
            "F2/lifted",
            "F3/lifted",
            "C1/lifted",
            "C2/lifted",
            "C3/persisted",
          ],
          highest: { F: 3, C: 3 },
        },
      ],
    ];

  it.each(table)("%s", (_name, reviews, expected) => {
    expect(summary(reviews)).toEqual(expected);
  });

  it("returns the fields of each finding beside its id, source and origin", () => {
    const { findings } = numberRunFindings([
      codeAbsent(answered("a")),
      complianceAbsent(complianceOf({ "phase-07": ["b"] })),
    ]);
    expect(findings).toEqual([
      { id: "F1", source: "code-review", origin: "lifted", ...codeFinding("a") },
      {
        id: "C1",
        source: "compliance-review",
        origin: "lifted",
        phaseId: "phase-07",
        dimension: "files",
        severity: "deviation",
        message: "b",
      },
    ]);
  });
});

describe("assignCodeReviewIds", () => {
  it("numbers the findings in answer order from after + 1, id first", () => {
    const review = assignCodeReviewIds(answered("a", "b"), 3);
    expect(review.findings.map((f) => f.id)).toEqual(["F4", "F5"]);
    expect(Object.keys(review.findings[0] ?? {})[0]).toBe("id");
    expect(review.findings.map((f) => f.message)).toEqual(["a", "b"]);
  });

  it("numbers an empty review as empty", () => {
    expect(assignCodeReviewIds(answered(), 9)).toEqual({ findings: [] });
  });
});

describe("assignComplianceReviewIds", () => {
  it("numbers the findings across perPhase in document order and keeps the rest of the review", () => {
    const answer = complianceOf({ "phase-01": ["a"], "phase-02": ["b", "c"], "phase-03": [] });
    const review = assignComplianceReviewIds(answer, 0);
    expect(review.perPhase.map((p) => p.findings.map((f) => f.id))).toEqual([
      ["C1"],
      ["C2", "C3"],
      [],
    ]);
    expect(review.perPhase.map((p) => p.phaseId)).toEqual(["phase-01", "phase-02", "phase-03"]);
    const { perPhase: _a, ...rest } = review;
    const { perPhase: _b, ...answerRest } = answer;
    expect(rest).toEqual(answerRest);
  });

  it("continues after the given number", () => {
    const review = assignComplianceReviewIds(complianceOf({ "phase-01": ["a", "b"] }), 5);
    expect(review.perPhase[0]?.findings.map((f) => f.id)).toEqual(["C6", "C7"]);
  });
});
