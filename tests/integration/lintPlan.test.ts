import { describe, it, expect } from "vitest";
import { Effect, Exit } from "effect";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { lintPlan, type LintReport } from "../../src/app/lintPlan.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";

const REPO_ROOT = "/repo";
const PLAN_PATH = "/repo/docs/plans/60-thing-plan.md";

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

/** A conforming plan.md with one phase, parameterised where a test needs a defect. */
function planMd(
  overrides: {
    readonly requiredCommands?: string;
    readonly model?: string;
    readonly create?: string;
    readonly edit?: string;
  } = {},
): string {
  const {
    requiredCommands = "- (none)",
    model = "claude-sonnet-5",
    create = "- (none)",
    edit = "- (none)",
  } = overrides;
  return `# Thing

## Required commands

${requiredCommands}

## phase-01 — First Phase {#phase-01-first}

**Recommended model:** ${model}
**Recommended effort:** medium

### Planned files to create

${create}

### Planned files to edit

${edit}

### Optional files that may be edited

- (none)

### Commit subject

feat(test): do thing

### Commit body

Does the thing.
`;
}

function runLint(plan: string, files: Readonly<Record<string, string>> = {}) {
  const fakeFs = makeFakeFileSystem();
  fakeFs.impl.setFile(PLAN_PATH, plan);
  for (const [path, content] of Object.entries(files)) fakeFs.impl.setFile(path, content);

  // Deliberately provided with the filesystem layer alone: `lintPlan` must not
  // require a Backend, so it can never fall back to the extraction model.
  const effect: Effect.Effect<LintReport, unknown, never> = lintPlan({
    planMdPath: PLAN_PATH,
    config,
  }).pipe(Effect.provide(fakeFs.layer));

  return Effect.runPromise(effect);
}

describe("lintPlan", () => {
  it("returns no findings for a conforming plan whose files all resolve", async () => {
    const report = await runLint(planMd({ edit: "- src/a.ts" }), { "/repo/src/a.ts": "export {}" });

    expect(report.findings).toEqual([]);
    expect(report.plan).toBe(PLAN_PATH);
  });

  it("reports only structure findings for a structurally broken plan", async () => {
    const broken = planMd().replace("## Required commands\n\n- (none)\n\n", "");

    const report = await runLint(broken);

    expect(report.findings.every((f) => f.check === "structure")).toBe(true);
    expect(report.findings).toContainEqual({
      severity: "error",
      check: "structure",
      phase: null,
      message: `missing "## Required commands" section`,
    });
  });

  it("reports an edit of a file absent from the working tree", async () => {
    const report = await runLint(planMd({ edit: "- src/missing.ts" }));

    expect(report.findings).toEqual([
      {
        severity: "error",
        check: "files",
        phase: "phase-01",
        message: "edit src/missing.ts: does not exist and no earlier phase creates it",
      },
    ]);
  });

  it("reports a required command covered by neither the grants nor the gate profile", async () => {
    const report = await runLint(planMd({ requiredCommands: "- deno" }));

    expect(report.findings).toEqual([
      {
        severity: "error",
        check: "commands",
        phase: null,
        message:
          'required command "deno" is not covered by security.agentCommands or the gate profile',
      },
    ]);
  });

  it("reports an unknown model id and names the phase", async () => {
    const report = await runLint(planMd({ model: "claude-imaginary-9" }));

    expect(report.findings).toEqual([
      {
        severity: "error",
        check: "models",
        phase: "phase-01",
        message: 'claude-imaginary-9 / medium: model id "claude-imaginary-9" not found in catalog',
      },
    ]);
  });

  it("fails the effect, without a finding, when the plan cannot be read", async () => {
    const fakeFs = makeFakeFileSystem();

    const exit = await Effect.runPromiseExit(
      lintPlan({ planMdPath: PLAN_PATH, config }).pipe(Effect.provide(fakeFs.layer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
