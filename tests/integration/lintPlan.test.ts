import { describe, it, expect } from "vitest";
import { Effect, Either, Exit, Layer } from "effect";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { lintPlan, type LintReport } from "../../src/app/lintPlan.js";
import { ArtifactValidationError } from "../../src/domain/errors.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";

const REPO_ROOT = "/repo";
const PLAN_REL = "docs/plans/2609101260-thing-plan.md";
const PLAN_PATH = `${REPO_ROOT}/${PLAN_REL}`;
const DRAFT_FRONTMATTER = "---\nstatus: Draft\nsource-spec: null\n---\n";

function frontmatterWithSpec(sourceSpec: string): string {
  return `---\nstatus: Draft\nsource-spec: ${sourceSpec}\n---\n`;
}

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
    readonly frontmatter?: string;
  } = {},
): string {
  const {
    requiredCommands = "- (none)",
    model = "claude-sonnet-5",
    create = "- (none)",
    edit = "- (none)",
    frontmatter = DRAFT_FRONTMATTER,
  } = overrides;
  return `${frontmatter}# Thing

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

interface LintOpts {
  readonly config?: ResolvedConfig;
  readonly fakeShell?: ReturnType<typeof makeFakeShell>;
  /** Repo-relative plan path; the plan is read from `/repo/<planRel>`. */
  readonly planRel?: string;
}

function lintEffect(
  plan: string,
  files: Readonly<Record<string, string>> = {},
  opts: LintOpts = {},
): Effect.Effect<LintReport, unknown, never> {
  const planRel = opts.planRel ?? PLAN_REL;
  const planPath = `${REPO_ROOT}/${planRel}`;
  const fakeFs = makeFakeFileSystem();
  fakeFs.impl.setFile(planPath, plan);
  for (const [path, content] of Object.entries(files)) fakeFs.impl.setFile(path, content);

  const fakeShell = opts.fakeShell ?? makeFakeShell();
  if (opts.fakeShell === undefined) {
    fakeShell.impl.setDefaultResponse({
      exitCode: 0,
      stdout: JSON.stringify({ findings: [] }),
      stderr: "",
    });
  }

  // Deliberately provided with the filesystem and shell layers alone:
  // `lintPlan` must not require a Backend, so it can never fall back to the
  // extraction model.
  return lintPlan({
    planMdPath: planPath,
    reportPath: planPath,
    repoRelPath: planRel,
    config: opts.config ?? config,
  }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer)));
}

function runLint(plan: string, files: Readonly<Record<string, string>> = {}, opts: LintOpts = {}) {
  return Effect.runPromise(lintEffect(plan, files, opts));
}

const PLAN_WITH_TWO_PHASES = `${DRAFT_FRONTMATTER}# Thing

## Required commands

- (none)

## phase-01 — First Phase {#phase-01-first}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

### Planned files to create

- src/a.ts

### Planned files to edit

- src/b.ts

### Optional files that may be edited

- src/c.ts

### Commit subject

feat(test): do thing one

### Commit body

Does the first thing.

## phase-02 — Second Phase {#phase-02-second}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

### Planned files to create

- (none)

### Planned files to edit

- src/a.ts

### Optional files that may be edited

- (none)

### Commit subject

feat(test): do thing two

### Commit body

Does the second thing.
`;

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
    const fakeShell = makeFakeShell();

    const exit = await Effect.runPromiseExit(
      lintPlan({
        planMdPath: PLAN_PATH,
        reportPath: PLAN_PATH,
        repoRelPath: PLAN_REL,
        config,
      }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  describe("repo-tracked plan checks", () => {
    it("fails with ArtifactValidationError, naming the grammar, on an off-grammar name", async () => {
      const result = await Effect.runPromise(
        Effect.either(lintEffect(planMd(), {}, { planRel: "docs/plans/Thing_Plan.md" })),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(ArtifactValidationError);
        expect((result.left as ArtifactValidationError).message).toBe(
          "docs/plans/Thing_Plan.md: name does not match <YYMMDDHHMM>-<slug>-plan.md",
        );
      }
    });

    it("fails with ArtifactValidationError on a well-named plan with no frontmatter", async () => {
      const result = await Effect.runPromise(
        Effect.either(lintEffect(planMd({ frontmatter: "" }))),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(ArtifactValidationError);
      }
    });

    it("reports a plan slug that differs from its source spec's slug as a structure error", async () => {
      const report = await runLint(
        planMd({
          frontmatter: frontmatterWithSpec("docs/specs/2609101200-other-thing.md"),
          edit: "- src/a.ts",
        }),
        { "/repo/src/a.ts": "export {}" },
      );

      expect(report.findings).toEqual([
        {
          severity: "error",
          check: "structure",
          phase: null,
          message: 'slug "thing" differs from source spec slug "other-thing"',
        },
      ]);
    });

    it("reports nothing when the slug matches its source spec's, archived or live", async () => {
      for (const spec of [
        "docs/specs/2609101200-thing.md",
        "docs/specs/archive/2609101200-thing.md",
      ]) {
        const report = await runLint(
          planMd({ frontmatter: frontmatterWithSpec(spec), edit: "- src/a.ts" }),
          { "/repo/src/a.ts": "export {}" },
        );
        expect(report.findings).toEqual([]);
      }
    });

    it("skips both checks for a loose plan.md outside docs/plans/", async () => {
      for (const frontmatter of ["", frontmatterWithSpec("docs/specs/2609101200-other.md")]) {
        const report = await runLint(
          planMd({ frontmatter, edit: "- src/a.ts" }),
          { "/repo/src/a.ts": "export {}" },
          { planRel: "examples/hello-world/plan.md" },
        );
        expect(report.findings).toEqual([]);
      }
    });
  });

  describe("advisory check", () => {
    const auditorConfig = { ...config, planAuditor: { command: "audit-plan" } } as ResolvedConfig;

    it("never spawns the shell when no plan auditor is registered", async () => {
      const fakeShell = makeFakeShell();
      fakeShell.impl.setDefaultResponse({
        exitCode: 0,
        stdout: JSON.stringify({ findings: [] }),
        stderr: "",
      });

      const report = await runLint(
        planMd({ edit: "- src/a.ts" }),
        { "/repo/src/a.ts": "export {}" },
        { fakeShell },
      );

      expect(report.findings).toEqual([]);
      expect(fakeShell.impl.calls).toHaveLength(0);
    });

    it("sends exactly the phase projection — no gated phase, models, or optional files", async () => {
      const fakeShell = makeFakeShell();
      fakeShell.impl.setDefaultResponse({
        exitCode: 0,
        stdout: JSON.stringify({ findings: [] }),
        stderr: "",
      });

      await runLint(
        PLAN_WITH_TWO_PHASES,
        { "/repo/src/b.ts": "export {}" },
        { config: auditorConfig, fakeShell },
      );

      expect(fakeShell.impl.calls).toHaveLength(1);
      expect(fakeShell.impl.calls[0]?.command).toEqual(["audit-plan"]);
      expect(fakeShell.impl.calls[0]?.cwd).toBe(REPO_ROOT);
      expect(JSON.parse(fakeShell.impl.calls[0]?.stdin ?? "")).toEqual({
        phases: [
          { id: "phase-01", files: ["src/a.ts", "src/b.ts"] },
          { id: "phase-02", files: ["src/a.ts"] },
        ],
      });
    });

    it("fans an auditor finding out to one advisory warning per named phase, appended last", async () => {
      const fakeShell = makeFakeShell();
      fakeShell.impl.setDefaultResponse({
        exitCode: 0,
        stdout: JSON.stringify({
          findings: [
            { message: "two-phase finding", phases: ["phase-01", "phase-02"] },
            { message: "no-phase finding", phases: [] },
          ],
        }),
        stderr: "",
      });

      const report = await runLint(
        PLAN_WITH_TWO_PHASES,
        { "/repo/src/b.ts": "export {}" },
        { config: auditorConfig, fakeShell },
      );

      expect(report.findings).toEqual([
        { severity: "warning", check: "advisory", phase: "phase-01", message: "two-phase finding" },
        { severity: "warning", check: "advisory", phase: "phase-02", message: "two-phase finding" },
        { severity: "warning", check: "advisory", phase: null, message: "no-phase finding" },
      ]);
    });

    it("reports a failing auditor as a single warning without failing the lint", async () => {
      const fakeShell = makeFakeShell();
      fakeShell.impl.setDefaultResponse({ exitCode: 1, stdout: "", stderr: "boom" });

      const report = await runLint(
        PLAN_WITH_TWO_PHASES,
        { "/repo/src/b.ts": "export {}" },
        { config: auditorConfig, fakeShell },
      );

      expect(report.findings).toEqual([
        {
          severity: "warning",
          check: "advisory",
          phase: null,
          message: "plan auditor failed: Plan auditor exited with code 1; stderr: boom",
        },
      ]);
    });

    it("never spawns the shell for a structurally broken plan even with an auditor registered", async () => {
      const fakeShell = makeFakeShell();
      const broken = planMd().replace("## Required commands\n\n- (none)\n\n", "");

      const report = await runLint(broken, {}, { config: auditorConfig, fakeShell });

      expect(report.findings.every((f) => f.check === "structure")).toBe(true);
      expect(fakeShell.impl.calls).toHaveLength(0);
    });
  });
});
