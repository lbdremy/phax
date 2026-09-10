import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { ArtifactValidationError } from "../../../src/domain/errors.js";
import {
  archivePathFor,
  classifyArtifactPath,
  validateArtifact,
} from "../../../src/domain/artifact/document.js";
import { decodePlanStatus, decodeSpecStatus } from "../../../src/schemas/artifactStatus.js";
import { PLAN_STATUSES, SPEC_STATUSES } from "../../../src/domain/artifact/status.js";

function specFm(status: string): string {
  return `---
status: ${status}
date: 2026-01-01
audience: test audience
scope: test scope
---
# Some spec

## Overview

Body text.
`;
}

function planFm(status: string, sourceSpec: string): string {
  return `---
status: ${status}
source-spec: ${sourceSpec}
---
# Some plan

## Overview

Body text.
`;
}

const SPEC_DOC = specFm("Approved");

describe("classifyArtifactPath", () => {
  it("classifies a live spec", () => {
    expect(classifyArtifactPath("docs/specs/2609101221-foo.md")).toEqual({
      kind: "spec",
      inArchive: false,
    });
  });

  it("classifies an archived spec", () => {
    expect(classifyArtifactPath("docs/specs/archive/2609101221-foo.md")).toEqual({
      kind: "spec",
      inArchive: true,
    });
  });

  it("classifies a live plan", () => {
    expect(classifyArtifactPath("docs/plans/2609101221-foo-plan.md")).toEqual({
      kind: "plan",
      inArchive: false,
    });
  });

  it("classifies an archived plan", () => {
    expect(classifyArtifactPath("docs/plans/archive/2609101221-foo-plan.md")).toEqual({
      kind: "plan",
      inArchive: true,
    });
  });

  it("returns null for a non-artifact path", () => {
    expect(classifyArtifactPath("src/domain/artifact/status.ts")).toBeNull();
    expect(classifyArtifactPath("README.md")).toBeNull();
  });
});

describe("archivePathFor", () => {
  it("maps a live spec into the spec archive dir", () => {
    expect(archivePathFor("docs/specs/2609101221-foo.md")).toBe(
      "docs/specs/archive/2609101221-foo.md",
    );
  });

  it("maps a live plan into the plan archive dir", () => {
    expect(archivePathFor("docs/plans/2609101221-foo-plan.md")).toBe(
      "docs/plans/archive/2609101221-foo-plan.md",
    );
  });
});

function assertLeftValidation(
  result: Either.Either<unknown, unknown>,
): asserts result is Either.Left<never, ArtifactValidationError> {
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isLeft(result)) {
    expect(result.left).toBeInstanceOf(ArtifactValidationError);
  }
}

