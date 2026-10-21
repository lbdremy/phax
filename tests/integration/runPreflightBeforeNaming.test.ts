/**
 * The preflight-before-naming order guard (spec §5.10) and its acceptance suite.
 *
 * Drives the real `runRun` against a temporary git repository and a separate
 * temporary state root: real config loading, extraction, git, filesystem,
 * registry, lock and run-folder code. Only the HOME-derived loaders (telemetry
 * config, routing/provider config) and the provider backend are replaced.
 *
 * SCENARIOS is keyed by FreshRunPreflightStep, so a new preflight step without
 * a refusal scenario fails `pnpm test:type`; a step moved back after naming
 * fails its scenario's no-trace assertions.
 */
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runRun } from "../../src/cli/commands/run.js";
import { runLs } from "../../src/cli/commands/ls.js";
import { loadConfig } from "../../src/app/loadConfig.js";
import { resolveGateProfile } from "../../src/app/gates.js";
import { loadModelRouting } from "../../src/app/loadRouting.js";
import { loadOrExtractPlan } from "../../src/app/loadOrExtractPlan.js";
import { reconcileRecordsSync } from "../../src/app/recordsSync.js";
import type { FreshRunPreflightStep } from "../../src/app/runPreflight.js";
import { ConfigValidationError } from "../../src/domain/errors.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { CURRENT_STAMPS } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import {
  createPreflightRepo,
  type Fixture,
  git,
  type PreflightRepo,
  recordingOutput,
  removePreflightRepo,
  snapshotRepo,
  writeFixtureFile,
} from "./helpers/preflightRepo.js";

// Telemetry on, so a run that got as far as executePlan would leave a
// semantic.jsonl (with --trace) under its run folder.
vi.mock("../../src/app/loadTelemetryConfig.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/app/loadTelemetryConfig.js")>();
  const effect = await import("effect");
  return { ...actual, loadTelemetryConfig: vi.fn(() => effect.Either.right({ enabled: true })) };
});
// The routing loaders read ~/.phax; serve the built-in defaults instead.
vi.mock("../../src/app/loadRouting.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/app/loadRouting.js")>();
  const effect = await import("effect");
  const defaults = await import("../../src/domain/routing/defaults.js");
  return {
    ...actual,
    loadModelRouting: vi.fn(() => effect.Effect.succeed(defaults.DEFAULT_MODEL_ROUTING)),
    loadProviderConfig: vi.fn(() => effect.Effect.succeed(defaults.DEFAULT_PROVIDER_CONFIG)),
  };
});
// No test may reach a real provider CLI, whether through extraction fallback
// or phase work.
vi.mock("../../src/infra/providers/dispatcher.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/infra/providers/dispatcher.js")>();
  const fakes = await import("../../src/infra/fakes/backend.js");
  return { ...actual, makeNodeBackendLayer: vi.fn(() => fakes.makeFakeBackend().layer) };
});
// A phax.json that decodes cannot make gate profile resolution refuse, so the
// gate-profile scenario forces a throw through this pass-through spy.
vi.mock("../../src/app/gates.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/app/gates.js")>();
  return { ...actual, resolveGateProfile: vi.fn(actual.resolveGateProfile) };
});
// A deterministically parsed phase is always locatable, so the phase-sections
// scenario simulates a model-extracted plan through this pass-through spy.
vi.mock("../../src/app/loadOrExtractPlan.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/app/loadOrExtractPlan.js")>();
  return { ...actual, loadOrExtractPlan: vi.fn(actual.loadOrExtractPlan) };
});

const SKILL_FILE = ".claude/skills/foo/SKILL.md";
const RECORDS_REMOTE = "git@records.example:acme/records.git";
const RECORDS_CONFIG = {
  transcript: false,
  destination: { kind: "repo", remote: RECORDS_REMOTE },
  autoPush: false,
};
const UNKNOWN_MODEL = "claude-nope-9";
const ROUTING_PARSE_ERROR = `Failed to parse "/fixture-home/.phax/model-routing.json": SyntaxError: Unexpected token`;

const REQUIRED_COMMANDS_MESSAGE = [
  `Security preflight failed: the plan requires 1 command(s) not covered by the frozen set.`,
  `Missing: "make deploy"`,
  `Add the missing commands to security.agentCommands in phax.json before running.`,
].join("\n");

