import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Layer, Option, Result } from "effect";
import { afterEach, beforeEach } from "vitest";
import { readCacheEntry } from "../../src/app/planCacheStore.js";
import {
  type ReviseArtifactError,
  type ReviseArtifactInput,
  type ReviseArtifactResult,
  reviseArtifact,
} from "../../src/app/reviseArtifact.js";
import { exitCodeForAuthoringError } from "../../src/cli/commands/runLayers.js";
import { serializeSidecar } from "../../src/domain/artifact/sidecar.js";
import type { ArtifactKind } from "../../src/domain/artifact/status.js";
import { renderPlanBody } from "../../src/domain/authoring/renderPlan.js";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import { planCacheKey } from "../../src/domain/planCache/key.js";
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
import type { ExtractedPhaxPlan } from "../../src/schemas/phaxPlan.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { PlanDocument } from "../../src/schemas/planDocument.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import type { SpecDocument } from "../../src/schemas/specDocument.js";
import {
  AMENDMENT,
  KEPT_BRIEF,
  PLAN_FRONTMATTER,
  REVISE_PLAN,
  REVISE_PLAN_ID,
  REVISE_PLAN_PATH,
  REVISE_PLAN_SIDECAR,
  REVISE_SPEC,
  REVISE_SPEC_ID,
  REVISE_SPEC_PATH,
  REVISE_SPEC_SIDECAR,
  SPEC_FRONTMATTER,
} from "../unit/revise/reviseFixtures.js";
import {
  EXTRACT_EFFORT,
  EXTRACT_MODEL,
  KEPT_FIRST_SESSION,
  KEPT_SESSION,
  NOW,
  OPERATOR,
  RECORDS_BRANCH,
  RECORDS_ON,
  RETRY_SESSION,
  WRITER_SESSION,
} from "./decideVerdictsHarness.js";
import { isolateGit } from "./isolateGit.js";
import { isolatePhaxHome } from "./isolatePhaxHome.js";
import { disableGitAutoMaintenance, removeTempDir } from "./tempGit.js";

// The world of the revise acceptance suite: a real git repository in a temp dir
// with a committer identity, a state root beside it, a fake backend, a fake
// terminal and a fake GitHub. It seeds a Draft headless spec or plan, its kept
// authoring session and brief, and every state revise refuses. Every spec, plan,
// operator and amendment is made up.

export { AMENDMENT, KEPT_BRIEF, KEPT_SESSION, OPERATOR, RECORDS_ON };

const SKILL_SPEC = "# Author a spec (bundled)\n\n- Write requirements as EARS statements.\n";
const SKILL_PLAN = "# Author a plan (bundled)\n\n- Split by shippable surface.\n";

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

