import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  type ParsedHandQuestions,
  parseHandAuthoredQuestions,
} from "../../../src/domain/artifact/questions.js";
import { writeHandDecisions } from "../../../src/domain/decide/handAuthored.js";
import { bindVerdicts, type VerdictsFile } from "../../../src/domain/decide/verdicts.js";
import type { HandDecisionAnswer } from "../../../src/schemas/handDecisionAnswer.js";
import { FILE_REVERSED, FILE_VALID, SPEC_FACTS, SPEC_PATH } from "./verdictsFixtures.js";

// What the oracles of verdicts mode's pure core leave unpinned: the order of a
// file, several re-arbitrated questions written in one pass, and an artifact
// path that leaves the repository. Every artifact here is made up.

function fileOf(text: string): VerdictsFile {
  const { artifact, verdicts } = JSON.parse(text) as VerdictsFile;
  return { artifact, verdicts };
}

function bind(file: VerdictsFile) {
  return bindVerdicts({
    file,
    artifactPath: SPEC_PATH,
    questions: SPEC_FACTS,
    label: "verdicts.json",
  });
}

describe("bindVerdicts: the order of the file", () => {
  it("gives the same result for the same verdicts in another order", () => {
    expect(bind(fileOf(FILE_REVERSED))).toEqual(bind(fileOf(FILE_VALID)));
  });
});

describe("bindVerdicts: an artifact key that leaves the repository", () => {
  const verdicts = [{ question: "q-keep", chosen: "keep-10", note: null }];

  it.each(["../outside.md", "docs/../../outside.md", "../../etc/passwd"])(
    "refuses %s as naming another artifact, quoting both paths",
    (artifact) => {
      const bound = bind({ artifact, verdicts });
      if (Either.isRight(bound)) throw new Error("expected a refusal");
      expect(bound.left).toContain(artifact);
      expect(bound.left).toContain(SPEC_PATH);
    },
  );

  it("accepts a path that normalizes to the artifact's", () => {
    const bound = bind({ artifact: "docs/specs/../specs/2610250900-log-rotation.md", verdicts });
    expect(Either.isRight(bound)).toBe(true);
  });
});

const TWO_ARBITRATED = [
  "---",
  "status: Draft",
  "---",
  "# Log format",
  "",
  "## 5. Requirements",
  "",
  "- 5.1 THE system SHALL write logs as text.",
  "",
  "## 9. Open questions",
  "",
  "None.",
  "",
  "## 9b. Arbitrated questions",
  "",
  "### Q3 — Format: text or JSON lines?",
  "",
  "- text — Plain text — abandons: structure",
  "- json — JSON lines — abandons: grep",
  "",
  "Recommendation: text — people read it",
  "",
  "Decision: text — lifted, unattributed, 2026-09-28",
  "",
  "### Q4 — Naming: by date or by run?",
  "",
  "- by-date — By date — abandons: a name that tells the run apart",
  "- by-run — By run — abandons: a name that sorts by date",
  "",
  "Recommendation: by-date — dates sort",
  "",
  "Decision: by-date — lifted, unattributed, 2026-09-29",
  "",
  "## 10. Implementation-planning note",
  "",
  "Settled: none.",
  "",
  "## 12. Decision log",
  "",
  "- 2026-09-28 Q3 lifted text — unattributed",
  "- 2026-09-29 Q4 lifted by-date — unattributed",
  "",
].join("\n");

function verdict(chosen: string, abandoned: readonly string[]) {
  return {
    kind: "decided" as const,
    chosen,
    abandoned,
    why: "Support asks for it.",
    advocate: "The abandoned option is simpler.",
    principles: ["S1"],
    reversibility: "cheap" as const,
    by: { kind: "operator" as const, name: "Ada Lovelace" },
    at: "2026-10-25T09:30:00.000Z",
    revised: ["## 5. Requirements"],
  };
}

describe("writeHandDecisions: several re-arbitrated questions", () => {
  it("rewrites each in place, keeping its earlier decision", () => {
    const parsed: ParsedHandQuestions = (() => {
      const result = parseHandAuthoredQuestions("spec", TWO_ARBITRATED);
      if (result.kind !== "parsed") throw new Error("the fixture does not parse");
      return result;
    })();
    const answer: HandDecisionAnswer = {
      kind: "spec",
      decisions: [
        { id: "Q3", verdict: verdict("json", ["text"]) },
        { id: "Q4", verdict: verdict("by-run", ["by-date"]) },
      ],
      markdown: TWO_ARBITRATED,
    } as HandDecisionAnswer;
    const written = writeHandDecisions({
      kind: "spec",
      md: TWO_ARBITRATED,
      answer,
      parsed,
      reArbitrated: ["Q3", "Q4"],
    });
    if (Either.isLeft(written)) throw new Error(written.left);
    const lines = written.right.split("\n");

    expect(lines).toContain("Decision: json — by operator (Ada Lovelace), 2026-10-25");
    expect(lines).toContain("Decision: by-run — by operator (Ada Lovelace), 2026-10-25");
    expect(lines).toContain("Earlier decision: text — lifted, unattributed, 2026-09-28");
    expect(lines).toContain("Earlier decision: by-date — lifted, unattributed, 2026-09-29");
    expect(lines).not.toContain("Decision: text — lifted, unattributed, 2026-09-28");
    expect(lines).not.toContain("Decision: by-date — lifted, unattributed, 2026-09-29");

    const reparsed = parseHandAuthoredQuestions("spec", written.right);
    if (reparsed.kind !== "parsed") throw new Error("the written Markdown does not parse");
    expect(reparsed.arbitrated.map((q) => [q.id, q.chosen])).toEqual([
      ["Q3", "json"],
      ["Q4", "by-run"],
    ]);

    const log = lines.slice(lines.indexOf("## 12. Decision log"));
    expect(log.filter((line) => /\bQ[34] decided\b/.test(line))).toHaveLength(2);
  });
});