const INTERACTIVE_LINE = "**Mode:** interactive";
const ORACLE_LINES = ["**Oracle phase:** yes", "**Oracle files:** `src/step-01.ts`"];
const LINT_HINT = "Fix the plan, then check it with `phax plans lint plan.md`.";
const INTERACTIVE_MESSAGE = [
  "Interactive preflight failed: 1 error(s).",
  "  phase-01  declared interactive (**Mode:** interactive): this phax cannot run an interactive phase yet; remove the line",
  LINT_HINT,
].join("\n");
const NO_PROVIDER_ROW =
  '  phase-01  oracle phase declared, but no "oracles" provider is configured (phax.json, phax.local.json or ~/.phax/config.json)';
const ORACLE_MESSAGE = ["Oracle preflight failed: 1 error(s).", NO_PROVIDER_ROW, LINT_HINT].join(
  "\n",
);
// The same text lint prints for the label error, under the model preflight header.
const MODEL_REASON_MESSAGE = [
  "Model preflight failed: 1 phase(s) have invalid model configuration.",
  "\n  phase-01 (claude-opus-5-5/medium):",
  "    - **Model reason:** is no longer read: write **Assignment reason:**",
].join("\n");

// Made-up assignment bounds over the fixture's phase-01, which creates
// src/step-01.ts at claude-opus-5-5 / medium: both name another model.
const BOUND_EFFORT = { min: "medium", max: "high" };
const STEP_BOUND = {
  kind: "globs",
  globs: ["src/step-01.ts"],
  model: "claude-sonnet-5-5",
  effort: BOUND_EFFORT,
};
const STEPS_PART_BOUND = {
  kind: "part",
  part: "steps",
  model: "claude-sonnet-5-5",
  effort: BOUND_EFFORT,
};
/** A committed architecture provider: reads its request, prints a report with a `steps` part. */
const ARCHITECTURE_PROVIDER = [
  "for await (const _chunk of process.stdin);",
  `process.stdout.write(${JSON.stringify(
    JSON.stringify({
      $schema: schemaUrl("architecture-report", CURRENT_STAMPS["architecture-report"]),
      body: "# Architecture — acme",
      parts: [{ id: "steps", name: "steps", description: "The steps.", globs: ["src/**"] }],
    }),
  )});`,
].join("\n");

function assignmentRefusal(covers: string): string {
  return [
    "Assignment preflight failed: 1 error(s) from the assignment bounds.",
    "",
    "  phase-01 (claude-opus-5-5/medium):",
    `    - outside assignments[0] (${covers}: claude-sonnet-5-5, medium–high) with no **Assignment reason:** line`,
    "",
    "Check the plan with `phax plans lint plan.md`.",
  ].join("\n");
}

interface RefusalScenario {
  /** Committed fixture content; the tree is clean unless `arrange` dirties it. */
  readonly fixture?: Fixture;
  /** Runs after the fixture commit and before the snapshot. */
  readonly arrange?: (roots: PreflightRepo) => void;
  readonly exitCode: number;
  /** The single error line `phax run` prints: the unchanged message and prefix. */
  readonly errorLine: (roots: PreflightRepo) => string;
}

