import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Result } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asReviewStopCommand } from "../../src/app/interactiveStop.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { runHomeWriteSetPreflight } from "../../src/app/runPreflight.js";
import { decodeShortName } from "../../src/domain/branded.js";
import { type ConfigValidationError, SecurityPreflightError } from "../../src/domain/errors.js";
import type { PhaxHome } from "../../src/domain/phaxHome.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { runClaudeAgent } from "../../src/infra/providers/claudeCode.js";
import { runCodexAgent } from "../../src/infra/providers/codexCli.js";
import { runVibeAgent } from "../../src/infra/providers/mistralVibe.js";
import type { AgentRunOptions } from "../../src/ports/backend.js";
import { SessionPhaxHome } from "../../src/ports/sessionPhaxHome.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { PhaxPlan } from "../../src/schemas/phaxPlan.js";
import { decodeRunHome } from "../../src/schemas/runHome.js";
import { makeFakeProviderCli } from "../helpers/fakeProviderCli.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { isolatePhaxHome, phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { phaseStatusFile } from "../helpers/phaseStatusFixture.js";
import { writeRunHomeRecord } from "../helpers/runHomeFixture.js";
import { runStatusFile } from "../helpers/runStatusFixture.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import { VIBE3_EXPORT_SHORT, vibe3ExportText, writeFakeVibe } from "../helpers/vibe3Fixtures.js";
import {
  CLI_BOUND_MS,
  CLI_LAUNCHER,
  GIT_BOUND_MS,
  boundedOutput,
  boundedSpawn,
  cliArgs,
} from "../helpers/boundedSpawn.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// The phax home pinned to a run (plan e2e-phax-home, phase-07). `phax run` records its home in
// the run folder; a phax call inside one of the run's phase worktrees uses that record and
// refuses a differing PHAX_HOME; `phax resume` refuses a differing current home; no allowWrite
// entry may reach the record; and every provider session is handed the run's home as PHAX_HOME.
// Every run, home and repository here is made up, on temporary state roots.

const NAMESPACE = "pinned";
const SHORT = "invoice-export";
const KEY = `${NAMESPACE}.${SHORT}`;

let root: string;
let stateRoot: string;
let home: string;
let homeA: string;
let homeB: string;
let restoreHome: () => void;
let restoreGit: () => void;
let savedPhaxHome: string | undefined;

