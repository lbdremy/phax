import { describe, expect, it } from "vitest";
import {
  buildCodeReviewPrompt,
  buildCodeReviewPositionalPrompt,
  CODE_REVIEW_PROMPT_FILENAME,
} from "../../../src/domain/review/codeReviewPrompt.js";

const baseAttentionPoints = [
  { path: "src/foo.ts", status: "modified", phaseRef: "phase-01" },
  { path: "src/bar.ts", status: "added", phaseRef: "phase-02" },
];

const baseInput = {
  worktreePath: "/home/user/.phax/worktrees/my-run/phase-03",
  reconciliationMd: "## PHAX File Reconciliation\n\n### Planned to edit\n- [x] src/foo.ts",
  attentionPoints: baseAttentionPoints,
  complianceMissing: false,
};

describe("buildCodeReviewPrompt", () => {
  describe("without compliance block", () => {
    const inputNoCoverage = { ...baseInput, complianceMissing: true };

    it("lists each attention point path", () => {
      const prompt = buildCodeReviewPrompt(inputNoCoverage);
      expect(prompt).toContain("src/foo.ts");
      expect(prompt).toContain("src/bar.ts");
    });

    it("lists each attention point status", () => {
      const prompt = buildCodeReviewPrompt(inputNoCoverage);
      expect(prompt).toContain("modified");
      expect(prompt).toContain("added");
    });

    it("lists each attention point phaseRef", () => {
      const prompt = buildCodeReviewPrompt(inputNoCoverage);
      expect(prompt).toContain("phase-01");
      expect(prompt).toContain("phase-02");
    });

    it("includes the worktree path", () => {
      const prompt = buildCodeReviewPrompt(inputNoCoverage);
      expect(prompt).toContain(baseInput.worktreePath);
    });

    it("includes the 'run review-compliance first' note", () => {
      const prompt = buildCodeReviewPrompt(inputNoCoverage);
      expect(prompt).toContain("review-compliance");
    });

    it("frames the session as interactive and developer-driven", () => {
      const prompt = buildCodeReviewPrompt(inputNoCoverage);
      const lower = prompt.toLowerCase();
      expect(lower).toMatch(/interactive|developer/);
    });

    it("states it is NOT a gate", () => {
      const prompt = buildCodeReviewPrompt(inputNoCoverage);
      const lower = prompt.toLowerCase();
      expect(lower).toMatch(/not a gate|not an? gate/);
    });

    it("is deterministic for the same input", () => {
      const a = buildCodeReviewPrompt(inputNoCoverage);
      const b = buildCodeReviewPrompt(inputNoCoverage);
      expect(a).toBe(b);
    });
  });

  describe("with compliance block", () => {
    const compliance = {
      attentionPoints: ["Double-check the config merge logic"],
      pointers: ["Possible bug at src/app/loadConfig.ts:42 — confirm via code review"],
      deviationFindings: [
        {
          phaseId: "phase-01",
          dimension: "files",
          severity: "deviation",
          message: "src/extra.ts was created but not planned",
        },
      ],
    };

    const inputWithCompliance = { ...baseInput, compliance, complianceMissing: false };

    it("includes compliance attention points", () => {
      const prompt = buildCodeReviewPrompt(inputWithCompliance);
      expect(prompt).toContain("Double-check the config merge logic");
    });

    it("includes compliance pointers", () => {
      const prompt = buildCodeReviewPrompt(inputWithCompliance);
      expect(prompt).toContain("src/app/loadConfig.ts:42");
    });

    it("includes deviation findings with phaseId, dimension, severity, and message", () => {
      const prompt = buildCodeReviewPrompt(inputWithCompliance);
      expect(prompt).toContain("phase-01");
      expect(prompt).toContain("files");
      expect(prompt).toContain("deviation");
      expect(prompt).toContain("src/extra.ts was created but not planned");
    });

    it("omits the 'run review-compliance first' note when compliance is present", () => {
      const prompt = buildCodeReviewPrompt(inputWithCompliance);
      // Should not suggest running review-compliance when we already have compliance data
      expect(prompt).not.toMatch(/run.*review-compliance.*first/i);
    });

    it("includes worktree path", () => {
      const prompt = buildCodeReviewPrompt(inputWithCompliance);
      expect(prompt).toContain(baseInput.worktreePath);
    });

    it("is deterministic for the same input", () => {
      const a = buildCodeReviewPrompt(inputWithCompliance);
      const b = buildCodeReviewPrompt(inputWithCompliance);
      expect(a).toBe(b);
    });
  });

  describe("empty attention points", () => {
    it("handles an empty attentionPoints array without throwing", () => {
      const input = { ...baseInput, attentionPoints: [], complianceMissing: true };
      expect(() => buildCodeReviewPrompt(input)).not.toThrow();
    });
  });
});

describe("buildCodeReviewPositionalPrompt", () => {
  it("returns a non-empty string", () => {
    const result = buildCodeReviewPositionalPrompt("/some/path/code-review-prompt.md");
    expect(result.length).toBeGreaterThan(0);
  });

  it("includes the supplied file path", () => {
    const filePath =
      "/home/user/.phax/worktrees/my-run/phase-03/.phax-context/code-review-prompt.md";
    const result = buildCodeReviewPositionalPrompt(filePath);
    expect(result).toContain(filePath);
  });

  it("instructs the agent to read the file before starting", () => {
    const result = buildCodeReviewPositionalPrompt("/some/path.md");
    const lower = result.toLowerCase();
    expect(lower).toMatch(/read/);
  });
});

describe("CODE_REVIEW_PROMPT_FILENAME", () => {
  it("is code-review-prompt.md", () => {
    expect(CODE_REVIEW_PROMPT_FILENAME).toBe("code-review-prompt.md");
  });
});