const SCENARIOS = {
  "skill-edit-consent": {
    fixture: { plan: { phases: [{ plannedFilesToCreate: [SKILL_FILE] }] } },
    exitCode: 11,
    errorLine: () =>
      [
        "Security preflight failed: the plan edits skill files, which requires --allow-skill-edits.",
        `  phase-01: ${SKILL_FILE}`,
        "Re-run with --allow-skill-edits to grant exactly these files.",
      ].join("\n"),
  },
  "routing-config": {
    arrange: () => {
      vi.mocked(loadModelRouting).mockReturnValueOnce(
        Effect.fail(
          new ConfigValidationError({
            message: ROUTING_PARSE_ERROR,
            path: "/fixture-home/.phax/model-routing.json",
          }),
        ),
      );
    },
    exitCode: 2,
    errorLine: () => `Failed to load routing config: ${ROUTING_PARSE_ERROR}`,
  },
  "gate-profile": {
    arrange: () => {
      vi.mocked(resolveGateProfile).mockImplementationOnce(() => {
        throw new Error(`Gate profile "standard" not found or empty`);
      });
    },
    exitCode: 3,
    errorLine: () => `phax run failed: Gate profile "standard" not found or empty`,
  },
  "required-commands": {
    fixture: { plan: { requiredCommands: ["make deploy"] } },
    exitCode: 11,
    errorLine: () => `phax run failed: ${REQUIRED_COMMANDS_MESSAGE}`,
  },
  "mcp-allow": {
    fixture: { config: { security: { mcp: { mode: "allowlist", allow: ["mcp/missing.json"] } } } },
    exitCode: 11,
    errorLine: () =>
      `phax run failed: ${[
        `Security preflight failed: 1 mcp.allow entry does not resolve to a readable file.`,
        `Missing: "mcp/missing.json"`,
        `mcp.allow entries must be paths to MCP server config files (not server names).`,
      ].join("\n")}`,
  },
  "records-destination": {
    fixture: { config: { records: RECORDS_CONFIG } },
    exitCode: 11,
    errorLine: (roots) =>
      `phax run failed: Records destination "${RECORDS_REMOTE}" has no local clone at "${join(roots.stateRoot, "records", roots.namespace)}". Run \`phax records sync\` before starting this run.`,
  },
  "phase-models": {
    fixture: { plan: { phases: [{ model: UNKNOWN_MODEL }] } },
    exitCode: 11,
    errorLine: () =>
      `phax run failed: ${[
        `Model preflight failed: 1 phase(s) have invalid model configuration.`,
        `\n  phase-01 (${UNKNOWN_MODEL}/medium):`,
        `    - model id "${UNKNOWN_MODEL}" not found in catalog`,
      ].join("\n")}`,
  },
  "phase-sections": {
    // The extraction returns a second phase that plan.md has no section for.
    arrange: () => {
      const passThrough = vi.mocked(loadOrExtractPlan).getMockImplementation()!;
      vi.mocked(loadOrExtractPlan).mockImplementationOnce((opts) =>
        passThrough(opts).pipe(
          Effect.map((extracted) => {
            const [first] = extracted.plan.phases;
            const second = {
              ...first,
              id: "phase-02",
              title: "Step 02",
              planMarkdownAnchor: "#phase-02-step",
              plannedFilesToCreate: ["src/step-02.ts"],
            };
            return {
              ...extracted,
              plan: { ...extracted.plan, phases: [first, second] },
            } as typeof extracted;
          }),
        ),
      );
    },
    exitCode: 11,
    errorLine: () =>
      `phax run failed: ${[
        `Plan preflight failed: phase-02 has no section in plan.md (expected a "## phase-02 — …" heading).`,
        "Fix the plan, then check it with `phax plans lint plan.md`.",
      ].join("\n")}`,
  },
  "assignment-bounds": {
    fixture: { config: { assignments: [STEP_BOUND] } },
    exitCode: 11,
    errorLine: () => `phax run failed: ${assignmentRefusal("globs src/step-01.ts")}`,
  },
  "interactive-phases": {
    fixture: { plan: { phases: [{ headerLines: [INTERACTIVE_LINE] }] } },
    exitCode: 11,
    errorLine: () => `phax run failed: ${INTERACTIVE_MESSAGE}`,
  },
  "oracle-phases": {
    fixture: { plan: { phases: [{ headerLines: ORACLE_LINES }, {}] } },
    exitCode: 11,
    errorLine: () => `phax run failed: ${ORACLE_MESSAGE}`,
  },
  "clean-tree": {
    arrange: (roots) => writeFixtureFile(roots.repo, "README.md", "# fixture, edited\n"),
    exitCode: 3,
    errorLine: () =>
      `phax run failed: Working tree is not clean. Commit or stash changes, or pass --allow-dirty.`,
  },
} satisfies Record<FreshRunPreflightStep, RefusalScenario>;

