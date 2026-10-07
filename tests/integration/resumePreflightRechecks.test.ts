/**
 * `phax resume` re-checks the run-independent inputs that can change between
 * two invocations (spec preflight-before-naming) before it creates any
 * worktree for the next phase.
 *
 * Drives the real `runResume` against a temporary git repository and a
 * separate temporary state root. The paused run is built with the real
 * `createRunFolder`, then phase-01 is marked committed and the run interrupted,
 * following the fixtures in skillEditConsent.test.ts and resumeFrom*.test.ts.
 * Only the HOME-derived loaders and the provider backend are replaced.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runResume } from "../../src/cli/commands/resume.js";
import { loadConfig } from "../../src/app/loadConfig.js";
import { loadOrExtractPlan } from "../../src/app/loadOrExtractPlan.js";
import { loadProviderConfig } from "../../src/app/loadRouting.js";
import { setRunStatus } from "../../src/app/registry.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";
import { PHAX_RELEASE } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import {
  createPreflightRepo,
  FIXTURE_EFFORT,
  FIXTURE_MODEL,
  git,
  type PreflightRepo,
  recordingOutput,
  removePreflightRepo,
} from "./helpers/preflightRepo.js";

// Telemetry off: resume's run telemetry is not under test here.
vi.mock("../../src/app/loadTelemetryConfig.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/app/loadTelemetryConfig.js")>();
  const effect = await import("effect");
  return { ...actual, loadTelemetryConfig: vi.fn(() => effect.Either.right({ enabled: false })) };
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
// No test may reach a real provider CLI.
vi.mock("../../src/infra/providers/dispatcher.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/infra/providers/dispatcher.js")>();
  const fakes = await import("../../src/infra/fakes/backend.js");
  return { ...actual, makeNodeBackendLayer: vi.fn(() => fakes.makeFakeBackend().layer) };
});

const MCP_FILE = "mcp/server.json";
const RECORDS_REMOTE = "git@records.example:acme/records.git";

const HANDOFF_CONTENT = [
  "## What was delivered",
  "Step 01.",
  "## Key decisions and why",
  "None.",
  "## Exact locations (file paths and exported names)",
  "src/step-01.ts",
  "## What the next phase needs to know",
  "Nothing.",
].join("\n");

/** Every provider disabled: no phase model has a provider or a permitted route. */
const ALL_PROVIDERS_DISABLED: ProviderConfig = {
  ...DEFAULT_PROVIDER_CONFIG,
  providers: Object.fromEntries(
    Object.entries(DEFAULT_PROVIDER_CONFIG.providers).map(([id, entry]) => [
      id,
      { ...entry, enabled: false },
    ]),
  ),
};

/**
 * Create a two-phase run with the real createRunFolder, then pause it after a
 * committed phase-01 so `phax resume` picks it up at phase-02.
 */
async function pauseAfterPhase01(roots: PreflightRepo): Promise<string> {
  const config = Either.getOrThrow(loadConfig(roots.repo));
  const planMdPath = join(roots.repo, "plan.md");
  const planMd = readFileSync(planMdPath, "utf8");
  const { plan } = await Effect.runPromise(
    loadOrExtractPlan({
      planMdPath,
      model: config.extractPlanModel,
      effort: config.extractPlanEffort,
      stateRoot: config.stateRoot,
      nowIso: new Date().toISOString(),
    }).pipe(Effect.provide(Layer.merge(NodeFileSystemLayer, makeFakeBackend().layer))),
  );
  const shortName = Either.getOrThrow(decodeShortName(plan.run.shortName));
  const { runPath } = await Effect.runPromise(
    createRunFolder(shortName, planMd, plan, config, "plan.md").pipe(
      Effect.provide(NodeFileSystemLayer),
    ),
  );

  const now = new Date().toISOString();
  const phase01 = join(runPath, "phase-01");
  await mkdir(phase01, { recursive: true });
  await writeFile(
    join(phase01, "status.json"),
    JSON.stringify({
      $schema: schemaUrl("phase-status", PHAX_RELEASE),
      phaseId: "phase-01",
      phaseIndex: 0,
      state: "committed",
      model: FIXTURE_MODEL,
      effort: FIXTURE_EFFORT,
      branchName: `${plan.run.branch}--phase-01`,
      base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      createdAt: now,
      updatedAt: now,
      worktreePath: join(roots.stateRoot, "worktrees", `${roots.namespace}.foo`, "phase-01"),
      commitHash: "aabbccdd11223344",
    }),
  );
  await writeFile(join(phase01, "phase-handoff.md"), HANDOFF_CONTENT);

  const statusPath = join(runPath, "run-status.json");
  const runStatus = JSON.parse(readFileSync(statusPath, "utf8")) as Record<string, unknown>;
  await writeFile(
    statusPath,
    JSON.stringify({
      ...runStatus,
      state: "interrupted",
      currentPhaseIndex: 1,
      gateProfileId: "standard",
      updatedAt: now,
    }),
  );
  await Effect.runPromise(
    setRunStatus(roots.stateRoot, roots.namespace, shortName, { state: "interrupted" }).pipe(
      Effect.provide(NodeFileSystemLayer),
    ),
  );
  return shortName;
}

