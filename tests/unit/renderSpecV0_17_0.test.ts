// Acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
import { describe, expect, it } from "vitest";
import { renderSpecBodyV0_17_0 } from "../../src/domain/authoring/renderSpecV0_17_0.js";
import type { SpecDocumentV0_17_0Value } from "../../src/schemas/persisted.js";

// A made-up spec in the 0.17.0 in-memory shape: no arbitratedQuestions.
const LOG_ROTATION: SpecDocumentV0_17_0Value = {
  kind: "spec",
  title: "Log rotation",
  ground: [{ path: "src/app/logs.ts", note: "where run logs are written" }],
  context: "Every run writes one log file.",
  problem: "The log directory grows without bound.",
  productGoal: {
    statement: "Bound the log directory.",
    guidingRule: "A log outlives its run only as long as it is useful.",
  },
  terminology: [{ term: "run log", definition: "the file a run writes its output to" }],
  requirements: [
    {
      id: "R-rotate",
      title: "Rotation",
      pattern: "event",
      statement: "WHEN a run ends THE system SHALL rotate its log.",
    },
  ],
  surface: [
    {
      surface: "config: `phax.json` `logs.keep`",
      binding: "indicative",
      before: '"logs": {}',
      after: '"logs": { "keep": 10 }',
    },
  ],
  nonGoals: [],
  acceptanceCriteria: [
    {
      id: "AC-1",
      name: "Old logs go",
      given: "eleven run logs",
      when: "a run ends",
      then: "ten remain",
      refs: ["R-rotate"],
    },
  ],
  openQuestions: [
    {
      id: "q-mode",
      question: "Logs: kept per run, or rotated daily?",
      options: [
        { id: "per-run", label: "Kept per run", abandons: "a bounded log directory" },
        { id: "daily", label: "Rotated daily", abandons: "one log per run to attach to a report" },
      ],
      recommendation: "per-run",
      rationale: "Decided by the author on 2026-09-28, a report names its run",
    },
    {
      id: "q-keep",
      question: "How many logs are kept?",
      options: [
        { id: "keep-10", label: "Ten", abandons: "older logs" },
        { id: "keep-20", label: "Twenty", abandons: "disk space" },
      ],
      recommendation: "keep-10",
      rationale: "ten covers a working week.",
    },
  ],
  planningNote: { settled: ["rotation at run end"], open: ["the default keep"], constraints: [] },
  docsPage: { kind: "none", why: "the config reference covers it" },
};

// Today's rendering, frozen: positional Q<n> headings, label-only bullets and
// a Recommendation line naming the recommended option's label.
const GOLDEN = `# Log rotation

## 1. Context

Every run writes one log file.

Ground read:

- \`src/app/logs.ts\` — where run logs are written

## 2. Problem

The log directory grows without bound.

## 3. Product goal

Bound the log directory.

> A log outlives its run only as long as it is useful.

## 4. Terminology

- **run log** — the file a run writes its output to

## 5. Functional requirements

### 5.1 Rotation

WHEN a run ends THE system SHALL rotate its log.

## 6. Surface

### config: \`phax.json\` \`logs.keep\` — indicative

before:

    "logs": {}

after:

    "logs": { "keep": 10 }

## 7. Non-goals

None.

## 8. Acceptance criteria

### Old logs go

Given eleven run logs, when a run ends, then ten remain. (refs §5.1)

## 9. Open questions for implementation planning

### Q1 — Logs: kept per run, or rotated daily?

- Kept per run — abandons: a bounded log directory
- Rotated daily — abandons: one log per run to attach to a report

Recommendation: Kept per run — Decided by the author on 2026-09-28, a report names its run.

### Q2 — How many logs are kept?

- Ten — abandons: older logs
- Twenty — abandons: disk space

Recommendation: Ten — ten covers a working week.

## 10. Implementation-planning note

Settled:

- rotation at run end

Left open:

- the default keep

Constraints: none.

## 11. Docs page

None — the config reference covers it
`;

describe("renderSpecBodyV0_17_0", () => {
  it("renders the 0.17.0 layout byte for byte", () => {
    expect(renderSpecBodyV0_17_0(LOG_ROTATION)).toBe(GOLDEN);
  });

  it("says None in §9 when there is no question", () => {
    expect(renderSpecBodyV0_17_0({ ...LOG_ROTATION, openQuestions: [] })).toContain(
      "## 9. Open questions for implementation planning\n\nNone.\n\n## 10.",
    );
  });
});