// Refusals that share a step with another scenario above.
const EXTRA_SCENARIOS: Record<string, RefusalScenario> = {
  "phase-models (a Model reason line)": {
    fixture: { plan: { phases: [{ headerLines: ["**Model reason:** old label"] }] } },
    exitCode: 11,
    errorLine: () => `phax run failed: ${MODEL_REASON_MESSAGE}`,
  },
  "assignment-bounds (a part bound the provider resolves)": {
    fixture: {
      config: {
        assignments: [STEPS_PART_BOUND],
        architecture: { command: "node acme-guard.mjs" },
      },
      files: { "acme-guard.mjs": ARCHITECTURE_PROVIDER },
    },
    exitCode: 11,
    errorLine: () => `phax run failed: ${assignmentRefusal("part steps")}`,
  },
  "assignment-bounds (an unresolved part bound)": {
    fixture: {
      config: {
        assignments: [STEP_BOUND, STEPS_PART_BOUND],
      },
    },
    exitCode: 11,
    errorLine: () =>
      `phax run failed: ${[
        "Assignment preflight failed: 1 error(s) from the assignment bounds.",
        "",
        "  assignments[1] (part steps): unresolved: no architecture provider is configured; no phase was compared with the bounds",
        "",
        "Check the plan with `phax plans lint plan.md`.",
      ].join("\n")}`,
  },
  "assignment-bounds (an invalid bound)": {
    fixture: { config: { assignments: [{ ...STEP_BOUND, model: "claude-opus-9" }] } },
    exitCode: 11,
    errorLine: () =>
      `phax run failed: ${[
        "Assignment preflight failed: 1 error(s) from the assignment bounds.",
        "",
        "  assignments[0].model: claude-opus-9 is not in the catalog",
        "",
        "Check the plan with `phax plans lint plan.md`.",
      ].join("\n")}`,
  },
  "oracle-phases (an interactive last phase declaring an oracle phase)": {
    fixture: { plan: { phases: [{}, { headerLines: [INTERACTIVE_LINE, ...ORACLE_LINES] }] } },
    exitCode: 11,
    errorLine: () =>
      `phax run failed: ${[
        "Oracle preflight failed: 4 error(s).",
        "  phase-02  oracle phase is discharged by the next phase, and phase-02 is the last phase",
        "  phase-02  oracle file src/step-01.ts is not among this phase's planned files to create or to edit",
        "  phase-02  an interactive phase takes no oracle role: it declares an oracle phase",
        NO_PROVIDER_ROW.replace("phase-01", "phase-02"),
        LINT_HINT,
      ].join("\n")}`,
  },
  "interactive-phases (a malformed Mode line)": {
    fixture: { plan: { phases: [{ headerLines: ["**Mode:** review"] }] } },
    exitCode: 11,
    errorLine: () =>
      `phax run failed: ${[
        "Interactive preflight failed: 1 error(s).",
        `  phase-01  **Mode:** "review" is not a mode: only an interactive phase carries a Mode line (**Mode:** interactive); a headless phase carries no Mode line`,
        LINT_HINT,
      ].join("\n")}`,
  },
};

const SCENARIO_CASES = [...Object.entries(SCENARIOS), ...Object.entries(EXTRA_SCENARIOS)] as [
  string,
  RefusalScenario,
][];