describe("validateArtifact", () => {
  it("accepts a valid live spec", () => {
    const result = validateArtifact("docs/specs/2609101221-foo.md", SPEC_DOC);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({ kind: "spec", status: "Approved" });
    }
  });

  it("rejects a non-artifact path", () => {
    assertLeftValidation(validateArtifact("README.md", SPEC_DOC));
  });

  it("refuses an off-grammar spec name, naming the file and the grammar", () => {
    const result = validateArtifact("docs/specs/34-foo.md", SPEC_DOC);
    assertLeftValidation(result);
    if (Either.isLeft(result)) {
      expect(result.left.path).toBe("docs/specs/34-foo.md");
      expect(result.left.message).toBe(
        "docs/specs/34-foo.md: name does not match <YYMMDDHHMM>-<slug>.md",
      );
    }
  });

  it("refuses an off-grammar plan name with the plan grammar", () => {
    const result = validateArtifact(
      "docs/plans/archive/Plan_Prune.md",
      planFm("Completed", "null"),
    );
    assertLeftValidation(result);
    if (Either.isLeft(result)) {
      expect(result.left.message).toBe(
        "docs/plans/archive/Plan_Prune.md: name does not match <YYMMDDHHMM>-<slug>-plan.md",
      );
    }
  });

  it("refuses a spec-shaped name under docs/plans/ (missing -plan suffix)", () => {
    const result = validateArtifact("docs/plans/2609101221-foo.md", planFm("Draft", "null"));
    assertLeftValidation(result);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("<YYMMDDHHMM>-<slug>-plan.md");
    }
  });

  it("refuses a plan-shaped name under docs/specs/", () => {
    const result = validateArtifact("docs/specs/2609101221-foo-plan.md", SPEC_DOC);
    assertLeftValidation(result);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("<YYMMDDHHMM>-<slug>.md");
    }
  });

  it("checks the name before the frontmatter", () => {
    const result = validateArtifact("docs/specs/34-foo.md", "# Doc\n\nNo metadata.\n");
    assertLeftValidation(result);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("name does not match");
      expect(result.left.message).not.toContain("frontmatter");
    }
  });

  it("rejects a header-line-only artifact with the missing-block message", () => {
    const md = `# Some spec\n\nStatus: Approved\n\n## Overview\n`;
    const result = validateArtifact("docs/specs/2609101221-foo.md", md);
    assertLeftValidation(result);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("no frontmatter block");
    }
  });

  it("rejects a missing frontmatter block", () => {
    const result = validateArtifact("docs/specs/2609101221-foo.md", "# Doc\n\nNo metadata.\n");
    assertLeftValidation(result);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("no frontmatter block");
    }
  });

  it("rejects an unknown frontmatter key, naming the key and the allowed set", () => {
    const md = `---
status: Approved
date: 2026-01-01
audience: a
scope: s
staus: typo
---
# Doc

## Overview
`;
    const result = validateArtifact("docs/specs/2609101221-foo.md", md);
    assertLeftValidation(result);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("staus");
      expect(result.left.message).toContain("allowed for a spec: status, date, audience, scope");
    }
  });

  it("rejects an unknown status value for a spec, naming the allowed statuses", () => {
    const result = validateArtifact("docs/specs/2609101221-foo.md", specFm("Stale"));
    assertLeftValidation(result);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("Draft");
      expect(result.left.message).toContain("Approved");
      expect(result.left.message).toContain("Abandoned");
      expect(result.left.message).toContain("Completed");
    }
  });

  it("rejects a terminal status outside archive/ (disagreement)", () => {
    assertLeftValidation(validateArtifact("docs/specs/2609101221-foo.md", specFm("Completed")));
  });

  it("rejects a non-terminal status inside archive/ (disagreement)", () => {
    assertLeftValidation(validateArtifact("docs/specs/archive/2609101221-foo.md", specFm("Draft")));
  });

  it("accepts a terminal status inside archive/", () => {
    const result = validateArtifact("docs/specs/archive/2609101221-foo.md", specFm("Completed"));
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts a Stale plan under docs/plans/", () => {
    const result = validateArtifact("docs/plans/2609101221-foo-plan.md", planFm("Stale", "null"));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({ kind: "plan", status: "Stale" });
    }
  });

  it("rejects a live plan missing the source-spec key, naming it", () => {
    const md = `---
status: Draft
---
# Doc

## Overview
`;
    const result = validateArtifact("docs/plans/2609101221-foo-plan.md", md);
    assertLeftValidation(result);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("source-spec");
    }
  });

  it("rejects a completed plan missing the source-spec key", () => {
    const md = `---
status: Completed
---
# Doc

## Overview
`;
    assertLeftValidation(validateArtifact("docs/plans/archive/2609101221-foo-plan.md", md));
  });

  it("accepts a spec (which has no source-spec key)", () => {
    const result = validateArtifact("docs/specs/2609101221-foo.md", SPEC_DOC);
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts a plan with an explicit null source-spec", () => {
    const result = validateArtifact("docs/plans/2609101221-foo-plan.md", planFm("Draft", "null"));
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts a plan declaring a spec path", () => {
    const result = validateArtifact(
      "docs/plans/2609101221-foo-plan.md",
      planFm("Draft", "docs/specs/2609101222-foo.md"),
    );
    expect(Either.isRight(result)).toBe(true);
  });
});

describe("decodeSpecStatus / decodePlanStatus", () => {
  it("decodes every valid spec status", () => {
    for (const status of SPEC_STATUSES) {
      expect(Either.isRight(decodeSpecStatus(status))).toBe(true);
    }
  });

  it("rejects a status outside the spec set", () => {
    expect(Either.isLeft(decodeSpecStatus("Stale"))).toBe(true);
  });

  it("decodes every valid plan status", () => {
    for (const status of PLAN_STATUSES) {
      expect(Either.isRight(decodePlanStatus(status))).toBe(true);
    }
  });

  it("rejects a status outside the plan set", () => {
    expect(Either.isLeft(decodePlanStatus("running"))).toBe(true);
  });
});
