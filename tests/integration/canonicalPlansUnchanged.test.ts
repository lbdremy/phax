// The ac-additive baseline: what `phax plans lint`, `plans overlap` and `plans status` print for
// canonical plans, recorded before the canonical-path change. The literals below must never be
// edited by a later phase.
import { readFileSync } from "node:fs";
import { Effect, Layer, Result } from "effect";
import { describe, expect, it } from "vitest";
import { lintPlan } from "../../src/app/lintPlan.js";
import { computeStaleness } from "../../src/domain/artifact/lineage.js";
import { renderStalenessReport } from "../../src/domain/artifact/render.js";
import { finalizeExtractedPlan } from "../../src/domain/plan/finalize.js";
import { renderLintReport } from "../../src/domain/plan/lintRender.js";
import { extractPlanDeterministic } from "../../src/domain/plan/parsePlanMarkdown.js";
import { readPlanPath } from "../../src/domain/plan/planPath.js";
import { buildFootprint, computePlanOverlap } from "../../src/domain/planOverlap/compute.js";
import { planInputFromPhaxPlan } from "../../src/domain/planOverlap/fromPhaxPlan.js";
import { renderPlanOverlap } from "../../src/domain/planOverlap/render.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import type { PhaxPlan } from "../../src/schemas/phaxPlan.js";

const PLANS = [
  { name: "hello-world", path: "examples/hello-world/plan.md" },
  { name: "artifact-revise", path: "docs/plans/archive/2611131401-artifact-revise-plan.md" },
  { name: "command-contracts", path: "docs/plans/archive/2611050752-command-contracts-plan.md" },
] as const;

type PlanName = (typeof PLANS)[number]["name"];

const REPO_ROOT = "/repo";

const config = {
  stateRoot: "/home/user/.phax",
  namespace: "test-project",
  extractPlanModel: "claude-sonnet-4-6",
  extractPlanEffort: "medium",
  raw: {
    version: 1,
    name: "test-project",
    state: { root: "/home/user/.phax" },
    gateProfiles: {
      standard: [{ command: "pnpm test", surface: "local", firing: "every-phase" }],
    },
  },
  security: {
    profile: "secure",
    filesystem: { allowRead: [], allowWrite: [] },
    network: { profile: "provider-only", allowDomains: [] },
    mcp: { mode: "disabled", allow: [] },
    agentCommands: ["pnpm"],
  },
  repoRoot: REPO_ROOT,
  maxFixAttempts: 1,
  fileReconciliationMode: "report_only",
  publish: {
    auto: false,
    remote: "origin",
    provider: "github",
    pushBranch: true,
    createPullRequest: true,
  },
  complianceReview: { enabled: false, model: "claude-sonnet-4-6", effort: "medium" },
} as unknown as ResolvedConfig;

const textOf = (path: string): string => readFileSync(path, "utf8");

function readPlan(path: string): PhaxPlan {
  const extracted = extractPlanDeterministic(textOf(path));
  if (Result.isFailure(extracted)) throw new Error(`${path}: ${extracted.failure.message}`);
  const finalized = finalizeExtractedPlan(extracted.success, textOf(path));
  if (Result.isFailure(finalized)) throw new Error(`${path}: ${finalized.failure.message}`);
  return finalized.success.plan;
}

const plans = PLANS.map((p) => ({ ...p, plan: readPlan(p.path) }));

function planPathsOf(plan: PhaxPlan): string[] {
  return plan.phases.flatMap((p) => [
    ...p.plannedFilesToCreate,
    ...p.plannedFilesToEdit,
    ...p.optionalFilesToEdit,
  ]);
}

// A loose plan at the root of a repository whose working tree holds every file the plan edits
// without any phase creating it, so the report shows the plan's own findings and not one
// "does not exist" per edit.
function lintOutput(path: string): Promise<string> {
  const fakeFs = makeFakeFileSystem();
  fakeFs.impl.setFile(`${REPO_ROOT}/plan.md`, textOf(path));
  const phases = readPlan(path).phases;
  const created = new Set(phases.flatMap((p) => p.plannedFilesToCreate));
  for (const p of phases) {
    for (const file of [...p.plannedFilesToEdit, ...p.optionalFilesToEdit]) {
      if (!created.has(file)) fakeFs.impl.setFile(`${REPO_ROOT}/${file}`, "");
    }
  }
  const fakeShell = makeFakeShell();
  fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "", stderr: "" });
  return Effect.runPromise(
    lintPlan({
      planMdPath: `${REPO_ROOT}/plan.md`,
      reportPath: "plan.md",
      repoRelPath: "plan.md",
      config,
    }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
  ).then((report) => renderLintReport(report));
}

const inputOf = (p: (typeof plans)[number]) => planInputFromPhaxPlan(p.plan, p.path, p.path);