describe("phax run — a preflight refusal precedes naming", () => {
  let roots: PreflightRepo | undefined;
  let origCwd: string;

  beforeEach(() => {
    origCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(origCwd);
    removePreflightRepo(roots);
    roots = undefined;
    vi.resetAllMocks();
  });

  function enter(fixture?: Fixture): PreflightRepo {
    roots = createPreflightRepo(fixture);
    process.chdir(roots.repo);
    // Guard: every write below must land in the temporary state root.
    const config = loadConfig(roots.repo);
    expect(Either.isRight(config) && config.right.stateRoot).toBe(roots.stateRoot);
    return roots;
  }

  it.each(SCENARIO_CASES)(
    "%s: refuses with the unchanged message and leaves no trace",
    async (_step, scenario) => {
      const r = enter(scenario.fixture);
      scenario.arrange?.(r);
      const before = snapshotRepo(r);
      const out = recordingOutput();

      const code = await runRun({ plan: "plan.md", trace: true }, out.port);

      expect(code).toBe(scenario.exitCode);
      expect(out.errors).toEqual([scenario.errorLine(r)]);
      expect(out.logs.filter((l) => l.startsWith("Run: "))).toEqual([]);
      expect(out.warnings.filter((w) => w.includes("already exists"))).toEqual([]);

      const after = snapshotRepo(r);
      expect(after.runs).toEqual([]);
      expect(after.runs).toEqual(before.runs);
      expect(after.registry).toEqual(before.registry);
      expect(after.phaxBranches).toBe("");
      expect(after.worktrees).toBe(before.worktrees);
      // Spec §5.7: the clean-tree refusal is read-only — porcelain identical.
      expect(after.status).toBe(before.status);
      expect(after.semanticJsonl).toEqual([]);
    },
  );

  it("a records refusal, then `phax records sync`, lets the retry take the bare slug", async () => {
    const remote = realpathSync(mkdtempSync(join(tmpdir(), "phax-preflight-records-remote-")));
    try {
      git(["init", "-q", "--bare"], remote);
      disableGitAutoMaintenance(remote);
      const r = enter({ config: { records: RECORDS_CONFIG } });

      const first = recordingOutput();
      expect(await runRun({ plan: "plan.md" }, first.port)).toBe(11);
      expect(snapshotRepo(r).runs).toEqual([]);
      expect(snapshotRepo(r).registry).toBeNull();

      // The use case behind `phax records sync`, on real git and filesystem
      // layers. phax.json only admits network remotes, so the sync is pointed
      // at a local bare repository standing in for RECORDS_REMOTE.
      const config = Either.getOrThrow(loadConfig(r.repo));
      const synced = await Effect.runPromise(
        reconcileRecordsSync({
          records: { ...config.records, destination: { kind: "repo", remote } },
          stateRoot: config.stateRoot,
          namespace: config.namespace,
        }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystemLayer, NodeGitLayer))),
      );
      expect(synced.kind).toBe("cloned");

      const second = recordingOutput();
      const code = await runRun({ plan: "plan.md" }, second.port);

      expect(second.logs).toContain(`Run: ${r.namespace}.foo`);
      expect(second.warnings.filter((w) => w.includes("already exists"))).toEqual([]);
      expect(git(["branch", "--list", "phax/foo"], r.repo)).not.toBe("");
      expect(code).not.toBe(11);
    } finally {
      removeTempDir(remote);
    }
  });

  // The plan the assignment-bounds scenario refuses, with a reason line in
  // plan.md: the same extracted plan now starts. Off the policy default in a
  // repository without bounds is a warning too.
  it.each([
    [
      "a stated departure from a bound",
      {
        config: { assignments: [STEP_BOUND] },
        plan: { phases: [{ headerLines: ["**Assignment reason:** Designs the step."] }] },
      },
    ],
    ["a repository without bounds", {}],
  ] satisfies [string, Fixture][])(
    "%s passes the preflight and names the run",
    async (_label, fixture) => {
      const r = enter(fixture);
      const out = recordingOutput();

      const code = await runRun({ plan: "plan.md" }, out.port);

      expect(out.logs).toContain(`Run: ${r.namespace}.foo`);
      expect(out.errors.filter((e) => e.includes("Assignment preflight"))).toEqual([]);
      expect(code).not.toBe(11);
    },
  );

  it("a well-formed oracle pair with a provider passes the preflight and names the run", async () => {
    const r = enter({
      config: { oracles: { command: "./fake-oracles" } },
      plan: { phases: [{ headerLines: ORACLE_LINES }, {}] },
    });
    const out = recordingOutput();

    const code = await runRun({ plan: "plan.md" }, out.port);

    expect(out.logs).toContain(`Run: ${r.namespace}.foo`);
    expect(out.errors.filter((e) => e.includes("Oracle preflight"))).toEqual([]);
    expect(code).not.toBe(11);
  });

  it("several refusals at once report only the first, in today's order", async () => {
    const r = enter({
      plan: { requiredCommands: ["make deploy"], phases: [{ model: UNKNOWN_MODEL }] },
    });
    writeFixtureFile(r.repo, "README.md", "# fixture, edited\n");
    const out = recordingOutput();

    const code = await runRun({ plan: "plan.md" }, out.port);

    expect(code).toBe(11);
    expect(out.errors).toEqual([`phax run failed: ${REQUIRED_COMMANDS_MESSAGE}`]);
  });

  it("a refused run leaves the runs list unchanged", async () => {
    enter({ plan: { requiredCommands: ["make deploy"] } });
    const lsBefore = recordingOutput();
    expect(await runLs({}, lsBefore.port)).toBe(0);

    expect(await runRun({ plan: "plan.md" }, recordingOutput().port)).toBe(11);

    const lsAfter = recordingOutput();
    expect(await runLs({}, lsAfter.port)).toBe(0);
    expect(lsAfter.logs).toEqual(lsBefore.logs);
    expect(lsAfter.warnings).toEqual(lsBefore.warnings);
    expect(lsAfter.errors).toEqual(lsBefore.errors);
  });
});
