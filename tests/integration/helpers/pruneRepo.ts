/**
 * Throwaway fixtures for the `phax prune` acceptance suite.
 *
 * Each fixture is a temporary git repository plus a SEPARATE temporary state
 * root outside it, so archive folders, locks and the registry never dirty the
 * tree under test. Both paths are realpath'd: git reports `/private/var` on
 * macOS, and prune decides worktree ownership by path prefix. All content is
 * made up here; nothing is read from ~/.phax or from another repository.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { OutputPort } from "../../../src/ports/output.js";
import { runKey } from "../../../src/domain/runRef.js";
import { withSchemaUrl } from "../../../src/schemas/persisted.js";
import { encodeRegistryFile, type RegistryEntry } from "../../../src/schemas/registry.js";
import { disableGitAutoMaintenance, removeTempDir } from "../../helpers/tempGit.js";
import { git } from "./preflightRepo.js";

export { git };

const PRUNE_NAMESPACE = "acme";
export const RECORDS_BRANCH = "phax/records/v1";

export interface PruneRepo {
  /** Real path of the temporary git repository. */
  readonly repo: string;
  /** Real path of the temporary state root, outside the repository. */
  readonly stateRoot: string;
  readonly namespace: string;
}

/**
 * Create both temporary roots and a git repository holding phax.json and a
 * README in one initial commit on `main`: the tree starts clean.
 */
export function createPruneRepo(): PruneRepo {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "phax-prune-repo-")));
  const stateRoot = realpathSync(mkdtempSync(join(tmpdir(), "phax-prune-state-")));

  git(["init", "-q", "-b", "main"], repo);
  disableGitAutoMaintenance(repo);
  git(["config", "--local", "user.email", "test@phax.test"], repo);
  git(["config", "--local", "user.name", "phax test"], repo);
  git(["config", "--local", "commit.gpgsign", "false"], repo);

  // A machine-wide ~/.phax/config.json may set state.root; the local overlay
  // outranks it. Excluded rather than committed so the tree stays clean.
  writeFileSync(join(repo, "phax.local.json"), JSON.stringify({ state: { root: stateRoot } }));
  writeFileSync(join(repo, ".git", "info", "exclude"), "phax.local.json\n");

  writeFileSync(join(repo, "README.md"), "# prune fixture\n");
  writeFileSync(
    join(repo, "phax.json"),
    JSON.stringify(
      {
        version: 1,
        name: PRUNE_NAMESPACE,
        state: { root: stateRoot },
        gateProfiles: {
          standard: [{ command: "true", surface: "local", firing: "every-phase" }],
        },
        publish: { auto: false },
        review: { compliance: { enabled: false } },
      },
      null,
      2,
    ) + "\n",
  );
  git(["add", "-A"], repo);
  git(["commit", "-q", "-m", "chore: fixture"], repo);
  return { repo, stateRoot, namespace: PRUNE_NAMESPACE };
}

export function removePruneRepo(roots: PruneRepo | undefined): void {
  if (roots === undefined) return;
  removeTempDir(roots.repo);
  removeTempDir(roots.stateRoot);
}

// ── Registry ─────────────────────────────────────────────────────────────────

export function registryPath(roots: PruneRepo): string {
  return join(roots.stateRoot, "registry.json");
}

export function readRegistryEntries(roots: PruneRepo): RegistryEntry[] {
  const path = registryPath(roots);
  if (!existsSync(path)) return [];
  return (JSON.parse(readFileSync(path, "utf8")) as { runs: RegistryEntry[] }).runs;
}

/** Append an entry, writing the registry exactly as phax's `upsertRun` does. */
function addRegistryEntry(roots: PruneRepo, entry: RegistryEntry): void {
  const runs = [...readRegistryEntries(roots), entry];
  writeFileSync(
    registryPath(roots),
    JSON.stringify(encodeRegistryFile(withSchemaUrl("registry", { runs })), null, 2),
  );
}

export function findEntry(
  roots: PruneRepo,
  shortName: string,
  namespace: string = roots.namespace,
): RegistryEntry | undefined {
  return readRegistryEntries(roots).find(
    (e) => e.namespace === namespace && e.shortName === shortName,
  );
}

function makeEntry(
  namespace: string,
  shortName: string,
  overrides: Partial<RegistryEntry> = {},
): RegistryEntry {
  return {
    namespace,
    shortName,
    runId: `run-${shortName}-0001`,
    state: "archived",
    branch: `phax/${shortName}`,
    projectName: namespace,
    phasesCount: 3,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z",
    ...overrides,
  };
}

/** A registry entry in any state, with no branches and no folders. */
export function addNonArchivedEntry(
  roots: PruneRepo,
  shortName: string,
  state: RegistryEntry["state"],
  namespace: string = roots.namespace,
): RegistryEntry {
  const entry = makeEntry(namespace, shortName, { state });
  addRegistryEntry(roots, entry);
  return entry;
}

// ── Git seeding ──────────────────────────────────────────────────────────────

export function headOf(roots: PruneRepo, ref: string): string {
  return git(["rev-parse", ref], roots.repo).trim();
}

export function branchExists(roots: PruneRepo, branch: string): boolean {
  return (
    git(["for-each-ref", "--format=%(refname)", `refs/heads/${branch}`], roots.repo).trim().length >
    0
  );
}

