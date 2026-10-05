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
  ApprovalRecordUnreadableError,
  ArtifactCommitFailedError,
  ArtifactDirtyWriteSetError,
  ArtifactSidecarDivergedError,
  ArtifactValidationError,
  InvalidArtifactTransitionError,
  SpecApprovalUnrecordedError,
  SpecEditedSinceApprovalError,
  SpecNotApprovedError,
  SpecRetirementBlockedError,
} from "../../src/domain/errors.js";
import { approvalRecordPathFor } from "../../src/domain/artifact/approvalRecordFile.js";
import { archivePathFor } from "../../src/domain/artifact/document.js";
import type { ArtifactKind } from "../../src/domain/artifact/status.js";
import { decodePlanRecordFile } from "../../src/schemas/approvalRecord.js";
import { decodeSpecRecordFile } from "../../src/schemas/specApprovalRecord.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";
import { PHAX_RELEASE } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { decodeSpecDocument } from "../../src/schemas/specDocument.js";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";

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

const THING_RECORD = "docs/plans/approvals/2609101240-thing-plan.json";
const FOO_RECORD = "docs/specs/approvals/2609101221-foo.json";

function recordPath(kind: ArtifactKind, artifactPath: string): string {
  const path = approvalRecordPathFor(kind, artifactPath);
  if (path === null) throw new Error(`${artifactPath} has no record path`);
  return path;
}

// The artifact's own record file, decoded, without $schema and artifact (which
// must name the artifact); undefined when the file does not exist.
function recordOf(
  fsImpl: { getFile(path: string): string | undefined },
  kind: ArtifactKind,
  artifactPath: string,
): Record<string, unknown> | undefined {
  const text = fsImpl.getFile(recordPath(kind, artifactPath));
  if (text === undefined) return undefined;
  const parsed: unknown = JSON.parse(text);
  const decoded: Either.Either<{ readonly artifact: string }, unknown> =
    kind === "plan" ? decodePlanRecordFile(parsed) : decodeSpecRecordFile(parsed);
  if (Either.isLeft(decoded)) throw new Error(`${artifactPath}: record does not decode`);
  const { $schema: _schema, artifact, ...record } = decoded.right as Record<string, unknown>;
  expect(artifact).toBe(artifactPath);
  return record;
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
  it("reports kind, status, legal targets, and approval:none for an Approved plan", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile("docs/plans/2609101221-foo-plan.md", APPROVED_PLAN);

    const result = await run(
      inspectArtifact("docs/plans/2609101221-foo-plan.md").pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        kind: "plan",
        status: "Approved",
        legalTargets: ["Approved", "Stale", "Abandoned", "Completed"],
        approval: { kind: "none" },
        authoring: { kind: "interactive" },
        orphanRecords: [],
      });
    }
  });

  it("lists orphan record files of the inspected kind only, changing no file", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile("docs/specs/2609101221-foo.md", DRAFT_SPEC);
    impl.setFile("docs/specs/approvals/2609010000-gone.json", "{ not valid json");
    impl.setFile("docs/plans/approvals/2609300900-gone-plan.json", "{}");
    const before = new Map(impl.files);

    const result = await run(
      inspectArtifact("docs/specs/2609101221-foo.md").pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.orphanRecords).toEqual([
        {
          recordFile: "docs/specs/approvals/2609010000-gone.json",
          artifact: "docs/specs/2609010000-gone.md",
        },
      ]);
    }
    expect(impl.files).toEqual(before);
  });

  it("surfaces ArtifactValidationError for a missing status line", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile("docs/plans/2609101221-foo-plan.md", NO_STATUS_PLAN);

    const result = await run(
      inspectArtifact("docs/plans/2609101221-foo-plan.md").pipe(Effect.provide(layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactValidationError);
    }
  });

  it("refuses an off-grammar name with ArtifactValidationError naming the file and grammar", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile("docs/plans/foo-plan.md", APPROVED_PLAN);

    const result = await run(inspectArtifact("docs/plans/foo-plan.md").pipe(Effect.provide(layer)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactValidationError);
      expect(result.left.message).toBe(
        "docs/plans/foo-plan.md: name does not match <YYMMDDHHMM>-<slug>-plan.md",
      );
    }
  });

  describe("spec approval variants", () => {
    it("reports approval:none for a Draft spec with no stamp", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101221-foo.md", DRAFT_SPEC);

      const result = await run(
        inspectArtifact("docs/specs/2609101221-foo.md").pipe(Effect.provide(layer)),
      );

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.approval).toEqual({ kind: "none" });
      }
    });

    it("reports approval:unrecorded for an Approved spec with no sidecar entry", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101221-foo.md", APPROVED_SPEC);

      const result = await run(
        inspectArtifact("docs/specs/2609101221-foo.md").pipe(Effect.provide(layer)),
      );

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.approval).toEqual({ kind: "unrecorded" });
        expect(result.right.legalTargets).toContain("Approved");
      }
    });

    it("reports approval:recorded/not-edited for a stamped, unedited spec", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101221-foo.md", DRAFT_SPEC);

      await run(
        transitionArtifact("docs/specs/2609101221-foo.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      const result = await run(
        inspectArtifact("docs/specs/2609101221-foo.md").pipe(Effect.provide(layer)),
      );

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.approval).toEqual({
          kind: "recorded",
          date: "2026-08-10",
          baseline: gitImpl.headCommitValue.slice(0, 7),
          editedSinceApproval: false,
        });
      }
    });

    it("reports approval:recorded/edited after a body edit post-approval", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101221-foo.md", DRAFT_SPEC);

      await run(
        transitionArtifact("docs/specs/2609101221-foo.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      const approvedMd = fsImpl.getFile("docs/specs/2609101221-foo.md") as string;
      fsImpl.setFile(
        "docs/specs/2609101221-foo.md",
        approvedMd.replace("Body text.", "Body text v2."),
      );

      const result = await run(
        inspectArtifact("docs/specs/2609101221-foo.md").pipe(Effect.provide(layer)),
      );

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.approval).toEqual({
          kind: "recorded",
          date: "2026-08-10",
          baseline: gitImpl.headCommitValue.slice(0, 7),
          editedSinceApproval: true,
        });
      }
    });
  });
});

