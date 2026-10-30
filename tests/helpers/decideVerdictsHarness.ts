import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, expect } from "vitest";
import {
  type DecideVerdictsInput,
  type DecideVerdictsResult,
  decideVerdicts,
} from "../../src/app/decideVerdicts.js";
import { exitCodeForAuthoringError } from "../../src/cli/commands/runLayers.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeTerminal } from "../../src/infra/fakes/terminal.js";
import { makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import type { Backend } from "../../src/ports/backend.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";
import { SPEC_PATH } from "../unit/decide/verdictsFixtures.js";
import { isolateGit } from "./isolateGit.js";
import { isolatePhaxHome } from "./isolatePhaxHome.js";
import { disableGitAutoMaintenance, removeTempDir } from "./tempGit.js";

// The world of the verdicts-mode integration suites: a real git repository in
// a temp dir, a state root beside it, a fake backend and a fake terminal. Every
// spec, plan, operator and doctrine is made up.

export const OPERATOR = "Ada Lovelace";
export const NOW = "2026-10-25T10:00:00.000Z";
export const EXTRACT_MODEL = "claude-haiku-5-5";
export const EXTRACT_EFFORT = "low";
/** The session id the kept authoring session was last resumed under. */
export const KEPT_SESSION = "5f0c2a71-1b9e-4c55-9a43-6a2d1f6e8b10";
export const KEPT_FIRST_SESSION = "11111111-2222-4333-8444-555555555555";
export const WRITER_SESSION = "7d3e9b10-aaaa-4bbb-8ccc-0123456789ab";
export const RETRY_SESSION = "9a8b7c6d-1111-4222-8333-444455556666";

// Made-up doctrine skills: ids open list items.
const SKILL_SPEC = [
  "# Decide a spec (bundled)",
  "",
  "- `E0` Escalate what you may not decide.",
  "- `C1` Name what each option abandons.",
  "- `S1` Adopt the recommendation unless a principle says otherwise.",
  "- `S2` A surface beats a promise.",
  "",
].join("\n");
const SKILL_PLAN = [
  "# Decide a plan (bundled)",
  "",
  "- `E0` Escalate what you may not decide.",
  "- `S1` Adopt the recommendation unless a principle says otherwise.",
  "- `P1` Split by shippable surface.",
  "",
].join("\n");

const SECURITY: ResolvedSecurityConfig = {
  profile: "secure",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],
};

const RECORDS_OFF: ResolvedRecordsConfig = {
  enabled: false,
  transcript: false,
  destination: { kind: "in-repo" },
  autoPush: false,
};
export const RECORDS_ON: ResolvedRecordsConfig = {
  enabled: true,
  transcript: true,
  destination: { kind: "in-repo" },
  autoPush: false,
};
export const RECORDS_BRANCH = "phax/records/v1";

export const SPEC_FRONTMATTER =
  "---\nstatus: Draft\ndate: 2026-10-25\naudience: maintainers\nscope: logs\n---\n";

/** The verdicts file's `$schema`-stamped JSON text. */
export interface HarnessOptions {
  /** Queued answers of the first writer turn when it runs a new session. */
  readonly runAnswers?: readonly string[];
  /** Queued answers of every resume: the kept session's turn, then the corrective one. */
  readonly resumeAnswers?: readonly string[];
  readonly terminal?: boolean;
  readonly stdin?: string;
  /** A backend to run the writer on instead of the fake one (the real adapters, over fake CLIs). */
  readonly backendLayer?: Layer.Layer<Backend>;
}

/**
 * Registers the suite's per-test world (git isolation, a fresh repository with
 * one commit, a state root) and gives its accessors. Values are read through
 * the returned object: they change from test to test.
 */