// A fixed approval record per plan; the changed files meet only one plan's footprint.
function statusOutput(): string {
  const changed = ["src/greet.ts", "unrelated/notes.txt"];
  return renderStalenessReport(
    plans.map((p) => ({
      path: p.path,
      result: computeStaleness({
        planPath: p.path,
        record: {
          planFingerprint: `fixed-${p.name}`,
          approvedAt: "2026-01-01T00:00:00.000Z",
          baseline: "baseline-0",
          sourceSpec: null,
        },
        baselineExists: true,
        currentPlanFingerprint: `fixed-${p.name}`,
        currentSpecFingerprint: null,
        changedFilesSinceBaseline: changed,
        footprint: Array.from(buildFootprint(inputOf(p)).all),
      }),
    })),
  );
}

describe("canonical plans' outputs (ac-additive baseline)", () => {
  it("every plan path of the three plans is canonical", () => {
    for (const p of plans) {
      for (const path of planPathsOf(p.plan)) {
        expect(readPlanPath(path).kind, `${p.path}: ${path}`).toBe("canonical");
      }
    }
  });

  for (const p of PLANS) {
    it(`lint: ${p.name}`, async () => {
      const out = await lintOutput(p.path);
      expect(out).toBe(LINT[p.name]);
    });
  }

  it("overlap", () => {
    const out = renderPlanOverlap(computePlanOverlap(plans.map(inputOf)));
    expect(out).toBe(OVERLAP);
  });

  it("status", () => {
    const out = statusOutput();
    expect(out).toBe(STATUS);
  });
});

const LINT: Record<PlanName, string> = {
  "hello-world":
    "plan.md: 0 errors, 3 warnings\nwarning  models       phase-01  claude-sonnet-5 / low: no bound governs; departs from the policy default (claude-sonnet-5-5 / medium) with no **Assignment reason:** line\nwarning  models       phase-02  claude-sonnet-5 / low: no bound governs; departs from the policy default (claude-sonnet-5-5 / medium) with no **Assignment reason:** line\nwarning  models       phase-03  claude-sonnet-5 / low: no bound governs; departs from the policy default (claude-sonnet-5-5 / medium) with no **Assignment reason:** line",
  "artifact-revise":
    'plan.md: 1 error, 1 warning\nerror    acceptance   phase-05  acceptance phase declared, but no "acceptance" provider is configured (phax.json, phax.local.json or ~/.phax/config.json)\nwarning  tests        -         source spec docs/specs/2610271505-artifact-revise.md is not found, here or under docs/specs/archive/: no criterion id is checked',
  "command-contracts":
    'plan.md: 1 error, 1 warning\nerror    acceptance   phase-04  acceptance phase declared, but no "acceptance" provider is configured (phax.json, phax.local.json or ~/.phax/config.json)\nwarning  tests        -         source spec docs/specs/2611031738-command-contracts.md is not found, here or under docs/specs/archive/: no criterion id is checked',
};

const OVERLAP =
  "=== Plan Overlap Analysis ===\n\nFootprints:\n  examples/hello-world/plan.md: 3 file(s)\n  docs/plans/archive/2611131401-artifact-revise-plan.md: 83 file(s)\n  docs/plans/archive/2611050752-command-contracts-plan.md: 168 file(s)\n\nPairwise matrix:\n  examples/hello-world/plan.md <-> docs/plans/archive/2611131401-artifact-revise-plan.md: hard -> README.md\n  examples/hello-world/plan.md <-> docs/plans/archive/2611050752-command-contracts-plan.md: hard -> README.md\n  docs/plans/archive/2611131401-artifact-revise-plan.md <-> docs/plans/archive/2611050752-command-contracts-plan.md: hard -> README.md, tests/unit/architecturalGuards.test.ts, src/cli/commands/runLayers.ts, src/domain/security/phaseGuard.ts, phax.usage.kdl, docs/cli/reference.md, site/pages.ts, docs/upgrading.md, src/cli/definitions/shared.ts, tests/helpers/runnerCall.ts, docs/json-output.md\n\nClean pairs: none\n\nLargest parallel-safe set: docs/plans/archive/2611050752-command-contracts-plan.md\n\nWave schedule (greedy):\n  Wave 1: examples/hello-world/plan.md\n  Wave 2: docs/plans/archive/2611131401-artifact-revise-plan.md\n  Wave 3: docs/plans/archive/2611050752-command-contracts-plan.md\n\n---\nCaveats:\n  Declared, not guaranteed: this report reflects each plan's declared file intentions,\n  not what agents will actually touch. phax reconciles declared vs actual after each phase.\n  File-level, not hunk-level: two plans editing different regions of the same file are\n  flagged as a conflict even though git may auto-merge them.\n  Regenerated artifacts (phax.usage.kdl, docs/cli/reference.md) are a hard-conflict\n  class: two plans that both regenerate them will collide on merge even when neither\n  lists them as a manual edit.";

const STATUS =
  "=== Plan Staleness Report ===\n\nexamples/hello-world/plan.md: STALE\n  ground-changed: src/greet.ts changed since baseline baseline-0\ndocs/plans/archive/2611131401-artifact-revise-plan.md: fresh\ndocs/plans/archive/2611050752-command-contracts-plan.md: fresh";
