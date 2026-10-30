import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  complianceReviewFileText,
  decodeComplianceReviewFile,
  readComplianceReviewAnswer,
} from "../../../src/schemas/complianceReview.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

const CURRENT_URL = "https://docs.phax.run/schemas/compliance-review/0.32.0.json";

// The answer is the file's own shape: `$schema`, the review, both ledgers.
const validAnswer = {
  $schema: CURRENT_URL,
  verdict: "conformant",
  summary: "All phases conformed to the plan.",
  perPhase: [
    {
      phaseId: "phase-01",
      verdict: "conformant",
      findings: [
        {
          dimension: "objective",
          severity: "info",
          message: "Phase objective delivered as specified.",
        },
      ],
    },
  ],
  unplannedChanges: [],
  unmetPromises: [],
  attentionPoints: [],
  pointers: [],
};

function withPhase(findings: unknown[]) {
  return { ...validAnswer, perPhase: [{ phaseId: "phase-01", verdict: "conformant", findings }] };
}

function refusal(answer: unknown): string {
  const read = readComplianceReviewAnswer(answer);
  if (Either.isRight(read)) throw new Error("expected a refusal");
  return read.left;
}

describe("readComplianceReviewAnswer", () => {
  it("accepts a 0.32.0 answer and returns the review without $schema", () => {
    const read = readComplianceReviewAnswer(validAnswer);
    expect(Either.isRight(read)).toBe(true);
    if (Either.isRight(read)) {
      expect(read.right.verdict).toBe("conformant");
      expect(read.right).not.toHaveProperty("$schema");
      expect(read.right.perPhase[0]?.phaseId).toBe("phase-01");
      expect(read.right.unplannedChanges).toEqual([]);
      expect(read.right.unmetPromises).toEqual([]);
    }
  });

  it("keeps the entries of both ledgers", () => {
    const read = readComplianceReviewAnswer({
      ...validAnswer,
      unplannedChanges: [{ phaseId: "phase-01", path: "README.md", note: "Not in the plan" }],
      unmetPromises: [{ phaseId: "phase-01", promise: "A unit test", note: "None found" }],
    });
    expect(Either.isRight(read)).toBe(true);
    if (Either.isRight(read)) {
      expect(read.right.unplannedChanges).toEqual([
        { phaseId: "phase-01", path: "README.md", note: "Not in the plan" },
      ]);
      expect(read.right.unmetPromises).toEqual([
        { phaseId: "phase-01", promise: "A unit test", note: "None found" },
      ]);
    }
  });

  it("refuses an answer without unmetPromises, naming the key", () => {
    const { unmetPromises: _gone, ...answer } = validAnswer;
    expect(refusal(answer)).toContain("unmetPromises");
  });

  it("refuses an answer without unplannedChanges, naming the key", () => {
    const { unplannedChanges: _gone, ...answer } = validAnswer;
    expect(refusal(answer)).toContain("unplannedChanges");
  });

  it("refuses the agent's old shape, naming the missing $schema and the unexpected version", () => {
    const { $schema: _schema, ...rest } = validAnswer;
    const text = refusal({ version: 1, ...rest });
    expect(text).toContain("$schema");
    expect(text).toContain("version");
  });

  it("refuses a $schema naming an older stamp of the format", () => {
    expect(
      refusal({ ...validAnswer, $schema: schemaUrl("compliance-review", "0.17.0") }),
    ).toContain("$schema");
  });

  it("refuses a ledger entry with an empty field, naming it", () => {
    expect(
      refusal({
        ...validAnswer,
        unplannedChanges: [{ phaseId: "phase-01", path: "", note: "x" }],
      }),
    ).toContain("path");
  });

  it("refuses an empty phase id", () => {
    expect(
      refusal({ ...validAnswer, perPhase: [{ phaseId: "", verdict: "conformant", findings: [] }] }),
    ).toContain("phaseId");
  });

  it("accepts all three verdicts", () => {
    for (const verdict of ["conformant", "conformant-with-deviations", "divergent"]) {
      expect(Either.isRight(readComplianceReviewAnswer({ ...validAnswer, verdict }))).toBe(true);
    }
  });

  it("refuses an invalid verdict, severity or dimension", () => {
    expect(Either.isLeft(readComplianceReviewAnswer({ ...validAnswer, verdict: "fine" }))).toBe(
      true,
    );
    expect(
      Either.isLeft(
        readComplianceReviewAnswer(
          withPhase([{ dimension: "objective", severity: "critical", message: "x" }]),
        ),
      ),
    ).toBe(true);
    expect(
      Either.isLeft(
        readComplianceReviewAnswer(
          withPhase([{ dimension: "style", severity: "info", message: "x" }]),
        ),
      ),
    ).toBe(true);
  });

  it("accepts every severity and every dimension", () => {
    for (const severity of ["info", "deviation", "concern"]) {
      expect(
        Either.isRight(
          readComplianceReviewAnswer(
            withPhase([{ dimension: "objective", severity, message: "x" }]),
          ),
        ),
      ).toBe(true);
    }
    for (const dimension of [
      "objective",
      "excluded-scope",
      "files",
      "tests",
      "boundaries",
      "commit",
      "handoff",
    ]) {
      expect(
        Either.isRight(
          readComplianceReviewAnswer(withPhase([{ dimension, severity: "info", message: "x" }])),
        ),
      ).toBe(true);
    }
  });

  it("refuses an unknown key at the top, in a finding, in a perPhase entry and in a ledger entry", () => {
    expect(Either.isLeft(readComplianceReviewAnswer({ ...validAnswer, bogus: true }))).toBe(true);
    expect(
      Either.isLeft(
        readComplianceReviewAnswer(
          withPhase([{ dimension: "objective", severity: "info", message: "x", extra: 1 }]),
        ),
      ),
    ).toBe(true);
    expect(
      Either.isLeft(
        readComplianceReviewAnswer({
          ...validAnswer,
          perPhase: [{ phaseId: "phase-01", verdict: "conformant", findings: [], extra: 1 }],
        }),
      ),
    ).toBe(true);
    expect(
      Either.isLeft(
        readComplianceReviewAnswer({
          ...validAnswer,
          unmetPromises: [{ phaseId: "phase-01", promise: "p", note: "n", extra: 1 }],
        }),
      ),
    ).toBe(true);
  });

  it("accepts an empty perPhase and several phases", () => {
    expect(Either.isRight(readComplianceReviewAnswer({ ...validAnswer, perPhase: [] }))).toBe(true);
    const several = readComplianceReviewAnswer({
      ...validAnswer,
      perPhase: [
        { phaseId: "phase-01", verdict: "conformant", findings: [] },
        {
          phaseId: "phase-02",
          verdict: "conformant-with-deviations",
          findings: [{ dimension: "files", severity: "deviation", message: "Extra file added" }],
        },
      ],
      attentionPoints: ["Review phase-02 extra file"],
      pointers: ["Possible bug at src/foo.ts — confirm via code review"],
    });
    expect(Either.isRight(several)).toBe(true);
    if (Either.isRight(several)) {
      expect(several.right.perPhase).toHaveLength(2);
      expect(several.right.attentionPoints).toHaveLength(1);
      expect(several.right.pointers).toHaveLength(1);
    }
  });
});