export function useDecideRepo() {
  let repoDir = "";
  let configDir = "";
  let stateRoot = "";
  let restoreGit: (() => void) | undefined;
  let restoreHome: (() => void) | undefined;

  function git(args: readonly string[]): string {
    return execFileSync("git", [...args], { cwd: repoDir, stdio: "pipe" }).toString();
  }

  beforeEach(() => {
    restoreGit = isolateGit();
    restoreHome = isolatePhaxHome().restore;
    configDir = mkdtempSync(join(tmpdir(), "phax-verdicts-config-"));
    stateRoot = join(realpathSync(configDir), "state");
    repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-verdicts-")));
    git(["init", "-q", "-b", "main"]);
    disableGitAutoMaintenance(repoDir);
    git(["config", "--local", "user.name", OPERATOR]);
    git(["config", "--local", "user.email", "ada@example.test"]);
    writeFileSync(join(repoDir, "README.md"), "fixture\n");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "init"]);
  });

  afterEach(() => {
    removeTempDir(repoDir);
    removeTempDir(configDir);
    restoreHome?.();
    restoreGit?.();
  });

  const world = {
    get repoDir() {
      return repoDir;
    },
    get stateRoot() {
      return stateRoot;
    },
    git,
    writeRepoFile(rel: string, content: string): void {
      const abs = join(repoDir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    },
    readRepoFile(rel: string): string {
      return readFileSync(join(repoDir, rel), "utf8");
    },
    commitAll(message = "seed"): void {
      git(["add", "-A"]);
      git(["commit", "-q", "-m", message]);
    },
    headSha(): string {
      return git(["rev-parse", "HEAD"]).trim();
    },
    headFiles(): string[] {
      return git(["show", "--name-only", "--format=", "HEAD"]).trim().split("\n").toSorted();
    },
    porcelain(): string {
      return git(["status", "--porcelain"]).trim();
    },
    /** The decision folder `<stateRoot>/decide/<id>/<index>`. */
    decisionFolder(id: string, index = "01"): string {
      return join(stateRoot, "decide", id, index);
    },
    /** Keeps an authoring session for `id`, as headless authoring leaves it. */
    keepAuthoringSession(
      id: string,
      overrides: { provider?: string; cwd?: string; retrySessionId?: string | null } = {},
    ): void {
      const folder = join(stateRoot, "authoring", id);
      mkdirSync(folder, { recursive: true });
      writeFileSync(
        join(folder, "session.json"),
        JSON.stringify({
          version: 1,
          provider: overrides.provider ?? "claude-code",
          sessionId: KEPT_FIRST_SESSION,
          retrySessionId:
            overrides.retrySessionId === undefined ? KEPT_SESSION : overrides.retrySessionId,
          cwd: overrides.cwd ?? repoDir,
        }),
      );
    },
    harness(opts: HarnessOptions = {}) {
      return harnessIn(world, opts);
    },
  };
  return world;
}

export type DecideRepo = ReturnType<typeof useDecideRepo>;

function harnessIn(world: DecideRepo, opts: HarnessOptions) {
  const backend = makeFakeBackend();
  for (const finalText of opts.runAnswers ?? []) {
    backend.impl.addRunResponse({
      sessionId: WRITER_SESSION as ClaudeSessionId,
      outputPath: "",
      finalText,
    });
  }
  for (const finalText of opts.resumeAnswers ?? []) {
    backend.impl.addResumeResponse({
      sessionId: RETRY_SESSION as ClaudeSessionId,
      outputPath: "",
      finalText,
    });
  }
  const terminal = makeFakeTerminal(opts.terminal ?? true, opts.stdin);
  const github = makeFakeGitHub();
  const lines: string[] = [];
  const warnings: string[] = [];
  const layer = Layer.mergeAll(
    makeRootedNodeFileSystemLayer(world.repoDir),
    NodeGitLayer,
    opts.backendLayer ?? backend.layer,
    terminal.layer,
    github.layer,
  );
  const run = (overrides: Partial<DecideVerdictsInput> = {}) =>
    Effect.runPromise(
      Effect.either(
        decideVerdicts({
          path: SPEC_PATH,
          verdicts: { kind: "file", path: "verdicts.json" },
          label: "verdicts.json",
          by: undefined,
          doctrinePath: null,
          model: undefined,
          effort: undefined,
          routing: DEFAULT_MODEL_ROUTING,
          providerConfig: DEFAULT_PROVIDER_CONFIG,
          bundledSkills: { spec: SKILL_SPEC, plan: SKILL_PLAN },
          security: SECURITY,
          repoRoot: world.repoDir,
          stateRoot: world.stateRoot,
          extractPlanModel: EXTRACT_MODEL,
          extractPlanEffort: EXTRACT_EFFORT,
          nowIso: NOW,
          records: RECORDS_OFF,
          publishRemote: "origin",
          output: { log: (l) => lines.push(l), warn: (w) => warnings.push(w) },
          ...overrides,
        }).pipe(Effect.provide(layer)),
      ),
    );
  return { backend: backend.impl, github: github.impl, lines, warnings, run };
}