beforeEach(() => {
  savedPhaxHome = process.env["PHAX_HOME"];
  delete process.env["PHAX_HOME"];
  restoreGit = isolateGit();
  ({ home, restore: restoreHome } = isolatePhaxHome());
  root = realpathSync(mkdtempSync(join(tmpdir(), "phax-run-home-")));
  stateRoot = join(root, "state");
  homeA = join(root, "home-a");
  homeB = join(root, "home-b");
  mkdirSync(homeA, { recursive: true });
  mkdirSync(homeB, { recursive: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (savedPhaxHome === undefined) delete process.env["PHAX_HOME"];
  else process.env["PHAX_HOME"] = savedPhaxHome;
  removeTempDir(root);
  restoreHome();
  restoreGit();
});

const runPath = (): string => join(stateRoot, "runs", KEY);
const worktree = (): string => join(stateRoot, "worktrees", KEY, "phase-01");
const recordFile = (): string => join(runPath(), "phax-home.json");

/** A run on the state root: its run-status.json, its phase-01 worktree with a phax.json and a
 *  .phax-context/, and (unless `record` is null) its home record. */
function seedRun(record: PhaxHome | null): void {
  mkdirSync(runPath(), { recursive: true });
  const created = "2026-11-27T09:00:00.000Z";
  writeFileSync(
    join(runPath(), "run-status.json"),
    JSON.stringify(
      runStatusFile({
        namespace: NAMESPACE,
        shortName: SHORT,
        runId: `${SHORT}-1795770000000`,
        state: "failed",
        createdAt: created,
        updatedAt: created,
        phasesCount: 1,
        currentPhaseIndex: 0,
      }),
      null,
      2,
    ),
  );
  writeFileSync(
    join(stateRoot, "registry.json"),
    JSON.stringify({
      $schema: currentSchemaUrl("registry"),
      runs: [
        {
          namespace: NAMESPACE,
          shortName: SHORT,
          runId: `${SHORT}-1795770000000`,
          state: "failed",
          branch: `phax/${SHORT}`,
          projectName: NAMESPACE,
          phasesCount: 1,
          createdAt: created,
          updatedAt: created,
        },
      ],
    }),
  );
  mkdirSync(join(runPath(), "phase-01"), { recursive: true });
  writeFileSync(
    join(runPath(), "phase-01", "status.json"),
    JSON.stringify(
      phaseStatusFile({
        phaseId: "phase-01",
        phaseIndex: 0,
        state: "failed",
        model: "claude-sonnet-5-5",
        effort: "medium",
        branchName: `phax/${SHORT}--phase-01`,
        base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
        createdAt: created,
        updatedAt: created,
        worktreePath: worktree(),
        claudeSessionId: "sess-run-home",
      }),
      null,
      2,
    ),
  );
  if (record !== null) writeRunHomeRecord(runPath(), record);
  mkdirSync(join(worktree(), ".phax-context"), { recursive: true });
}

/** `pinRunHome(cwd, env)` then `resolvePhaxHome(env)`, in fresh modules: the pin is per process. */
async function pinnedHome(
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<Result.Result<PhaxHome, ConfigValidationError>> {
  vi.resetModules();
  const { pinRunHome } = await import("../../src/app/runHome.js");
  const { resolvePhaxHome } = await import("../../src/app/phaxHome.js");
  pinRunHome(cwd, env);
  return resolvePhaxHome(env);
}

const succeeded = (path: string, from: PhaxHome["from"]) => Result.succeed({ path, from });

// ── The record ────────────────────────────────────────────────────────────────

const plan: PhaxPlan = {
  run: {
    shortName: SHORT,
    title: "Invoice export",
    branch: "feature/invoice-export",
    requiredCommands: [],
    gateProfile: "fast",
  },
  phases: [
    {
      id: "phase-01",
      title: "Export port",
      model: "claude-sonnet-5-5",
      effort: "medium",
      planMarkdownAnchor: "#phase-01",
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      mode: "headless",
      acceptance: null,
      testLines: [],
      commit: { subject: "feat(export): export port", body: "Made-up body." },
    },
  ],
};

const config = (): ResolvedConfig => ({
  raw: {
    version: 1,
    name: NAMESPACE,
    state: { root: stateRoot },
    gateProfiles: {
      fast: [{ command: "pnpm test", surface: "local", firing: "every-phase", output: "log" }],
    },
  },
  stateRoot,
  namespace: NAMESPACE,
  repoRoot: join(root, "repo"),
  maxFixAttempts: 1,
  extractPlanModel: "claude-haiku-4-5-20251001",
  extractPlanEffort: "low",
  fileReconciliationMode: "report_only",
  publish: resolvePublishConfig(undefined),
  complianceReview: resolveComplianceReviewConfig(undefined),
  codeReview: resolveCodeReviewConfig(undefined),
  authoring: resolveAuthoringConfig(undefined),
  security: {
    profile: "unsafe",
    filesystem: { allowRead: [], allowWrite: [] },
    network: { profile: "provider-only" },
    mcp: { mode: "disabled", allow: [] },
    agentCommands: [],
  },
  records: { enabled: false, transcript: false, destination: { kind: "in-repo" }, autoPush: false },
});

describe("phax run records the home it started with", () => {
  const create = () =>
    Effect.runPromise(
      createRunFolder(
        Result.getOrThrow(decodeShortName(SHORT)),
        "# Invoice export\n",
        plan,
        config(),
      ).pipe(Effect.provide(NodeFileSystemLayer)),
    );
  const record = (): unknown =>
    Result.getOrThrow(decodeRunHome(JSON.parse(readFileSync(recordFile(), "utf8"))));

  it("records the default home when PHAX_HOME is unset", async () => {
    await create();
    expect(record()).toEqual({ path: join(home, ".phax"), from: "default" });
  });

  it("records PHAX_HOME, and where it came from, when it is set", async () => {
    vi.stubEnv("PHAX_HOME", homeA);
    await create();
    expect(record()).toEqual({ path: homeA, from: "PHAX_HOME" });
  });
});

// ── A call from a run's phase worktree ────────────────────────────────────────

const recordA: PhaxHome = { path: "", from: "PHAX_HOME" };
const A = (): PhaxHome => ({ ...recordA, path: homeA });

describe("a call from a run's phase worktree uses the run's recorded home", () => {
  const envs = {
    unset: (): NodeJS.ProcessEnv => ({}),
    equal: (): NodeJS.ProcessEnv => ({ PHAX_HOME: `${homeA}/` }),
    differing: (): NodeJS.ProcessEnv => ({ PHAX_HOME: homeB }),
  } as const;

  it.each(["unset", "equal"] as const)("answers the record with PHAX_HOME %s", async (variable) => {
    seedRun(A());
    expect(await pinnedHome(worktree(), envs[variable]())).toEqual(succeeded(homeA, "PHAX_HOME"));
  });

  it("refuses a differing PHAX_HOME, naming both homes", async () => {
    seedRun(A());
    const result = await pinnedHome(worktree(), envs.differing());
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isSuccess(result)) return;
    expect(result.failure.path).toBe("PHAX_HOME");
    expect(result.failure.message).toBe(
      `PHAX_HOME "${homeB}" differs from this run's phax home "${homeA}"`,
    );
  });

  it.each(["unset", "equal", "differing"] as const)(
    "refuses a missing record, naming the file, with PHAX_HOME %s",
    async (variable) => {
      seedRun(null);
      const result = await pinnedHome(worktree(), envs[variable]());
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isSuccess(result)) return;
      expect(result.failure.path).toBe("PHAX_HOME");
      expect(result.failure.message).toContain(`"${recordFile()}" is missing`);
    },
  );

  it.each([
    ["not JSON", "{"],
    ["no source", JSON.stringify({ path: "/somewhere/.phax" })],
    ["a relative path", JSON.stringify({ path: "somewhere", from: "default" })],
    ["an extra key", JSON.stringify({ path: "/somewhere/.phax", from: "default", more: 1 })],
  ])("refuses a corrupt record (%s), naming the file", async (_case, text) => {
    seedRun(null);
    writeFileSync(recordFile(), text);
    for (const variable of ["unset", "equal", "differing"] as const) {
      const result = await pinnedHome(worktree(), envs[variable]());
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isSuccess(result)) return;
      expect(result.failure.path).toBe("PHAX_HOME");
      expect(result.failure.message).toContain(`"${recordFile()}" does not decode`);
    }
  });

  it("is not misled by a removed .phax-context/, from a subdirectory too", async () => {
    seedRun(A());
    rmSync(join(worktree(), ".phax-context"), { recursive: true });
    mkdirSync(join(worktree(), "src", "deep"), { recursive: true });
    expect(await pinnedHome(join(worktree(), "src", "deep"), envs.unset())).toEqual(
      succeeded(homeA, "PHAX_HOME"),
    );
    const differing = await pinnedHome(worktree(), envs.differing());
    expect(Result.isFailure(differing)).toBe(true);
  });

  it("keeps the outermost run when a look-alike run is built inside the worktree", async () => {
    seedRun(A());
    const inner = join(worktree(), "planted");
    mkdirSync(join(inner, "runs", "fake.run"), { recursive: true });
    writeFileSync(join(inner, "runs", "fake.run", "run-status.json"), "{}\n");
    writeRunHomeRecord(join(inner, "runs", "fake.run"), { path: homeB, from: "PHAX_HOME" });
    const nested = join(inner, "worktrees", "fake.run", "phase-01");
    mkdirSync(nested, { recursive: true });

    expect(await pinnedHome(nested, envs.unset())).toEqual(succeeded(homeA, "PHAX_HOME"));
    const planted = await pinnedHome(nested, envs.differing());
    expect(Result.isFailure(planted)).toBe(true);
  });

  it("follows a symlink to the worktree to its real location", async () => {
    seedRun(A());
    const link = join(root, "link");
    symlinkSync(worktree(), link);
    const result = await pinnedHome(link, envs.differing());
    expect(Result.isFailure(result)).toBe(true);
  });

  it("pins nothing outside every run's phase worktree", async () => {
    seedRun(A());
    const outside = join(root, "elsewhere");
    mkdirSync(outside);
    expect(await pinnedHome(outside, envs.unset())).toEqual(
      succeeded(join(home, ".phax"), "default"),
    );
    expect(await pinnedHome(outside, envs.differing())).toEqual(succeeded(homeB, "PHAX_HOME"));
    // A worktrees/<key>/<phase> directory whose run has no run-status.json is no run's worktree.
    const unknown = join(stateRoot, "worktrees", "other.run", "phase-01");
    mkdirSync(unknown, { recursive: true });
    expect(await pinnedHome(unknown, envs.differing())).toEqual(succeeded(homeB, "PHAX_HOME"));
  });
});