export function refExists(roots: PruneRepo, ref: string): boolean {
  return git(["for-each-ref", "--format=%(refname)", ref], roots.repo).trim().length > 0;
}

/** `count` commits on top of `parent`, reachable from no ref: returns the tip. */
function danglingCommits(roots: PruneRepo, parent: string, count: number, label: string): string {
  let tip = parent;
  for (let i = 1; i <= count; i++) {
    tip = git(
      ["commit-tree", `${tip}^{tree}`, "-p", tip, "-m", `${label} ${i}`],
      roots.repo,
    ).trim();
  }
  return tip;
}

/** Point `refs/remotes/<remoteRef>` at the tip of `branch` (no remote is contacted). */
export function addRemoteTrackingRef(roots: PruneRepo, remoteRef: string, branch: string): void {
  git(["update-ref", `refs/remotes/${remoteRef}`, `refs/heads/${branch}`], roots.repo);
}

/** A records branch with one commit of its own. Returns its tip. */
export function addRecordsBranch(roots: PruneRepo): string {
  const tip = danglingCommits(roots, headOf(roots, "main"), 1, "records");
  git(["update-ref", `refs/heads/${RECORDS_BRANCH}`, tip], roots.repo);
  return tip;
}

/** A plain local branch at `main`'s tip (e.g. a neighbouring run's branch). */
export function addBranch(roots: PruneRepo, branch: string): void {
  git(["branch", branch, "main"], roots.repo);
}

export interface SeedArchivedRun {
  readonly shortName: string;
  readonly phasesCount?: number;
  /** Namespace of the entry and archive folder; defaults to the fixture's. */
  readonly namespace?: string;
  /** Commits only `<branch>--phase-NN` holds, on top of `main`. */
  readonly unpreserved?: { readonly phase: number; readonly commits: number };
  /** Bytes of the made-up file under the archive's runs/ folder. */
  readonly payloadBytes?: number;
  /**
   * Add a real linked worktree for phase 01 under
   * `<stateRoot>/worktrees/<ns>.<name>/phase-01`, then move it into the
   * archive folder, leaving git's admin record stale.
   */
  readonly withWorktree?: boolean;
  /** Create the local branches (default true). */
  readonly branches?: boolean;
}

export interface SeededRun {
  readonly entry: RegistryEntry;
  readonly archivePath: string;
  readonly branches: readonly string[];
}

function phaseBranch(branch: string, phase: number): string {
  return `${branch}--phase-${String(phase).padStart(2, "0")}`;
}

/**
 * An archived run as `phax archive` leaves it: local branches, an archived
 * registry entry with its `archivePath`, and an archive folder
 * `<stateRoot>/archive/<ns>.<name>/{runs,worktrees}`.
 */
export function seedArchivedRun(roots: PruneRepo, seed: SeedArchivedRun): SeededRun {
  const namespace = seed.namespace ?? roots.namespace;
  const phasesCount = seed.phasesCount ?? 3;
  const key = runKey(namespace, seed.shortName);
  const archivePath = join(roots.stateRoot, "archive", key);
  const entry = makeEntry(namespace, seed.shortName, { phasesCount, archivePath });
  const branches = [
    entry.branch,
    ...Array.from({ length: phasesCount }, (_, i) => phaseBranch(entry.branch, i + 1)),
  ];

  if (seed.branches !== false) {
    const main = headOf(roots, "main");
    for (const [i, branch] of branches.entries()) {
      const tip =
        seed.unpreserved !== undefined && i === seed.unpreserved.phase
          ? danglingCommits(roots, main, seed.unpreserved.commits, `${seed.shortName} work`)
          : main;
      git(["update-ref", `refs/heads/${branch}`, tip], roots.repo);
    }
  }

  mkdirSync(join(archivePath, "runs"), { recursive: true });
  mkdirSync(join(archivePath, "worktrees"), { recursive: true });
  writeFileSync(
    join(archivePath, "runs", "run-status.json"),
    "x".repeat(seed.payloadBytes ?? 4096),
  );

  if (seed.withWorktree === true) {
    const live = join(roots.stateRoot, "worktrees", key, "phase-01");
    mkdirSync(dirname(live), { recursive: true });
    git(["worktree", "add", "-q", live, phaseBranch(entry.branch, 1)], roots.repo);
    renameSync(live, join(archivePath, "worktrees", "phase-01"));
  }

  addRegistryEntry(roots, entry);
  return { entry, archivePath, branches };
}

/** The apparent size of a folder: the lstat sizes of its regular files, symlinks not followed. */
export function apparentSize(path: string): number {
  if (!existsSync(path)) return 0;
  const stat = lstatSync(path);
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  return readdirSync(path).reduce((sum, name) => sum + apparentSize(join(path, name)), 0);
}

// ── Output ───────────────────────────────────────────────────────────────────

export interface RecordingOutput {
  readonly port: OutputPort;
  readonly logs: string[];
  readonly errors: string[];
  /** Every log, warn, error and prompt, in order (`log: …`, `error: …`, `prompt: …`). */
  readonly events: string[];
}

export function recordingOutput(events: string[] = []): RecordingOutput {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    port: {
      log: (m) => {
        logs.push(m);
        events.push(`log: ${m}`);
      },
      warn: (m) => {
        errors.push(m);
        events.push(`warn: ${m}`);
      },
      error: (m) => {
        errors.push(m);
        events.push(`error: ${m}`);
      },
    },
    logs,
    errors,
    events,
  };
}
