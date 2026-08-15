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
  ArtifactCommitFailedError,
  ArtifactDirtyWriteSetError,
  ArtifactValidationError,
  InvalidArtifactTransitionError,
  SpecNotApprovedError,
  SpecRetirementBlockedError,
} from "../../src/domain/errors.js";
import { APPROVALS_FILE_PATH } from "../../src/domain/artifact/lineage.js";
import { decodeApprovalRecordFile } from "../../src/schemas/approvalRecord.js";

const DRAFT_SPEC = specMd("Draft");
const APPROVED_SPEC = specMd("Approved");
const APPROVED_PLAN = planMd("Approved", "null");

// A document with no frontmatter block: rejected by validateArtifact up front.
const NO_STATUS_PLAN = `# Some plan

## Overview

Body text.
`;

function planMd(status: string, sourceSpec: string): string {
  return `---
status: ${status}
source-spec: ${sourceSpec}
---
# Some plan

## Overview

Body text.
`;
}

function specMd(status: string): string {
  return `---
status: ${status}
date: 2026-01-01
audience: test
scope: test
---
# Some spec

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

const DEFAULT_OPTS = {
  repoRoot: "/fake-repo",
  nowIso: "2026-08-10T12:00:00.000Z",
  commit: false,
};

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
        legalTargets: ["Approved", "Stale", "Abandoned", "Completed"],
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
    expect(fsImpl.getFile("docs/specs/21-foo.md")).toContain("status: Approved");
  });

  it("archive relocates an Approved spec under archive/ and removes the original", async () => {
    const { fsImpl, layer } = makeHarness();
    fsImpl.setFile("docs/specs/21-foo.md", APPROVED_SPEC);

    const result = await run(
      transitionArtifact("docs/specs/21-foo.md", "Completed", DEFAULT_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({ status: "Completed", path: "docs/specs/archive/21-foo.md" });
    }
    expect(fsImpl.getFile("docs/specs/archive/21-foo.md")).toContain("status: Completed");
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
      transitionArtifact("docs/plans/21-foo-plan.md", "Completed", DEFAULT_OPTS).pipe(
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
      transitionArtifact("docs/specs/21-foo.md", "Completed", DEFAULT_OPTS).pipe(
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
      fsImpl.setFile("docs/specs/archive/22-foo.md", specMd("Completed"));
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
          expect(result.left.specStatus).toBe("Completed");
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
      expect(updatedMd).toContain("approved:");
      expect(updatedMd).toContain("date: 2026-08-10");
      expect(updatedMd).toContain(gitImpl.headCommitValue.slice(0, 7));

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
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "null"));

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
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "null"));

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
          commit: false,
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
        transitionArtifact("docs/specs/23-foo.md", "Completed", DEFAULT_OPTS).pipe(
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
      expect(fsImpl.getFile("docs/plans/50-plan.md")).toContain("status: Approved");
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
        transitionArtifact("docs/specs/23-foo.md", "Completed", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      expect(Either.isRight(archiveResult)).toBe(true);
      if (Either.isRight(archiveResult)) {
        expect(archiveResult.right.path).toBe("docs/specs/archive/23-foo.md");
      }
      // The dependent stays exactly where the abandon step left it.
      expect(fsImpl.getFile("docs/plans/archive/50-plan.md")).toContain("status: Abandoned");
    });

    it("archives a spec with no dependents cleanly", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/24-foo.md", specMd("Approved"));

      const result = await run(
        transitionArtifact("docs/specs/24-foo.md", "Completed", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isRight(result)).toBe(true);
    });
  });

  describe("sidecar hygiene", () => {
    it("removes the sidecar entry when an Approved plan goes terminal", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "null"));

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
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "null"));

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

  describe("reopen clears the approval", () => {
    it("Stale → Draft drops the approved: stamp and the sidecar record", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "null"));

      await run(
        transitionArtifact("docs/plans/40-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      await run(
        transitionArtifact("docs/plans/40-plan.md", "Stale", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      // Both artifacts of the approval survive the Approved → Stale exit.
      expect(fsImpl.getFile("docs/plans/40-plan.md")).toContain("approved:");
      const staleStore = decodeApprovalRecordFile(
        JSON.parse(fsImpl.getFile(APPROVALS_FILE_PATH) as string),
      );
      expect(Either.isRight(staleStore)).toBe(true);
      if (Either.isRight(staleStore)) {
        expect(staleStore.right.records["docs/plans/40-plan.md"]).toBeDefined();
      }

      const result = await run(
        transitionArtifact("docs/plans/40-plan.md", "Draft", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      expect(Either.isRight(result)).toBe(true);

      // The reopened plan claims no approval, in the frontmatter or the sidecar.
      expect(fsImpl.getFile("docs/plans/40-plan.md")).not.toContain("approved:");
      const afterStore = decodeApprovalRecordFile(
        JSON.parse(fsImpl.getFile(APPROVALS_FILE_PATH) as string),
      );
      expect(Either.isRight(afterStore)).toBe(true);
      if (Either.isRight(afterStore)) {
        expect(afterStore.right.records["docs/plans/40-plan.md"]).toBeUndefined();
      }
    });

    it("Approved → Stale retains the record (pinned arbitration)", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "null"));

      await run(
        transitionArtifact("docs/plans/40-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      await run(
        transitionArtifact("docs/plans/40-plan.md", "Stale", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      // The record is the fingerprint/baseline the plan went stale against; a
      // direct Stale → Approved is legal, so the record must survive here.
      const store = decodeApprovalRecordFile(
        JSON.parse(fsImpl.getFile(APPROVALS_FILE_PATH) as string),
      );
      expect(Either.isRight(store)).toBe(true);
      if (Either.isRight(store)) {
        expect(store.right.records["docs/plans/40-plan.md"]).toBeDefined();
      }
      expect(fsImpl.getFile("docs/plans/40-plan.md")).toContain("approved:");
    });

    it("the reopen commit carries the plan and approvals.json, leaving nothing uncommitted", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "null"));

      await run(
        transitionArtifact("docs/plans/40-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      await run(
        transitionArtifact("docs/plans/40-plan.md", "Stale", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      gitImpl.enqueueDirtyPaths([]); // pre-write precondition: clean
      gitImpl.enqueueDirtyPaths(["docs/plans/40-plan.md", APPROVALS_FILE_PATH]); // post-write

      const result = await run(
        transitionArtifact("docs/plans/40-plan.md", "Draft", {
          ...DEFAULT_OPTS,
          commit: true,
        }).pipe(Effect.provide(layer)),
      );

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.commit).toEqual({
          hash: gitImpl.headCommitValue,
          subject: "chore(plans): reopen 40-plan",
        });
      }
      // The commit stages exactly the write-set — plan + approvals.json — so no
      // approvals.json edit is left behind in the working tree.
      const commitCalls = gitImpl.calls.filter((c) => c.method === "commitPaths");
      expect(commitCalls).toHaveLength(1);
      if (commitCalls[0]?.method === "commitPaths") {
        expect(commitCalls[0].paths).toEqual(["docs/plans/40-plan.md", APPROVALS_FILE_PATH]);
      }
    });
  });

  describe("auto-commit", () => {
    it("approve commits exactly the write-set", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "null"));
      gitImpl.enqueueDirtyPaths([]); // pre-write precondition: clean
      gitImpl.enqueueDirtyPaths(["docs/plans/40-plan.md", APPROVALS_FILE_PATH]); // post-write: changed

      const result = await run(
        transitionArtifact("docs/plans/40-plan.md", "Approved", {
          ...DEFAULT_OPTS,
          commit: true,
        }).pipe(Effect.provide(layer)),
      );

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.commit).toEqual({
          hash: gitImpl.headCommitValue,
          subject: "chore(plans): approve 40-plan",
        });
      }
      const commitCalls = gitImpl.calls.filter((c) => c.method === "commitPaths");
      expect(commitCalls).toEqual([
        {
          method: "commitPaths",
          repo: DEFAULT_OPTS.repoRoot,
          paths: ["docs/plans/40-plan.md", APPROVALS_FILE_PATH],
          subject: "chore(plans): approve 40-plan",
          body: expect.stringContaining("docs/plans/40-plan.md"),
        },
      ]);
    });

    it("archive captures the source removal and archive addition in one commit", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/21-foo.md", APPROVED_SPEC);
      gitImpl.enqueueDirtyPaths([]);
      gitImpl.enqueueDirtyPaths(["docs/specs/21-foo.md", "docs/specs/archive/21-foo.md"]);

      const result = await run(
        transitionArtifact("docs/specs/21-foo.md", "Completed", {
          ...DEFAULT_OPTS,
          commit: true,
        }).pipe(Effect.provide(layer)),
      );

      expect(Either.isRight(result)).toBe(true);
      const commitCalls = gitImpl.calls.filter((c) => c.method === "commitPaths");
      expect(commitCalls).toHaveLength(1);
      if (commitCalls[0]?.method === "commitPaths") {
        expect(commitCalls[0].paths).toEqual([
          "docs/specs/21-foo.md",
          "docs/specs/archive/21-foo.md",
        ]);
      }
    });

    it("refuses a dirty write-set target before writing anything", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      const source = planMd("Draft", "null");
      fsImpl.setFile("docs/plans/40-plan.md", source);
      gitImpl.setDirtyPaths(["docs/plans/40-plan.md"]);

      const result = await run(
        transitionArtifact("docs/plans/40-plan.md", "Approved", {
          ...DEFAULT_OPTS,
          commit: true,
        }).pipe(Effect.provide(layer)),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(ArtifactDirtyWriteSetError);
        if (result.left instanceof ArtifactDirtyWriteSetError) {
          expect(result.left.paths).toEqual(["docs/plans/40-plan.md"]);
        }
      }
      expect(fsImpl.getFile("docs/plans/40-plan.md")).toBe(source);
      expect(fsImpl.getFile(APPROVALS_FILE_PATH)).toBeUndefined();
      expect(gitImpl.calls.some((c) => c.method === "commitPaths")).toBe(false);
    });

    it("commit: false skips the precondition and creates no commit", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "null"));
      gitImpl.setDirtyPaths(["docs/plans/40-plan.md"]); // would refuse if enforced

      const result = await run(
        transitionArtifact("docs/plans/40-plan.md", "Approved", {
          ...DEFAULT_OPTS,
          commit: false,
        }).pipe(Effect.provide(layer)),
      );

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.commit).toBeUndefined();
      }
      expect(gitImpl.calls.some((c) => c.method === "dirtyPaths")).toBe(false);
      expect(gitImpl.calls.some((c) => c.method === "commitPaths")).toBe(false);
    });

    it("a no-op transition (no diff against HEAD) creates no commit", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "null"));

      const result = await run(
        transitionArtifact("docs/plans/40-plan.md", "Approved", {
          ...DEFAULT_OPTS,
          commit: true,
        }).pipe(Effect.provide(layer)),
      );

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.commit).toBeUndefined();
      }
      expect(gitImpl.calls.some((c) => c.method === "commitPaths")).toBe(false);
    });

    it("surfaces a commit failure loudly, leaving the writes in place", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/40-plan.md", planMd("Draft", "null"));
      gitImpl.enqueueDirtyPaths([]);
      gitImpl.enqueueDirtyPaths(["docs/plans/40-plan.md", APPROVALS_FILE_PATH]);
      gitImpl.failNextCommitPaths("fatal: unable to auto-detect email address");

      const result = await run(
        transitionArtifact("docs/plans/40-plan.md", "Approved", {
          ...DEFAULT_OPTS,
          commit: true,
        }).pipe(Effect.provide(layer)),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(ArtifactCommitFailedError);
        if (result.left instanceof ArtifactCommitFailedError) {
          expect(result.left.paths).toEqual(["docs/plans/40-plan.md", APPROVALS_FILE_PATH]);
          expect(result.left.cause).toContain("unable to auto-detect email address");
        }
      }
      // The transition's writes stayed in place despite the commit failure.
      expect(fsImpl.getFile("docs/plans/40-plan.md")).toContain("status: Approved");
      expect(fsImpl.getFile(APPROVALS_FILE_PATH)).toBeDefined();
    });
  });
});

describe("checkPlanRunnable", () => {
  it("refuses a plan with no frontmatter block", () => {
    const result = checkPlanRunnable(NO_STATUS_PLAN, "docs/plans/21-foo-plan.md");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left.status).toBe("missing");
  });

  it("refuses a plan with an invalid status value", () => {
    const result = checkPlanRunnable(planMd("NotAThing", "null"), "docs/plans/21-foo-plan.md");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left.status).toBe("invalid");
  });

  it("refuses a Draft plan", () => {
    const result = checkPlanRunnable(planMd("Draft", "null"), "docs/plans/21-foo-plan.md");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.status).toBe("Draft");
      expect(result.left.message).toContain("Approve");
    }
  });

  it("refuses a Stale plan with wording distinct from Draft", () => {
    const result = checkPlanRunnable(planMd("Stale", "null"), "docs/plans/21-foo-plan.md");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.status).toBe("Stale");
      expect(result.left.message).toContain("Re-plan");
      expect(result.left.message).not.toContain("Approve");
    }
  });

  it("refuses an Abandoned plan as retired, at its archive path", () => {
    const result = checkPlanRunnable(
      planMd("Abandoned", "null"),
      "docs/plans/archive/21-foo-plan.md",
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.status).toBe("Abandoned");
      expect(result.left.message).toContain("retired");
    }
  });

  it("refuses a Completed plan as retired, at its archive path", () => {
    const result = checkPlanRunnable(
      planMd("Completed", "null"),
      "docs/plans/archive/21-foo-plan.md",
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.status).toBe("Completed");
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

  it("passes for an Approved plan at a non-artifact path", () => {
    const result = checkPlanRunnable(APPROVED_PLAN, "tests/fixtures/plan.md");
    expect(Either.isRight(result)).toBe(true);
  });
});
