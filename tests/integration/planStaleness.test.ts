import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  applyStalenessReport,
  computePlanStaleness,
  computeStalenessForPlan,
  plansStalenessReport,
} from "../../src/app/planStaleness.js";
import { transitionArtifact } from "../../src/app/artifactStatus.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { renderStalenessApply, renderStalenessReport } from "../../src/domain/artifact/render.js";
import {
  ApprovalLedgerMigrationRequiredError,
  ApprovalRecordUnreadableError,
  ArtifactValidationError,
} from "../../src/domain/errors.js";
import { FileSystem } from "../../src/ports/fs.js";

const REPO_ROOT = "/fake-repo";
const NOW_ISO = "2026-08-10T12:00:00.000Z";
const APPROVE_OPTS = { repoRoot: REPO_ROOT, nowIso: NOW_ISO, commit: false };

function specMd(status: string): string {
  return `---\nstatus: ${status}\ndate: 2026-01-01\naudience: test\nscope: test\n---\n# Some spec\n\n## Overview\n\nSpec body v1.\n`;
}

function planMd(sourceSpec: string): string {
  const ss = sourceSpec === "(none)" ? "null" : sourceSpec;
  const completes = ss === "null" ? "" : "completes-spec: true\n";
  return `---\nstatus: Draft\nsource-spec: ${ss}\n${completes}---\n# Some plan\n\n## Overview\n\nBody text.\n`;
}

function run<A, E>(effect: Effect.Effect<A, E, never>) {
  return Effect.runPromise(Effect.either(effect));
}

// Backend-free harness: proves computeStalenessForPlan requires only FileSystem | Git.
function coreHarness() {
  const { impl: fsImpl, layer: fsLayer } = makeFakeFileSystem();
  const { impl: gitImpl, layer: gitLayer } = makeFakeGit();
  const layer = Layer.merge(fsLayer, gitLayer);
  return { fsImpl, gitImpl, layer };
}