describe("the pin at the process entry", () => {
  const PHAX_JSON = {
    version: 1,
    name: NAMESPACE,
    gateProfiles: { standard: [{ command: "pnpm test", surface: "local", firing: "every-phase" }] },
  };

  function seedWorktreeRepo(record: PhaxHome | null): void {
    seedRun(record);
    boundedOutput("git", ["init", "-q"], { cwd: worktree(), boundMs: GIT_BOUND_MS });
    disableGitAutoMaintenance(worktree());
    writeFileSync(join(worktree(), "phax.json"), JSON.stringify(PHAX_JSON, null, 2));
  }

  /** `phax validate` from the run's worktree, with PHAX_HOME set to `phaxHome` when given. */
  const validate = (phaxHome?: string) =>
    boundedSpawn(CLI_LAUNCHER, cliArgs("validate"), {
      boundMs: CLI_BOUND_MS,
      cwd: worktree(),
      env: { ...phaxHomeEnv(), ...(phaxHome === undefined ? {} : { PHAX_HOME: phaxHome }) },
    });

  it("reports the recorded home, refuses a differing PHAX_HOME and a deleted record", () => {
    seedWorktreeRepo(A());

    const pinned = validate();
    expect(pinned.status).toBe(0);
    expect(pinned.stdout.split("\n")[1]).toBe(`  home:    ${homeA} (PHAX_HOME)`);

    const differing = validate(homeB);
    expect(differing.status).toBe(2);
    expect(differing.stdout).toBe("");
    expect(differing.stderr).toContain(
      `PHAX_HOME "${homeB}" differs from this run's phax home "${homeA}"`,
    );

    rmSync(recordFile());
    const missing = validate();
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain(`"${recordFile()}" is missing`);
  }, 60_000);

  it("prints no notice for a run on the default home", () => {
    seedWorktreeRepo({ path: join(home, ".phax"), from: "default" });
    const result = validate();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.split("\n")[1]).toBe(`  home:    ${join(home, ".phax")} (default)`);
  }, 30_000);
});