describe("decodeComplianceReviewFile", () => {
  it("accepts the 0.32.0 file", () => {
    expect(Either.isRight(decodeComplianceReviewFile(validAnswer))).toBe(true);
  });

  it("refuses the 0.17.0 file: its stamp is not the format's current one", () => {
    const file = { ...validAnswer, $schema: schemaUrl("compliance-review", "0.17.0") };
    expect(Either.isLeft(decodeComplianceReviewFile(file))).toBe(true);
  });

  it("refuses a file that also carries version", () => {
    expect(Either.isLeft(decodeComplianceReviewFile({ ...validAnswer, version: 1 }))).toBe(true);
  });

  it("refuses a $schema naming another format", () => {
    const other = { ...validAnswer, $schema: schemaUrl("phax-plan", "0.32.0") };
    expect(Either.isLeft(decodeComplianceReviewFile(other))).toBe(true);
  });
});

describe("complianceReviewFileText", () => {
  const { $schema: _schema, ...review } = validAnswer;

  it("starts with the $schema at the 0.32.0 stamp, indented by 2", () => {
    const text = complianceReviewFileText(review as Parameters<typeof complianceReviewFileText>[0]);
    expect(text.startsWith(`{\n  "$schema": "${CURRENT_URL}",\n  "verdict"`)).toBe(true);
  });

  it("round-trips through the file decoder", () => {
    const text = complianceReviewFileText(review as Parameters<typeof complianceReviewFileText>[0]);
    expect(JSON.parse(text)).toEqual(validAnswer);
  });
});
