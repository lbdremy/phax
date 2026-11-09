import { Result } from "effect";
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

// `completes-spec` follows a spec path (true unless given) and is absent beside null.
function planFm(status: string, sourceSpec: string, completesSpec = "true"): string {
  const completes = sourceSpec === "null" ? "" : `completes-spec: ${completesSpec}\n`;
  return `---
status: ${status}
source-spec: ${sourceSpec}
${completes}---
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

  it("returns null for any path under an approvals/ directory", () => {
    expect(classifyArtifactPath("docs/plans/approvals/2609101221-foo-plan.json")).toBeNull();
    expect(classifyArtifactPath("docs/specs/approvals/2609101221-foo.json")).toBeNull();
    expect(classifyArtifactPath("docs/plans/approvals/2609101221-foo-plan.md")).toBeNull();
    expect(classifyArtifactPath("docs/specs/approvals/2609101221-foo.md")).toBeNull();
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
  result: Result.Result<unknown, unknown>,
): asserts result is Result.Failure<never, ArtifactValidationError> {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure).toBeInstanceOf(ArtifactValidationError);
  }
}

describe("validateArtifact", () => {
  it("accepts a valid live spec", () => {
    const result = validateArtifact("docs/specs/2609101221-foo.md", SPEC_DOC);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({ kind: "spec", status: "Approved" });
    }
  });

  it("rejects a non-artifact path", () => {
    assertLeftValidation(validateArtifact("README.md", SPEC_DOC));
  });

  it.each([
    "docs/specs/approvals/2609101221-foo.md",
    "docs/plans/approvals/2609101221-foo-plan.json",
  ])("refuses the record path %s as not a recognized artifact path", (path) => {
    const result = validateArtifact(path, SPEC_DOC);
    assertLeftValidation(result);
    expect(result.failure.message).toContain(`${path} is not a recognized artifact path`);
  });

  it("refuses an off-grammar spec name, naming the file and the grammar", () => {
    const result = validateArtifact("docs/specs/34-foo.md", SPEC_DOC);
    assertLeftValidation(result);
    if (Result.isFailure(result)) {
      expect(result.failure.path).toBe("docs/specs/34-foo.md");
      expect(result.failure.message).toBe(
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
    if (Result.isFailure(result)) {
      expect(result.failure.message).toBe(
        "docs/plans/archive/Plan_Prune.md: name does not match <YYMMDDHHMM>-<slug>-plan.md",
      );
    }
  });

  it("refuses a spec-shaped name under docs/plans/ (missing -plan suffix)", () => {
    const result = validateArtifact("docs/plans/2609101221-foo.md", planFm("Draft", "null"));
    assertLeftValidation(result);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain("<YYMMDDHHMM>-<slug>-plan.md");
    }
  });

  it("refuses a plan-shaped name under docs/specs/", () => {
    const result = validateArtifact("docs/specs/2609101221-foo-plan.md", SPEC_DOC);
    assertLeftValidation(result);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain("<YYMMDDHHMM>-<slug>.md");
    }
  });

  it("checks the name before the frontmatter", () => {
    const result = validateArtifact("docs/specs/34-foo.md", "# Doc\n\nNo metadata.\n");
    assertLeftValidation(result);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain("name does not match");
      expect(result.failure.message).not.toContain("frontmatter");
    }
  });

  it("rejects a header-line-only artifact with the missing-block message", () => {
    const md = `# Some spec\n\nStatus: Approved\n\n## Overview\n`;
    const result = validateArtifact("docs/specs/2609101221-foo.md", md);
    assertLeftValidation(result);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain("no frontmatter block");
    }
  });

  it("rejects a missing frontmatter block", () => {
    const result = validateArtifact("docs/specs/2609101221-foo.md", "# Doc\n\nNo metadata.\n");
    assertLeftValidation(result);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain("no frontmatter block");
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
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain("staus");
      expect(result.failure.message).toContain("allowed for a spec: status, date, audience, scope");
    }
  });

  it("rejects an unknown status value for a spec, naming the allowed statuses", () => {
    const result = validateArtifact("docs/specs/2609101221-foo.md", specFm("Stale"));
    assertLeftValidation(result);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain("Draft");
      expect(result.failure.message).toContain("Approved");
      expect(result.failure.message).toContain("Abandoned");
      expect(result.failure.message).toContain("Completed");
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
    expect(Result.isSuccess(result)).toBe(true);
  });

  it("accepts a Stale plan under docs/plans/", () => {
    const result = validateArtifact("docs/plans/2609101221-foo-plan.md", planFm("Stale", "null"));
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({ kind: "plan", status: "Stale" });
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
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain("source-spec");
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
    expect(Result.isSuccess(result)).toBe(true);
  });

  it("accepts a plan with an explicit null source-spec", () => {
    const result = validateArtifact("docs/plans/2609101221-foo-plan.md", planFm("Draft", "null"));
    expect(Result.isSuccess(result)).toBe(true);
  });

  it.each(["true", "false"])(
    "accepts a plan declaring a spec path with completes-spec: %s",
    (v) => {
      const result = validateArtifact(
        "docs/plans/2609101221-foo-plan.md",
        planFm("Draft", "docs/specs/2609101222-foo.md", v),
      );
      expect(Result.isSuccess(result)).toBe(true);
    },
  );

  const ALLOWED_PLAN_KEYS =
    "allowed for a plan: status, source-spec, completes-spec (required with a source spec, absent without), approved";

  it("rejects a plan declaring a spec path without completes-spec, naming it", () => {
    const md = `---\nstatus: Draft\nsource-spec: docs/specs/2609101222-foo.md\n---\n# Some plan\n`;
    const result = validateArtifact("docs/plans/2609101221-foo-plan.md", md);
    assertLeftValidation(result);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain(ALLOWED_PLAN_KEYS);
      expect(result.failure.message).toContain("completes-spec: is missing");
    }
  });

  it("rejects a non-boolean completes-spec, naming it", () => {
    const result = validateArtifact(
      "docs/plans/2609101221-foo-plan.md",
      planFm("Draft", "docs/specs/2609101222-foo.md", "yes"),
    );
    assertLeftValidation(result);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain(ALLOWED_PLAN_KEYS);
      expect(result.failure.message).toContain("completes-spec: must be true or false");
    }
  });

  it("rejects completes-spec beside source-spec: null, naming it as inconsistent", () => {
    const md = `---\nstatus: Draft\nsource-spec: null\ncompletes-spec: false\n---\n# Some plan\n`;
    const result = validateArtifact("docs/plans/2609101221-foo-plan.md", md);
    assertLeftValidation(result);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain(ALLOWED_PLAN_KEYS);
      expect(result.failure.message).toContain(
        "completes-spec: is inconsistent with source-spec: null",
      );
    }
  });
});

describe("decodeSpecStatus / decodePlanStatus", () => {
  it("decodes every valid spec status", () => {
    for (const status of SPEC_STATUSES) {
      expect(Result.isSuccess(decodeSpecStatus(status))).toBe(true);
    }
  });

  it("rejects a status outside the spec set", () => {
    expect(Result.isFailure(decodeSpecStatus("Stale"))).toBe(true);
  });

  it("decodes every valid plan status", () => {
    for (const status of PLAN_STATUSES) {
      expect(Result.isSuccess(decodePlanStatus(status))).toBe(true);
    }
  });

  it("rejects a status outside the plan set", () => {
    expect(Result.isFailure(decodePlanStatus("running"))).toBe(true);
  });
});
