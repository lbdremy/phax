import { describe, expect, it } from "vitest";
import {
  CODE_REVIEW_ESCAPES,
  CODE_REVIEW_LENSES,
  CODE_REVIEW_SEVERITIES,
} from "../../../src/schemas/codeReview.js";
import {
  buildHeadlessCodeReviewPrompt,
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
  attentionPoints: baseAttentionPoints,
  complianceMissing: false,
  doctrine: {
    source: "bundled" as const,
    text: "---\nname: phax-review\ndescription: How to review.\n---\n\n# phax review — how to review a run\n\nUse it before you read it.\n",
  },
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

describe("buildCodeReviewPrompt doctrine", () => {
  it("carries the review doctrine after the steps, named with its source", () => {
    const prompt = buildCodeReviewPrompt(baseInput);
    const steps = prompt.indexOf("## How to proceed");
    const doctrine = prompt.indexOf("## Review doctrine — `phax-review` (bundled)");
    expect(steps).toBeGreaterThan(-1);
    expect(doctrine).toBeGreaterThan(steps);
    expect(prompt.slice(doctrine)).toContain("Use it before you read it.");
  });

  it("drops the skill's frontmatter", () => {
    const prompt = buildCodeReviewPrompt(baseInput);
    expect(prompt).not.toContain("name: phax-review");
    expect(prompt).not.toContain("description: How to review.");
    expect(prompt).toContain("# phax review — how to review a run");
  });

  it("names a project copy as the doctrine's source", () => {
    const prompt = buildCodeReviewPrompt({
      ...baseInput,
      doctrine: { source: "project", text: "# Our review rules\n" },
    });
    expect(prompt).toContain("## Review doctrine — `phax-review` (project)");
    expect(prompt).toContain("# Our review rules");
  });

  it("asks for the surface pass first, then findings with their escape", () => {
    const prompt = buildCodeReviewPrompt(baseInput);
    expect(prompt).toContain("use the change before you read its code, then work outside-in");
    expect(prompt).toContain("each with its severity, lens, escape and suggestion");
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

describe("buildHeadlessCodeReviewPrompt", () => {
  const answerPath = "/wt/.phax-context/code-review.json";
  const compliance = {
    attentionPoints: ["watch the retry"],
    pointers: ["check the docs"],
    deviationFindings: [
      { phaseId: "phase-01", dimension: "scope", severity: "minor", message: "extra file" },
    ],
  };

  it("names the answer file and the shape with every key", () => {
    const prompt = buildHeadlessCodeReviewPrompt({ ...baseInput, answerPath });
    expect(prompt).toContain("# Headless code review");
    expect(prompt).toContain(answerPath);
    for (const key of [
      "severity",
      "file",
      "line",
      "message",
      "lens",
      "escape",
      "criterion",
      "suggestion",
    ]) {
      expect(prompt).toContain(`"${key}"`);
    }
    expect(prompt).toContain('{"version":1,"findings":[]}');
  });

  it("lists the closed ids of the contract", () => {
    const prompt = buildHeadlessCodeReviewPrompt({ ...baseInput, answerPath });
    for (const id of [...CODE_REVIEW_SEVERITIES, ...CODE_REVIEW_LENSES, ...CODE_REVIEW_ESCAPES]) {
      expect(prompt).toContain(`\`${id}\``);
    }
  });

  it("carries the flagged files, the compliance findings and the doctrine", () => {
    const prompt = buildHeadlessCodeReviewPrompt({ ...baseInput, compliance, answerPath });
    expect(prompt).toContain("src/foo.ts");
    expect(prompt).toContain("watch the retry");
    expect(prompt).toContain("extra file");
    expect(prompt).toContain("Review doctrine — `phax-review` (bundled)");
    expect(prompt).toContain("Use it before you read it.");
    expect(prompt).not.toContain("name: phax-review");
  });

  it("tells the session that no developer, fix or run exists", () => {
    const prompt = buildHeadlessCodeReviewPrompt({ ...baseInput, answerPath });
    expect(prompt).toContain("no developer is present");
    expect(prompt).toContain("In the session");
    expect(prompt).toContain("help text");
  });

  it("says plainly that compliance findings are missing, without the interactive tip", () => {
    const prompt = buildHeadlessCodeReviewPrompt({
      ...baseInput,
      complianceMissing: true,
      answerPath,
    });
    expect(prompt).toContain("No compliance findings are available");
    expect(prompt).not.toContain("review-compliance");
  });

  it("marks a project copy of the doctrine as such", () => {
    const prompt = buildHeadlessCodeReviewPrompt({
      ...baseInput,
      doctrine: { source: "project", text: "# Our own review rules\n" },
      answerPath,
    });
    expect(prompt).toContain("(project)");
    expect(prompt).toContain("Our own review rules");
  });
});