describe("transitionArtifact", () => {
  it("approve rewrites a Draft spec's status line in place", async () => {
    const { fsImpl, layer } = makeHarness();
    fsImpl.setFile("docs/specs/2609101221-foo.md", DRAFT_SPEC);

    const result = await run(
      transitionArtifact("docs/specs/2609101221-foo.md", "Approved", DEFAULT_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        status: "Approved",
        path: "docs/specs/2609101221-foo.md",
        approvedBaseline: expect.any(String),
      });
    }
    expect(fsImpl.getFile("docs/specs/2609101221-foo.md")).toContain("status: Approved");
  });

  it("archive relocates an Approved spec under archive/ and removes the original", async () => {
    const { fsImpl, layer } = makeHarness();
    fsImpl.setFile("docs/specs/2609101221-foo.md", APPROVED_SPEC);

    const result = await run(
      transitionArtifact("docs/specs/2609101221-foo.md", "Completed", DEFAULT_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        status: "Completed",
        path: "docs/specs/archive/2609101221-foo.md",
      });
    }
    expect(fsImpl.getFile("docs/specs/archive/2609101221-foo.md")).toContain("status: Completed");
    expect(fsImpl.getFile("docs/specs/2609101221-foo.md")).toBeUndefined();
  });

  it("abandon relocates an Approved plan and a further transition is refused", async () => {
    const { fsImpl, layer } = makeHarness();
    fsImpl.setFile("docs/plans/2609101221-foo-plan.md", APPROVED_PLAN);

    const result = await run(
      transitionArtifact("docs/plans/2609101221-foo-plan.md", "Abandoned", DEFAULT_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        status: "Abandoned",
        path: "docs/plans/archive/2609101221-foo-plan.md",
      });
    }
    expect(fsImpl.getFile("docs/plans/2609101221-foo-plan.md")).toBeUndefined();

    const further = await run(
      transitionArtifact(
        "docs/plans/archive/2609101221-foo-plan.md",
        "Approved",
        DEFAULT_OPTS,
      ).pipe(Effect.provide(layer)),
    );
    expect(Either.isLeft(further)).toBe(true);
    if (Either.isLeft(further)) {
      expect(further.left).toBeInstanceOf(InvalidArtifactTransitionError);
    }
  });

  it("refuses to archive over an existing destination and leaves the original intact", async () => {
    const { fsImpl, layer } = makeHarness();
    fsImpl.setFile("docs/plans/2609101221-foo-plan.md", APPROVED_PLAN);
    fsImpl.setFile("docs/plans/archive/2609101221-foo-plan.md", "# Pre-existing archived plan\n");

    const result = await run(
      transitionArtifact("docs/plans/2609101221-foo-plan.md", "Completed", DEFAULT_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactValidationError);
      expect(result.left.message).toContain("already exists");
    }
    // Neither file is touched.
    expect(fsImpl.getFile("docs/plans/2609101221-foo-plan.md")).toBe(APPROVED_PLAN);
    expect(fsImpl.getFile("docs/plans/archive/2609101221-foo-plan.md")).toBe(
      "# Pre-existing archived plan\n",
    );
  });

  it("surfaces InvalidArtifactTransitionError for an illegal transition", async () => {
    const { fsImpl, layer } = makeHarness();
    fsImpl.setFile("docs/specs/2609101221-foo.md", DRAFT_SPEC);

    const result = await run(
      transitionArtifact("docs/specs/2609101221-foo.md", "Completed", DEFAULT_OPTS).pipe(
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
    fsImpl.setFile("docs/specs/2609101221-foo.md", NO_STATUS_PLAN);

    const result = await run(
      transitionArtifact("docs/specs/2609101221-foo.md", "Approved", DEFAULT_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactValidationError);
    }
    expect(fsImpl.getFile("docs/specs/2609101221-foo.md")).toBe(NO_STATUS_PLAN);
  });

  describe("spec approval", () => {
    it("approve stamps approved: with the short HEAD and writes the spec record with the full HEAD", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101221-foo.md", DRAFT_SPEC);

      const result = await run(
        transitionArtifact("docs/specs/2609101221-foo.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.approvedBaseline).toBe(gitImpl.headCommitValue);
      }

      const updatedMd = fsImpl.getFile("docs/specs/2609101221-foo.md") as string;
      expect(updatedMd).toContain("approved:");
      expect(updatedMd).toContain("date: 2026-08-10");
      expect(updatedMd).toContain(gitImpl.headCommitValue.slice(0, 7));

      expect(recordOf(fsImpl, "spec", "docs/specs/2609101221-foo.md")).toEqual({
        specFingerprint: artifactFingerprint(updatedMd),
        approvedAt: DEFAULT_OPTS.nowIso,
        baseline: gitImpl.headCommitValue,
      });
      expect(fsImpl.getFile("docs/specs/approvals.json")).toBeUndefined();
    });

    it("re-approval on an Approved spec replaces the record's baseline", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101221-foo.md", DRAFT_SPEC);

      await run(
        transitionArtifact("docs/specs/2609101221-foo.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      gitImpl.setHeadCommit("1".repeat(40));
      const secondNowIso = "2026-08-11T09:00:00.000Z";
      const result = await run(
        transitionArtifact("docs/specs/2609101221-foo.md", "Approved", {
          repoRoot: DEFAULT_OPTS.repoRoot,
          nowIso: secondNowIso,
          commit: false,
        }).pipe(Effect.provide(layer)),
      );

      expect(Either.isRight(result)).toBe(true);

      const record = recordOf(fsImpl, "spec", "docs/specs/2609101221-foo.md");
      expect(record?.["baseline"]).toBe("1".repeat(40));
      expect(record?.["approvedAt"]).toBe(secondNowIso);
    });

    // Spec approval writes its own record file: approve, edit the body,
    // re-approve; only that spec's record file is replaced.
    it("re-approval after a body edit replaces only the spec's own record file", async () => {
      const { fsImpl, layer } = makeHarness();
      const SPEC = "docs/specs/2609101221-foo.md";
      const OTHER_RECORD = "docs/specs/approvals/2609101299-other.json";
      const otherText = JSON.stringify(
        withSchemaUrl("spec-approval-record", {
          artifact: "docs/specs/2609101299-other.md",
          specFingerprint: "other-fp",
          approvedAt: "2026-01-01T00:00:00.000Z",
          baseline: "e".repeat(40),
        }),
        null,
        2,
      );
      fsImpl.setFile(OTHER_RECORD, otherText);
      fsImpl.setFile(SPEC, DRAFT_SPEC);

      await run(transitionArtifact(SPEC, "Approved", DEFAULT_OPTS).pipe(Effect.provide(layer)));
      const editedMd = (fsImpl.getFile(SPEC) as string).replace("Body text.", "Body text v2.");
      fsImpl.setFile(SPEC, editedMd);
      const result = await run(
        transitionArtifact(SPEC, "Approved", DEFAULT_OPTS).pipe(Effect.provide(layer)),
      );

      expect(Either.isRight(result)).toBe(true);
      expect(recordOf(fsImpl, "spec", SPEC)?.["specFingerprint"]).toBe(
        artifactFingerprint(fsImpl.getFile(SPEC) as string),
      );
      expect(fsImpl.getFile(OTHER_RECORD)).toBe(otherText);
    });

    it("re-approval commit carries the spec file and its own record file", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101221-foo.md", DRAFT_SPEC);

      await run(
        transitionArtifact("docs/specs/2609101221-foo.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      gitImpl.setHeadCommit("1".repeat(40));
      gitImpl.enqueueDirtyPaths([]);
      const specRecord = recordPath("spec", "docs/specs/2609101221-foo.md");
      gitImpl.enqueueDirtyPaths(["docs/specs/2609101221-foo.md", specRecord]);

      const result = await run(
        transitionArtifact("docs/specs/2609101221-foo.md", "Approved", {
          ...DEFAULT_OPTS,
          commit: true,
        }).pipe(Effect.provide(layer)),
      );

      expect(Either.isRight(result)).toBe(true);
      const commitCalls = gitImpl.calls.filter((c) => c.method === "commitPaths");
      expect(commitCalls).toHaveLength(1);
      if (commitCalls[0]?.method === "commitPaths") {
        expect(commitCalls[0].paths).toEqual(["docs/specs/2609101221-foo.md", specRecord]);
      }
    });
  });

  describe("chain-gated plan approval", () => {
    it("refuses when the declared spec is not Approved", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101222-foo.md", specMd("Draft"));
      fsImpl.setFile(
        "docs/plans/2609101240-thing-plan.md",
        planMd("Draft", "docs/specs/2609101222-foo.md"),
      );

      const result = await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(SpecNotApprovedError);
        if (result.left instanceof SpecNotApprovedError) {
          expect(result.left.specPath).toBe("docs/specs/2609101222-foo.md");
          expect(result.left.specStatus).toBe("Draft");
        }
      }
    });

    it("refuses when the declared spec is Approved but unrecorded", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101222-foo.md", specMd("Approved"));
      fsImpl.setFile(
        "docs/plans/2609101240-thing-plan.md",
        planMd("Draft", "docs/specs/2609101222-foo.md"),
      );

      const result = await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(SpecApprovalUnrecordedError);
        if (result.left instanceof SpecApprovalUnrecordedError) {
          expect(result.left.specPath).toBe("docs/specs/2609101222-foo.md");
        }
      }
    });

    it("refuses when the declared spec is Approved but edited since its approval", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101222-foo.md", DRAFT_SPEC);
      fsImpl.setFile(
        "docs/plans/2609101240-thing-plan.md",
        planMd("Draft", "docs/specs/2609101222-foo.md"),
      );

      // Approve spec → creates record
      await run(
        transitionArtifact("docs/specs/2609101222-foo.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      // Edit the spec body after approval
      const approvedMd = fsImpl.getFile("docs/specs/2609101222-foo.md") as string;
      fsImpl.setFile(
        "docs/specs/2609101222-foo.md",
        approvedMd.replace("Body text.", "Body text v2."),
      );

      const result = await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(SpecEditedSinceApprovalError);
        if (result.left instanceof SpecEditedSinceApprovalError) {
          expect(result.left.specPath).toBe("docs/specs/2609101222-foo.md");
        }
      }
      // Nothing was written to the plan
      expect(fsImpl.getFile("docs/plans/2609101240-thing-plan.md")).not.toContain("approved:");
    });

    it("proceeds when the declared spec is Approved and recorded", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101222-foo.md", DRAFT_SPEC);
      fsImpl.setFile(
        "docs/plans/2609101240-thing-plan.md",
        planMd("Draft", "docs/specs/2609101222-foo.md"),
      );

      // Approve spec first so chain gate has a valid record
      await run(
        transitionArtifact("docs/specs/2609101222-foo.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      const result = await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isRight(result)).toBe(true);
    });

    it("refuses when the declared spec resolves at its archive path but is not Approved (terminal)", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/archive/2609101222-foo.md", specMd("Completed"));
      fsImpl.setFile(
        "docs/plans/2609101240-thing-plan.md",
        planMd("Draft", "docs/specs/2609101222-foo.md"),
      );

      const result = await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", DEFAULT_OPTS).pipe(
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
      fsImpl.setFile(
        "docs/plans/2609101240-thing-plan.md",
        planMd("Draft", "docs/specs/2609101299-missing.md"),
      );

      const result = await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(ArtifactValidationError);
        expect(result.left.message).toContain("docs/specs/2609101299-missing.md");
      }
    });
  });

  describe("approval record capture", () => {
    it("records plan fingerprint, spec identity+fingerprint, and HEAD baseline; stamps the header", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101222-foo.md", DRAFT_SPEC);
      fsImpl.setFile(
        "docs/plans/2609101240-thing-plan.md",
        planMd("Draft", "docs/specs/2609101222-foo.md"),
      );

      // Must approve spec first so the chain gate accepts it
      await run(
        transitionArtifact("docs/specs/2609101222-foo.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      const specSource = fsImpl.getFile("docs/specs/2609101222-foo.md") as string;

      const result = await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      expect(Either.isRight(result)).toBe(true);

      const updatedMd = fsImpl.getFile("docs/plans/2609101240-thing-plan.md");
      expect(updatedMd).toBeDefined();
      expect(updatedMd).toContain("approved:");
      expect(updatedMd).toContain("date: 2026-08-10");
      expect(updatedMd).toContain(gitImpl.headCommitValue.slice(0, 7));

      const recordText = fsImpl.getFile(recordPath("plan", "docs/plans/2609101240-thing-plan.md"));
      expect(Object.keys(JSON.parse(recordText as string))).toEqual([
        "$schema",
        "artifact",
        "planFingerprint",
        "approvedAt",
        "baseline",
        "sourceSpec",
      ]);
      expect(recordOf(fsImpl, "plan", "docs/plans/2609101240-thing-plan.md")).toEqual({
        planFingerprint: artifactFingerprint(updatedMd as string),
        approvedAt: DEFAULT_OPTS.nowIso,
        baseline: gitImpl.headCommitValue,
        sourceSpec: {
          path: "docs/specs/2609101222-foo.md",
          fingerprint: artifactFingerprint(specSource),
        },
      });
      expect(fsImpl.getFile("docs/plans/approvals.json")).toBeUndefined();
    });

    // Plan approval writes its own record file: the commit holds exactly the
    // plan and its record file.
    it("the approve commit holds exactly the plan and its own record file", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      const PLAN = "docs/plans/2609101240-thing-plan.md";
      fsImpl.setFile(PLAN, planMd("Draft", "null"));
      gitImpl.enqueueDirtyPaths([]);
      gitImpl.enqueueDirtyPaths([PLAN, recordPath("plan", PLAN)]);

      const result = await run(
        transitionArtifact(PLAN, "Approved", { ...DEFAULT_OPTS, commit: true }).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isRight(result)).toBe(true);
      const commitCalls = gitImpl.calls.filter((c) => c.method === "commitPaths");
      expect(commitCalls).toHaveLength(1);
      if (commitCalls[0]?.method === "commitPaths") {
        expect(commitCalls[0].paths).toEqual([
          PLAN,
          "docs/plans/approvals/2609101240-thing-plan.json",
        ]);
      }
    });

    it("(none) plan approves with a null sourceSpec binding", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("Draft", "null"));

      const result = await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      expect(Either.isRight(result)).toBe(true);

      expect(
        recordOf(fsImpl, "plan", "docs/plans/2609101240-thing-plan.md")?.["sourceSpec"],
      ).toBeNull();
    });

    it("re-approval replaces the sidecar entry with a fresh baseline", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("Draft", "null"));

      await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      gitImpl.setHeadCommit("1".repeat(40));
      const secondNowIso = "2026-08-11T09:00:00.000Z";
      const result = await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", {
          repoRoot: DEFAULT_OPTS.repoRoot,
          nowIso: secondNowIso,
          commit: false,
        }).pipe(Effect.provide(layer)),
      );
      expect(Either.isRight(result)).toBe(true);

      const record = recordOf(fsImpl, "plan", "docs/plans/2609101240-thing-plan.md");
      expect(record?.["baseline"]).toBe("1".repeat(40));
      expect(record?.["approvedAt"]).toBe(secondNowIso);
    });
  });

  describe("spec retirement gate", () => {
    it("refuses to retire a spec with a live dependent plan, naming it and its status", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101223-foo.md", specMd("Approved"));
      fsImpl.setFile(
        "docs/plans/2609101250-thing-plan.md",
        planMd("Approved", "docs/specs/2609101223-foo.md"),
      );

      const result = await run(
        transitionArtifact("docs/specs/2609101223-foo.md", "Completed", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(SpecRetirementBlockedError);
        if (result.left instanceof SpecRetirementBlockedError) {
          expect(result.left.dependents).toEqual([
            { path: "docs/plans/2609101250-thing-plan.md", status: "Approved" },
          ]);
        }
      }
      // Neither artifact was touched.
      expect(fsImpl.getFile("docs/specs/2609101223-foo.md")).toBeDefined();
      expect(fsImpl.getFile("docs/plans/2609101250-thing-plan.md")).toContain("status: Approved");
    });

    it("archives cleanly once the dependent is abandoned, without touching the dependent again", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101223-foo.md", specMd("Approved"));
      fsImpl.setFile(
        "docs/plans/2609101250-thing-plan.md",
        planMd("Approved", "docs/specs/2609101223-foo.md"),
      );

      const abandonResult = await run(
        transitionArtifact("docs/plans/2609101250-thing-plan.md", "Abandoned", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      expect(Either.isRight(abandonResult)).toBe(true);

      const archiveResult = await run(
        transitionArtifact("docs/specs/2609101223-foo.md", "Completed", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      expect(Either.isRight(archiveResult)).toBe(true);
      if (Either.isRight(archiveResult)) {
        expect(archiveResult.right.path).toBe("docs/specs/archive/2609101223-foo.md");
      }
      // The dependent stays exactly where the abandon step left it.
      expect(fsImpl.getFile("docs/plans/archive/2609101250-thing-plan.md")).toContain(
        "status: Abandoned",
      );
    });

    it("archives a spec with no dependents cleanly", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101224-foo.md", specMd("Approved"));

      const result = await run(
        transitionArtifact("docs/specs/2609101224-foo.md", "Completed", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isRight(result)).toBe(true);
    });
  });

  // Complete and abandon delete the record file.
  describe("record file hygiene", () => {
    it("deletes the plan's record file when an Approved plan goes terminal", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("Draft", "null"));

      await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      expect(recordOf(fsImpl, "plan", "docs/plans/2609101240-thing-plan.md")).toBeDefined();

      await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Abandoned", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(fsImpl.getFile(THING_RECORD)).toBeUndefined();
      expect(
        fsImpl.getFile("docs/plans/archive/approvals/2609101240-thing-plan.json"),
      ).toBeUndefined();
    });

    it("deletes the spec's record file when an Approved spec goes terminal; archived file keeps the stamp", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101221-foo.md", DRAFT_SPEC);

      await run(
        transitionArtifact("docs/specs/2609101221-foo.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      expect(recordOf(fsImpl, "spec", "docs/specs/2609101221-foo.md")).toBeDefined();

      await run(
        transitionArtifact("docs/specs/2609101221-foo.md", "Completed", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(fsImpl.getFile(FOO_RECORD)).toBeUndefined();
      expect(fsImpl.getFile("docs/specs/archive/approvals/2609101221-foo.json")).toBeUndefined();

      // Archived file keeps the approved: stamp
      expect(fsImpl.getFile("docs/specs/archive/2609101221-foo.md")).toContain("approved:");
    });

    // Record files are not artifacts.
    it("refuses to inspect or transition a record file as an artifact", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile(THING_RECORD, "{}");

      const failures: unknown[] = [
        Either.flip(await run(inspectArtifact(THING_RECORD).pipe(Effect.provide(layer)))),
        Either.flip(
          await run(
            transitionArtifact(THING_RECORD, "Approved", DEFAULT_OPTS).pipe(Effect.provide(layer)),
          ),
        ),
      ];
      for (const failure of failures) {
        expect(failure).toMatchObject({
          _tag: "Right",
          right: expect.objectContaining({
            _tag: "ArtifactValidationError",
            message: expect.stringContaining("is not a recognized artifact path"),
          }),
        });
      }
      expect(fsImpl.getFile(THING_RECORD)).toBe("{}");
    });

    it("the dependent-plan check ignores the approvals/ directory", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101221-foo.md", APPROVED_SPEC);
      fsImpl.setFile(THING_RECORD, "{ not valid json");

      const result = await run(
        transitionArtifact("docs/specs/2609101221-foo.md", "Completed", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isRight(result)).toBe(true);
      expect(fsImpl.getFile(THING_RECORD)).toBe("{ not valid json");
    });

    it("a never-approved Draft spec's abandon commits without a record path", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101221-foo.md", DRAFT_SPEC);
      gitImpl.enqueueDirtyPaths([]);
      gitImpl.enqueueDirtyPaths([
        "docs/specs/2609101221-foo.md",
        "docs/specs/archive/2609101221-foo.md",
      ]);

      const result = await run(
        transitionArtifact("docs/specs/2609101221-foo.md", "Abandoned", {
          ...DEFAULT_OPTS,
          commit: true,
        }).pipe(Effect.provide(layer)),
      );

      expect(Either.isRight(result)).toBe(true);
      const commitCalls = gitImpl.calls.filter((c) => c.method === "commitPaths");
      expect(commitCalls).toHaveLength(1);
      if (commitCalls[0]?.method === "commitPaths") {
        expect(commitCalls[0].paths).toEqual([
          "docs/specs/2609101221-foo.md",
          "docs/specs/archive/2609101221-foo.md",
        ]);
      }
    });

    it("leaves another artifact's record file byte-identical", async () => {
      const { fsImpl, layer } = makeHarness();
      const OTHER = "docs/plans/approvals/2609101299-other-plan.json";
      fsImpl.setFile(OTHER, "{ not valid json");
      fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("Draft", "null"));

      for (const target of ["Approved", "Stale", "Draft", "Approved", "Completed"] as const) {
        const result = await run(
          transitionArtifact("docs/plans/2609101240-thing-plan.md", target, DEFAULT_OPTS).pipe(
            Effect.provide(layer),
          ),
        );
        expect(Either.isRight(result)).toBe(true);
      }
      expect(fsImpl.getFile(OTHER)).toBe("{ not valid json");
    });

    // An unreadable record file is refused, never overwritten or deleted.
    const [major = 0] = PHAX_RELEASE.split(".").map(Number);
    const unreadable: ReadonlyArray<readonly [string, (artifact: string) => string]> = [
      ["not JSON", () => "{ not valid json"],
      [
        "without $schema",
        (artifact) =>
          JSON.stringify({
            artifact,
            planFingerprint: "fp",
            approvedAt: "2026-01-01T00:00:00.000Z",
            baseline: "a".repeat(40),
            sourceSpec: null,
          }),
      ],
      [
        "from a newer release",
        (artifact) =>
          JSON.stringify({
            $schema: schemaUrl("plan-approval-record", `${major + 1}.0.0`),
            artifact,
            planFingerprint: "fp",
            approvedAt: "2026-01-01T00:00:00.000Z",
            baseline: "a".repeat(40),
            sourceSpec: null,
          }),
      ],
      [
        "failing to decode",
        (artifact) =>
          JSON.stringify(withSchemaUrl("plan-approval-record", { artifact, planFingerprint: 42 })),
      ],
    ];

    it.each(unreadable)(
      "refuses a plan approval when its record file is %s, touching nothing",
      async (_, text) => {
        const { fsImpl, layer } = makeHarness();
        const plan = planMd("Draft", "null");
        const recordText = text("docs/plans/2609101240-thing-plan.md");
        fsImpl.setFile(THING_RECORD, recordText);
        fsImpl.setFile("docs/plans/2609101240-thing-plan.md", plan);

        const result = await run(
          transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", DEFAULT_OPTS).pipe(
            Effect.provide(layer),
          ),
        );

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          expect(result.left).toBeInstanceOf(ApprovalRecordUnreadableError);
          expect(exitCodeForError(result.left)).toBe(12);
        }
        expect(fsImpl.getFile(THING_RECORD)).toBe(recordText);
        expect(fsImpl.getFile("docs/plans/2609101240-thing-plan.md")).toBe(plan);
      },
    );

    it("refuses a spec transition when its record file is not JSON, touching nothing", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile(FOO_RECORD, "{ not valid json");
      fsImpl.setFile("docs/specs/2609101221-foo.md", DRAFT_SPEC);

      const result = await run(
        transitionArtifact("docs/specs/2609101221-foo.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(ApprovalRecordUnreadableError);
      }
      expect(fsImpl.getFile(FOO_RECORD)).toBe("{ not valid json");
      expect(fsImpl.getFile("docs/specs/2609101221-foo.md")).toBe(DRAFT_SPEC);
    });

    // An archival refused after the move would leave it uncommitted, and run
    // completion reads a plan gone from its source path as already completed.
    it.each([
      ["plan", THING_RECORD, "docs/plans/2609101240-thing-plan.md", APPROVED_PLAN],
      ["spec", FOO_RECORD, "docs/specs/2609101221-foo.md", APPROVED_SPEC],
    ])(
      "refuses to complete a %s when its record file is corrupt, before moving it",
      async (_, ownRecord, path, md) => {
        const { fsImpl, layer } = makeHarness();
        fsImpl.setFile(ownRecord, "{ not valid json");
        fsImpl.setFile(path, md);

        const result = await run(
          transitionArtifact(path, "Completed", DEFAULT_OPTS).pipe(Effect.provide(layer)),
        );

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          expect(result.left).toBeInstanceOf(ApprovalRecordUnreadableError);
        }
        expect(fsImpl.getFile(ownRecord)).toBe("{ not valid json");
        expect(fsImpl.getFile(path)).toBe(md);
        expect(fsImpl.getFile(archivePathFor(path))).toBeUndefined();
      },
    );

    // A copied record does not approve another artifact.
    it("refuses a plan whose record file records another plan", async () => {
      const { fsImpl, layer } = makeHarness();
      const copied = JSON.stringify(
        withSchemaUrl("plan-approval-record", {
          artifact: "docs/plans/2609101299-other-plan.md",
          planFingerprint: "fp",
          approvedAt: "2026-01-01T00:00:00.000Z",
          baseline: "a".repeat(40),
          sourceSpec: null,
        }),
      );
      fsImpl.setFile(THING_RECORD, copied);
      fsImpl.setFile("docs/plans/2609101240-thing-plan.md", APPROVED_PLAN);

      const result = await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Completed", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(ApprovalRecordUnreadableError);
        expect(result.left.message).toContain(
          "records docs/plans/2609101299-other-plan.md, not docs/plans/2609101240-thing-plan.md",
        );
      }
      expect(fsImpl.getFile(THING_RECORD)).toBe(copied);
      expect(fsImpl.getFile("docs/plans/2609101240-thing-plan.md")).toBe(APPROVED_PLAN);
    });

    it("refuses a plan approval whose declared spec's record file records another spec", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101221-foo.md", APPROVED_SPEC);
      fsImpl.setFile(
        FOO_RECORD,
        JSON.stringify(
          withSchemaUrl("spec-approval-record", {
            artifact: "docs/specs/2609101299-other.md",
            specFingerprint: artifactFingerprint(APPROVED_SPEC),
            approvedAt: "2026-01-01T00:00:00.000Z",
            baseline: "a".repeat(40),
          }),
        ),
      );
      fsImpl.setFile(
        "docs/plans/2609101240-thing-plan.md",
        planMd("Draft", "docs/specs/2609101221-foo.md"),
      );

      const result = await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(ApprovalRecordUnreadableError);
      expect(fsImpl.getFile(THING_RECORD)).toBeUndefined();
    });
  });

  describe("reopen clears the approval", () => {
    it("Stale → Draft drops the approved: stamp and the sidecar record", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("Draft", "null"));

      await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Stale", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      // Both artifacts of the approval survive the Approved → Stale exit.
      expect(fsImpl.getFile("docs/plans/2609101240-thing-plan.md")).toContain("approved:");
      expect(recordOf(fsImpl, "plan", "docs/plans/2609101240-thing-plan.md")).toBeDefined();

      const result = await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Draft", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      expect(Either.isRight(result)).toBe(true);

      // The reopened plan claims no approval, in the frontmatter or the sidecar.
      expect(fsImpl.getFile("docs/plans/2609101240-thing-plan.md")).not.toContain("approved:");
      expect(fsImpl.getFile(THING_RECORD)).toBeUndefined();
    });

    // Reopen deletes the plan's record file; another plan's record file is
    // left byte-identical.
    it("reopen leaves another plan's record file byte-identical", async () => {
      const { fsImpl, layer } = makeHarness();
      const OTHER = "docs/plans/approvals/2609101299-other-plan.json";
      const otherText = JSON.stringify(
        withSchemaUrl("plan-approval-record", {
          artifact: "docs/plans/2609101299-other-plan.md",
          planFingerprint: "fp",
          approvedAt: "2026-01-01T00:00:00.000Z",
          baseline: "a".repeat(40),
          sourceSpec: null,
        }),
        null,
        2,
      );
      fsImpl.setFile(OTHER, otherText);
      fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("Draft", "null"));

      for (const target of ["Approved", "Stale", "Draft"] as const) {
        await run(
          transitionArtifact("docs/plans/2609101240-thing-plan.md", target, DEFAULT_OPTS).pipe(
            Effect.provide(layer),
          ),
        );
      }

      expect(fsImpl.getFile(THING_RECORD)).toBeUndefined();
      expect(fsImpl.getFile(OTHER)).toBe(otherText);
    });

    it("Approved → Stale retains the record (pinned arbitration)", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("Draft", "null"));

      await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Stale", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      // The record is the fingerprint/baseline the plan went stale against; a
      // direct Stale → Approved is legal, so the record must survive here.
      expect(recordOf(fsImpl, "plan", "docs/plans/2609101240-thing-plan.md")).toBeDefined();
      expect(fsImpl.getFile("docs/plans/2609101240-thing-plan.md")).toContain("approved:");
    });

    it("the reopen commit carries the plan and its record file, leaving nothing uncommitted", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("Draft", "null"));

      await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );
      await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Stale", DEFAULT_OPTS).pipe(
          Effect.provide(layer),
        ),
      );

      gitImpl.enqueueDirtyPaths([]); // pre-write precondition: clean
      gitImpl.enqueueDirtyPaths(["docs/plans/2609101240-thing-plan.md", THING_RECORD]); // post-write

      const result = await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Draft", {
          ...DEFAULT_OPTS,
          commit: true,
        }).pipe(Effect.provide(layer)),
      );

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.commit).toEqual({
          hash: gitImpl.headCommitValue,
          subject: "chore(plans): reopen thing",
        });
      }
      // The commit stages exactly the write-set — plan + its record file — so
      // the record file's deletion is not left behind in the working tree.
      const commitCalls = gitImpl.calls.filter((c) => c.method === "commitPaths");
      expect(commitCalls).toHaveLength(1);
      if (commitCalls[0]?.method === "commitPaths") {
        expect(commitCalls[0].paths).toEqual(["docs/plans/2609101240-thing-plan.md", THING_RECORD]);
      }
    });
  });

  describe("auto-commit", () => {
    it("approve commits exactly the write-set", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("Draft", "null"));
      gitImpl.enqueueDirtyPaths([]); // pre-write precondition: clean
      gitImpl.enqueueDirtyPaths(["docs/plans/2609101240-thing-plan.md", THING_RECORD]); // post-write: changed

      const result = await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", {
          ...DEFAULT_OPTS,
          commit: true,
        }).pipe(Effect.provide(layer)),
      );

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.commit).toEqual({
          hash: gitImpl.headCommitValue,
          subject: "chore(plans): approve thing",
        });
      }
      const commitCalls = gitImpl.calls.filter((c) => c.method === "commitPaths");
      expect(commitCalls).toEqual([
        {
          method: "commitPaths",
          repo: DEFAULT_OPTS.repoRoot,
          paths: ["docs/plans/2609101240-thing-plan.md", THING_RECORD],
          subject: "chore(plans): approve thing",
          body: expect.stringContaining("docs/plans/2609101240-thing-plan.md"),
        },
      ]);
    });

    it("archive captures the source removal, record deletion and archive addition in one commit", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      fsImpl.setFile("docs/specs/2609101221-foo.md", APPROVED_SPEC);
      fsImpl.setFile(
        FOO_RECORD,
        JSON.stringify(
          withSchemaUrl("spec-approval-record", {
            artifact: "docs/specs/2609101221-foo.md",
            specFingerprint: artifactFingerprint(APPROVED_SPEC),
            approvedAt: "2026-01-01T00:00:00.000Z",
            baseline: "a".repeat(40),
          }),
        ),
      );
      gitImpl.enqueueDirtyPaths([]);
      gitImpl.enqueueDirtyPaths([
        "docs/specs/2609101221-foo.md",
        FOO_RECORD,
        "docs/specs/archive/2609101221-foo.md",
      ]);

      const result = await run(
        transitionArtifact("docs/specs/2609101221-foo.md", "Completed", {
          ...DEFAULT_OPTS,
          commit: true,
        }).pipe(Effect.provide(layer)),
      );

      expect(Either.isRight(result)).toBe(true);
      const commitCalls = gitImpl.calls.filter((c) => c.method === "commitPaths");
      expect(commitCalls).toHaveLength(1);
      if (commitCalls[0]?.method === "commitPaths") {
        expect(commitCalls[0].paths).toEqual([
          "docs/specs/2609101221-foo.md",
          FOO_RECORD,
          "docs/specs/archive/2609101221-foo.md",
        ]);
      }
      expect(fsImpl.getFile(FOO_RECORD)).toBeUndefined();
    });

    it("refuses a dirty write-set target before writing anything", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      const source = planMd("Draft", "null");
      fsImpl.setFile("docs/plans/2609101240-thing-plan.md", source);
      gitImpl.setDirtyPaths(["docs/plans/2609101240-thing-plan.md"]);

      const result = await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", {
          ...DEFAULT_OPTS,
          commit: true,
        }).pipe(Effect.provide(layer)),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(ArtifactDirtyWriteSetError);
        if (result.left instanceof ArtifactDirtyWriteSetError) {
          expect(result.left.paths).toEqual(["docs/plans/2609101240-thing-plan.md"]);
        }
      }
      expect(fsImpl.getFile("docs/plans/2609101240-thing-plan.md")).toBe(source);
      expect(fsImpl.getFile(THING_RECORD)).toBeUndefined();
      expect(gitImpl.calls.some((c) => c.method === "commitPaths")).toBe(false);
    });

    it("commit: false skips the precondition and creates no commit", async () => {
      const { fsImpl, gitImpl, layer } = makeHarness();
      fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("Draft", "null"));
      gitImpl.setDirtyPaths(["docs/plans/2609101240-thing-plan.md"]); // would refuse if enforced

      const result = await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", {
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
      fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("Draft", "null"));

      const result = await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", {
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
      fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("Draft", "null"));
      gitImpl.enqueueDirtyPaths([]);
      gitImpl.enqueueDirtyPaths(["docs/plans/2609101240-thing-plan.md", THING_RECORD]);
      gitImpl.failNextCommitPaths("fatal: unable to auto-detect email address");

      const result = await run(
        transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", {
          ...DEFAULT_OPTS,
          commit: true,
        }).pipe(Effect.provide(layer)),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(ArtifactCommitFailedError);
        if (result.left instanceof ArtifactCommitFailedError) {
          expect(result.left.paths).toEqual(["docs/plans/2609101240-thing-plan.md", THING_RECORD]);
          expect(result.left.cause).toContain("unable to auto-detect email address");
          expect(result.left.commitMessage).toEqual({
            subject: "chore(plans): approve thing",
            body: "Transitions docs/plans/2609101240-thing-plan.md to Approved (approve).",
          });
          expect(result.left.message).toContain(
            "git commit -m 'chore(plans): approve thing' -m 'Transitions docs/plans/2609101240-thing-plan.md to Approved (approve).' --",
          );
          expect(result.left.message).not.toContain("JSON sidecar");
        }
      }
      // The transition's writes stayed in place despite the commit failure.
      expect(fsImpl.getFile("docs/plans/2609101240-thing-plan.md")).toContain("status: Approved");
      expect(fsImpl.getFile(THING_RECORD)).toBeDefined();
    });
  });
});

