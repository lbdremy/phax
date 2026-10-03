/**
 * Throwaway project fixtures for the preflight-before-naming acceptance suite.
 *
 * Each fixture is a temporary git repository plus a SEPARATE temporary state
 * root outside it, so run folders, locks and the registry never dirty the tree
 * under test. All content is made up here; nothing is read from ~/.phax or from
 * another repository.
 */
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
import type { OutputPort } from "../../../src/ports/output.js";
import { disableGitAutoMaintenance, removeTempDir } from "../../helpers/tempGit.js";

const FIXTURE_NAMESPACE = "acme";
/** The model every fixture phase uses unless overridden: an active catalog entry. */
export const FIXTURE_MODEL = "claude-opus-5-5";
export const FIXTURE_EFFORT = "medium";

export interface PreflightRepo {
  /** Real path of the temporary git repository (what `git rev-parse` reports). */
  readonly repo: string;
  /** Real path of the temporary state root, outside the repository. */
  readonly stateRoot: string;
  readonly namespace: string;
}

interface FixtureConfig {
  /** Verbatim `security` block of phax.json. */
  readonly security?: Record<string, unknown>;
  /** Verbatim `records` block of phax.json. */
  readonly records?: Record<string, unknown>;
}

interface FixturePhase {
  readonly model?: string;
  readonly effort?: string;
  readonly plannedFilesToCreate?: readonly string[];
  readonly plannedFilesToEdit?: readonly string[];
}

interface FixturePlan {
  readonly requiredCommands?: readonly string[];
  /** One entry per phase; defaults to a single phase. */
  readonly phases?: readonly FixturePhase[];
}

export interface Fixture {
  readonly config?: FixtureConfig;
  readonly plan?: FixturePlan;
  /** Extra committed files, keyed by repo-relative path. */
  readonly files?: Readonly<Record<string, string>>;
}

export function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: "pipe" });
}

/**
 * Create the two temporary roots and a git repository holding phax.json,
 * plan.md (title `Foo`, so the run slug is `foo`) and any extra files, all in
 * one initial commit: the tree starts clean.
 */
export function createPreflightRepo(fixture: Fixture = {}): PreflightRepo {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "phax-preflight-repo-")));
  const stateRoot = realpathSync(mkdtempSync(join(tmpdir(), "phax-preflight-state-")));
  const roots: PreflightRepo = { repo, stateRoot, namespace: FIXTURE_NAMESPACE };

  git(["init", "-q", "-b", "main"], repo);
  disableGitAutoMaintenance(repo);
  git(["config", "--local", "user.email", "test@phax.test"], repo);
  git(["config", "--local", "user.name", "phax test"], repo);
  git(["config", "--local", "commit.gpgsign", "false"], repo);

  // A machine-wide ~/.phax/config.json may set state.root; the local overlay
  // outranks it, so every write stays under the temporary state root. It is
  // excluded rather than committed so it never shows up in the tree.
  writeFileSync(join(repo, "phax.local.json"), JSON.stringify({ state: { root: stateRoot } }));
  writeFileSync(join(repo, ".git", "info", "exclude"), "phax.local.json\n");

  writeFixtureFile(repo, "README.md", "# fixture\n");
  writeFixtureFile(repo, "phax.json", fixturePhaxJson(roots, fixture.config));
  writeFixtureFile(repo, "plan.md", fixturePlanMd(fixture.plan));
  for (const [path, content] of Object.entries(fixture.files ?? {})) {
    writeFixtureFile(repo, path, content);
  }
  commitAll(repo, "chore: fixture");
  return roots;
}

export function removePreflightRepo(roots: PreflightRepo | undefined): void {
  if (roots === undefined) return;
  removeTempDir(roots.repo);
  removeTempDir(roots.stateRoot);
}