/** A provider config that enables Mistral Vibe beside the defaults. */
export const VIBE_ENABLED: ProviderConfig = {
  providers: {
    ...DEFAULT_PROVIDER_CONFIG.providers,
    "mistral-vibe": { ...DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"]!, enabled: true },
  },
};

/** The state of the artifact a seeder writes. */
type SeedShape = "in-sync" | "hand" | "diverged" | "invalid" | "unmigrated";

export interface SeedOptions {
  readonly kind: ArtifactKind;
  /** How the artifact is authored and whether its sidecar agrees; default `in-sync`. */
  readonly shape?: SeedShape;
  /** The frontmatter status; default `Draft`. */
  readonly status?: "Draft" | "Approved" | "Stale";
  /**
   * The kept authoring session under `authoring/<id>/`, with its brief: `false`
   * keeps none; `{ provider }` names the provider it ran on (default
   * `claude-code`, in this checkout).
   */
  readonly kept?: false | { readonly provider?: string };
}

/** What a seeder wrote and committed. */
export interface Seeded {
  readonly kind: ArtifactKind;
  /** Repo-relative path of the artifact and of its sidecar. */
  readonly path: string;
  readonly sidecarPath: string;
  /** `<stamp>-<slug>`: the authoring id, and the revise folder's parent. */
  readonly id: string;
  readonly md: string;
  /** The sidecar's text, or null when none was written. */
  readonly sidecarText: string | null;
  /** The frontmatter block, `---` lines included. */
  readonly frontmatter: string;
}

export interface HarnessOptions {
  /** Queued answers of the first writer turn when it runs a new session. */
  readonly runAnswers?: readonly string[];
  /** Queued answers of every resume: the kept session's turn, then the corrective one. */
  readonly resumeAnswers?: readonly string[];
  /** Whether stdin is a terminal; default true. */
  readonly terminal?: boolean;
}

/** An older `$schema` of each kind's document format, below the current shape. */
const OLDER_SHAPE: Readonly<Record<ArtifactKind, string>> = { spec: "0.17.0", plan: "0.19.0" };

/**
 * Registers the suite's per-test world (git isolation, a fresh repository with
 * one commit and a committer identity, a state root) and gives its accessors.
 * Values are read through the returned object: they change from test to test.
 */
export function useReviseRepo() {
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
    configDir = mkdtempSync(join(tmpdir(), "phax-revise-config-"));
    stateRoot = join(realpathSync(configDir), "state");
    repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-revise-")));
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

  function writeRepoFile(rel: string, content: string): void {
    const abs = join(repoDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  function commitAll(message = "seed"): void {
    git(["add", "-A"]);
    git(["commit", "-q", "-m", message]);
  }

  /** Keeps an authoring session for `id`, as headless authoring leaves it, and its brief. */
  function keepAuthoring(id: string, provider: string): void {
    const folder = join(stateRoot, "authoring", id);
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "session.json"),
      JSON.stringify({
        version: 1,
        provider,
        sessionId: KEPT_FIRST_SESSION,
        retrySessionId: KEPT_SESSION,
        cwd: repoDir,
      }),
    );
    writeFileSync(join(folder, "brief.md"), KEPT_BRIEF);
  }

  /** Writes the artifact (and its sidecar), commits it, and keeps its authoring session. */
  function seed(options: SeedOptions): Seeded {
    const { kind } = options;
    const shape = options.shape ?? "in-sync";
    const status = options.status ?? "Draft";
    const path = kind === "spec" ? REVISE_SPEC_PATH : REVISE_PLAN_PATH;
    const sidecarPath = kind === "spec" ? REVISE_SPEC_SIDECAR : REVISE_PLAN_SIDECAR;
    const id = kind === "spec" ? REVISE_SPEC_ID : REVISE_PLAN_ID;
    const sidecar = kind === "spec" ? REVISE_SPEC : REVISE_PLAN;
    const frontmatter = (kind === "spec" ? SPEC_FRONTMATTER : PLAN_FRONTMATTER).replace(
      "status: Draft",
      `status: ${status}`,
    );
    const body =
      kind === "spec"
        ? renderSpecBody(sidecar.document as SpecDocument)
        : renderPlanBody(sidecar.document as PlanDocument);
    const inSync = serializeSidecar(sidecar);
    const format = kind === "spec" ? "spec-document" : "plan-document";

    const md =
      shape === "diverged" ? `${frontmatter}${body}\nA stray paragraph.\n` : frontmatter + body;
    let sidecarText: string | null;
    switch (shape) {
      case "hand":
        sidecarText = null;
        break;
      case "invalid":
        sidecarText = `${JSON.stringify({ $schema: currentSchemaUrl(format), kind }, null, 2)}\n`;
        break;
      case "unmigrated":
        sidecarText = inSync.replace(
          currentSchemaUrl(format),
          schemaUrl(format, OLDER_SHAPE[kind]),
        );
        break;
      default:
        sidecarText = inSync;
    }
    writeRepoFile(path, md);
    if (sidecarText !== null) writeRepoFile(sidecarPath, sidecarText);
    commitAll();
    if (shape !== "hand" && options.kept !== false) {
      keepAuthoring(id, options.kept?.provider ?? "claude-code");
    }
    return { kind, path, sidecarPath, id, md, sidecarText, frontmatter };
  }

  const world = {
    get repoDir() {
      return repoDir;
    },
    get stateRoot() {
      return stateRoot;
    },
    git,
    writeRepoFile,
    readRepoFile(rel: string): string {
      return readFileSync(join(repoDir, rel), "utf8");
    },
    commitAll,
    seed,
    headSha(): string {
      return git(["rev-parse", "HEAD"]).trim();
    },
    /** The paths of the HEAD commit, sorted. */
    headFiles(): string[] {
      return git(["show", "--name-only", "--format=", "HEAD"]).trim().split("\n").toSorted();
    },
    /** The full message of the HEAD commit, without its trailing newline. */
    headMessage(): string {
      return git(["log", "-1", "--format=%B"]).trimEnd();
    },
    /** How many commits HEAD is ahead of `base`. */
    commitsSince(base: string): number {
      return Number(git(["rev-list", "--count", `${base}..HEAD`]).trim());
    },
    porcelain(): string {
      return git(["status", "--porcelain"]).trim();
    },
    /** Drops the repository's committing identity, as a machine with none configured. */
    unsetCommitterName(): void {
      git(["config", "--local", "--unset", "user.name"]);
    },
    /** The revision folder `<stateRoot>/revise/<id>/<index>`. */
    reviseFolder(id: string, index = "01"): string {
      return join(stateRoot, "revise", id, index);
    },
    /** The file names of a revision folder, sorted; empty when it does not exist. */
    reviseFolderFiles(id: string, index = "01"): string[] {
      const folder = join(stateRoot, "revise", id, index);
      return existsSync(folder) ? readdirSync(folder).toSorted() : [];
    },
    /** Whether the state root holds any revision folder at all. */
    hasReviseRoot(): boolean {
      return existsSync(join(stateRoot, "revise"));
    },
    /** The plan extraction cache's entry for this plan text, or null when there is none. */
    async planCacheEntry(md: string): Promise<ExtractedPhaxPlan | null> {
      const entry = await Effect.runPromise(
        readCacheEntry(stateRoot, planCacheKey(md, EXTRACT_MODEL, EXTRACT_EFFORT)).pipe(
          Effect.provide(makeRootedNodeFileSystemLayer(repoDir)),
        ),
      );
      return Option.getOrNull(entry);
    },
    /** A file of the records branch, or null when the branch or the file is missing. */
    recordsFile(path: string): string | null {
      try {
        return git(["show", `${RECORDS_BRANCH}:${path}`]);
      } catch {
        return null;
      }
    },
    /** The revision record's manifest for a Revision-Id, decoded as JSON, or null when none was written. */
    revisionRecord(revisionId: string): Record<string, unknown> | null {
      const text = world.recordsFile(`revision/${revisionId}/record.json`);
      return text === null ? null : (JSON.parse(text) as Record<string, unknown>);
    },
    harness(opts: HarnessOptions = {}) {
      return harnessIn(world, opts);
    },
  };
  return world;
}

export type ReviseRepo = ReturnType<typeof useReviseRepo>;

function harnessIn(world: ReviseRepo, opts: HarnessOptions) {
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
  const terminal = makeFakeTerminal(opts.terminal ?? true);
  const github = makeFakeGitHub();
  const lines: string[] = [];
  const warnings: string[] = [];
  const layer = Layer.mergeAll(
    makeRootedNodeFileSystemLayer(world.repoDir),
    NodeGitLayer,
    backend.layer,
    terminal.layer,
    github.layer,
  );

  /** Runs `reviseArtifact` on `path`; `overrides` replace the input's defaults. */
  const run = (
    path: string,
    overrides: Partial<ReviseArtifactInput> = {},
  ): Promise<Result.Result<ReviseArtifactResult, ReviseArtifactError>> =>
    Effect.runPromise(
      Effect.result(
        reviseArtifact({
          path,
          amendment: { text: AMENDMENT, label: "amendment.md" },
          by: "operator",
          model: undefined,
          effort: undefined,
          authoring: {
            spec: { model: "claude-sonnet-5-5", effort: "high" },
            plan: { model: "claude-sonnet-5-5", effort: "high" },
          },
          routing: DEFAULT_MODEL_ROUTING,
          providerConfig: DEFAULT_PROVIDER_CONFIG,
          skills: { spec: SKILL_SPEC, plan: SKILL_PLAN },
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
export type RunResult = Result.Result<ReviseArtifactResult, ReviseArtifactError>;

/** The committed or unchanged result, or the run's error made readable. */
export function succeeded(result: RunResult): ReviseArtifactResult {
  return Result.getOrThrowWith(result, (error) => {
    const { _tag, message } = error as { _tag?: string; message?: string };
    return new Error(`revise failed: ${_tag ?? "error"}: ${message ?? JSON.stringify(error)}`);
  });
}

/** What a failed run says: its error's tag and message, and the exit code the CLI maps it to. */
export interface FailureFacts {
  readonly tag: string;
  readonly message: string;
  readonly exitCode: number;
}

/** The run's failure, with its exit code; throws when the run succeeded. */
export function failureOf(result: RunResult): FailureFacts {
  if (Result.isSuccess(result)) {
    throw new Error(`expected a failure, got ${result.success.kind}`);
  }
  const raw = result.failure as { _tag: string; message: string };
  const { _tag: tag, message } = raw;
  return { tag, message, exitCode: exitCodeForAuthoringError(raw) };
}

/** No writer was started and nothing was recorded or written: no call, no revision folder. */
export function noWriterStarted(world: ReviseRepo, h: Harness): boolean {
  return (
    h.backend.runCalls.length === 0 &&
    h.backend.resumeCalls.length === 0 &&
    h.backend.completeCalls.length === 0 &&
    !world.hasReviseRoot()
  );
}

/** The value of a commit message's trailer, or null. */
export function trailerOf(message: string, key: string): string | null {
  const found = new RegExp(`^${key}: (.*)$`, "m").exec(message);
  return found === null ? null : (found[1] ?? null);
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