// A hand edit of a headless artifact's body.
function edited(body: string): string {
  return body.replace("Free a slug", "Release a slug");
}

describe("headless-authored artifacts (JSON sidecar)", () => {
  const SPEC = "docs/specs/2609230835-plan-prune.md";
  const SIDECAR = "docs/specs/2609230835-plan-prune.json";
  const SPEC_RECORD = "docs/specs/approvals/2609230835-plan-prune.json";
  const ARCHIVED_SPEC = "docs/specs/archive/2609230835-plan-prune.md";
  const ARCHIVED_SIDECAR = "docs/specs/archive/2609230835-plan-prune.json";

  const SPEC_DOCUMENT = {
    version: 1,
    kind: "spec",
    title: "Plan Prune",
    ground: [{ path: "docs/ideas/plan-prune.md", note: "the idea" }],
    context: "A slug is held forever by its archived run.",
    problem: "The `-2` habit is the visible symptom.",
    productGoal: {
      statement: "Free a slug once its run is archived.",
      guidingRule: "A slug is held only by a live run.",
    },
    terminology: [{ term: "live run", definition: "a run that is not archived" }],
    requirements: [
      {
        id: "5.1",
        title: "Prune eligibility",
        pattern: "event",
        statement: "WHEN a run is archived THE system SHALL make it eligible to prune.",
      },
    ],
    surface: [
      {
        surface: "cli: `phax prune <run>`",
        binding: "normative",
        before: null,
        after: "phax prune usage-cli",
      },
    ],
    nonGoals: ["pruning a live run"],
    acceptanceCriteria: [
      {
        id: "AC-1",
        name: "Prune frees the slug",
        given: "an archived run usage-cli",
        when: "`phax prune usage-cli` runs",
        // oxlint-disable-next-line unicorn/no-thenable -- given/when/then data, never awaited
        then: "the slug is free",
        refs: ["5.1"],
      },
    ],
    openQuestions: [],
    planningNote: { settled: ["manual prune"], open: [], constraints: [] },
    docsPage: { kind: "none", why: "the CLI reference covers it" },
  };
  const SIDECAR_JSON = `${JSON.stringify(SPEC_DOCUMENT, null, 2)}\n`;

  function headlessSpecMd(status: string, bodyEdit: (body: string) => string = (b) => b): string {
    const decoded = decodeSpecDocument(SPEC_DOCUMENT);
    if (Either.isLeft(decoded)) throw new Error("fixture spec document must decode");
    return `---
status: ${status}
date: 2026-09-23
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
${bodyEdit(renderSpecBody(decoded.right))}`;
  }

  function headlessHarness(md: string, sidecarJson: string = SIDECAR_JSON) {
    const harness = makeHarness();
    harness.fsImpl.setFile(SPEC, md);
    harness.fsImpl.setFile(SIDECAR, sidecarJson);
    return harness;
  }

  describe("inspectArtifact", () => {
    // SIDECAR_JSON is the shape 0.16.0 committed (`version: 1`, no `$schema`):
    // it is read through the frozen pre-schema decoder (ac-own-legacy).
    it("reports headless, in sync, when the body is the sidecar's rendering", async () => {
      const { layer } = headlessHarness(headlessSpecMd("Draft"));
      const result = await run(inspectArtifact(SPEC).pipe(Effect.provide(layer)));
      expect(Either.isRight(result) && result.right.authoring).toEqual({
        kind: "headless",
        sidecarPath: SIDECAR,
        agreement: "in-sync",
      });
    });

    it("reports headless, in sync, for a sidecar phax wrote with $schema", async () => {
      const { version: _version, ...authored } = SPEC_DOCUMENT;
      const stamped = `${JSON.stringify(withSchemaUrl("spec-document", authored), null, 2)}\n`;
      const { layer } = headlessHarness(headlessSpecMd("Draft"), stamped);
      const result = await run(inspectArtifact(SPEC).pipe(Effect.provide(layer)));
      expect(Either.isRight(result) && result.right.authoring).toEqual({
        kind: "headless",
        sidecarPath: SIDECAR,
        agreement: "in-sync",
      });
    });

    it("reports diverged after a body edit", async () => {
      const { layer } = headlessHarness(headlessSpecMd("Draft", edited));
      const result = await run(inspectArtifact(SPEC).pipe(Effect.provide(layer)));
      expect(Either.isRight(result) && result.right.authoring).toEqual({
        kind: "headless",
        sidecarPath: SIDECAR,
        agreement: "diverged",
      });
    });

    it("reports an invalid sidecar with the reason", async () => {
      const { layer } = headlessHarness(headlessSpecMd("Draft"), "{ nope");
      const result = await run(inspectArtifact(SPEC).pipe(Effect.provide(layer)));
      expect(Either.isRight(result) && result.right.authoring).toMatchObject({
        kind: "headless",
        agreement: { kind: "invalid", message: expect.stringMatching(/^not JSON/) },
      });
    });

    it("reports interactive (no sidecar) for an artifact without one", async () => {
      const { fsImpl, layer } = makeHarness();
      fsImpl.setFile(SPEC, DRAFT_SPEC);
      const result = await run(inspectArtifact(SPEC).pipe(Effect.provide(layer)));
      expect(Either.isRight(result) && result.right.authoring).toEqual({ kind: "interactive" });
    });
  });

  describe("transitionArtifact", () => {
    it("approve commits the artifact, its sidecar and its record file", async () => {
      const { fsImpl, gitImpl, layer } = headlessHarness(headlessSpecMd("Draft"));
      gitImpl.enqueueDirtyPaths([]);
      gitImpl.enqueueDirtyPaths([SPEC, SPEC_RECORD]);

      const result = await run(
        transitionArtifact(SPEC, "Approved", { ...DEFAULT_OPTS, commit: true }).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isRight(result)).toBe(true);
      const commitCalls = gitImpl.calls.filter((c) => c.method === "commitPaths");
      expect(commitCalls).toHaveLength(1);
      if (commitCalls[0]?.method === "commitPaths") {
        expect(commitCalls[0].paths).toEqual([SPEC, SIDECAR, SPEC_RECORD]);
      }
      // The frontmatter stamp does not diverge the pair.
      expect(fsImpl.getFile(SIDECAR)).toBe(SIDECAR_JSON);
      const after = await run(inspectArtifact(SPEC).pipe(Effect.provide(layer)));
      expect(Either.isRight(after) && after.right.authoring).toMatchObject({
        agreement: "in-sync",
      });
    });

    it("complete moves both files under archive/ in one commit", async () => {
      const { fsImpl, gitImpl, layer } = headlessHarness(headlessSpecMd("Approved"));
      gitImpl.enqueueDirtyPaths([]);
      gitImpl.enqueueDirtyPaths([SPEC, SIDECAR, ARCHIVED_SPEC, ARCHIVED_SIDECAR]);

      const result = await run(
        transitionArtifact(SPEC, "Completed", { ...DEFAULT_OPTS, commit: true }).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isRight(result)).toBe(true);
      expect(fsImpl.getFile(SPEC)).toBeUndefined();
      expect(fsImpl.getFile(SIDECAR)).toBeUndefined();
      expect(fsImpl.getFile(ARCHIVED_SPEC)).toContain("status: Completed");
      expect(fsImpl.getFile(ARCHIVED_SIDECAR)).toBe(SIDECAR_JSON);
      const commitCalls = gitImpl.calls.filter((c) => c.method === "commitPaths");
      expect(commitCalls).toHaveLength(1);
      if (commitCalls[0]?.method === "commitPaths") {
        // No record file exists, so none joins the write-set.
        expect(commitCalls[0].paths).toEqual([SPEC, SIDECAR, ARCHIVED_SPEC, ARCHIVED_SIDECAR]);
      }
    });

    it("approve of a diverged artifact fails with exit 12 naming both remedies, writing nothing", async () => {
      const source = headlessSpecMd("Draft", edited);
      const { fsImpl, gitImpl, layer } = headlessHarness(source);

      const result = await run(
        transitionArtifact(SPEC, "Approved", { ...DEFAULT_OPTS, commit: true }).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(ArtifactSidecarDivergedError);
        expect(exitCodeForError(result.left)).toBe(12);
        expect(result.left.message).toContain("differs from its sidecar's rendering");
        expect(result.left.message).toContain(
          "phax artifact new spec plan-prune --headless --brief <file|->",
        );
        expect(result.left.message).toContain(
          `delete ${SIDECAR} to demote the artifact to hand-authored`,
        );
      }
      expect(fsImpl.getFile(SPEC)).toBe(source);
      expect(fsImpl.getFile(SPEC_RECORD)).toBeUndefined();
      expect(gitImpl.calls.some((c) => c.method === "commitPaths")).toBe(false);
    });

    it("approve of an artifact with an invalid sidecar fails the same way", async () => {
      const { layer } = headlessHarness(headlessSpecMd("Draft"), "{ nope");

      const result = await run(
        transitionArtifact(SPEC, "Approved", DEFAULT_OPTS).pipe(Effect.provide(layer)),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(ArtifactSidecarDivergedError);
        expect(result.left.message).toContain("has an invalid sidecar (not JSON");
      }
    });

    it("other transitions are not blocked by divergence; the sidecar still travels", async () => {
      const { fsImpl, layer } = headlessHarness(headlessSpecMd("Draft", edited));

      const result = await run(
        transitionArtifact(SPEC, "Abandoned", DEFAULT_OPTS).pipe(Effect.provide(layer)),
      );

      expect(Either.isRight(result)).toBe(true);
      expect(fsImpl.getFile(ARCHIVED_SPEC)).toContain("status: Abandoned");
      expect(fsImpl.getFile(ARCHIVED_SIDECAR)).toBe(SIDECAR_JSON);
      expect(fsImpl.getFile(SIDECAR)).toBeUndefined();
    });

    it("refuses to archive over an existing archived sidecar, moving neither file", async () => {
      const source = headlessSpecMd("Approved");
      const { fsImpl, layer } = headlessHarness(source);
      fsImpl.setFile(ARCHIVED_SIDECAR, "{}");

      const result = await run(
        transitionArtifact(SPEC, "Completed", DEFAULT_OPTS).pipe(Effect.provide(layer)),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(ArtifactValidationError);
        expect(result.left.message).toContain(`destination ${ARCHIVED_SIDECAR} already exists`);
      }
      expect(fsImpl.getFile(SPEC)).toBe(source);
      expect(fsImpl.getFile(SIDECAR)).toBe(SIDECAR_JSON);
      expect(fsImpl.getFile(ARCHIVED_SPEC)).toBeUndefined();
    });
  });
});

