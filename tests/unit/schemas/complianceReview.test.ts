import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeComplianceReview } from "../../../src/schemas/complianceReview.js";

const validReview = {
  version: 1,
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
  attentionPoints: [],
  pointers: [],
};

describe("decodeComplianceReview", () => {
  it("accepts a well-formed review", () => {
    const result = decodeComplianceReview(validReview);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.verdict).toBe("conformant");
      expect(result.right.version).toBe(1);
      expect(result.right.perPhase).toHaveLength(1);
      expect(result.right.perPhase[0]?.phaseId).toBe("phase-01");
      expect(result.right.perPhase[0]?.findings[0]?.dimension).toBe("objective");
    }
  });

  it("accepts conformant-with-deviations verdict", () => {
    const result = decodeComplianceReview({
      ...validReview,
      verdict: "conformant-with-deviations",
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.verdict).toBe("conformant-with-deviations");
    }
  });

  it("accepts divergent verdict", () => {
    const result = decodeComplianceReview({ ...validReview, verdict: "divergent" });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.verdict).toBe("divergent");
    }
  });

  it("accepts all valid severity values", () => {
    for (const severity of ["info", "deviation", "concern"]) {
      const review = {
        ...validReview,
        perPhase: [
          {
            phaseId: "phase-01",
            verdict: "conformant",
            findings: [{ dimension: "objective", severity, message: "test" }],
          },
        ],
      };
      const result = decodeComplianceReview(review);
      expect(Either.isRight(result)).toBe(true);
    }
  });

  it("accepts all valid dimension values", () => {
    for (const dimension of [
      "objective",
      "excluded-scope",
      "files",
      "tests",
      "boundaries",
      "commit",
      "handoff",
    ]) {
      const review = {
        ...validReview,
        perPhase: [
          {
            phaseId: "phase-01",
            verdict: "conformant",
            findings: [{ dimension, severity: "info", message: "test" }],
          },
        ],
      };
      const result = decodeComplianceReview(review);
      expect(Either.isRight(result)).toBe(true);
    }
  });

  it("rejects an invalid verdict literal", () => {
    const result = decodeComplianceReview({ ...validReview, verdict: "invalid-verdict" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an invalid severity literal", () => {
    const review = {
      ...validReview,
      perPhase: [
        {
          phaseId: "phase-01",
          verdict: "conformant",
          findings: [{ dimension: "objective", severity: "critical", message: "test" }],
        },
      ],
    };
    const result = decodeComplianceReview(review);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an invalid dimension literal", () => {
    const review = {
      ...validReview,
      perPhase: [
        {
          phaseId: "phase-01",
          verdict: "conformant",
          findings: [{ dimension: "unknown-dim", severity: "info", message: "test" }],
        },
      ],
    };
    const result = decodeComplianceReview(review);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an unknown top-level key", () => {
    const result = decodeComplianceReview({ ...validReview, bogusField: true });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an unknown key inside a finding", () => {
    const review = {
      ...validReview,
      perPhase: [
        {
          phaseId: "phase-01",
          verdict: "conformant",
          findings: [{ dimension: "objective", severity: "info", message: "test", extra: "bad" }],
        },
      ],
    };
    const result = decodeComplianceReview(review);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an unknown key inside a perPhase entry", () => {
    const review = {
      ...validReview,
      perPhase: [{ phaseId: "phase-01", verdict: "conformant", findings: [], extra: "bad" }],
    };
    const result = decodeComplianceReview(review);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("accepts a review with empty perPhase, attentionPoints, and pointers", () => {
    const result = decodeComplianceReview({
      ...validReview,
      perPhase: [],
      attentionPoints: [],
      pointers: [],
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts a review with multiple phases and attention points", () => {
    const result = decodeComplianceReview({
      ...validReview,
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
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.perPhase).toHaveLength(2);
      expect(result.right.attentionPoints).toHaveLength(1);
      expect(result.right.pointers).toHaveLength(1);
    }
  });
});