// ── phax resume ───────────────────────────────────────────────────────────────

describe("phax resume keeps the run's home", () => {
  let repo: string;

  /** The sha256 of every file under `dir`, by relative path. */
  function hashTree(dir: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (at: string, rel: string): void => {
      for (const name of readdirSync(at).toSorted()) {
        const path = join(at, name);
        const key = rel === "" ? name : `${rel}/${name}`;
        if (statSync(path).isDirectory()) walk(path, key);
        else out[key] = createHash("sha256").update(readFileSync(path)).digest("hex");
      }
    };
    walk(dir, "");
    return out;
  }

  function seedRepo(security?: unknown): void {
    repo = join(root, "repo");
    mkdirSync(repo, { recursive: true });
    boundedOutput("git", ["init", "-q"], { cwd: repo, boundMs: GIT_BOUND_MS });
    disableGitAutoMaintenance(repo);
    writeFileSync(
      join(repo, "phax.json"),
      JSON.stringify({
        version: 1,
        name: NAMESPACE,
        state: { root: stateRoot },
        gateProfiles: {
          standard: [{ command: "pnpm test", surface: "local", firing: "every-phase" }],
        },
        ...(security === undefined ? {} : { security }),
      }),
    );
  }

  /** `phax resume` from the main checkout, under PHAX_HOME `phaxHome`. */
  const resume = (phaxHome: string) =>
    boundedSpawn(CLI_LAUNCHER, cliArgs("resume", SHORT, "--yes"), {
      boundMs: CLI_BOUND_MS,
      cwd: repo,
      env: { ...phaxHomeEnv(), PHAX_HOME: phaxHome },
    });

  it("refuses a differing current home before anything changes, naming the recorded one", () => {
    seedRun(A());
    seedRepo();
    const before = hashTree(stateRoot);

    const result = resume(homeB);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(
      `this run's phax home is "${homeA}", but the current phax home is "${homeB}"`,
    );
    expect(result.stderr).toContain(`Set PHAX_HOME to "${homeA}" and resume again.`);
    expect(hashTree(stateRoot)).toEqual(before);
  }, 30_000);

  it("tells a run on the default home to unset PHAX_HOME", () => {
    seedRun({ path: join(home, ".phax"), from: "default" });
    seedRepo();
    const result = resume(homeB);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("unset PHAX_HOME and resume again.");
  }, 30_000);

  it("refuses an absent record before anything changes, naming the file", () => {
    seedRun(null);
    seedRepo();
    const before = hashTree(stateRoot);

    const result = resume(homeA);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(`"${recordFile()}" is missing`);
    expect(hashTree(stateRoot)).toEqual(before);
  }, 30_000);

  it("refuses an allowWrite entry that reaches the record, exit 11", () => {
    seedRun(A());
    seedRepo({ filesystem: { allowWrite: [stateRoot] } });
    const before = hashTree(stateRoot);

    const result = resume(homeA);

    expect(result.status, result.stderr).toBe(11);
    expect(result.stderr).toContain(`"${recordFile()}"`);
    expect(result.stderr).toContain(`Covering: "${stateRoot}"`);
    expect(hashTree(stateRoot)).toEqual(before);
  }, 30_000);

  it("passes the home check under the recorded home", async () => {
    seedRun(A());
    vi.stubEnv("PHAX_HOME", homeA);
    const { resumeHomePreflight } = await import("../../src/app/resume.js");
    const answer = await Effect.runPromise(Effect.result(resumeHomePreflight(runPath(), [])));
    expect(answer).toEqual(Result.succeed(A()));
  });
});

