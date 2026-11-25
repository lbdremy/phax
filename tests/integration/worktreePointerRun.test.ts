import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Layer, Predicate, Result } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { withRunLock } from "../../src/app/lock.js";
import { resetPhase } from "../../src/app/resetPhase.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import {
  decodeClaudeSessionId,
  decodeShortName,
  type RunId,
  type ShortName,
} from "../../src/domain/branded.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeLock } from "../../src/infra/fakes/lock.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { makeNodeGitLayer } from "../../src/infra/git.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import type { PhaxPlan } from "../../src/schemas/phaxPlan.js";
import { GIT_BOUND_MS, boundedOutput, boundedSpawn } from "../helpers/boundedSpawn.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { liftFixturePhaxPlanToCurrent } from "../helpers/liftFixturePhaxPlan.js";
import { planMdFor } from "../helpers/planMarkdown.js";
import { processOutput } from "../helpers/processOutput.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// A phase whose agent rewrote the worktree's .git to a gitdir of its own, with
// a planted fsmonitor, run end to end through executePlan with the rooted real
// git adapter, the fake backend and a scripted shell: the phase fails with the
// refusal and no fsmonitor runs; reset-phase then removes the worktree git
// will not, and a resume creates it again with an intact pointer.

const NAMESPACE = "example";
const SHORT = "invoice-export";
const GATE = "pnpm test";

const HANDOFF = [
  "## What was delivered",
  "- phase-01 delivered its file.",
  "## Key decisions and why",
  "- None.",
  "## Exact locations (file paths and exported names)",
  "- src/phase-01.ts",
  "## What the next phase needs to know",
  "- Ready to proceed.",
  "",
].join("\n");

let root: string;
let repoRoot: string;
let stateRoot: string;
let markers: string;
let restoreGit: () => void;

const gitIn = (cwd: string, ...args: string[]): string =>
  boundedOutput("git", args, { boundMs: GIT_BOUND_MS, cwd });

const writeIn = (dir: string, path: string, content: string, executable = false): void => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
  if (executable) chmodSync(join(dir, path), 0o755);
};

const worktreeOf = (): string => join(stateRoot, "worktrees", `${NAMESPACE}.${SHORT}`, "phase-01");

beforeEach(() => {
  restoreGit = isolateGit();
  root = realpathSync(mkdtempSync(join(tmpdir(), "phax-pointer-run-")));
  repoRoot = join(root, "repo");
  stateRoot = join(root, "state");
  markers = join(root, "markers");
  for (const dir of [repoRoot, stateRoot, markers]) mkdirSync(dir);
  gitIn(repoRoot, "init", "--initial-branch=main");
  disableGitAutoMaintenance(repoRoot);
  gitIn(repoRoot, "config", "--local", "user.email", "ada@example.test");
  gitIn(repoRoot, "config", "--local", "user.name", "Ada Example");
  gitIn(repoRoot, "config", "--local", "commit.gpgsign", "false");
  writeIn(repoRoot, ".gitignore", ".phax-context/\n");
  writeIn(repoRoot, "src/keep.ts", "export const keep = 1;\n");
  gitIn(repoRoot, "add", "-A");
  gitIn(repoRoot, "commit", "-m", "chore: start");
});

afterEach(() => {
  removeTempDir(root);
  restoreGit();
});

function planOf(): { plan: PhaxPlan; planMd: string } {
  const { plan } = Result.getOrThrow(
    liftFixturePhaxPlanToCurrent("phax-plan.json", {
      version: 1,
      run: {
        shortName: SHORT,
        title: "Invoice export",
        branch: `phax/${SHORT}`,
        requiredCommands: [],
      },
      phases: [
        {
          id: "phase-01",
          title: "Export step",
          model: "claude-sonnet-5-5",
          effort: "medium",
          planMarkdownAnchor: "#phase-01",
          plannedFilesToCreate: ["src/phase-01.ts"],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "feat(export): step one", body: "Made-up body." },
        },
      ],
    }),
  );
  return { plan, planMd: planMdFor(plan) };
}