function modelFailure(phaseId: string): string {
  return [
    `\n  ${phaseId} (${FIXTURE_MODEL}/${FIXTURE_EFFORT}):`,
    `    - provider "claude-code" is disabled and no permitted cross-family equivalence route exists`,
  ].join("\n");
}

interface RecheckCase {
  readonly change: (roots: PreflightRepo) => void;
  readonly message: (roots: PreflightRepo) => string;
}

const CASES: Record<string, RecheckCase> = {
  "the mcp.allow file named in phax.json is deleted": {
    change: (roots) => rmSync(join(roots.repo, MCP_FILE)),
    message: () =>
      [
        `Security preflight failed: 1 mcp.allow entry does not resolve to a readable file.`,
        `Missing: "${MCP_FILE}"`,
        `mcp.allow entries must be paths to MCP server config files (not server names).`,
      ].join("\n"),
  },
  "the records clone is removed": {
    change: (roots) =>
      rmSync(join(roots.stateRoot, "records", roots.namespace), { recursive: true, force: true }),
    message: (roots) =>
      `Records destination "${RECORDS_REMOTE}" has no local clone at "${join(roots.stateRoot, "records", roots.namespace)}". Run \`phax records sync\` before starting this run.`,
  },
  "the provider serving phase-02's model is disabled with no permitted route": {
    change: () => {
      vi.mocked(loadProviderConfig).mockReturnValueOnce(Effect.succeed(ALL_PROVIDERS_DISABLED));
    },
    message: () =>
      [
        `Model preflight failed: 2 phase(s) have invalid model configuration.`,
        modelFailure("phase-01"),
        modelFailure("phase-02"),
      ].join("\n"),
  },
};

describe("phax resume — re-checks the inputs that can change before any worktree", () => {
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

  it.each(Object.entries(CASES))("refuses when %s", async (_name, recheck) => {
    const r = createPreflightRepo({
      config: {
        security: { mcp: { mode: "allowlist", allow: [MCP_FILE] } },
        records: {
          transcript: false,
          destination: { kind: "repo", remote: RECORDS_REMOTE },
          autoPush: false,
        },
      },
      plan: { phases: [{}, {}] },
      files: { [MCP_FILE]: "{}\n" },
    });
    roots = r;
    process.chdir(r.repo);
    // Guard: every write below must land in the temporary state root.
    const config = loadConfig(r.repo);
    expect(Either.isRight(config) && config.right.stateRoot).toBe(r.stateRoot);
    // The records clone only has to exist for the run preflight to pass.
    await mkdir(join(r.stateRoot, "records", r.namespace), { recursive: true });

    const shortName = await pauseAfterPhase01(r);

    // Resumable at phase-02 while every input is still valid.
    const probe = recordingOutput();
    expect(await runResume(shortName, {}, probe.port)).toBe(0);
    expect(probe.logs.some((l) => l.includes("would resume from phase 2: phase-02"))).toBe(true);
    expect(probe.errors).toEqual([]);

    const worktreesBefore = git(["worktree", "list", "--porcelain"], r.repo);
    recheck.change(r);
    const out = recordingOutput();

    const code = await runResume(shortName, { yes: true }, out.port);

    expect(code).toBe(11);
    expect(out.errors).toEqual([`phax resume failed: ${recheck.message(r)}`]);
    expect(
      existsSync(join(r.stateRoot, "worktrees", `${r.namespace}.${shortName}`, "phase-02")),
    ).toBe(false);
    expect(git(["worktree", "list", "--porcelain"], r.repo)).toBe(worktreesBefore);
  });
});