export function writeFixtureFile(repo: string, relPath: string, content: string): void {
  const abs = join(repo, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function commitAll(repo: string, message: string): void {
  git(["add", "-A"], repo);
  git(["commit", "-q", "-m", message], repo);
}

function fixturePhaxJson(roots: PreflightRepo, config: FixtureConfig = {}): string {
  return (
    JSON.stringify(
      {
        version: 1,
        name: roots.namespace,
        state: { root: roots.stateRoot },
        gateProfiles: {
          standard: [{ command: "true", surface: "local", firing: "every-phase" }],
        },
        publish: { auto: false },
        review: { compliance: { enabled: false } },
        ...(config.security !== undefined ? { security: config.security } : {}),
        ...(config.records !== undefined ? { records: config.records } : {}),
      },
      null,
      2,
    ) + "\n"
  );
}

function bulletList(items: readonly string[] | undefined): string {
  if (items === undefined || items.length === 0) return "- (none)";
  return items.map((item) => `- \`${item}\``).join("\n");
}

/** A plan.md in the shape deterministic extraction parses without a provider. */
function fixturePlanMd(plan: FixturePlan = {}): string {
  const phases = plan.phases ?? [{}];
  const sections = phases.map((phase, i) => {
    const n = String(i + 1).padStart(2, "0");
    return [
      `## phase-${n} — Step ${n} {#phase-${n}-step}`,
      "",
      `**Recommended model:** ${phase.model ?? FIXTURE_MODEL}`,
      `**Recommended effort:** ${phase.effort ?? FIXTURE_EFFORT}`,
      "",
      "### Planned files to create",
      "",
      bulletList(phase.plannedFilesToCreate ?? [`src/step-${n}.ts`]),
      "",
      "### Planned files to edit",
      "",
      bulletList(phase.plannedFilesToEdit),
      "",
      "### Optional files that may be edited",
      "",
      "- (none)",
      "",
      "### Commit subject",
      "",
      `\`feat: step ${n}\``,
      "",
      "### Commit body",
      "",
      `Adds step ${n}.`,
      "",
      "---",
      "",
    ].join("\n");
  });
  return [
    "---",
    "status: Approved",
    "source-spec: null",
    "---",
    "# Foo",
    "",
    "## Required commands",
    "",
    bulletList(plan.requiredCommands),
    "",
    ...sections,
  ].join("\n");
}

export interface RepoSnapshot {
  /** registry.json bytes, or null when absent. */
  readonly registry: string | null;
  /** Entries under `<stateRoot>/runs/`. */
  readonly runs: readonly string[];
  /** `git branch --list 'phax/*'`. */
  readonly phaxBranches: string;
  /** `git worktree list --porcelain`. */
  readonly worktrees: string;
  /** `git status --porcelain`. */
  readonly status: string;
  /** Every `semantic.jsonl` found under `<stateRoot>/runs/`. */
  readonly semanticJsonl: readonly string[];
}

function findFiles(dir: string, name: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findFiles(path, name));
    else if (entry.name === name) found.push(path);
  }
  return found;
}

export function snapshotRepo(roots: PreflightRepo): RepoSnapshot {
  const registryPath = join(roots.stateRoot, "registry.json");
  const runsDir = join(roots.stateRoot, "runs");
  return {
    registry: existsSync(registryPath) ? readFileSync(registryPath, "utf8") : null,
    runs: existsSync(runsDir) ? readdirSync(runsDir).toSorted() : [],
    phaxBranches: git(["branch", "--list", "phax/*"], roots.repo),
    worktrees: git(["worktree", "list", "--porcelain"], roots.repo),
    status: git(["status", "--porcelain"], roots.repo),
    semanticJsonl: findFiles(runsDir, "semantic.jsonl"),
  };
}

export interface RecordingOutput {
  readonly port: OutputPort;
  readonly logs: string[];
  readonly warnings: string[];
  readonly errors: string[];
}

export function recordingOutput(): RecordingOutput {
  const logs: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    port: {
      log: (m) => logs.push(m),
      warn: (m) => warnings.push(m),
      error: (m) => errors.push(m),
    },
    logs,
    warnings,
    errors,
  };
}