const SESSION = Result.getOrThrow(decodeClaudeSessionId("session-phase-01"));

function configOf(): ResolvedConfig {
  return {
    raw: {
      version: 1,
      name: NAMESPACE,
      state: { root: stateRoot },
      gateProfiles: {
        standard: [{ command: GATE, surface: "local", firing: "every-phase", output: "log" }],
      },
    },
    stateRoot,
    namespace: NAMESPACE,
    repoRoot,
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low",
    fileReconciliationMode: "report_only",
    records: {
      enabled: false,
      transcript: false,
      destination: { kind: "in-repo" },
      autoPush: false,
    },
    security: {
      profile: "unsafe",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
    publish: resolvePublishConfig(undefined),
    complianceReview: resolveComplianceReviewConfig(undefined),
    codeReview: resolveCodeReviewConfig(undefined),
    authoring: resolveAuthoringConfig(undefined),
  };
}

interface Run {
  readonly shortName: ShortName;
  readonly plan: PhaxPlan;
  readonly planMd: string;
  readonly config: ResolvedConfig;
  readonly runPath: string;
  readonly runId: RunId;
  readonly lock: ReturnType<typeof makeFakeLock>;
}

/** The agent's turn: it writes its file, then `tamper` runs in the worktree. */
function backendFor(tamper: ((worktree: string) => void) | null) {
  const backend = makeFakeBackend();
  backend.impl.setOnRunAgent((_prompt, options) => {
    writeIn(options.cwd, "src/phase-01.ts", "export const one = 1;\n");
    tamper?.(options.cwd);
  });
  backend.impl.setAutoHandoffContent(HANDOFF);
  backend.impl.addRunResponse({ sessionId: SESSION, outputPath: "", finalText: "done" });
  backend.impl.addResumeResponse({ sessionId: SESSION, outputPath: "", finalText: "" });
  return backend;
}

function layersFor(run: Run, backend: ReturnType<typeof makeFakeBackend>) {
  const shell = makeFakeShell();
  shell.impl.setDefaultResponse({ exitCode: 0, stdout: "ok", stderr: "" });
  return Layer.mergeAll(
    backend.layer,
    NodeFileSystemLayer,
    makeNodeGitLayer({ repoRoot }),
    shell.layer,
    NoopSystemTelemetryLayer,
    makeFakeGitHub().layer,
    run.lock.layer,
  );
}

function execute(run: Run, backend: ReturnType<typeof makeFakeBackend>, allowDirty: boolean) {
  return Effect.runPromise(
    Effect.result(
      withRunLock(
        `${NAMESPACE}.${SHORT}`,
        executePlan({
          phaxVersion: "0.0.0-test",
          output: processOutput,
          shortName: run.shortName,
          namespace: NAMESPACE,
          plan: run.plan,
          planMd: run.planMd,
          config: run.config,
          gateProfileId: "standard",
          allowDirty,
          runPath: run.runPath,
          runId: run.runId,
          startIndex: 0,
          routing: DEFAULT_MODEL_ROUTING,
          providerConfig: DEFAULT_PROVIDER_CONFIG,
        }),
      ).pipe(Effect.provide(layersFor(run, backend))),
    ),
  );
}

async function newRun(): Promise<Run> {
  const shortName = Result.getOrThrow(decodeShortName(SHORT));
  const { plan, planMd } = planOf();
  const config = configOf();
  const { runPath, runId } = await Effect.runPromise(
    createRunFolder(shortName, planMd, plan, config).pipe(Effect.provide(NodeFileSystemLayer)),
  );
  return { shortName, plan, planMd, config, runPath, runId, lock: makeFakeLock() };
}

/** The field `key` of the JSON object in the file at `path`. */
function fieldOf(path: string, key: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return Predicate.hasProperty(parsed, key) ? parsed[key] : undefined;
}

/** The agent's tampering: `.git` names a gitdir of its own, whose config plants an fsmonitor. */
function plantGitdir(worktree: string): void {
  const head = gitIn(worktree, "rev-parse", "HEAD").trim();
  writeIn(root, "fsmonitor.sh", `#!/bin/sh\ntouch "${join(markers, "fsmonitor")}"\nexit 0\n`, true);
  writeIn(worktree, "x/HEAD", `${head}\n`);
  writeIn(
    worktree,
    "x/config",
    `[core]\n\trepositoryformatversion = 0\n\tfsmonitor = ${join(root, "fsmonitor.sh")}\n`,
  );
  mkdirSync(join(worktree, "x/objects"), { recursive: true });
  mkdirSync(join(worktree, "x/refs"), { recursive: true });
  writeIn(worktree, ".git", "gitdir: ./x\n");
}

describe("a phase whose agent rewrote the worktree's .git", () => {
  it("fails with the refusal, and reset-phase then a resume recreate an intact worktree", async () => {
    const run = await newRun();
    const result = await execute(run, backendFor(plantGitdir), false);

    // The phase failed with the refusal, and the planted fsmonitor never ran.
    expect(Result.isFailure(result)).toBe(true);
    const worktree = worktreeOf();
    const expected = join(realpathSync(join(repoRoot, ".git")), "worktrees", "phase-01");
    const refusal = [
      `${join(worktree, ".git")}: the worktree's .git no longer points at the git directory phax created`,
      ".git holds:  gitdir: ./x",
      `expected:    gitdir: ${expected}`,
      "phax ran no git command in this worktree after the change.",
    ].join("\n");
    if (Result.isFailure(result)) {
      const failure = result.failure;
      expect(Predicate.hasProperty(failure, "message") ? failure.message : undefined).toBe(refusal);
    }
    // The first git call after the turn is the phase commit: the refusal fails
    // the run, rather than pausing it as a commit to retry; nothing is committed.
    const runStatusPath = join(run.runPath, "run-status.json");
    expect(fieldOf(join(run.runPath, "phase-01", "status.json"), "commitHash")).toBeUndefined();
    expect(fieldOf(runStatusPath, "state")).toBe("failed");
    expect(fieldOf(runStatusPath, "lastError")).toEqual(expect.stringContaining(refusal));
    expect(gitIn(repoRoot, "log", "-1", "--format=%s", `phax/${SHORT}--phase-01`).trim()).toBe(
      "chore: start",
    );
    expect(existsSync(join(markers, "fsmonitor"))).toBe(false);
    // `phax resume` alone would refuse again: the pointer is still rewritten.
    expect(readFileSync(join(worktree, ".git"), "utf8")).toBe("gitdir: ./x\n");
    // git itself will not remove such a worktree, which is why the reset deletes it.
    const plainRemove = boundedSpawn("git", ["worktree", "remove", "--force", worktree], {
      boundMs: GIT_BOUND_MS,
      cwd: repoRoot,
    });
    expect(plainRemove.status).not.toBe(0);
    expect(existsSync(worktree)).toBe(true);

    const reset = await Effect.runPromise(
      Effect.result(
        resetPhase({
          namespace: NAMESPACE,
          shortName: run.shortName,
          phaseId: "phase-01",
          stateRoot,
          repoRoot,
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              NodeFileSystemLayer,
              makeNodeGitLayer({ repoRoot }),
              makeFakeShell().layer,
              NoopSystemTelemetryLayer,
              run.lock.layer,
            ),
          ),
        ),
      ),
    );
    if (Result.isFailure(reset)) throw new Error(reset.failure.message);
    expect(reset.success.worktreeRemoved).toBe(true);
    expect(existsSync(worktree)).toBe(false);
    expect(gitIn(repoRoot, "worktree", "list", "--porcelain")).not.toContain(worktree);

    const resumed = await execute(run, backendFor(null), true);
    expect(Result.isSuccess(resumed)).toBe(true);
    expect(readFileSync(join(worktree, ".git"), "utf8").trim()).toBe(`gitdir: ${expected}`);
    expect(gitIn(worktree, "log", "-1", "--format=%s").trim()).toBe("feat(export): step one");
    expect(existsSync(join(markers, "fsmonitor"))).toBe(false);
  });
});
