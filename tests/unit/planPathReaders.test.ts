// Acceptance tests (spec plan-path-canonical §8): every reader that compares a plan's paths gives a
// plan.md writing `./src/x.ts` the answer it gives one writing `src/x.ts`. Each test reads the
// plan.md through the deterministic reader and asserts the reading succeeded before it compares
// anything, so a plan that was skipped or refused cannot pass. What they judge with is frozen with
// them, so the plan.md builder below is local and imports no shared helper.
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { computeStaleness } from "../../src/domain/artifact/lineage.js";
import { finalizeExtractedPlan } from "../../src/domain/plan/finalize.js";
import { extractPlanDeterministic } from "../../src/domain/plan/parsePlanMarkdown.js";
import { buildFootprint, computePlanOverlap } from "../../src/domain/planOverlap/compute.js";
import { planInputFromPhaxPlan } from "../../src/domain/planOverlap/fromPhaxPlan.js";
import { reconcile } from "../../src/domain/reconciliation/reconcile.js";
import type { PhaxPlan } from "../../src/schemas/phaxPlan.js";

interface PhaseSpec {
  readonly create?: readonly string[];
  readonly edit?: readonly string[];
  readonly optional?: readonly string[];
}

function items(paths: readonly string[] | undefined): string {
  return paths === undefined || paths.length === 0
    ? "- (none)"
    : paths.map((p) => `- \`${p}\``).join("\n");
}

/** A frontmatter-free plan.md: one conforming phase per spec, paths written exactly as given. */
function planMd(phases: readonly PhaseSpec[]): string {
  const sections = phases.map((phase, i) => {
    const id = `phase-${String(i + 1).padStart(2, "0")}`;
    return `## ${id} — Phase ${i + 1} {#${id}}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

### Planned files to create

${items(phase.create)}

### Planned files to edit

${items(phase.edit)}

### Optional files that may be edited

${items(phase.optional)}

### Commit subject

feat(test): phase ${i + 1}

### Commit body

Does phase ${i + 1}.
`;
  });
  return `# Thing\n\n## Required commands\n\n- (none)\n\n${sections.join("\n")}`;
}

/** The plan phax would run for this plan.md, as `loadOrExtractPlan` reads it without the model. */
function readPlan(md: string): Result.Result<PhaxPlan, string> {
  const extracted = extractPlanDeterministic(md);
  if (Result.isFailure(extracted)) return Result.fail(extracted.failure.message);
  const finalized = finalizeExtractedPlan(extracted.success, md);
  if (Result.isFailure(finalized)) return Result.fail(finalized.failure.message);
  return Result.succeed(finalized.success.plan);
}

function planWriting(edit: string, create?: string): string {
  return planMd([{ edit: [edit], ...(create === undefined ? {} : { create: [create] }) }]);
}

const input = (plan: PhaxPlan, id: string) => planInputFromPhaxPlan(plan, id, id);

describe("ac-reconcile: Reconciliation matches a non-canonical planned path", () => {
  it("a phase that plans ./src/x.ts and changes src/x.ts edited a planned file, as the plan written src/x.ts did", () => {
    const dotted = readPlan(planWriting("./src/x.ts"));
    const canonical = readPlan(planWriting("src/x.ts"));
    expect(Result.isSuccess(canonical)).toBe(true);
    expect(Result.isSuccess(dotted)).toBe(true);
    if (!Result.isSuccess(dotted) || !Result.isSuccess(canonical)) return;

    const diff = [{ status: "modified", path: "src/x.ts" }] as const;
    const planned = (plan: PhaxPlan) => {
      const phase = plan.phases[0]!;
      return {
        create: phase.plannedFilesToCreate,
        edit: phase.plannedFilesToEdit,
        optional: phase.optionalFilesToEdit,
      };
    };
    const result = reconcile(planned(dotted.success), diff);

    expect(result.editedAsPlanned).toEqual(["src/x.ts"]);
    expect(result.missingPlannedEdit).toEqual([]);
    expect(result.unplannedEdited).toEqual([]);
    expect(result.hasDeviations).toBe(false);
    expect(result).toEqual(reconcile(planned(canonical.success), diff));
  });
});

describe("ac-overlap: Overlap sees one file under two spellings", () => {
  const sharedPaths = (a: string, b: string): string[] => {
    const planA = readPlan(a);
    const planB = readPlan(b);
    expect(Result.isSuccess(planA)).toBe(true);
    expect(Result.isSuccess(planB)).toBe(true);
    if (!Result.isSuccess(planA) || !Result.isSuccess(planB)) return [];
    const result = computePlanOverlap([input(planA.success, "a"), input(planB.success, "b")]);
    expect(result.edges).toHaveLength(1);
    return result.edges[0]!.shared.map((s) => s.path);
  };

  it("a plan editing ./src/x.ts and one editing src/x.ts share src/x.ts", () => {
    expect(sharedPaths(planWriting("./src/x.ts"), planWriting("src/x.ts"))).toEqual(["src/x.ts"]);
  });

  // Pull request #205's case, restated against plans read through the deterministic reader.
  it("pull request #205: ./src/x.ts and src//x.ts share one file, src/x.ts", () => {
    expect(sharedPaths(planWriting("./src/x.ts"), planWriting("src//x.ts"))).toEqual(["src/x.ts"]);
  });

  it("pull request #205: creating src/a/../x.ts and editing src/x.ts share one file, src/x.ts", () => {
    const creating = planMd([{ create: ["src/a/../x.ts"] }]);
    expect(sharedPaths(creating, planWriting("src/x.ts"))).toEqual(["src/x.ts"]);
  });
});

describe("ac-staleness: Staleness sees a change to a non-canonical planned file", () => {
  it("a change to src/x.ts gives the plan written ./src/x.ts the verdict of the plan written src/x.ts", () => {
    const dotted = readPlan(planWriting("./src/x.ts"));
    const canonical = readPlan(planWriting("src/x.ts"));
    expect(Result.isSuccess(canonical)).toBe(true);
    expect(Result.isSuccess(dotted)).toBe(true);
    if (!Result.isSuccess(dotted) || !Result.isSuccess(canonical)) return;

    const verdict = (plan: PhaxPlan) =>
      computeStaleness({
        planPath: "docs/plans/thing-plan.md",
        record: {
          planFingerprint: "fixed",
          approvedAt: "2026-01-01T00:00:00.000Z",
          baseline: "baseline-0",
          sourceSpec: null,
          code: null,
        },
        baselineExists: true,
        currentPlanFingerprint: "fixed",
        currentSpecFingerprint: null,
        changedFilesSinceBaseline: ["src/x.ts"],
        footprint: Array.from(buildFootprint(input(plan, "thing")).all),
        code: { kind: "unlinked" },
      });

    expect(verdict(canonical.success)).toEqual({
      kind: "stale",
      evidence: [{ reason: "ground-changed", baseline: "baseline-0", files: ["src/x.ts"] }],
    });
    expect(verdict(dotted.success)).toEqual(verdict(canonical.success));
  });
});
