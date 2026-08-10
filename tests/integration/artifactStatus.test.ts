import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  checkPlanRunnable,
  inspectArtifact,
  transitionArtifact,
} from "../../src/app/artifactStatus.js";
import { artifactFingerprint } from "../../src/app/approvalRecordStore.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import {
  ArtifactValidationError,
  InvalidArtifactTransitionError,
  SpecNotApprovedError,
  SpecRetirementBlockedError,
} from "../../src/domain/errors.js";
import { APPROVALS_FILE_PATH } from "../../src/domain/artifact/lineage.js";
import { decodeApprovalRecordFile } from "../../src/schemas/approvalRecord.js";

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
Source-Spec: (none)

## Overview

Body text.
`;

const NO_STATUS_PLAN = `# Some plan

## Overview

Body text.
`;

function planMd(status: string, sourceSpec: string): string {
  return `# Some plan

Status: ${status}
Source-Spec: ${sourceSpec}

## Overview

Body text.
`;
}

function specMd(status: string): string {
  return `# Some spec

Status: ${status}

## Overview

Body text.
`;
}

function run<A, E>(effect: Effect.Effect<A, E, never>) {
  return Effect.runPromise(Effect.either(effect));
}

function makeHarness() {
  const { impl: fsImpl, layer: fsLayer } = makeFakeFileSystem();
  const { impl: gitImpl, layer: gitLayer } = makeFakeGit();
  const layer = Layer.merge(fsLayer, gitLayer);
  return { fsImpl, gitImpl, layer };
}

const DEFAULT_OPTS = { repoRoot: "/fake-repo", nowIso: "2026-08-10T12:00:00.000Z" };

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
    const { fsImpl, layer } = makeHarness();
    fsImpl.setFile("docs/specs/21-foo.md", DRAFT_SPEC);

    const result = await run(
      transitionArtifact("docs/specs/21-foo.md", "Approved", DEFAULT_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({ status: "Approved", path: "docs/specs/21-foo.md" });
    }
    expect(fsImpl.getFile("docs/specs/21-foo.md")).toContain("Status: Approved");
  });

  it("archive relocates an Approved spec under archive/ and removes the original", async () => {
    const { fsImpl, layer } = makeHarness();
    fsImpl.setFile("docs/specs/21-foo.md", APPROVED_SPEC);

    const result = await run(
      transitionArtifact("docs/specs/21-foo.md", "Archived", DEFAULT_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({ status: "Archived", path: "docs/specs/archive/21-foo.md" });
    }
    expect(fsImpl.getFile("docs/specs/archive/21-foo.md")).toContain("Status: Archived");
    expect(fsImpl.getFile("docs/specs/21-foo.md")).toBeUndefined();
  });

  it("abandon relocates an Approved plan and a further transition is refused", async () => {
    const { fsImpl, layer } = makeHarness();
    fsImpl.setFile("docs/plans/21-foo-plan.md", APPROVED_PLAN);

    const result = await run(
      transitionArtifact("docs/plans/21-foo-plan.md", "Abandoned", DEFAULT_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        status: "Abandoned",
        path: "docs/plans/archive/21-foo-plan.md",
      });
    }
    expect(fsImpl.getFile("docs/plans/21-foo-plan.md")).toBeUndefined();

    const further = await run(
      transitionArtifact("docs/plans/archive/21-foo-plan.md", "Approved", DEFAULT_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    expect(Either.isLeft(further)).toBe(true);
    if (Either.isLeft(further)) {
      expect(further.left).toBeInstanceOf(InvalidArtifactTransitionError);
    }
  });

  it("refuses to archive over an existing destination and leaves the original intact", async () => {
    const { fsImpl, layer } = makeHarness();
    fsImpl.setFile("docs/plans/21-foo-plan.md", APPROVED_PLAN);
    fsImpl.setFile("docs/plans/archive/21-foo-plan.md", "# Pre-existing archived plan\n");

    const result = await run(
      transitionArtifact("docs/plans/21-foo-plan.md", "Archived", DEFAULT_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactValidationError);
      expect(result.left.message).toContain("already exists");
    }
    // Neither file is touched.
    expect(fsImpl.getFile("docs/plans/21-foo-plan.md")).toBe(APPROVED_PLAN);
    expect(fsImpl.getFile("docs/plans/archive/21-foo-plan.md")).toBe(
      "# Pre-existing archived plan\n",
    );
  });

  it("surfaces InvalidArtifactTransitionError for an illegal transition", async () => {
    const { fsImpl, layer } = makeHarness();
    fsImpl.setFile("docs/specs/21-foo.md", DRAFT_SPEC);

    const result = await run(
      transitionArtifact("docs/specs/21-foo.md", "Archived", DEFAULT_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(InvalidArtifactTransitionError);
    }
  });

  it("surfaces ArtifactValidationError before any write on a validation failure", async () => {
    const { fsImpl, layer } = makeHarness();
    fsImpl.setFile("docs/specs/21-foo.md", NO_STATUS_PLAN);

    const result = await run(
      transitionArtifact("docs/specs/21-foo.md", "Approved", DEFAULT_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactValidationError);
    }
    expect(fsImpl.getFile("docs/specs/21-foo.md")).toBe(NO_STATUS_PLAN);
  });

  describe("chain-gated plan approval", () => {
    it("refuses when the declared spec is not Approved", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/22-foo.md", specMd("Draft"));
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "docs/specs/22-foo.md"));

      const result = await run(
        transitionArtifact("docs/plans/40-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(SpecNotApprovedError);
        if (result.left instanceof SpecNotApprovedError) {
          expect(result.left.specPath).toBe("docs/specs/22-foo.md");
          expect(result.left.specStatus).toBe("Draft");
        }
      }
    });

    it("proceeds when the declared spec is Approved", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/22-foo.md", specMd("Approved"));
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "docs/specs/22-foo.md"));

      const result = await run(
        transitionArtifact("docs/plans/40-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isRight(result)).toBe(true);
    });

    it("refuses when the declared spec resolves at its archive path but is not Approved (terminal)", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/archive/22-foo.md", specMd("Archived"));
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "docs/specs/22-foo.md"));

      const result = await run(
        transitionArtifact("docs/plans/40-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(SpecNotApprovedError);
        if (result.left instanceof SpecNotApprovedError) {
          expect(result.left.specStatus).toBe("Archived");
        }
      }
    });

    it("refuses a dangling Source-Spec declaration, naming the reference", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "docs/specs/99-missing.md"));

      const result = await run(
        transitionArtifact("docs/plans/40-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(ArtifactValidationError);
        expect(result.left.message).toContain("docs/specs/99-missing.md");
      }
    });
  });

  describe("approval record capture", () => {
    it("records plan fingerprint, spec identity+fingerprint, and HEAD baseline; stamps the header", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      const specSource = specMd("Approved");
      fsImpl.setFile("docs/specs/22-foo.md", specSource);
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "docs/specs/22-foo.md"));

      const result = await run(
        transitionArtifact("docs/plans/40-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      expect(Either.isRight(result)).toBe(true);

      const updatedMd = fsImpl.getFile("docs/plans/40-plan.md");
      expect(updatedMd).toBeDefined();
      expect(updatedMd).toContain(`Approved: 2026-08-10 @ ${gitImpl.headCommitValue.slice(0, 7)}`);

      const storeText = fsImpl.getFile(APPROVALS_FILE_PATH);
      expect(storeText).toBeDefined();
      const decoded = decodeApprovalRecordFile(JSON.parse(storeText as string));
      expect(Either.isRight(decoded)).toBe(true);
      if (Either.isRight(decoded)) {
        const record = decoded.right.records["docs/plans/40-plan.md"];
        expect(record).toEqual({
          planFingerprint: artifactFingerprint(updatedMd as string),
          approvedAt: DEFAULT_OPTS.nowIso,
          baseline: gitImpl.headCommitValue,
          sourceSpec: {
            path: "docs/specs/22-foo.md",
            fingerprint: artifactFingerprint(specSource),
          },
        });
      }
    });

    it("(none) plan approves with a null sourceSpec binding", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "(none)"));

      const result = await run(
        transitionArtifact("docs/plans/40-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      expect(Either.isRight(result)).toBe(true);

      const storeText = fsImpl.getFile(APPROVALS_FILE_PATH) as string;
      const decoded = decodeApprovalRecordFile(JSON.parse(storeText));
      expect(Either.isRight(decoded)).toBe(true);
      if (Either.isRight(decoded)) {
        expect(decoded.right.records["docs/plans/40-plan.md"]?.sourceSpec).toBeNull();
      }
    });

    it("re-approval replaces the sidecar entry with a fresh baseline", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "(none)"));

      await run(
        transitionArtifact("docs/plans/40-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      gitImpl.setHeadCommit("1".repeat(40));
      const secondNowIso = "2026-08-11T09:00:00.000Z";
      const result = await run(
        transitionArtifact("docs/plans/40-plan.md", "Approved", {
          repoRoot: DEFAULT_OPTS.repoRoot,
          nowIso: secondNowIso,
        }).pipe(Effect.provide(layer)),
      );
      expect(Either.isRight(result)).toBe(true);

      const storeText = fsImpl.getFile(APPROVALS_FILE_PATH) as string;
      const decoded = decodeApprovalRecordFile(JSON.parse(storeText));
      expect(Either.isRight(decoded)).toBe(true);
      if (Either.isRight(decoded)) {
        expect(Object.keys(decoded.right.records)).toEqual(["docs/plans/40-plan.md"]);
        expect(decoded.right.records["docs/plans/40-plan.md"]?.baseline).toBe("1".repeat(40));
        expect(decoded.right.records["docs/plans/40-plan.md"]?.approvedAt).toBe(secondNowIso);
      }
    });
  });

  describe("spec retirement gate", () => {
    it("refuses to retire a spec with a live dependent plan, naming it and its status", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/23-foo.md", specMd("Approved"));
      fsImpl.setFile("docs/plans/50-plan.md", planMd("Approved", "docs/specs/23-foo.md"));

      const result = await run(
        transitionArtifact("docs/specs/23-foo.md", "Archived", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(SpecRetirementBlockedError);
        if (result.left instanceof SpecRetirementBlockedError) {
          expect(result.left.dependents).toEqual([
            { path: "docs/plans/50-plan.md", status: "Approved" },
          ]);
        }
      }
      // Neither artifact was touched.
      expect(fsImpl.getFile("docs/specs/23-foo.md")).toBeDefined();
      expect(fsImpl.getFile("docs/plans/50-plan.md")).toContain("Status: Approved");
    });

    it("archives cleanly once the dependent is abandoned, without touching the dependent again", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/23-foo.md", specMd("Approved"));
      fsImpl.setFile("docs/plans/50-plan.md", planMd("Approved", "docs/specs/23-foo.md"));

      const abandonResult = await run(
        transitionArtifact("docs/plans/50-plan.md", "Abandoned", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      expect(Either.isRight(abandonResult)).toBe(true);

      const archiveResult = await run(
        transitionArtifact("docs/specs/23-foo.md", "Archived", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      expect(Either.isRight(archiveResult)).toBe(true);
      if (Either.isRight(archiveResult)) {
        expect(archiveResult.right.path).toBe("docs/specs/archive/23-foo.md");
      }
      // The dependent stays exactly where the abandon step left it.
      expect(fsImpl.getFile("docs/plans/archive/50-plan.md")).toContain("Status: Abandoned");
    });

    it("archives a spec with no dependents cleanly", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/24-foo.md", specMd("Approved"));

      const result = await run(
        transitionArtifact("docs/specs/24-foo.md", "Archived", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isRight(result)).toBe(true);
    });
  });

  describe("sidecar hygiene", () => {
    it("removes the sidecar entry when an Approved plan goes terminal", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "(none)"));

      await run(
        transitionArtifact("docs/plans/40-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      const beforeStore = decodeApprovalRecordFile(
        JSON.parse(fsImpl.getFile(APPROVALS_FILE_PATH) as string),
      );
      expect(Either.isRight(beforeStore)).toBe(true);
      if (Either.isRight(beforeStore)) {
        expect(beforeStore.right.records["docs/plans/40-plan.md"]).toBeDefined();
      }

      await run(
        transitionArtifact("docs/plans/40-plan.md", "Abandoned", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      const afterStore = decodeApprovalRecordFile(
        JSON.parse(fsImpl.getFile(APPROVALS_FILE_PATH) as string),
      );
      expect(Either.isRight(afterStore)).toBe(true);
      if (Either.isRight(afterStore)) {
        expect(afterStore.right.records["docs/plans/40-plan.md"]).toBeUndefined();
      }
    });

    it("does not block a transition when approvals.json is corrupt", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile(APPROVALS_FILE_PATH, "{ not valid json");
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "(none)"));

      const result = await run(
        transitionArtifact("docs/plans/40-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isRight(result)).toBe(true);
      const storeText = fsImpl.getFile(APPROVALS_FILE_PATH) as string;
      expect(() => JSON.parse(storeText)).not.toThrow();
    });
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
