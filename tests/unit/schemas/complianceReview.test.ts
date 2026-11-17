import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  complianceReviewFileText,
  decodeComplianceReviewFile,
  readComplianceReviewAnswer,
  type ComplianceReview,
} from "../../../src/schemas/complianceReview.js";
import { assignComplianceReviewIds } from "../../../src/domain/findings/runFindings.js";
import { formatFirstViolation } from "../../../src/schemas/formatError.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

const CURRENT_URL = schemaUrl("compliance-review", CURRENT_STAMPS["compliance-review"]);
const ANSWER_URL = schemaUrl(
  "compliance-review-answer",
  CURRENT_STAMPS["compliance-review-answer"],
);

// The answer: `$schema` naming its own format, the review, both ledgers.
const validAnswer = {
  $schema: ANSWER_URL,
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
  if (Result.isSuccess(read)) throw new Error("expected a refusal");
  return read.failure;
}

describe("readComplianceReviewAnswer", () => {
  it("refuses a finding that carries an id, naming its path", () => {
    const text = refusal(
      withPhase([{ id: "C1", dimension: "objective", severity: "info", message: "x" }]),
    );
    expect(text).toContain("perPhase[0].findings[0].id");
    expect(text).toContain("unexpected");
  });

  it("refuses an answer stamped as the compliance-review file", () => {
    expect(refusal({ ...validAnswer, $schema: CURRENT_URL })).toContain("$schema");
  });

  it("accepts an answer and returns the review without $schema", () => {
    const read = readComplianceReviewAnswer(validAnswer);
    expect(Result.isSuccess(read)).toBe(true);
    if (Result.isSuccess(read)) {
      expect(read.success.verdict).toBe("conformant");
      expect(read.success).not.toHaveProperty("$schema");
      expect(read.success.perPhase[0]?.phaseId).toBe("phase-01");
      expect(read.success.unplannedChanges).toEqual([]);
      expect(read.success.unmetPromises).toEqual([]);
    }
  });

  it("keeps the entries of both ledgers", () => {
    const read = readComplianceReviewAnswer({
      ...validAnswer,
      unplannedChanges: [{ phaseId: "phase-01", path: "README.md", note: "Not in the plan" }],
      unmetPromises: [{ phaseId: "phase-01", promise: "A unit test", note: "None found" }],
    });
    expect(Result.isSuccess(read)).toBe(true);
    if (Result.isSuccess(read)) {
      expect(read.success.unplannedChanges).toEqual([
        { phaseId: "phase-01", path: "README.md", note: "Not in the plan" },
      ]);
      expect(read.success.unmetPromises).toEqual([
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
      expect(Result.isSuccess(readComplianceReviewAnswer({ ...validAnswer, verdict }))).toBe(true);
    }
  });

  it("refuses an invalid verdict, severity or dimension", () => {
    expect(Result.isFailure(readComplianceReviewAnswer({ ...validAnswer, verdict: "fine" }))).toBe(
      true,
    );
    expect(
      Result.isFailure(
        readComplianceReviewAnswer(
          withPhase([{ dimension: "objective", severity: "critical", message: "x" }]),
        ),
      ),
    ).toBe(true);
    expect(
      Result.isFailure(
        readComplianceReviewAnswer(
          withPhase([{ dimension: "style", severity: "info", message: "x" }]),
        ),
      ),
    ).toBe(true);
  });

  it("accepts every severity and every dimension", () => {
    for (const severity of ["info", "deviation", "concern"]) {
      expect(
        Result.isSuccess(
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
        Result.isSuccess(
          readComplianceReviewAnswer(withPhase([{ dimension, severity: "info", message: "x" }])),
        ),
      ).toBe(true);
    }
  });

  it("refuses an unknown key at the top, in a finding, in a perPhase entry and in a ledger entry", () => {
    expect(Result.isFailure(readComplianceReviewAnswer({ ...validAnswer, bogus: true }))).toBe(
      true,
    );
    expect(
      Result.isFailure(
        readComplianceReviewAnswer(
          withPhase([{ dimension: "objective", severity: "info", message: "x", extra: 1 }]),
        ),
      ),
    ).toBe(true);
    expect(
      Result.isFailure(
        readComplianceReviewAnswer({
          ...validAnswer,
          perPhase: [{ phaseId: "phase-01", verdict: "conformant", findings: [], extra: 1 }],
        }),
      ),
    ).toBe(true);
    expect(
      Result.isFailure(
        readComplianceReviewAnswer({
          ...validAnswer,
          unmetPromises: [{ phaseId: "phase-01", promise: "p", note: "n", extra: 1 }],
        }),
      ),
    ).toBe(true);
  });

  it("accepts an empty perPhase and several phases", () => {
    expect(Result.isSuccess(readComplianceReviewAnswer({ ...validAnswer, perPhase: [] }))).toBe(
      true,
    );
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
    expect(Result.isSuccess(several)).toBe(true);
    if (Result.isSuccess(several)) {
      expect(several.success.perPhase).toHaveLength(2);
      expect(several.success.attentionPoints).toHaveLength(1);
      expect(several.success.pointers).toHaveLength(1);
    }
  });
});

describe("decodeComplianceReviewFile", () => {
  // The file: the answer's review with an id on every finding.
  const validFile = {
    ...validAnswer,
    $schema: CURRENT_URL,
    perPhase: validAnswer.perPhase.map((phase) => ({
      ...phase,
      findings: phase.findings.map((finding, index) => ({ id: `C${index + 1}`, ...finding })),
    })),
  };

  it("accepts the file at its current stamp", () => {
    expect(Result.isSuccess(decodeComplianceReviewFile(validFile))).toBe(true);
  });

  it("refuses a finding without an id", () => {
    const withoutIds = { ...validAnswer, $schema: CURRENT_URL };
    expect(Result.isFailure(decodeComplianceReviewFile(withoutIds))).toBe(true);
  });

  it.each(["C0", "C01", "F1", "c1", "C", "C1a", ""])("refuses the finding id %j", (id) => {
    const [phase] = validFile.perPhase;
    const [finding] = phase?.findings ?? [];
    const file = { ...validFile, perPhase: [{ ...phase, findings: [{ ...finding, id }] }] };
    expect(Result.isFailure(decodeComplianceReviewFile(file))).toBe(true);
  });

  it("names the form a wrong id should have", () => {
    const [phase] = validFile.perPhase;
    const [finding] = phase?.findings ?? [];
    const refused = decodeComplianceReviewFile({
      ...validFile,
      perPhase: [{ ...phase, findings: [{ ...finding, id: "F1" }] }],
    });
    if (Result.isSuccess(refused)) throw new Error("expected a refusal");
    expect(formatFirstViolation(refused.failure)).toContain("C<n>");
  });

  it("refuses the 0.17.0 file: its stamp is not the format's current one", () => {
    const file = { ...validFile, $schema: schemaUrl("compliance-review", "0.17.0") };
    expect(Result.isFailure(decodeComplianceReviewFile(file))).toBe(true);
  });

  it("refuses a file that also carries version", () => {
    expect(Result.isFailure(decodeComplianceReviewFile({ ...validFile, version: 1 }))).toBe(true);
  });

  it("refuses a $schema naming another format, the answer's included", () => {
    const other = { ...validFile, $schema: schemaUrl("phax-plan", "0.32.0") };
    expect(Result.isFailure(decodeComplianceReviewFile(other))).toBe(true);
    expect(
      Result.isFailure(decodeComplianceReviewFile({ ...validFile, $schema: ANSWER_URL })),
    ).toBe(true);
  });
});

describe("complianceReviewFileText", () => {
  const { $schema: _schema, ...review } = validAnswer;
  const numbered = () => assignComplianceReviewIds(review as ComplianceReview, 0);

  it("starts with the $schema at the file's current stamp, indented by 2", () => {
    expect(
      complianceReviewFileText(numbered()).startsWith(
        `{\n  "$schema": "${CURRENT_URL}",\n  "verdict"`,
      ),
    ).toBe(true);
  });

  it("writes the finding ids and round-trips through the file decoder", () => {
    const written: unknown = JSON.parse(complianceReviewFileText(numbered()));
    expect(written).toMatchObject({
      $schema: CURRENT_URL,
      perPhase: [{ findings: [{ id: "C1" }] }],
    });
    expect(Result.isSuccess(decodeComplianceReviewFile(written))).toBe(true);
  });
});
