import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  checkPlanRunnable,
  inspectArtifact,
  transitionArtifact,
} from "../../src/app/artifactStatus.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import {
  ArtifactValidationError,
  InvalidArtifactTransitionError,
} from "../../src/domain/errors.js";

const DRAFT_SPEC = `# Some spec

Status: Draft

## Overview

Body text.
`;

const APPROVED_SPEC = `# Some spec

Status: Approved

## Overview

Body text.
`;

const APPROVED_PLAN = `# Some plan

Status: Approved

## Overview

Body text.
`;

const NO_STATUS_PLAN = `# Some plan

## Overview

Body text.
`;

function run<A, E>(effect: Effect.Effect<A, E, never>) {
  return Effect.runPromise(Effect.either(effect));
}

describe("inspectArtifact", () => {
  it("reports kind, status, and legal targets for an Approved plan", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile("docs/plans/21-foo-plan.md", APPROVED_PLAN);

    const result = await run(
      inspectArtifact("docs/plans/21-foo-plan.md").pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        kind: "plan",
        status: "Approved",
        legalTargets: ["Approved", "Stale", "Abandoned", "Archived"],
      });
    }
  });

  it("surfaces ArtifactValidationError for a missing status line", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile("docs/plans/21-foo-plan.md", NO_STATUS_PLAN);

    const result = await run(
      inspectArtifact("docs/plans/21-foo-plan.md").pipe(Effect.provide(layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactValidationError);
    }
  });
});

describe("transitionArtifact", () => {
  it("approve rewrites a Draft spec's status line in place", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile("docs/specs/21-foo.md", DRAFT_SPEC);

    const result = await run(
      transitionArtifact("docs/specs/21-foo.md", "Approved").pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({ status: "Approved", path: "docs/specs/21-foo.md" });
    }
    expect(impl.getFile("docs/specs/21-foo.md")).toContain("Status: Approved");
  });

  it("archive relocates an Approved spec under archive/ and removes the original", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile("docs/specs/21-foo.md", APPROVED_SPEC);

    const result = await run(
      transitionArtifact("docs/specs/21-foo.md", "Archived").pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({ status: "Archived", path: "docs/specs/archive/21-foo.md" });
    }
    expect(impl.getFile("docs/specs/archive/21-foo.md")).toContain("Status: Archived");
    expect(impl.getFile("docs/specs/21-foo.md")).toBeUndefined();
  });

  it("abandon relocates an Approved plan and a further transition is refused", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile("docs/plans/21-foo-plan.md", APPROVED_PLAN);

    const result = await run(
      transitionArtifact("docs/plans/21-foo-plan.md", "Abandoned").pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        status: "Abandoned",
        path: "docs/plans/archive/21-foo-plan.md",
      });
    }
    expect(impl.getFile("docs/plans/21-foo-plan.md")).toBeUndefined();

    const further = await run(
      transitionArtifact("docs/plans/archive/21-foo-plan.md", "Approved").pipe(
        Effect.provide(layer),
      ),
    );
    expect(Either.isLeft(further)).toBe(true);
    if (Either.isLeft(further)) {
      expect(further.left).toBeInstanceOf(InvalidArtifactTransitionError);
    }
  });

  it("refuses to archive over an existing destination and leaves the original intact", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile("docs/plans/21-foo-plan.md", APPROVED_PLAN);
    impl.setFile("docs/plans/archive/21-foo-plan.md", "# Pre-existing archived plan\n");

    const result = await run(
      transitionArtifact("docs/plans/21-foo-plan.md", "Archived").pipe(Effect.provide(layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactValidationError);
      expect(result.left.message).toContain("already exists");
    }
    // Neither file is touched.
    expect(impl.getFile("docs/plans/21-foo-plan.md")).toBe(APPROVED_PLAN);
    expect(impl.getFile("docs/plans/archive/21-foo-plan.md")).toBe(
      "# Pre-existing archived plan\n",
    );
  });

  it("surfaces InvalidArtifactTransitionError for an illegal transition", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile("docs/specs/21-foo.md", DRAFT_SPEC);

    const result = await run(
      transitionArtifact("docs/specs/21-foo.md", "Archived").pipe(Effect.provide(layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(InvalidArtifactTransitionError);
    }
  });

  it("surfaces ArtifactValidationError before any write on a validation failure", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile("docs/specs/21-foo.md", NO_STATUS_PLAN);

    const result = await run(
      transitionArtifact("docs/specs/21-foo.md", "Approved").pipe(Effect.provide(layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactValidationError);
    }
    expect(impl.getFile("docs/specs/21-foo.md")).toBe(NO_STATUS_PLAN);
  });
});

describe("checkPlanRunnable", () => {
  it("refuses a plan with no status line", () => {
    const result = checkPlanRunnable(NO_STATUS_PLAN, "docs/plans/21-foo-plan.md");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left.status).toBe("missing");
  });

  it("refuses a plan with an invalid status value", () => {
    const md = `# Plan\n\nStatus: NotAThing\n\n## Overview\n`;
    const result = checkPlanRunnable(md, "docs/plans/21-foo-plan.md");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left.status).toBe("invalid");
  });

  it("refuses a Draft plan", () => {
    const md = `# Plan\n\nStatus: Draft\n\n## Overview\n`;
    const result = checkPlanRunnable(md, "docs/plans/21-foo-plan.md");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.status).toBe("Draft");
      expect(result.left.message).toContain("Approve");
    }
  });

  it("refuses a Stale plan with wording distinct from Draft", () => {
    const md = `# Plan\n\nStatus: Stale\n\n## Overview\n`;
    const result = checkPlanRunnable(md, "docs/plans/21-foo-plan.md");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.status).toBe("Stale");
      expect(result.left.message).toContain("Re-plan");
      expect(result.left.message).not.toContain("Approve");
    }
  });

  it("refuses an Abandoned plan as retired, at its archive path", () => {
    const md = `# Plan\n\nStatus: Abandoned\n\n## Overview\n`;
    const result = checkPlanRunnable(md, "docs/plans/archive/21-foo-plan.md");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.status).toBe("Abandoned");
      expect(result.left.message).toContain("retired");
    }
  });

  it("refuses an Archived plan as retired, at its archive path", () => {
    const md = `# Plan\n\nStatus: Archived\n\n## Overview\n`;
    const result = checkPlanRunnable(md, "docs/plans/archive/21-foo-plan.md");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.status).toBe("Archived");
      expect(result.left.message).toContain("retired");
    }
  });

  it("passes for an Approved plan", () => {
    const result = checkPlanRunnable(APPROVED_PLAN, "docs/plans/21-foo-plan.md");
    expect(Either.isRight(result)).toBe(true);
  });

  it("refuses an Approved plan sitting under docs/plans/archive/ (location disagreement)", () => {
    const result = checkPlanRunnable(APPROVED_PLAN, "docs/plans/archive/21-foo-plan.md");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("disagrees with its location");
    }
  });

  it("passes for an Approved plan at a non-artifact path (fixtures stay line-only)", () => {
    const result = checkPlanRunnable(APPROVED_PLAN, "tests/fixtures/plan.md");
    expect(Either.isRight(result)).toBe(true);
  });
});
