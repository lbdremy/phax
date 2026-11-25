// Acceptance tests (spec plan-path-canonical §8) for the plan.md route, through phax's use cases:
// lint, the assignment bounds, the unplannable refusals, the absence of any model fallback and the
// run's phax-plan.json. Every plan is made up, built inline here, and read without a model; each test
// asserts that something only a full reading of the plan produces (a finding on a later phase, a
// finding for a file after the one a path spells, a written plan) before it compares anything. What
// they judge with is frozen with them, so no shared helper is imported.
import { Effect, Layer, Result } from "effect";
import { describe, expect, it } from "vitest";
import { lintPlan, type LintReport } from "../../src/app/lintPlan.js";
import { loadOrExtractPlan } from "../../src/app/loadOrExtractPlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import type { ShortName } from "../../src/domain/branded.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

const REPO_ROOT = "/repo";

const baseConfig = {
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

/** A config with one globs bound: `src/**` takes claude-opus-5-5 at medium to high effort. */
const boundedConfig = {
  ...baseConfig,
  assignments: [
    {
      kind: "globs",
      globs: ["src/**"],
      model: "claude-opus-5-5",
      effort: { min: "medium", max: "high" },
    },
  ],
} as unknown as ResolvedConfig;

interface PhaseSpec {
  readonly model?: string;
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

**Recommended model:** ${phase.model ?? "claude-sonnet-5-5"}
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
  return `# Thing\n\n## Gate profile\n\n\`standard\`\n\n## Required commands\n\n- (none)\n\n${sections.join("\n")}`;
}

/** Lint of a loose plan.md at the root of a repository whose working tree holds `tree`. */
function lint(
  md: string,
  tree: readonly string[] = [],
  config: ResolvedConfig = baseConfig,
): Promise<LintReport> {
  const fakeFs = makeFakeFileSystem();
  fakeFs.impl.setFile(`${REPO_ROOT}/plan.md`, md);
  for (const file of tree) fakeFs.impl.setFile(`${REPO_ROOT}/${file}`, "");
  const fakeShell = makeFakeShell();
  fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "", stderr: "" });
  // Provided with the filesystem and the shell alone: lint can never fall back to the model.
  return Effect.runPromise(
    lintPlan({
      planMdPath: `${REPO_ROOT}/plan.md`,
      reportPath: "plan.md",
      repoRelPath: "plan.md",
      config,
    }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer, makeFakeGit().layer))),
  );
}

const messagesOf = (report: LintReport, check: string, phase: string): string[] =>
  report.findings.filter((f) => f.check === check && f.phase === phase).map((f) => f.message);

describe("ac-lint-collision: Lint sees a create/edit collision across spellings", () => {
  it("phase-01 creating ./src/x.ts and editing src/x.ts both list src/x.ts", async () => {
    const report = await lint(planMd([{ create: ["./src/x.ts"], edit: ["src/x.ts"] }]));
    expect(messagesOf(report, "files", "phase-01")).toContain("create and edit both list src/x.ts");
  });
});

describe("ac-lint-already-created: Lint sees a file already created under another spelling", () => {
  it("phase-02 creating src/x.ts after phase-01 created src//x.ts is already created", async () => {
    const report = await lint(planMd([{ create: ["src//x.ts"] }, { create: ["src/x.ts"] }]));
    expect(messagesOf(report, "files", "phase-02")).toEqual([
      "create src/x.ts: already created by phase-01",
    ]);
  });
});

describe("ac-lint-probe: Lint's working-tree probe finds a non-canonical path", () => {
  it("a plan editing ./src/x.ts finds src/x.ts, and the findings are those of the plan written src/x.ts", async () => {
    const tree = ["src/x.ts"];
    const dotted = await lint(planMd([{ edit: ["./src/x.ts", "src/missing.ts"] }]), tree);
    const canonical = await lint(planMd([{ edit: ["src/x.ts", "src/missing.ts"] }]), tree);

    // The probe ran for the second file, so the plan was read in full.
    const missing = (r: LintReport) =>
      r.findings.filter((f) => f.check === "files" && f.message.includes("does not exist"));
    expect(missing(dotted).map((f) => f.message)).toEqual([
      "edit src/missing.ts: does not exist and no earlier phase creates it",
    ]);
    expect(dotted.findings).toEqual(canonical.findings);
  });
});

describe("ac-bounds: Assignment bounds govern a non-canonical path", () => {
  it("a bound on src/** governs a phase listing only ./src/x.ts, as it does one listing src/x.ts", async () => {
    const tree = ["src/x.ts"];
    const dotted = await lint(planMd([{ edit: ["./src/x.ts"] }]), tree, boundedConfig);
    const canonical = await lint(planMd([{ edit: ["src/x.ts"] }]), tree, boundedConfig);

    const outside = dotted.findings.filter(
      (f) => f.check === "models" && f.phase === "phase-01" && f.severity === "error",
    );
    expect(outside).toHaveLength(1);
    expect(outside[0]!.message).toContain("outside assignments[0] (globs src/**");
    expect(dotted.findings).toEqual(canonical.findings);
  });
});

