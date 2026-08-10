import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { ArtifactValidationError } from "../../../src/domain/errors.js";
import {
  archivePathFor,
  classifyArtifactPath,
  readStatusLine,
  replaceStatusLine,
  validateArtifact,
} from "../../../src/domain/artifact/document.js";
import { decodePlanStatus, decodeSpecStatus } from "../../../src/schemas/artifactStatus.js";
import { PLAN_STATUSES, SPEC_STATUSES } from "../../../src/domain/artifact/status.js";

const SPEC_DOC = `# Some spec

Status: Approved

## Overview

Body text.
`;

const PLAN_DOC = `# Some plan

Status: Draft
Source-Spec: (none)

## Overview

Body text.
`;

describe("classifyArtifactPath", () => {
  it("classifies a live spec", () => {
    expect(classifyArtifactPath("docs/specs/21-foo.md")).toEqual({
      kind: "spec",
      inArchive: false,
    });
  });

  it("classifies an archived spec", () => {
    expect(classifyArtifactPath("docs/specs/archive/21-foo.md")).toEqual({
      kind: "spec",
      inArchive: true,
    });
  });

  it("classifies a live plan", () => {
    expect(classifyArtifactPath("docs/plans/21-foo-plan.md")).toEqual({
      kind: "plan",
      inArchive: false,
    });
  });

  it("classifies an archived plan", () => {
    expect(classifyArtifactPath("docs/plans/archive/21-foo-plan.md")).toEqual({
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
    expect(archivePathFor("docs/specs/21-foo.md")).toBe("docs/specs/archive/21-foo.md");
  });

  it("maps a live plan into the plan archive dir", () => {
    expect(archivePathFor("docs/plans/21-foo-plan.md")).toBe("docs/plans/archive/21-foo-plan.md");
  });
});

describe("readStatusLine", () => {
  it("finds the status line on line 3 of a spec-shaped doc", () => {
    expect(readStatusLine(SPEC_DOC)).toBe("Approved");
  });

  it("ignores a Status: line after the first H2", () => {
    const md = `# Doc

## Overview

Status: not-a-real-status
`;
    expect(readStatusLine(md)).toBeNull();
  });

  it("returns null when no status line exists", () => {
    expect(readStatusLine("# Doc\n\nNo status here.\n")).toBeNull();
  });
});

describe("replaceStatusLine", () => {
  it("replaces the value in place, round-tripping through readStatusLine", () => {
    const updated = replaceStatusLine(PLAN_DOC, "Approved");
    expect(readStatusLine(updated)).toBe("Approved");
    expect(updated).toContain("Status: Approved");
  });

  it("does not touch a Status: line after the first H2", () => {
    const md = `# Doc

Status: Draft

## Overview

Status: illustrative-example
`;
    const updated = replaceStatusLine(md, "Approved");
    expect(updated).toContain("Status: illustrative-example");
    expect(readStatusLine(updated)).toBe("Approved");
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
    const result = validateArtifact("docs/specs/21-foo.md", SPEC_DOC);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({ kind: "spec", status: "Approved" });
    }
  });

  it("rejects a non-artifact path", () => {
    assertLeftValidation(validateArtifact("README.md", SPEC_DOC));
  });

  it("rejects a missing status line", () => {
    assertLeftValidation(validateArtifact("docs/specs/21-foo.md", "# Doc\n\nNo status.\n"));
  });

  it("rejects an unknown status, naming the allowed set (spec Stale case)", () => {
    const md = `# Doc

Status: Stale

## Overview
`;
    const result = validateArtifact("docs/specs/21-foo.md", md);
    assertLeftValidation(result);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("Draft");
      expect(result.left.message).toContain("Approved");
      expect(result.left.message).toContain("Abandoned");
      expect(result.left.message).toContain("Archived");
    }
  });

  it("rejects a terminal status outside archive/ (disagreement)", () => {
    const md = `# Doc

Status: Archived

## Overview
`;
    assertLeftValidation(validateArtifact("docs/specs/21-foo.md", md));
  });

  it("rejects a non-terminal status inside archive/ (disagreement)", () => {
    const md = `# Doc

Status: Draft

## Overview
`;
    assertLeftValidation(validateArtifact("docs/specs/archive/21-foo.md", md));
  });

  it("accepts a terminal status inside archive/", () => {
    const md = `# Doc

Status: Archived

## Overview
`;
    const result = validateArtifact("docs/specs/archive/21-foo.md", md);
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects a live plan with no Source-Spec declaration", () => {
    const md = `# Doc

Status: Draft

## Overview
`;
    const result = validateArtifact("docs/plans/21-foo-plan.md", md);
    assertLeftValidation(result);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("Source-Spec");
    }
  });

  it("rejects an archived plan with no Source-Spec declaration", () => {
    const md = `# Doc

Status: Archived

## Overview
`;
    assertLeftValidation(validateArtifact("docs/plans/archive/21-foo-plan.md", md));
  });

  it("accepts a spec with no Source-Spec declaration", () => {
    const result = validateArtifact("docs/specs/21-foo.md", SPEC_DOC);
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts a plan with an explicit (none) Source-Spec declaration", () => {
    const md = `# Doc

Status: Draft
Source-Spec: (none)

## Overview
`;
    const result = validateArtifact("docs/plans/21-foo-plan.md", md);
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts a plan declaring a spec path", () => {
    const md = `# Doc

Status: Draft
Source-Spec: docs/specs/22-foo.md

## Overview
`;
    const result = validateArtifact("docs/plans/21-foo-plan.md", md);
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
