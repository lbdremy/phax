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
import { ArtifactValidationError } from "../../src/domain/errors.js";

const REPO_ROOT = "/fake-repo";
const NOW_ISO = "2026-08-10T12:00:00.000Z";
const APPROVE_OPTS = { repoRoot: REPO_ROOT, nowIso: NOW_ISO, commit: false };

function specMd(status: string): string {
  return `---\nstatus: ${status}\ndate: 2026-01-01\naudience: test\nscope: test\n---\n# Some spec\n\n## Overview\n\nSpec body v1.\n`;
}

function planMd(sourceSpec: string): string {
  const ss = sourceSpec === "(none)" ? "null" : sourceSpec;
  return `---\nstatus: Draft\nsource-spec: ${ss}\n---\n# Some plan\n\n## Overview\n\nBody text.\n`;
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
    fsImpl.setFile("docs/plans/40-plan.md", planMd("(none)"));

    const verdict = await run(
      computeStalenessForPlan("docs/plans/40-plan.md", planMd("(none)"), [], {
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
    fsImpl.setFile("docs/plans/40-plan.md", planMd("(none)"));

    await run(
      transitionArtifact("docs/plans/40-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const baseline = gitImpl.headCommitValue;
    gitImpl.existingCommits.delete(baseline);

    const currentPlanMd = fsImpl.getFile("docs/plans/40-plan.md") as string;
    const verdict = await run(
      computeStalenessForPlan("docs/plans/40-plan.md", currentPlanMd, [], {
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
    fsImpl.setFile("docs/specs/22-foo.md", specMd("Approved"));
    fsImpl.setFile("docs/plans/40-plan.md", planMd("docs/specs/22-foo.md"));

    await run(
      transitionArtifact("docs/plans/40-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const currentPlanMd = fsImpl.getFile("docs/plans/40-plan.md") as string;

    const verdict = await run(
      computeStalenessForPlan("docs/plans/40-plan.md", currentPlanMd, ["src/foo.ts"], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(verdict)).toBe(true);
    if (Either.isRight(verdict)) expect(verdict.right).toEqual({ kind: "fresh" });
  });

  it("a declared spec's content edit reports spec-changed", async () => {
    const { fsImpl, layer } = coreHarness();
    fsImpl.setFile("docs/specs/22-foo.md", specMd("Approved"));
    fsImpl.setFile("docs/plans/40-plan.md", planMd("docs/specs/22-foo.md"));

    await run(
      transitionArtifact("docs/plans/40-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const currentPlanMd = fsImpl.getFile("docs/plans/40-plan.md") as string;
    fsImpl.setFile("docs/specs/22-foo.md", specMd("Approved").replace("v1", "v2 — edited"));

    const verdict = await run(
      computeStalenessForPlan("docs/plans/40-plan.md", currentPlanMd, [], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(verdict)).toBe(true);
    if (Either.isRight(verdict)) {
      expect(verdict.right).toEqual({
        kind: "stale",
        evidence: [{ reason: "spec-changed", specPath: "docs/specs/22-foo.md" }],
      });
    }
  });

  it("a spec-less ((none)) plan never reports spec-changed", async () => {
    const { fsImpl, layer } = coreHarness();
    fsImpl.setFile("docs/plans/40-plan.md", planMd("(none)"));

    await run(
      transitionArtifact("docs/plans/40-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const currentPlanMd = fsImpl.getFile("docs/plans/40-plan.md") as string;

    const verdict = await run(
      computeStalenessForPlan("docs/plans/40-plan.md", currentPlanMd, [], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(verdict)).toBe(true);
    if (Either.isRight(verdict)) expect(verdict.right).toEqual({ kind: "fresh" });
  });

  it("a footprint file listed in changedFilesSince reports ground-changed naming exactly that file", async () => {
    const { fsImpl, gitImpl, layer } = coreHarness();
    fsImpl.setFile("docs/plans/40-plan.md", planMd("(none)"));

    await run(
      transitionArtifact("docs/plans/40-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const currentPlanMd = fsImpl.getFile("docs/plans/40-plan.md") as string;
    gitImpl.setChangedFilesSince(gitImpl.headCommitValue, ["src/foo.ts", "unrelated.ts"]);

    const verdict = await run(
      computeStalenessForPlan("docs/plans/40-plan.md", currentPlanMd, ["src/foo.ts"], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
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
    fsImpl.setFile("docs/plans/40-plan.md", planMd("(none)"));

    await run(
      transitionArtifact("docs/plans/40-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const currentPlanMd = fsImpl.getFile("docs/plans/40-plan.md") as string;
    gitImpl.setChangedFilesSince(gitImpl.headCommitValue, ["unrelated.ts"]);

    const verdict = await run(
      computeStalenessForPlan("docs/plans/40-plan.md", currentPlanMd, ["src/foo.ts"], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(verdict)).toBe(true);
    if (Either.isRight(verdict)) expect(verdict.right).toEqual({ kind: "fresh" });
  });

  it("editing the plan body after approval reports self-changed", async () => {
    const { fsImpl, layer } = coreHarness();
    fsImpl.setFile("docs/plans/40-plan.md", planMd("(none)"));

    await run(
      transitionArtifact("docs/plans/40-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const approvedMd = fsImpl.getFile("docs/plans/40-plan.md") as string;
    const editedMd = approvedMd.replace("Body text.", "Body text v2 — edited.");

    const verdict = await run(
      computeStalenessForPlan("docs/plans/40-plan.md", editedMd, [], {
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
    fsImpl.setFile("docs/specs/22-foo.md", specMd("Approved"));
    fsImpl.setFile("docs/plans/40-plan.md", planMd("docs/specs/22-foo.md"));

    await run(
      transitionArtifact("docs/plans/40-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const approvedMd = fsImpl.getFile("docs/plans/40-plan.md") as string;
    const editedMd = approvedMd.replace("Body text.", "Body text v2 — edited.");

    fsImpl.setFile("docs/specs/22-foo.md", specMd("Approved").replace("v1", "v2 — edited"));
    gitImpl.setChangedFilesSince(gitImpl.headCommitValue, ["src/foo.ts"]);

    const verdict = await run(
      computeStalenessForPlan("docs/plans/40-plan.md", editedMd, ["src/foo.ts"], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(verdict)).toBe(true);
    if (Either.isRight(verdict)) {
      expect(verdict.right).toEqual({
        kind: "stale",
        evidence: [
          { reason: "spec-changed", specPath: "docs/specs/22-foo.md" },
          { reason: "ground-changed", baseline: gitImpl.headCommitValue, files: ["src/foo.ts"] },
          { reason: "self-changed" },
        ],
      });
    }
  });

  it("a dangling recorded Source-Spec fails with ArtifactValidationError naming it", async () => {
    const { fsImpl, layer } = coreHarness();
    fsImpl.setFile("docs/specs/22-foo.md", specMd("Approved"));
    fsImpl.setFile("docs/plans/40-plan.md", planMd("docs/specs/22-foo.md"));

    await run(
      transitionArtifact("docs/plans/40-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const currentPlanMd = fsImpl.getFile("docs/plans/40-plan.md") as string;
    fsImpl.remove("docs/specs/22-foo.md");

    const verdict = await run(
      computeStalenessForPlan("docs/plans/40-plan.md", currentPlanMd, [], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isLeft(verdict)).toBe(true);
    if (Either.isLeft(verdict)) {
      expect(verdict.left).toBeInstanceOf(ArtifactValidationError);
      expect((verdict.left as ArtifactValidationError).message).toContain("docs/specs/22-foo.md");
    }
  });

  it("re-approval on edited content restores freshness", async () => {
    const { fsImpl, layer } = coreHarness();
    fsImpl.setFile("docs/plans/40-plan.md", planMd("(none)"));

    await run(
      transitionArtifact("docs/plans/40-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const approvedMd = fsImpl.getFile("docs/plans/40-plan.md") as string;
    const editedMd = approvedMd.replace("Body text.", "Body text v2 — edited.");
    fsImpl.setFile("docs/plans/40-plan.md", editedMd);

    const staleVerdict = await run(
      computeStalenessForPlan("docs/plans/40-plan.md", editedMd, [], {
        repoRoot: REPO_ROOT,
      }).pipe(Effect.provide(layer)),
    );
    expect(Either.isRight(staleVerdict)).toBe(true);
    if (Either.isRight(staleVerdict)) expect(staleVerdict.right.kind).toBe("stale");

    await run(
      transitionArtifact("docs/plans/40-plan.md", "Approved", {
        repoRoot: REPO_ROOT,
        nowIso: "2026-08-11T09:00:00.000Z",
        commit: false,
      }).pipe(Effect.provide(layer)),
    );
    const reapprovedMd = fsImpl.getFile("docs/plans/40-plan.md") as string;

    const freshVerdict = await run(
      computeStalenessForPlan("docs/plans/40-plan.md", reapprovedMd, [], {
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
  return `---
status: ${opts.status}
source-spec: ${ss}
---
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
      "docs/plans/40-plan.md",
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)", create: ["src/foo.ts"] }),
    );
    await run(
      transitionArtifact("docs/plans/40-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    const verdict = await run(
      computePlanStaleness("docs/plans/40-plan.md", REPORT_OPTS).pipe(Effect.provide(layer)),
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
      "docs/plans/40-fresh-plan.md",
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)", create: ["src/fresh.ts"] }),
    );
    await run(
      transitionArtifact("docs/plans/40-fresh-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    fsImpl.setFile(
      "docs/plans/41-stale-plan.md",
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)", create: ["src/stale.ts"] }),
    );
    await run(
      transitionArtifact("docs/plans/41-stale-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const approvedStaleMd = fsImpl.getFile("docs/plans/41-stale-plan.md") as string;
    fsImpl.setFile(
      "docs/plans/41-stale-plan.md",
      approvedStaleMd.replace("Body text.", "Body text v2 — edited after approval."),
    );

    fsImpl.setFile(
      "docs/plans/42-draft-plan.md",
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)" }),
    );

    const beforeFresh = fsImpl.getFile("docs/plans/40-fresh-plan.md");
    const beforeStale = fsImpl.getFile("docs/plans/41-stale-plan.md");
    const beforeDraft = fsImpl.getFile("docs/plans/42-draft-plan.md");

    const report = await Effect.runPromise(
      plansStalenessReport(REPORT_OPTS).pipe(Effect.provide(layer)),
    );

    expect(report.map((e) => e.path)).toEqual([
      "docs/plans/40-fresh-plan.md",
      "docs/plans/41-stale-plan.md",
    ]);
    const fresh = report.find((e) => e.path === "docs/plans/40-fresh-plan.md");
    const stale = report.find((e) => e.path === "docs/plans/41-stale-plan.md");
    expect(fresh?.result).toEqual({ kind: "fresh" });
    expect(stale?.result).toEqual({
      kind: "stale",
      evidence: [{ reason: "self-changed" }],
    });

    // Report-only sweep: no file was rewritten, and the Draft plan is untouched.
    expect(fsImpl.getFile("docs/plans/40-fresh-plan.md")).toBe(beforeFresh);
    expect(fsImpl.getFile("docs/plans/41-stale-plan.md")).toBe(beforeStale);
    expect(fsImpl.getFile("docs/plans/42-draft-plan.md")).toBe(beforeDraft);
    expect(fsImpl.getFile("docs/plans/42-draft-plan.md")).toContain("status: Draft");

    expect(backendImpl.runCalls).toHaveLength(0);
    expect(backendImpl.completeCalls).toHaveLength(0);

    const rendered = renderStalenessReport(report);
    expect(rendered).toContain("docs/plans/40-fresh-plan.md: fresh");
    expect(rendered).toContain("docs/plans/41-stale-plan.md: STALE");
    expect(rendered).toContain("self-changed");
  });

  it("returns an empty report when docs/plans does not exist", async () => {
    const { layer } = fullHarness();
    const report = await Effect.runPromise(
      plansStalenessReport(REPORT_OPTS).pipe(Effect.provide(layer)),
    );
    expect(report).toEqual([]);
  });

  it("a per-plan extraction failure yields an error entry and the sweep still completes", async () => {
    const { fsImpl, layer } = fullHarness();

    fsImpl.setFile(
      "docs/plans/40-good-plan.md",
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)", create: ["src/good.ts"] }),
    );
    await run(
      transitionArtifact("docs/plans/40-good-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    // Not deterministically parseable (no "## Required commands" / phase section);
    // with noExtract: true and no cache entry, extraction fails outright.
    fsImpl.setFile("docs/plans/41-bad-plan.md", planMd("(none)"));
    await run(
      transitionArtifact("docs/plans/41-bad-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    const report = await Effect.runPromise(
      plansStalenessReport({ ...REPORT_OPTS, noExtract: true }).pipe(Effect.provide(layer)),
    );

    expect(report).toHaveLength(2);
    const good = report.find((e) => e.path === "docs/plans/40-good-plan.md");
    const bad = report.find((e) => e.path === "docs/plans/41-bad-plan.md");
    expect(good?.result).toEqual({ kind: "fresh" });
    expect(bad?.result.kind).toBe("error");
  });

  it("a plan that fails artifact validation yields an error entry before any extraction", async () => {
    const { fsImpl, backendImpl, layer } = fullHarness();

    // Invalid Status value: validateArtifact rejects it up front, so the entry
    // never reaches the Approved filter or the extraction pipeline.
    fsImpl.setFile(
      "docs/plans/40-malformed-plan.md",
      "---\nstatus: Nonsense\nsource-spec: null\n---\n# Some plan\n\n## Overview\n\nBody text.\n",
    );

    const report = await Effect.runPromise(
      plansStalenessReport(REPORT_OPTS).pipe(Effect.provide(layer)),
    );

    expect(report).toHaveLength(1);
    const entry = report[0];
    expect(entry?.path).toBe("docs/plans/40-malformed-plan.md");
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
      "docs/plans/40-live-plan.md",
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)", create: ["src/live.ts"] }),
    );
    await run(
      transitionArtifact("docs/plans/40-live-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    // An archived (terminal) plan under docs/plans/archive/. fs.list returns the
    // bare "archive" directory entry, which the .md filter skips — its contents
    // are never recursed into.
    fsImpl.setFile(
      "docs/plans/archive/38-old-plan.md",
      deterministicPlanMd({ status: "Completed", sourceSpec: "(none)" }),
    );

    const report = await Effect.runPromise(
      plansStalenessReport(REPORT_OPTS).pipe(Effect.provide(layer)),
    );

    expect(report.map((e) => e.path)).toEqual(["docs/plans/40-live-plan.md"]);
  });
});

describe("applyStalenessReport", () => {
  it("flips exactly the stale-computed plans to Stale, leaves fresh ones Approved, and never touches the backend", async () => {
    const { fsImpl, backendImpl, layer } = fullHarness();

    fsImpl.setFile(
      "docs/plans/40-fresh-plan.md",
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)", create: ["src/fresh.ts"] }),
    );
    await run(
      transitionArtifact("docs/plans/40-fresh-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );

    fsImpl.setFile(
      "docs/plans/41-stale-plan.md",
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)", create: ["src/stale.ts"] }),
    );
    await run(
      transitionArtifact("docs/plans/41-stale-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    const approvedStaleMd = fsImpl.getFile("docs/plans/41-stale-plan.md") as string;
    fsImpl.setFile(
      "docs/plans/41-stale-plan.md",
      approvedStaleMd.replace("Body text.", "Body text v2 — edited after approval."),
    );

    const report = await Effect.runPromise(
      plansStalenessReport(REPORT_OPTS).pipe(Effect.provide(layer)),
    );

    const flipped = await run(
      applyStalenessReport(report, APPROVE_OPTS).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(flipped)).toBe(true);
    if (Either.isRight(flipped)) {
      expect(flipped.right.map((f) => f.path)).toEqual(["docs/plans/41-stale-plan.md"]);
      const rendered = renderStalenessApply(flipped.right);
      expect(rendered).toContain("docs/plans/41-stale-plan.md: Approved -> Stale");
    }

    expect(fsImpl.getFile("docs/plans/41-stale-plan.md")).toContain("status: Stale");
    expect(fsImpl.getFile("docs/plans/40-fresh-plan.md")).toContain("status: Approved");

    expect(backendImpl.runCalls).toHaveLength(0);
    expect(backendImpl.completeCalls).toHaveLength(0);
  });

  it("flips a missing-record entry (vanished baseline) to Stale", async () => {
    const { fsImpl, gitImpl, layer } = fullHarness();

    fsImpl.setFile(
      "docs/plans/40-plan.md",
      deterministicPlanMd({ status: "Draft", sourceSpec: "(none)", create: ["src/foo.ts"] }),
    );
    await run(
      transitionArtifact("docs/plans/40-plan.md", "Approved", APPROVE_OPTS).pipe(
        Effect.provide(layer),
      ),
    );
    // Baseline commit garbage-collected: the approval record survives but its
    // baseline is gone, so the plan computes missing-record while still Approved.
    gitImpl.existingCommits.delete(gitImpl.headCommitValue);

    const report = await Effect.runPromise(
      plansStalenessReport(REPORT_OPTS).pipe(Effect.provide(layer)),
    );
    expect(report.find((e) => e.path === "docs/plans/40-plan.md")?.result.kind).toBe(
      "missing-record",
    );

    const flipped = await run(
      applyStalenessReport(report, APPROVE_OPTS).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(flipped)).toBe(true);
    if (Either.isRight(flipped)) {
      expect(flipped.right.map((f) => f.path)).toEqual(["docs/plans/40-plan.md"]);
      expect(flipped.right[0]?.verdict.kind).toBe("missing-record");
    }
    expect(fsImpl.getFile("docs/plans/40-plan.md")).toContain("status: Stale");
  });
});