describe("computeStalenessForPlan (core, Backend-free)", () => {
  it("no sidecar entry reports missing-record", async () => {
    const { fsImpl, layer } = coreHarness();
    fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("(none)"));

    const verdict = await run(
      computeStalenessForPlan("docs/plans/2609101240-thing-plan.md", planMd("(none)"), [], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(verdict)).toBe(true);
    if (Either.isRight(verdict)) {
      expect(verdict.right.kind).toBe("missing-record");
    }
  });

  it("a vanished baseline commit reports missing-record naming it", async () => {
    const { fsImpl, gitImpl, layer } = coreHarness();
    fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("(none)"));

    await run(
      transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const baseline = gitImpl.headCommitValue;
    gitImpl.existingCommits.delete(baseline);

    const currentPlanMd = fsImpl.getFile("docs/plans/2609101240-thing-plan.md") as string;
    const verdict = await run(
      computeStalenessForPlan("docs/plans/2609101240-thing-plan.md", currentPlanMd, [], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(verdict)).toBe(true);
    if (Either.isRight(verdict)) {
      expect(verdict.right.kind).toBe("missing-record");
      if (verdict.right.kind === "missing-record") {
        expect(verdict.right.detail).toContain(baseline);
      }
    }
  });

  it("reports fresh for an unchanged plan and spec with no ground changes", async () => {
    const { fsImpl, layer } = coreHarness();
    fsImpl.setFile("docs/specs/2609101222-foo.md", specMd("Draft"));
    fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("docs/specs/2609101222-foo.md"));

    await run(
      transitionArtifact("docs/specs/2609101222-foo.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    await run(
      transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const currentPlanMd = fsImpl.getFile("docs/plans/2609101240-thing-plan.md") as string;

    const verdict = await run(
      computeStalenessForPlan(
        "docs/plans/2609101240-thing-plan.md",
        currentPlanMd,
        ["src/foo.ts"],
        {
          repoRoot: REPO_ROOT,
        },
      ).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(verdict)).toBe(true);
    if (Either.isRight(verdict)) expect(verdict.right).toEqual({ kind: "fresh" });
  });

  it("a declared spec's content edit reports spec-changed", async () => {
    const { fsImpl, layer } = coreHarness();
    fsImpl.setFile("docs/specs/2609101222-foo.md", specMd("Draft"));
    fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("docs/specs/2609101222-foo.md"));

    await run(
      transitionArtifact("docs/specs/2609101222-foo.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    await run(
      transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const currentPlanMd = fsImpl.getFile("docs/plans/2609101240-thing-plan.md") as string;
    const approvedSpecMd = fsImpl.getFile("docs/specs/2609101222-foo.md") as string;
    fsImpl.setFile(
      "docs/specs/2609101222-foo.md",
      approvedSpecMd.replace("Spec body v1.", "Spec body v2 — edited."),
    );

    const verdict = await run(
      computeStalenessForPlan("docs/plans/2609101240-thing-plan.md", currentPlanMd, [], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(verdict)).toBe(true);
    if (Either.isRight(verdict)) {
      expect(verdict.right).toEqual({
        kind: "stale",
        evidence: [{ reason: "spec-changed", specPath: "docs/specs/2609101222-foo.md" }],
      });
    }
  });

  it("flipping completes-spec on an Approved, fresh plan reports self-changed", async () => {
    const { fsImpl, layer } = coreHarness();
    fsImpl.setFile("docs/specs/2609101222-foo.md", specMd("Draft"));
    fsImpl.setFile(
      "docs/plans/2609101240-thing-plan.md",
      planMd("docs/specs/2609101222-foo.md").replace(
        "completes-spec: true",
        "completes-spec: false",
      ),
    );

    await run(
      transitionArtifact("docs/specs/2609101222-foo.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    await run(
      transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const approvedPlanMd = fsImpl.getFile("docs/plans/2609101240-thing-plan.md") as string;
    expect(approvedPlanMd).toContain("status: Approved");

    const before = await run(
      computeStalenessForPlan("docs/plans/2609101240-thing-plan.md", approvedPlanMd, [], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );
    expect(before).toEqual(Either.right({ kind: "fresh" }));

    const flipped = approvedPlanMd.replace("completes-spec: false", "completes-spec: true");
    expect(flipped).not.toBe(approvedPlanMd);
    const after = await run(
      computeStalenessForPlan("docs/plans/2609101240-thing-plan.md", flipped, [], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );
    expect(after).toEqual(Either.right({ kind: "stale", evidence: [{ reason: "self-changed" }] }));
  });

  it("a spec-less ((none)) plan never reports spec-changed", async () => {
    const { fsImpl, layer } = coreHarness();
    fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("(none)"));

    await run(
      transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const currentPlanMd = fsImpl.getFile("docs/plans/2609101240-thing-plan.md") as string;

    const verdict = await run(
      computeStalenessForPlan("docs/plans/2609101240-thing-plan.md", currentPlanMd, [], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(verdict)).toBe(true);
    if (Either.isRight(verdict)) expect(verdict.right).toEqual({ kind: "fresh" });
  });

  it("a footprint file listed in changedFilesSince reports ground-changed naming exactly that file", async () => {
    const { fsImpl, gitImpl, layer } = coreHarness();
    fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("(none)"));

    await run(
      transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const currentPlanMd = fsImpl.getFile("docs/plans/2609101240-thing-plan.md") as string;
    gitImpl.setChangedFilesSince(gitImpl.headCommitValue, ["src/foo.ts", "unrelated.ts"]);

    const verdict = await run(
      computeStalenessForPlan(
        "docs/plans/2609101240-thing-plan.md",
        currentPlanMd,
        ["src/foo.ts"],
        {
          repoRoot: REPO_ROOT,
        },
      ).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(verdict)).toBe(true);
    if (Either.isRight(verdict)) {
      expect(verdict.right).toEqual({
        kind: "stale",
        evidence: [
          { reason: "ground-changed", baseline: gitImpl.headCommitValue, files: ["src/foo.ts"] },
        ],
      });
    }
  });

  it("changed files disjoint from the footprint do not flip the verdict", async () => {
    const { fsImpl, gitImpl, layer } = coreHarness();
    fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("(none)"));

    await run(
      transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const currentPlanMd = fsImpl.getFile("docs/plans/2609101240-thing-plan.md") as string;
    gitImpl.setChangedFilesSince(gitImpl.headCommitValue, ["unrelated.ts"]);

    const verdict = await run(
      computeStalenessForPlan(
        "docs/plans/2609101240-thing-plan.md",
        currentPlanMd,
        ["src/foo.ts"],
        {
          repoRoot: REPO_ROOT,
        },
      ).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(verdict)).toBe(true);
    if (Either.isRight(verdict)) expect(verdict.right).toEqual({ kind: "fresh" });
  });

  it("editing the plan body after approval reports self-changed", async () => {
    const { fsImpl, layer } = coreHarness();
    fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("(none)"));

    await run(
      transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const approvedMd = fsImpl.getFile("docs/plans/2609101240-thing-plan.md") as string;
    const editedMd = approvedMd.replace("Body text.", "Body text v2 — edited.");

    const verdict = await run(
      computeStalenessForPlan("docs/plans/2609101240-thing-plan.md", editedMd, [], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(verdict)).toBe(true);
    if (Either.isRight(verdict)) {
      expect(verdict.right).toEqual({ kind: "stale", evidence: [{ reason: "self-changed" }] });
    }
  });

  it("reports all three reasons together, in enum order", async () => {
    const { fsImpl, gitImpl, layer } = coreHarness();
    fsImpl.setFile("docs/specs/2609101222-foo.md", specMd("Draft"));
    fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("docs/specs/2609101222-foo.md"));

    await run(
      transitionArtifact("docs/specs/2609101222-foo.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    await run(
      transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const approvedMd = fsImpl.getFile("docs/plans/2609101240-thing-plan.md") as string;
    const editedMd = approvedMd.replace("Body text.", "Body text v2 — edited.");

    const approvedSpecMd = fsImpl.getFile("docs/specs/2609101222-foo.md") as string;
    fsImpl.setFile(
      "docs/specs/2609101222-foo.md",
      approvedSpecMd.replace("Spec body v1.", "Spec body v2 — edited."),
    );
    gitImpl.setChangedFilesSince(gitImpl.headCommitValue, ["src/foo.ts"]);

    const verdict = await run(
      computeStalenessForPlan("docs/plans/2609101240-thing-plan.md", editedMd, ["src/foo.ts"], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(verdict)).toBe(true);
    if (Either.isRight(verdict)) {
      expect(verdict.right).toEqual({
        kind: "stale",
        evidence: [
          { reason: "spec-changed", specPath: "docs/specs/2609101222-foo.md" },
          { reason: "ground-changed", baseline: gitImpl.headCommitValue, files: ["src/foo.ts"] },
          { reason: "self-changed" },
        ],
      });
    }
  });

  it("re-approving the spec without editing it leaves the plan fresh (fingerprint is stamp-neutral)", async () => {
    const { fsImpl, layer } = coreHarness();
    fsImpl.setFile("docs/specs/2609101222-foo.md", specMd("Draft"));
    fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("docs/specs/2609101222-foo.md"));

    // Approve spec first so the chain gate accepts the plan approval
    await run(
      transitionArtifact("docs/specs/2609101222-foo.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    await run(
      transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const currentPlanMd = fsImpl.getFile("docs/plans/2609101240-thing-plan.md") as string;

    // Re-approve the spec with no body edit (only the approved: stamp changes)
    await run(
      transitionArtifact("docs/specs/2609101222-foo.md", "Approved", {
        ...APPROVE_OPTS,
        nowIso: "2026-08-11T09:00:00.000Z",
      }).pipe(Effect.provide(layer)),
    );

    // The plan's staleness check must still report fresh because fingerprintSource
    // strips the approved: key — re-stamping alone does not change the fingerprint.
    const verdict = await run(
      computeStalenessForPlan("docs/plans/2609101240-thing-plan.md", currentPlanMd, [], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(verdict)).toBe(true);
    if (Either.isRight(verdict)) {
      expect(verdict.right).toEqual({ kind: "fresh" });
    }
  });

  it("a dangling recorded Source-Spec fails with ArtifactValidationError naming it", async () => {
    const { fsImpl, layer } = coreHarness();
    fsImpl.setFile("docs/specs/2609101222-foo.md", specMd("Draft"));
    fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("docs/specs/2609101222-foo.md"));

    await run(
      transitionArtifact("docs/specs/2609101222-foo.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    await run(
      transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const currentPlanMd = fsImpl.getFile("docs/plans/2609101240-thing-plan.md") as string;
    fsImpl.remove("docs/specs/2609101222-foo.md");

    const verdict = await run(
      computeStalenessForPlan("docs/plans/2609101240-thing-plan.md", currentPlanMd, [], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isLeft(verdict)).toBe(true);
    if (Either.isLeft(verdict)) {
      expect(verdict.left).toBeInstanceOf(ArtifactValidationError);
      expect((verdict.left as ArtifactValidationError).message).toContain(
        "docs/specs/2609101222-foo.md",
      );
    }
  });

  it("re-approval on edited content restores freshness", async () => {
    const { fsImpl, layer } = coreHarness();
    fsImpl.setFile("docs/plans/2609101240-thing-plan.md", planMd("(none)"));

    await run(
      transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const approvedMd = fsImpl.getFile("docs/plans/2609101240-thing-plan.md") as string;
    const editedMd = approvedMd.replace("Body text.", "Body text v2 — edited.");
    fsImpl.setFile("docs/plans/2609101240-thing-plan.md", editedMd);

    const staleVerdict = await run(
      computeStalenessForPlan("docs/plans/2609101240-thing-plan.md", editedMd, [], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );
    expect(Either.isRight(staleVerdict)).toBe(true);
    if (Either.isRight(staleVerdict)) expect(staleVerdict.right.kind).toBe("stale");

    await run(
      transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", {
        repoRoot: REPO_ROOT,
        nowIso: "2026-08-11T09:00:00.000Z",
        commit: false,
      }).pipe(Effect.provide(layer)),
    );
    const reapprovedMd = fsImpl.getFile("docs/plans/2609101240-thing-plan.md") as string;

    const freshVerdict = await run(
      computeStalenessForPlan("docs/plans/2609101240-thing-plan.md", reapprovedMd, [], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );
    expect(Either.isRight(freshVerdict)).toBe(true);
    if (Either.isRight(freshVerdict)) expect(freshVerdict.right).toEqual({ kind: "fresh" });
  });
});

// Deterministically parseable plan.md: satisfies extractPlanDeterministic outright, so
// computePlanStaleness / plansStalenessReport / applyStalenessReport never touch the
// backend or the extraction cache.
function deterministicPlanMd(opts: {
  readonly status: string;
  readonly sourceSpec: string;
  readonly create?: readonly string[];
}): string {
  const create =
    opts.create !== undefined && opts.create.length > 0
      ? opts.create.map((f) => `- ${f}`).join("\n")
      : "- (none)";
  const ss = opts.sourceSpec === "(none)" ? "null" : opts.sourceSpec;
  const completes = ss === "null" ? "" : "completes-spec: true\n";
  return `---
status: ${opts.status}
source-spec: ${ss}
${completes}---
# Some plan

## Overview

Body text.

## Required commands

- pnpm check:full

## phase-01 — First phase {#phase-01-first}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

### Planned files to create

${create}

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Commit subject

feat: something

### Commit body

Body of commit.
`;
}

function fullHarness() {
  const { impl: fsImpl, layer: fsLayer } = makeFakeFileSystem();
  const { impl: gitImpl, layer: gitLayer } = makeFakeGit();
  const { impl: backendImpl, layer: backendLayer } = makeFakeBackend();
  const layer = Layer.mergeAll(fsLayer, gitLayer, backendLayer);
  return { fsImpl, gitImpl, backendImpl, layer };
}

const REPORT_OPTS = {
  repoRoot: REPO_ROOT,
  stateRoot: "/fake/state",
  model: "claude-sonnet-5",
  effort: "medium",
  nowIso: NOW_ISO,
};

describe("computePlanStaleness (extraction wrapper)", () => {
  it("derives the footprint through deterministic extraction without touching the backend", async () => {
    const { fsImpl, backendImpl, layer } = fullHarness();
    fsImpl.setFile(
      "docs/plans/2609101240-thing-plan.md",
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)", create: ["src/foo.ts"] }),
    );
    await run(
      transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    const verdict = await run(
      computePlanStaleness("docs/plans/2609101240-thing-plan.md", REPORT_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    expect(Either.isRight(verdict)).toBe(true);
    if (Either.isRight(verdict)) expect(verdict.right).toEqual({ kind: "fresh" });
    expect(backendImpl.runCalls).toHaveLength(0);
    expect(backendImpl.completeCalls).toHaveLength(0);
  });
});

describe("plansStalenessReport", () => {
  it("lists exactly the Approved entries as fresh or stale, leaves the Draft plan untouched, and writes nothing", async () => {
    const { fsImpl, backendImpl, layer } = fullHarness();

    fsImpl.setFile(
      "docs/plans/2609101240-fresh-plan.md",
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)", create: ["src/fresh.ts"] }),
    );
    await run(
      transitionArtifact("docs/plans/2609101240-fresh-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    fsImpl.setFile(
      "docs/plans/2609101241-stale-plan.md",
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)", create: ["src/stale.ts"] }),
    );
    await run(
      transitionArtifact("docs/plans/2609101241-stale-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const approvedStaleMd = fsImpl.getFile("docs/plans/2609101241-stale-plan.md") as string;
    fsImpl.setFile(
      "docs/plans/2609101241-stale-plan.md",
      approvedStaleMd.replace("Body text.", "Body text v2 — edited after approval."),
    );

    fsImpl.setFile(
      "docs/plans/2609101242-draft-plan.md",
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)" }),
    );

    const beforeFresh = fsImpl.getFile("docs/plans/2609101240-fresh-plan.md");
    const beforeStale = fsImpl.getFile("docs/plans/2609101241-stale-plan.md");
    const beforeDraft = fsImpl.getFile("docs/plans/2609101242-draft-plan.md");

    const { report } = await Effect.runPromise(
      plansStalenessReport(REPORT_OPTS).pipe(Effect.provide(layer)),
    );

    expect(report.map((e) => e.path)).toEqual([
      "docs/plans/2609101240-fresh-plan.md",
      "docs/plans/2609101241-stale-plan.md",
    ]);
    const fresh = report.find((e) => e.path === "docs/plans/2609101240-fresh-plan.md");
    const stale = report.find((e) => e.path === "docs/plans/2609101241-stale-plan.md");
    expect(fresh?.result).toEqual({ kind: "fresh" });
    expect(stale?.result).toEqual({
      kind: "stale",
      evidence: [{ reason: "self-changed" }],
    });

    // Report-only sweep: no file was rewritten, and the Draft plan is untouched.
    expect(fsImpl.getFile("docs/plans/2609101240-fresh-plan.md")).toBe(beforeFresh);
    expect(fsImpl.getFile("docs/plans/2609101241-stale-plan.md")).toBe(beforeStale);
    expect(fsImpl.getFile("docs/plans/2609101242-draft-plan.md")).toBe(beforeDraft);
    expect(fsImpl.getFile("docs/plans/2609101242-draft-plan.md")).toContain("status: Draft");

    expect(backendImpl.runCalls).toHaveLength(0);
    expect(backendImpl.completeCalls).toHaveLength(0);

    const rendered = renderStalenessReport(report);
    expect(rendered).toContain("docs/plans/2609101240-fresh-plan.md: fresh");
    expect(rendered).toContain("docs/plans/2609101241-stale-plan.md: STALE");
    expect(rendered).toContain("self-changed");
  });

  it("returns an empty report when docs/plans does not exist", async () => {
    const { layer } = fullHarness();
    const result = await Effect.runPromise(
      plansStalenessReport(REPORT_OPTS).pipe(Effect.provide(layer)),
    );
    expect(result).toEqual({ report: [], orphanRecords: [] });
  });

  it("a per-plan extraction failure yields an error entry and the sweep still completes", async () => {
    const { fsImpl, layer } = fullHarness();

    fsImpl.setFile(
      "docs/plans/2609101240-good-plan.md",
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)", create: ["src/good.ts"] }),
    );
    await run(
      transitionArtifact("docs/plans/2609101240-good-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    // Not deterministically parseable (no "## Required commands" / phase section);
    // with noExtract: true and no cache entry, extraction fails outright.
    fsImpl.setFile("docs/plans/2609101241-bad-plan.md", planMd("(none)"));
    await run(
      transitionArtifact("docs/plans/2609101241-bad-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    const { report } = await Effect.runPromise(
      plansStalenessReport({ ...REPORT_OPTS, noExtract: true }).pipe(Effect.provide(layer)),
    );

    expect(report).toHaveLength(2);
    const good = report.find((e) => e.path === "docs/plans/2609101240-good-plan.md");
    const bad = report.find((e) => e.path === "docs/plans/2609101241-bad-plan.md");
    expect(good?.result).toEqual({ kind: "fresh" });
    expect(bad?.result.kind).toBe("error");
  });

  it("a plan that fails artifact validation yields an error entry before any extraction", async () => {
    const { fsImpl, backendImpl, layer } = fullHarness();

    // Invalid Status value: validateArtifact rejects it up front, so the entry
    // never reaches the Approved filter or the extraction pipeline.
    fsImpl.setFile(
      "docs/plans/2609101240-malformed-plan.md",
      "---\nstatus: Nonsense\nsource-spec: null\n---\n# Some plan\n\n## Overview\n\nBody text.\n",
    );

    const { report } = await Effect.runPromise(
      plansStalenessReport(REPORT_OPTS).pipe(Effect.provide(layer)),
    );

    expect(report).toHaveLength(1);
    const entry = report[0];
    expect(entry?.path).toBe("docs/plans/2609101240-malformed-plan.md");
    expect(entry?.result.kind).toBe("error");
    if (entry?.result.kind === "error") {
      expect(entry.result.message).toContain("invalid frontmatter");
    }
    // Validation failed before extraction, so the backend was never engaged.
    expect(backendImpl.runCalls).toHaveLength(0);
    expect(backendImpl.completeCalls).toHaveLength(0);
  });

  it("scans only top-level plans, skipping the archive/ subdirectory", async () => {
    const { fsImpl, layer } = fullHarness();

    fsImpl.setFile(
      "docs/plans/2609101240-live-plan.md",
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)", create: ["src/live.ts"] }),
    );
    await run(
      transitionArtifact("docs/plans/2609101240-live-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    // An archived (terminal) plan under docs/plans/archive/. fs.list returns the
    // bare "archive" directory entry, which the .md filter skips — its contents
    // are never recursed into.
    fsImpl.setFile(
      "docs/plans/archive/2609101238-old-plan.md",
      deterministicPlanMd({ status: "Completed", sourceSpec: "(none)" }),
    );

    const { report } = await Effect.runPromise(
      plansStalenessReport(REPORT_OPTS).pipe(Effect.provide(layer)),
    );

    expect(report.map((e) => e.path)).toEqual(["docs/plans/2609101240-live-plan.md"]);
  });
});

describe("applyStalenessReport", () => {
  it("flips exactly the stale-computed plans to Stale, leaves fresh ones Approved, and never touches the backend", async () => {
    const { fsImpl, backendImpl, layer } = fullHarness();

    fsImpl.setFile(
      "docs/plans/2609101240-fresh-plan.md",
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)", create: ["src/fresh.ts"] }),
    );
    await run(
      transitionArtifact("docs/plans/2609101240-fresh-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    fsImpl.setFile(
      "docs/plans/2609101241-stale-plan.md",
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)", create: ["src/stale.ts"] }),
    );
    await run(
      transitionArtifact("docs/plans/2609101241-stale-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const approvedStaleMd = fsImpl.getFile("docs/plans/2609101241-stale-plan.md") as string;
    fsImpl.setFile(
      "docs/plans/2609101241-stale-plan.md",
      approvedStaleMd.replace("Body text.", "Body text v2 — edited after approval."),
    );

    const { report } = await Effect.runPromise(
      plansStalenessReport(REPORT_OPTS).pipe(Effect.provide(layer)),
    );

    const flipped = await run(
      applyStalenessReport(report, APPROVE_OPTS).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(flipped)).toBe(true);
    if (Either.isRight(flipped)) {
      expect(flipped.right.map((f) => f.path)).toEqual(["docs/plans/2609101241-stale-plan.md"]);
      const rendered = renderStalenessApply(flipped.right);
      expect(rendered).toContain("docs/plans/2609101241-stale-plan.md: Approved -> Stale");
    }

    expect(fsImpl.getFile("docs/plans/2609101241-stale-plan.md")).toContain("status: Stale");
    expect(fsImpl.getFile("docs/plans/2609101240-fresh-plan.md")).toContain("status: Approved");

    expect(backendImpl.runCalls).toHaveLength(0);
    expect(backendImpl.completeCalls).toHaveLength(0);
  });

  it("flips a missing-record entry (vanished baseline) to Stale", async () => {
    const { fsImpl, gitImpl, layer } = fullHarness();

    fsImpl.setFile(
      "docs/plans/2609101240-thing-plan.md",
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)", create: ["src/foo.ts"] }),
    );
    await run(
      transitionArtifact("docs/plans/2609101240-thing-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    // Baseline commit garbage-collected: the approval record survives but its
    // baseline is gone, so the plan computes missing-record while still Approved.
    gitImpl.existingCommits.delete(gitImpl.headCommitValue);

    const { report } = await Effect.runPromise(
      plansStalenessReport(REPORT_OPTS).pipe(Effect.provide(layer)),
    );
    expect(report.find((e) => e.path === "docs/plans/2609101240-thing-plan.md")?.result.kind).toBe(
      "missing-record",
    );

    const flipped = await run(
      applyStalenessReport(report, APPROVE_OPTS).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(flipped)).toBe(true);
    if (Either.isRight(flipped)) {
      expect(flipped.right.map((f) => f.path)).toEqual(["docs/plans/2609101240-thing-plan.md"]);
      expect(flipped.right[0]?.verdict.kind).toBe("missing-record");
    }
    expect(fsImpl.getFile("docs/plans/2609101240-thing-plan.md")).toContain("status: Stale");
  });
});

describe("per-artifact approval record files", () => {
  const PLAN_A = "docs/plans/2609101240-alpha-plan.md";
  const PLAN_B = "docs/plans/2609101241-beta-plan.md";
  const PLAN_C = "docs/plans/2609101242-gamma-plan.md";
  const RECORD_A = "docs/plans/approvals/2609101240-alpha-plan.json";
  const RECORD_B = "docs/plans/approvals/2609101241-beta-plan.json";
  const RECORD_C = "docs/plans/approvals/2609101242-gamma-plan.json";

  async function approve(
    fsImpl: { setFile(path: string, text: string): void },
    layer: ReturnType<typeof fullHarness>["layer"],
    path: string,
  ) {
    fsImpl.setFile(
      path,
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)", create: ["src/x.ts"] }),
    );
    const approved = await run(
      transitionArtifact(path, "Approved", APPROVE_OPTS).pipe(Effect.provide(layer)),
    );
    expect(Either.isRight(approved)).toBe(true);
  }

  // Another plan's record is never read.
  it("an unreadable record of another plan never affects a plan", async () => {
    const { fsImpl, layer } = fullHarness();
    await approve(fsImpl, layer, PLAN_A);
    await approve(fsImpl, layer, PLAN_B);
    fsImpl.setFile(RECORD_B, "{ not valid json");

    // Approving C succeeds with B's record unreadable.
    await approve(fsImpl, layer, PLAN_C);
    expect(fsImpl.getFile(RECORD_C)).toBeDefined();

    const verdictA = await run(
      computeStalenessForPlan(PLAN_A, fsImpl.getFile(PLAN_A) as string, [], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );
    expect(verdictA).toEqual(Either.right({ kind: "fresh" }));

    const { report } = await Effect.runPromise(
      plansStalenessReport(REPORT_OPTS).pipe(Effect.provide(layer)),
    );
    expect(report.map((e) => e.path)).toEqual([PLAN_A, PLAN_B, PLAN_C]);
    expect(report.find((e) => e.path === PLAN_A)?.result).toEqual({ kind: "fresh" });
    expect(report.find((e) => e.path === PLAN_C)?.result).toEqual({ kind: "fresh" });
    const b = report.find((e) => e.path === PLAN_B)?.result;
    expect(b?.kind).toBe("error");
    if (b?.kind === "error") expect(b.message).toContain(`${RECORD_B}: not valid JSON`);

    expect(fsImpl.getFile(RECORD_B)).toBe("{ not valid json");
  });

  // A missing record file is no record.
  it("a plan whose record file is missing computes missing-record", async () => {
    const { fsImpl, layer } = fullHarness();
    await approve(fsImpl, layer, PLAN_A);
    await Effect.runPromise(
      Effect.flatMap(FileSystem, (fs) => fs.remove(RECORD_A)).pipe(Effect.provide(layer)),
    );

    const verdict = await run(
      computeStalenessForPlan(PLAN_A, fsImpl.getFile(PLAN_A) as string, [], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );
    expect(Either.isRight(verdict) && verdict.right.kind).toBe("missing-record");
  });

  // Unreadable record files are refused and kept.
  it("refuses a plan's own unreadable record file, reporting an error entry", async () => {
    const { fsImpl, layer } = fullHarness();
    await approve(fsImpl, layer, PLAN_A);
    const { $schema: _schema, ...withoutSchema } = JSON.parse(
      fsImpl.getFile(RECORD_A) as string,
    ) as Record<string, unknown>;
    const text = JSON.stringify(withoutSchema);
    fsImpl.setFile(RECORD_A, text);

    const verdict = await run(
      computeStalenessForPlan(PLAN_A, fsImpl.getFile(PLAN_A) as string, [], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );
    expect(Either.isLeft(verdict)).toBe(true);
    if (Either.isLeft(verdict)) {
      expect(verdict.left).toBeInstanceOf(ApprovalRecordUnreadableError);
      expect(verdict.left.message).toContain(`${RECORD_A}: plan approval record has no $schema`);
    }

    const { report } = await Effect.runPromise(
      plansStalenessReport(REPORT_OPTS).pipe(Effect.provide(layer)),
    );
    expect(report.map((e) => e.result.kind)).toEqual(["error"]);
    expect(fsImpl.getFile(RECORD_A)).toBe(text);
  });

  // Record files are not artifacts: the walk sees only the .md entries.
  it("the staleness report ignores the approvals/ directory", async () => {
    const { fsImpl, layer } = fullHarness();
    await approve(fsImpl, layer, PLAN_A);
    fsImpl.setFile("docs/plans/approvals/2609101299-gone-plan.json", "{ not valid json");

    const { report } = await Effect.runPromise(
      plansStalenessReport(REPORT_OPTS).pipe(Effect.provide(layer)),
    );
    expect(report).toEqual([{ path: PLAN_A, result: { kind: "fresh" } }]);
  });
});

describe("orphan record files", () => {
  const PLAN_A = "docs/plans/2609101240-alpha-plan.md";
  const GONE_RECORD = "docs/plans/approvals/2609300900-gone-plan.json";
  const GONE_PLAN = "docs/plans/2609300900-gone-plan.md";
  const SPEC_ORPHAN = "docs/specs/approvals/2609010000-gone.json";

  async function approvedPlanHarness() {
    const harness = fullHarness();
    harness.fsImpl.setFile(
      PLAN_A,
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)", create: ["src/x.ts"] }),
    );
    const approved = await run(
      transitionArtifact(PLAN_A, "Approved", APPROVE_OPTS).pipe(Effect.provide(harness.layer)),
    );
    expect(Either.isRight(approved)).toBe(true);
    return harness;
  }

  function report(layer: ReturnType<typeof fullHarness>["layer"]) {
    return Effect.runPromise(plansStalenessReport(REPORT_OPTS).pipe(Effect.provide(layer)));
  }

  it("lists a plan record whose plan does not exist, leaving the report and every file unchanged", async () => {
    const { fsImpl, layer } = await approvedPlanHarness();
    const without = await report(layer);
    expect(without.orphanRecords).toEqual([]);

    // Contents are copied from a live record: the orphan rule looks at names only.
    fsImpl.setFile(GONE_RECORD, fsImpl.getFile("docs/plans/approvals/2609101240-alpha-plan.json")!);
    // A spec orphan is another kind: plans status never reports it.
    fsImpl.setFile(SPEC_ORPHAN, "{}");
    const before = new Map(fsImpl.files);

    const withOrphan = await report(layer);
    expect(withOrphan.orphanRecords).toEqual([{ recordFile: GONE_RECORD, artifact: GONE_PLAN }]);
    expect(withOrphan.report).toEqual(without.report);
    expect(fsImpl.files).toEqual(before);

    await Effect.runPromise(
      Effect.flatMap(FileSystem, (fs) => fs.remove(GONE_RECORD)).pipe(Effect.provide(layer)),
    );
    expect((await report(layer)).orphanRecords).toEqual([]);
  });

  it("an unreadable orphan is still only an orphan", async () => {
    const { fsImpl, layer } = await approvedPlanHarness();
    fsImpl.setFile(GONE_RECORD, "{ not valid json");

    const result = await report(layer);
    expect(result.orphanRecords).toEqual([{ recordFile: GONE_RECORD, artifact: GONE_PLAN }]);
    expect(result.report).toEqual([{ path: PLAN_A, result: { kind: "fresh" } }]);
  });

  it("a record whose plan was completed into archive/ is an orphan; other entries are ignored", async () => {
    const { fsImpl, layer } = await approvedPlanHarness();
    fsImpl.setFile("docs/plans/archive/2609300900-gone-plan.md", "archived");
    fsImpl.setFile(GONE_RECORD, "{}");
    fsImpl.setFile("docs/plans/approvals/notes.txt", "not a record");
    fsImpl.setFile("docs/plans/approvals/nested/2609300901-deep-plan.json", "{}");

    const result = await report(layer);
    expect(result.orphanRecords).toEqual([{ recordFile: GONE_RECORD, artifact: GONE_PLAN }]);
  });

  it("orders orphans by record file", async () => {
    const { fsImpl, layer } = await approvedPlanHarness();
    fsImpl.setFile("docs/plans/approvals/2609300902-zeta-plan.json", "{}");
    fsImpl.setFile("docs/plans/approvals/2609300901-eta-plan.json", "{}");

    const result = await report(layer);
    expect(result.orphanRecords.map((o) => o.recordFile)).toEqual([
      "docs/plans/approvals/2609300901-eta-plan.json",
      "docs/plans/approvals/2609300902-zeta-plan.json",
    ]);
  });

  it("reports no orphans when no approvals directory exists", async () => {
    const { layer } = fullHarness();
    expect(await report(layer)).toEqual({ report: [], orphanRecords: [] });
  });
});

describe("old approval ledger refusal", () => {
  const PLAN = "docs/plans/2609101240-thing-plan.md";

  for (const ledgerPath of ["docs/plans/approvals.json", "docs/specs/approvals.json"]) {
    // An Approved plan with its record, so without the ledger both use cases
    // would succeed; then the ledger is added on top.
    async function seeded() {
      const harness = fullHarness();
      harness.fsImpl.setFile(
        PLAN,
        deterministicPlanMd({ status: "Draft", sourceSpec: "(none)", create: ["src/x.ts"] }),
      );
      const approved = await run(
        transitionArtifact(PLAN, "Approved", APPROVE_OPTS).pipe(Effect.provide(harness.layer)),
      );
      expect(Either.isRight(approved)).toBe(true);
      harness.fsImpl.setFile(ledgerPath, `{"version":1,"records":{}}`);
      return { ...harness, before: new Map(harness.fsImpl.files) };
    }

    function expectRefused(result: Either.Either<unknown, unknown>): void {
      expect(Either.isLeft(result)).toBe(true);
      if (!Either.isLeft(result)) return;
      expect(result.left).toBeInstanceOf(ApprovalLedgerMigrationRequiredError);
      expect((result.left as ApprovalLedgerMigrationRequiredError).ledgerPath).toBe(ledgerPath);
    }

    it(`plansStalenessReport fails as a whole with only ${ledgerPath}, writing nothing`, async () => {
      const { fsImpl, backendImpl, layer, before } = await seeded();

      expectRefused(await run(plansStalenessReport(REPORT_OPTS).pipe(Effect.provide(layer))));

      expect(new Map(fsImpl.files)).toEqual(before);
      expect(backendImpl.runCalls).toHaveLength(0);
      expect(backendImpl.completeCalls).toHaveLength(0);
    });

    it(`computeStalenessForPlan refuses with only ${ledgerPath}, writing nothing`, async () => {
      const { fsImpl, layer, before } = await seeded();
      const md = fsImpl.getFile(PLAN) as string;

      expectRefused(
        await run(
          computeStalenessForPlan(PLAN, md, [], { repoRoot: REPO_ROOT }).pipe(
            Effect.provide(layer),
          ),
        ),
      );

      expect(new Map(fsImpl.files)).toEqual(before);
    });
  }
});
