import { Result } from "effect";
import { describe, it, expect } from "vitest";
import { planCacheKey, EXTRACTOR_VERSION } from "../../src/domain/planCache/key.js";
import { decodeExtractedPlanCacheEntry } from "../../src/schemas/extractedPlanCacheEntry.js";

describe("planCacheKey", () => {
  it("returns a 64-character hex string", () => {
    const key = planCacheKey("# Plan", "claude-sonnet-4-6", "medium");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for the same inputs", () => {
    const a = planCacheKey("# Plan", "claude-sonnet-4-6", "medium");
    const b = planCacheKey("# Plan", "claude-sonnet-4-6", "medium");
    expect(a).toBe(b);
  });

  it("changes when planMd changes", () => {
    const a = planCacheKey("# Plan A", "claude-sonnet-4-6", "medium");
    const b = planCacheKey("# Plan B", "claude-sonnet-4-6", "medium");
    expect(a).not.toBe(b);
  });

  it("changes when model changes", () => {
    const a = planCacheKey("# Plan", "claude-sonnet-4-6", "medium");
    const b = planCacheKey("# Plan", "claude-haiku-4-5-20251001", "medium");
    expect(a).not.toBe(b);
  });

  it("changes when effort changes", () => {
    const a = planCacheKey("# Plan", "claude-sonnet-4-6", "medium");
    const b = planCacheKey("# Plan", "claude-sonnet-4-6", "high");
    expect(a).not.toBe(b);
  });

  it("changes when extractorVersion changes", () => {
    const a = planCacheKey("# Plan", "claude-sonnet-4-6", "medium", 1);
    const b = planCacheKey("# Plan", "claude-sonnet-4-6", "medium", 2);
    expect(a).not.toBe(b);
  });

  it("defaults to EXTRACTOR_VERSION", () => {
    const a = planCacheKey("# Plan", "claude-sonnet-4-6", "medium");
    const b = planCacheKey("# Plan", "claude-sonnet-4-6", "medium", EXTRACTOR_VERSION);
    expect(a).toBe(b);
  });

  it("EXTRACTOR_VERSION is 7", () => {
    expect(EXTRACTOR_VERSION).toBe(7);
  });

  // An extraction cached before the run carried its gate profile is a miss
  // twice over: its key was taken at extractor version 6, and its extracted
  // run holds no gateProfile, which the cache entry now requires.
  describe("an entry written before the run carried its gate profile", () => {
    const md = "# Plan\n\n## Gate profile\n\n`light`\n\n## Required commands\n\n- (none)\n";

    it("is keyed apart from the version 7 key", () => {
      expect(planCacheKey(md, "claude-sonnet-4-6", "medium", 6)).not.toBe(
        planCacheKey(md, "claude-sonnet-4-6", "medium"),
      );
    });

    it("fails to decode without run.gateProfile, and decodes with it", () => {
      const entry = (run: object) => ({
        version: 1,
        key: "k",
        planMdSha256: "s",
        model: "claude-sonnet-4-6",
        effort: "medium",
        extractorVersion: 6,
        extractedAt: "2026-01-01T00:00:00.000Z",
        extracted: {
          version: 1,
          run,
          phases: [
            {
              id: "phase-01",
              model: "claude-sonnet-4-6",
              effort: "medium",
              planMarkdownAnchor: "#phase-01",
              plannedFilesToCreate: [],
              plannedFilesToEdit: [],
              optionalFilesToEdit: [],
              mode: "headless",
              acceptance: null,
              testLines: [],
              commit: { subject: "feat: x", body: "Adds x." },
            },
          ],
        },
      });
      const run = { shortName: "r", title: "R", requiredCommands: [] };
      expect(Result.isFailure(decodeExtractedPlanCacheEntry(entry(run)))).toBe(true);
      expect(
        Result.isSuccess(decodeExtractedPlanCacheEntry(entry({ ...run, gateProfile: "light" }))),
      ).toBe(true);
    });
  });

  // An entry written before plan paths were canonical is a miss twice over: its
  // key was taken at extractor version 5, and its extracted plan may hold a
  // spelling the strict `PlanPath` refuses.
  describe("an entry written before plan paths were canonical", () => {
    it("is keyed apart from the version 6 key", () => {
      expect(planCacheKey("# Plan", "claude-sonnet-4-6", "medium", 5)).not.toBe(
        planCacheKey("# Plan", "claude-sonnet-4-6", "medium"),
      );
    });

    it("fails to decode when it holds ./src/x.ts", () => {
      const entry = (path: string) => ({
        version: 1,
        key: "k",
        planMdSha256: "s",
        model: "claude-sonnet-4-6",
        effort: "medium",
        extractorVersion: 5,
        extractedAt: "2026-01-01T00:00:00.000Z",
        extracted: {
          version: 1,
          // The run's gate profile is set so the plan path alone decides the decode.
          run: { shortName: "r", title: "R", requiredCommands: [], gateProfile: "standard" },
          phases: [
            {
              id: "phase-01",
              model: "claude-sonnet-4-6",
              effort: "medium",
              planMarkdownAnchor: "#phase-01",
              plannedFilesToCreate: [],
              plannedFilesToEdit: [path],
              optionalFilesToEdit: [],
              mode: "headless",
              acceptance: null,
              testLines: [],
              commit: { subject: "feat: x", body: "Adds x." },
            },
          ],
        },
      });
      expect(Result.isSuccess(decodeExtractedPlanCacheEntry(entry("src/x.ts")))).toBe(true);
      const refused = decodeExtractedPlanCacheEntry(entry("./src/x.ts"));
      expect(Result.isFailure(refused)).toBe(true);
    });
  });

  describe("keys on the body without its frontmatter", () => {
    const body = "\n# Plan\n\n## Required commands\n\n- (none)\n";
    const draft = `---\nstatus: Draft\nsource-spec: null\n---\n${body}`;
    const approved = `---\nstatus: Approved\nsource-spec: null\napproved:\n  date: 2026-09-23\n  baseline: abc1234\n---\n${body}`;

    it("same body under two different frontmatter blocks → same key", () => {
      expect(planCacheKey(draft, "claude-sonnet-4-6", "medium")).toBe(
        planCacheKey(approved, "claude-sonnet-4-6", "medium"),
      );
    });

    it("a frontmatter-bearing plan keys like its bare body", () => {
      expect(planCacheKey(draft, "claude-sonnet-4-6", "medium")).toBe(
        planCacheKey(body, "claude-sonnet-4-6", "medium"),
      );
    });

    it("a body edit under the same frontmatter → different key", () => {
      const edited = draft.replace("# Plan", "# Plan, edited");
      expect(planCacheKey(edited, "claude-sonnet-4-6", "medium")).not.toBe(
        planCacheKey(draft, "claude-sonnet-4-6", "medium"),
      );
    });

    it("a plan without a frontmatter block keys on its full text", () => {
      // An unterminated block is not frontmatter: the whole text is the body.
      const unterminated = "---\nstatus: Draft\n# Plan\n";
      expect(planCacheKey(unterminated, "claude-sonnet-4-6", "medium")).not.toBe(
        planCacheKey("# Plan\n", "claude-sonnet-4-6", "medium"),
      );
      expect(planCacheKey("# Plan A", "claude-sonnet-4-6", "medium")).not.toBe(
        planCacheKey("# Plan B", "claude-sonnet-4-6", "medium"),
      );
    });
  });
});