describe("ac-unplannable: Each kind of unplannable path is refused", () => {
  const rows: readonly (readonly [written: string, reason: string])[] = [
    ["", "empty"],
    ["./", "empty"],
    ["/src/x.ts", "absolute"],
    ["../x.ts", "leaves the repository"],
    ["src/../../x.ts", "leaves the repository"],
    ["src/", "names a directory"],
    ["src\\x.ts", "backslash"],
  ];

  for (const [written, reason] of rows) {
    it(`a plan.md listing ${JSON.stringify(written)} under Planned files to edit is refused: ${reason}`, async () => {
      const report = await lint(planMd([{ create: ["src/a.ts"] }, { edit: [written] }]));
      const refusal = messagesOf(report, "structure", "phase-02").find((m) =>
        m.includes(JSON.stringify(written)),
      );
      expect(refusal).toBeDefined();
      expect(refusal).toContain("Planned files to edit");
      expect(refusal).toContain(reason);
      expect(report.findings.some((f) => f.severity === "error" && f.phase === "phase-01")).toBe(
        false,
      );
    });
  }
});

describe("ac-unplannable: an empty item is an empty path", () => {
  for (const [label, item] of [
    ["a bare bullet", "-"],
    ["a code span of spaces", "- `   `"],
  ] as const) {
    it(`a plan.md whose Planned files to edit holds ${label} is refused: empty`, async () => {
      const md = planMd([{ create: ["src/a.ts"] }, { edit: ["src/b.ts"] }]).replace(
        "- `src/b.ts`",
        `- \`src/b.ts\`\n${item}`,
      );
      const report = await lint(md);
      expect(messagesOf(report, "structure", "phase-02")).toEqual([
        'Planned files to edit: "" is empty',
      ]);
    });
  }
});

describe("ac-no-fallback: An unplannable path in plan.md never reaches the model", () => {
  it("a plan.md listing ../x.ts is refused by lint and by loadOrExtractPlan, and the backend holds no call", async () => {
    const md = planMd([{ create: ["src/a.ts"] }, { edit: ["../x.ts"] }]);

    const report = await lint(md);
    const refusal = report.findings.find(
      (f) => f.check === "structure" && f.severity === "error" && f.phase === "phase-02",
    );
    expect(refusal).toBeDefined();
    expect(refusal?.message).toContain("../x.ts");

    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();
    fs.impl.setFile("/project/plan.md", md);
    const loaded = await Effect.runPromise(
      Effect.result(
        loadOrExtractPlan({
          planMdPath: "/project/plan.md",
          model: "claude-sonnet-5-5",
          effort: "medium",
          stateRoot: "/state",
          nowIso: "2026-11-14T00:00:00.000Z",
        }).pipe(Effect.provide(Layer.merge(fs.layer, backend.layer))),
      ),
    );

    expect(Result.isFailure(loaded)).toBe(true);
    const message = Result.isFailure(loaded) ? loaded.failure.message : "";
    expect(message).toContain("phase-02");
    expect(message).toContain("../x.ts");
    expect(backend.impl.completeCalls).toHaveLength(0);
  });
});

describe("ac-persisted-canonical: phax-plan.json holds the canonical form", () => {
  it("a plan.md listing ./src/x.ts, src//y.ts and src/a/../z.ts gives a phax-plan.json at the current stamp listing src/x.ts, src/y.ts and src/z.ts, without the model", async () => {
    const md = planMd([{ edit: ["./src/x.ts", "src//y.ts", "src/a/../z.ts"] }]);
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();
    fs.impl.setFile("/project/plan.md", md);
    const layer = Layer.mergeAll(fs.layer, backend.layer);

    const loaded = await Effect.runPromise(
      Effect.result(
        loadOrExtractPlan({
          planMdPath: "/project/plan.md",
          model: "claude-sonnet-5-5",
          effort: "medium",
          stateRoot: "/state",
          nowIso: "2026-11-14T00:00:00.000Z",
        }).pipe(Effect.provide(layer)),
      ),
    );
    expect(Result.isSuccess(loaded)).toBe(true);
    expect(backend.impl.completeCalls).toHaveLength(0);
    if (!Result.isSuccess(loaded)) return;

    const run = await Effect.runPromise(
      Effect.result(
        createRunFolder("thing" as ShortName, md, loaded.success.plan, baseConfig).pipe(
          Effect.provide(layer),
        ),
      ),
    );
    expect(Result.isSuccess(run)).toBe(true);
    if (!Result.isSuccess(run)) return;

    const written = JSON.parse(
      fs.impl.getFile(`${run.success.runPath}/phax-plan.json`) ?? "null",
    ) as {
      $schema: string;
      phases: { plannedFilesToEdit: string[] }[];
    };
    expect(written.phases[0]!.plannedFilesToEdit).toEqual(["src/x.ts", "src/y.ts", "src/z.ts"]);
    expect(written.$schema).toBe(currentSchemaUrl("phax-plan"));
    expect(written.$schema).not.toBe(schemaUrl("phax-plan", "0.33.0"));
  });
});
