import { describe, it, expect } from "vitest";
import { Either } from "effect";
import { finalizeExtractedPlan } from "../../src/domain/plan/finalize.js";
import type { ExtractedPhaxPlan } from "../../src/schemas/phaxPlan.js";
import { PlanValidationError } from "../../src/domain/errors.js";

function makeExtracted(overrides?: Partial<ExtractedPhaxPlan>): ExtractedPhaxPlan {
  return {
    version: 1,
    run: { shortName: "my-run", title: "My Run", requiredCommands: [] },
    phases: [
      {
        id: "phase-01",
        model: "claude-sonnet-4-6",
        effort: "low",
        planMarkdownAnchor: "#phase-01-alpha",
        plannedFilesToCreate: [],
        plannedFilesToEdit: [],
        optionalFilesToEdit: [],
        commit: { subject: "feat: phase-01", body: "body" },
      },
    ],
    ...overrides,
  };
}

const PLAN_MD_ONE_PHASE = [
  "# Plan — My Run",
  "",
  "## phase-01 — Alpha phase {#phase-01-alpha}",
  "",
  "Some content.",
].join("\n");

describe("finalizeExtractedPlan", () => {
  it("derives phase titles from headings", () => {
    const result = finalizeExtractedPlan(makeExtracted(), PLAN_MD_ONE_PHASE);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.plan.phases[0]!.title).toBe("Alpha phase");
    }
  });

  it("slugifies shortName and sets branch", () => {
    const extracted = makeExtracted({
      run: { shortName: "My Fancy Run!", title: "My Fancy Run", requiredCommands: [] },
    });
    const result = finalizeExtractedPlan(extracted, PLAN_MD_ONE_PHASE);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.plan.run.shortName).toBe("my-fancy-run");
      expect(result.right.plan.run.branch).toBe("phax/my-fancy-run");
    }
  });

  it("falls back to title slug when shortName cannot be slugified", () => {
    const extracted = makeExtracted({
      run: { shortName: "!!!", title: "fallback title", requiredCommands: [] },
    });
    const result = finalizeExtractedPlan(extracted, PLAN_MD_ONE_PHASE);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.plan.run.shortName).toBe("fallback-title");
      expect(result.right.plan.run.branch).toBe("phax/fallback-title");
    }
  });

  it("returns PlanValidationError when a phase has no matching heading", () => {
    const extracted = makeExtracted({
      phases: [
        {
          id: "phase-02",
          model: "claude-sonnet-4-6",
          effort: "low",
          planMarkdownAnchor: "#phase-02-missing",
          plannedFilesToCreate: [],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "feat: phase-02", body: "body" },
        },
      ],
    });
    const result = finalizeExtractedPlan(extracted, PLAN_MD_ONE_PHASE);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(PlanValidationError);
      expect(result.left.message).toContain("phase-02");
    }
  });

  it("detects phase anchors from headings", () => {
    const planMd = [
      "# Plan",
      "",
      "## phase-01 — Alpha {#phase-01-alpha}",
      "",
      "## phase-02 — Beta {#phase-02-beta}",
    ].join("\n");
    const extracted = makeExtracted({
      phases: [
        {
          id: "phase-01",
          model: "claude-sonnet-4-6",
          effort: "low",
          planMarkdownAnchor: "#phase-01-alpha",
          plannedFilesToCreate: [],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "feat: phase-01", body: "body" },
        },
        {
          id: "phase-02",
          model: "claude-sonnet-4-6",
          effort: "low",
          planMarkdownAnchor: "#phase-02-beta",
          plannedFilesToCreate: [],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "feat: phase-02", body: "body" },
        },
      ],
    });
    const result = finalizeExtractedPlan(extracted, planMd);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.detectedAnchors).toEqual(["phase-01", "phase-02"]);
      expect(result.right.warnings).toHaveLength(0);
    }
  });

  it("emits a warning when phase count differs from detected anchors", () => {
    const planMd = [
      "# Plan",
      "",
      "## phase-01 — Alpha {#phase-01-alpha}",
      "",
      "## phase-02 — Beta {#phase-02-beta}",
    ].join("\n");
    const extracted = makeExtracted({
      phases: [
        {
          id: "phase-01",
          model: "claude-sonnet-4-6",
          effort: "low",
          planMarkdownAnchor: "#phase-01-alpha",
          plannedFilesToCreate: [],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "feat: phase-01", body: "body" },
        },
      ],
    });
    const result = finalizeExtractedPlan(extracted, planMd);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.warnings.length).toBeGreaterThan(0);
      expect(result.right.warnings[0]).toContain("2 detected phase anchor");
    }
  });

  it("preserves titles with double quotes", () => {
    const planMd = [
      "# Plan",
      "",
      '## phase-01 — Guard "all I/O goes through a port" {#phase-01-quoted}',
    ].join("\n");
    const extracted = makeExtracted({
      phases: [
        {
          id: "phase-01",
          model: "claude-sonnet-4-6",
          effort: "low",
          planMarkdownAnchor: "#phase-01-quoted",
          plannedFilesToCreate: [],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "feat: phase-01", body: "body" },
        },
      ],
    });
    const result = finalizeExtractedPlan(extracted, planMd);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.plan.phases[0]!.title).toBe('Guard "all I/O goes through a port"');
    }
  });
});