// ── The write set ─────────────────────────────────────────────────────────────

describe("no allowWrite entry may reach the run's home record", () => {
  const refusalOf = (allowWrite: readonly string[]) =>
    Effect.runSync(Effect.result(runHomeWriteSetPreflight(allowWrite, recordFile())));

  it.each([
    ["the record itself", () => recordFile()],
    ["the run folder", () => runPath()],
    ["the state root, with a trailing slash", () => `${stateRoot}/`],
    ["the filesystem root", () => "/"],
  ])("refuses %s, naming the entry and the record", (_case, entry) => {
    seedRun(A());
    const result = refusalOf([join(root, "unrelated"), entry()]);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isSuccess(result)) return;
    expect(result.failure).toBeInstanceOf(SecurityPreflightError);
    expect(result.failure.message).toContain(`"${recordFile()}"`);
    expect(result.failure.message).toContain(`Covering: "${entry()}"`);
    expect(result.failure.message).not.toContain("unrelated");
  });

  it("refuses a symlink that leads to the state root", () => {
    seedRun(A());
    const link = join(root, "state-link");
    symlinkSync(stateRoot, link);
    expect(Result.isFailure(refusalOf([link]))).toBe(true);
  });

  it.each([
    ["a sibling run folder", () => join(stateRoot, "runs", `${KEY}-2`)],
    ["the run's phase worktree", () => worktree()],
    ["a sibling sharing the run folder's prefix", () => `${runPath()}x`],
    ["no entry", () => undefined],
  ])("accepts %s", (_case, entry) => {
    seedRun(A());
    const value = entry();
    expect(refusalOf(value === undefined ? [] : [value])).toEqual(Result.succeed(undefined));
  });
});

// ── The sessions ──────────────────────────────────────────────────────────────

