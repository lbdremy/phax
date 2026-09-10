import { describe, expect, it } from "vitest";
import {
  artifactNameGrammar,
  buildArtifactName,
  formatStamp,
  isSlug,
  parseArtifactName,
  SLUG_PATTERN,
} from "../../../src/domain/artifact/name.js";

describe("SLUG_PATTERN / isSlug", () => {
  it("accepts a well-formed slug", () => {
    expect(isSlug("artifact-timestamp-naming")).toBe(true);
    expect(isSlug("plan-prune")).toBe(true);
    expect(isSlug("a1-b2")).toBe(true);
  });

  it("rejects the spec's refusal example", () => {
    expect(isSlug("Plan_Prune")).toBe(false);
  });

  it("rejects uppercase, underscores, double hyphens, and leading/trailing hyphens", () => {
    expect(isSlug("Foo")).toBe(false);
    expect(isSlug("foo_bar")).toBe(false);
    expect(isSlug("foo--bar")).toBe(false);
    expect(isSlug("-foo")).toBe(false);
    expect(isSlug("foo-")).toBe(false);
    expect(isSlug("")).toBe(false);
  });

  it("matches via SLUG_PATTERN directly", () => {
    expect(SLUG_PATTERN.test("foo-bar")).toBe(true);
  });
});

describe("formatStamp", () => {
  it("converts a non-UTC offset instant to its UTC minute", () => {
    expect(formatStamp("2026-09-09T14:12:40+02:00")).toBe("2609091212");
  });

  it("handles a midnight rollover across the UTC day boundary", () => {
    expect(formatStamp("2026-09-09T23:30:00-01:30")).toBe("2609100100");
  });

  it("zero-pads single-digit month, day, hour, and minute", () => {
    expect(formatStamp("2026-01-02T03:04:00Z")).toBe("2601020304");
  });
});

describe("buildArtifactName", () => {
  it("builds a spec name", () => {
    expect(buildArtifactName("spec", "2026-09-09T14:12:40Z", "artifact-timestamp-naming")).toBe(
      "2609091412-artifact-timestamp-naming.md",
    );
  });

  it("builds a plan name", () => {
    expect(buildArtifactName("plan", "2026-09-09T14:12:40Z", "artifact-timestamp-naming")).toBe(
      "2609091412-artifact-timestamp-naming-plan.md",
    );
  });
});

describe("parseArtifactName", () => {
  it("round-trips a built spec name", () => {
    const name = buildArtifactName("spec", "2026-09-09T14:12:40Z", "plan-prune");
    expect(parseArtifactName("spec", name)).toEqual({ stamp: "2609091412", slug: "plan-prune" });
  });

  it("round-trips a built plan name", () => {
    const name = buildArtifactName("plan", "2026-09-09T14:12:40Z", "plan-prune");
    expect(parseArtifactName("plan", name)).toEqual({ stamp: "2609091412", slug: "plan-prune" });
  });

  it("rejects a plan name given as a spec", () => {
    expect(parseArtifactName("spec", "2609091412-plan-prune-plan.md")).toBeNull();
  });

  it("rejects a spec name given as a plan", () => {
    expect(parseArtifactName("plan", "2609091412-plan-prune.md")).toBeNull();
  });

  it("rejects a wrong digit count", () => {
    expect(parseArtifactName("spec", "260909141-plan-prune.md")).toBeNull();
    expect(parseArtifactName("spec", "26090914123-plan-prune.md")).toBeNull();
  });

  it("rejects uppercase, underscores, double hyphens, and leading/trailing hyphens in the slug", () => {
    expect(parseArtifactName("spec", "2609091412-Plan-Prune.md")).toBeNull();
    expect(parseArtifactName("spec", "2609091412-plan_prune.md")).toBeNull();
    expect(parseArtifactName("spec", "2609091412-plan--prune.md")).toBeNull();
    expect(parseArtifactName("spec", "2609091412-.md")).toBeNull();
  });

  it("rejects a non-.md file", () => {
    expect(parseArtifactName("spec", "2609091412-plan-prune.txt")).toBeNull();
  });

  it("rejects a missing separator", () => {
    expect(parseArtifactName("spec", "2609091412.md")).toBeNull();
  });
});

describe("artifactNameGrammar", () => {
  it("describes the spec grammar", () => {
    expect(artifactNameGrammar("spec")).toBe("<YYMMDDHHMM>-<slug>.md");
  });

  it("describes the plan grammar", () => {
    expect(artifactNameGrammar("plan")).toBe("<YYMMDDHHMM>-<slug>-plan.md");
  });
});