describe("checkPlanRunnable", () => {
  it("refuses a plan with no frontmatter block", () => {
    const result = checkPlanRunnable(NO_STATUS_PLAN, "docs/plans/2609101221-foo-plan.md");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left.status).toBe("missing");
  });

  it("refuses a plan with an invalid status value", () => {
    const result = checkPlanRunnable(
      planMd("NotAThing", "null"),
      "docs/plans/2609101221-foo-plan.md",
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left.status).toBe("invalid");
  });

  it("refuses a Draft plan", () => {
    const result = checkPlanRunnable(planMd("Draft", "null"), "docs/plans/2609101221-foo-plan.md");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.status).toBe("Draft");
      expect(result.left.message).toContain("Approve");
    }
  });

  it("refuses a Stale plan with wording distinct from Draft", () => {
    const result = checkPlanRunnable(planMd("Stale", "null"), "docs/plans/2609101221-foo-plan.md");
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
      "docs/plans/archive/2609101221-foo-plan.md",
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
      "docs/plans/archive/2609101221-foo-plan.md",
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.status).toBe("Completed");
      expect(result.left.message).toContain("retired");
    }
  });

  it("passes for an Approved plan", () => {
    const result = checkPlanRunnable(APPROVED_PLAN, "docs/plans/2609101221-foo-plan.md");
    expect(Either.isRight(result)).toBe(true);
  });

  it("refuses an Approved plan sitting under docs/plans/archive/ (location disagreement)", () => {
    const result = checkPlanRunnable(APPROVED_PLAN, "docs/plans/archive/2609101221-foo-plan.md");
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