export type Harness = ReturnType<typeof harnessIn>;
export type RunResult = Either.Either<DecideVerdictsResult, unknown>;

/** The committed result, or the run's error made readable. */
export function committed(result: RunResult): DecideVerdictsResult {
  return Either.getOrThrowWith(result, (error) => {
    const { _tag, message } = error as { _tag?: string; message?: string };
    return new Error(
      `decide --verdicts failed: ${_tag ?? "error"}: ${message ?? JSON.stringify(error)}`,
    );
  });
}

/** The run failed with this exit code, leaving tree and HEAD as they were. */
export function expectFailure(
  world: DecideRepo,
  result: RunResult,
  exitCode: number,
  head: string,
): { readonly error: FailureFacts } {
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isRight(result)) throw new Error("expected a failure");
  const raw = result.left as {
    _tag: string;
    message: string;
    reason?: string;
    path?: string;
  };
  expect(exitCodeForAuthoringError(raw)).toBe(exitCode);
  expect(world.headSha()).toBe(head);
  expect(world.porcelain()).toBe("");
  const { _tag: tag, message, reason, path } = raw;
  return { error: { tag, message, reason, path } };
}

/** What a failed run says: its error's tag, message, and (when it has them) reason and document path. */
export interface FailureFacts {
  readonly tag: string;
  readonly message: string;
  readonly reason: string | undefined;
  readonly path: string | undefined;
}

/** No writer was started and nothing was recorded or written: no call, no decision folder. */
export function expectNoWriter(world: DecideRepo, h: Harness): void {
  expect(h.backend.runCalls).toEqual([]);
  expect(h.backend.resumeCalls).toEqual([]);
  expect(h.backend.completeCalls).toEqual([]);
  expect(existsSync(join(world.stateRoot, "decide"))).toBe(false);
}

/** A Claude turn's stream: every event names the session it ran in. */
function claudeTranscript(sessionId: string): string {
  return [
    JSON.stringify({ type: "system", subtype: "init", session_id: sessionId }),
    JSON.stringify({
      type: "result",
      session_id: sessionId,
      result: "{}",
      usage: {
        input_tokens: 900,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 4000,
        output_tokens: 700,
      },
      total_cost_usd: 0.2,
    }),
    "",
  ].join("\n");
}

/** The writer's turns write their transcripts as Claude would, naming the session. */
export function playTranscripts(h: Harness): void {
  h.backend.setOnRunAgent((_prompt, options) => {
    if (options.outputJsonlPath !== undefined) {
      writeFileSync(options.outputJsonlPath, claudeTranscript(WRITER_SESSION));
    }
  });
  h.backend.setOnResumeAgent((sessionId, _prompt, options) => {
    if (options.outputJsonlPath !== undefined) {
      writeFileSync(options.outputJsonlPath, claudeTranscript(sessionId));
    }
  });
}