describe("every provider session is handed the run's home as PHAX_HOME, and nothing else", () => {
  const SESSION = "019a2f6e-0000-4000-8000-0000000000cc";
  const RUN_HOME = "/run-recorded-home/.phax";
  const unsafePolicy: SecurityPolicy = {
    mode: "unsafe",
    filesystem: { allowRead: [], allowWrite: [] },
    network: { profile: "open" },
    mcp: { mode: "provider-default", allow: [] },
    agentCommands: [],
    failClosed: false,
  };

  /** Runs `spawn` once without the reference and once with it; answers both environments. */
  async function envsOf(
    spawn: () => Effect.Effect<unknown, unknown>,
    lastEnv: () => Readonly<Record<string, string>> | undefined,
  ): Promise<readonly [Readonly<Record<string, string>>, Readonly<Record<string, string>>]> {
    await Effect.runPromise(Effect.result(spawn()));
    const before = lastEnv();
    await Effect.runPromise(
      Effect.result(spawn().pipe(Effect.provideService(SessionPhaxHome, RUN_HOME))),
    );
    const after = lastEnv();
    if (before === undefined || after === undefined) throw new Error("no spawn was recorded");
    return [before, after];
  }

  const optionsFor = (provider: AgentRunOptions["provider"], model: string): AgentRunOptions => ({
    provider,
    model,
    effort: "high",
    cwd: root,
    security: unsafePolicy,
    outputJsonlPath: join(root, "phase-01", "output.jsonl"),
    phaseFolderPath: join(root, "phase-01"),
  });

  beforeEach(() => {
    mkdirSync(join(root, "phase-01"), { recursive: true });
  });

  it("claude-code", async () => {
    const cli = makeFakeProviderCli(join(root, "cli"));
    for (const [name, value] of Object.entries(cli.env)) vi.stubEnv(name, value);
    cli.setScript({ sessionId: SESSION, finalText: "ok" });
    const [before, after] = await envsOf(
      () => runClaudeAgent("ask", optionsFor("claude-code", "claude-sonnet-5-5")),
      () => cli.traces().at(-1)?.env,
    );
    expect(before["PHAX_HOME"]).toBeUndefined();
    expect(after).toEqual({ ...before, PHAX_HOME: RUN_HOME });
  });

  it("codex-cli", async () => {
    const cli = makeFakeProviderCli(join(root, "cli"));
    for (const [name, value] of Object.entries(cli.env)) vi.stubEnv(name, value);
    cli.setScript({ sessionId: SESSION, finalText: "ok" });
    const entry = {
      enabled: true,
      executable: cli.codexPath,
      families: {
        "openai-gpt": {
          models: [{ id: "gpt-5.5", efforts: ["low", "medium", "high"], status: "active" }],
        },
      },
    } as const;
    const [before, after] = await envsOf(
      () => runCodexAgent("ask", optionsFor("codex-cli", "gpt-5.5"), entry),
      () => cli.traces().at(-1)?.env,
    );
    expect(before["PHAX_HOME"]).toBeUndefined();
    expect(after).toEqual({ ...before, PHAX_HOME: RUN_HOME });
  });

  it("mistral-vibe", async () => {
    const fake = writeFakeVibe(join(root, "vibe-bin"), {
      exportText: vibe3ExportText(VIBE3_EXPORT_SHORT),
    });
    const [before, after] = await envsOf(
      () =>
        runVibeAgent("ask", optionsFor("mistral-vibe", "mistral-medium-3.5"), {
          executable: fake.executable,
        }),
      () =>
        fake
          .traces()
          .filter((trace) => trace.argv.includes("-p"))
          .at(-1)?.env,
    );
    expect(before["PHAX_HOME"]).toBeUndefined();
    expect(after).toEqual({ ...before, PHAX_HOME: RUN_HOME });
  });

  it("the commands an interactive stop prints", () => {
    const command = { executable: "claude", args: ["--resume", SESSION], cwd: root, env: {} };
    expect(asReviewStopCommand(command, undefined).env).toEqual({});
    expect(asReviewStopCommand(command, RUN_HOME).env).toEqual({ PHAX_HOME: RUN_HOME });
    const vibe = { ...command, executable: "vibe", env: { VIBE_ACTIVE_MODEL: "m" } };
    expect(asReviewStopCommand(vibe, RUN_HOME).env).toEqual({
      VIBE_ACTIVE_MODEL: "m",
      PHAX_HOME: RUN_HOME,
    });
  });
});
