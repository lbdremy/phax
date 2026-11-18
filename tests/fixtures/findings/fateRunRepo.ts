import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Result } from "effect";
import { loadConfig } from "../../../src/app/loadConfig.js";
import { resolveRun } from "../../../src/app/resolveRunInfo.js";
import type { ShortName } from "../../../src/domain/branded.js";
import { findingGroup } from "../../../src/cli/definitions/finding.js";
import { decodeFindingListFile } from "../../../src/schemas/findingList.js";
import { runnerCall } from "../../helpers/runnerCall.js";
import { buildFindingRunRepo, type FindingRunRepo } from "./findingRunRepo.js";

// The project of the acceptance tests of `phax finding fix`, `dismiss` and `defer`: the run of
// findingRunRepo.ts plus tracked files in its final worktree, and helpers to change, stage and
// inspect them. Nothing outside the fixture's temporary directories is read or written. A test
// file that builds it hoists the `node:os` mock of tests/helpers/isolatePhaxHome.ts, and sets the
// process working directory to `repoDir`, which is outside the worktree.

export interface FateRunRepo extends FindingRunRepo {
  /** The run's final worktree. */
  readonly worktreePath: string;
  /** The branch checked out in the worktree. */
  readonly runBranch: string;
}

function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: "pipe" });
}

function writeTracked(root: string, path: string, content: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/**
 * Builds the run of `buildFindingRunRepo()`, then commits on the run branch, in the worktree,
 * `tests/gate.test.ts`, `src/app/gate.ts`, `docs/gates.md` and a `README.md`, and on main, in the
 * main checkout, `docs/briefs/gate-retry-docs.md`.
 */
export function buildFateRunRepo(): FateRunRepo {
  const repo = buildFindingRunRepo();
  try {
    const config = loadConfig(repo.repoDir);
    if (Result.isFailure(config)) throw new Error(config.failure.message);
    const resolved = resolveRun(
      config.success.namespace,
      repo.shortName as ShortName,
      repo.stateRoot,
    );
    if (Result.isFailure(resolved)) throw new Error(resolved.failure);
    const worktreePath = resolved.success.worktreePath;
    const runBranch = resolved.success.finalPhaseBranch as string;

    writeTracked(worktreePath, "tests/gate.test.ts", "export const gateTest = 1;\n");
    writeTracked(worktreePath, "src/app/gate.ts", "export const gate = 1;\n");
    writeTracked(worktreePath, "docs/gates.md", "# Gates\n");
    writeTracked(worktreePath, "README.md", "# findings\n\nInitial notes.\n");
    git(["add", "-A"], worktreePath);
    git(["commit", "-q", "-m", "feat: gate files"], worktreePath);

    writeTracked(repo.repoDir, "docs/briefs/gate-retry-docs.md", "# Gate retry\n");
    git(["add", "docs/briefs/gate-retry-docs.md"], repo.repoDir);
    git(["commit", "-q", "-m", "docs: gate retry brief"], repo.repoDir);

    return { ...repo, worktreePath, runBranch };
  } catch (error) {
    repo.cleanup();
    throw error;
  }
}

/** Writes (or overwrites) a file of the worktree, leaving it unstaged. */
export function writeInWorktree(repo: FateRunRepo, path: string, content: string): void {
  writeTracked(repo.worktreePath, path, content);
}

/** Stages a path of the worktree. */
export function stageInWorktree(repo: FateRunRepo, path: string): void {
  git(["add", "--", path], repo.worktreePath);
}

/** Rewrites the state in the run's run-status.json. */
export function setRunState(repo: FateRunRepo, state: string): void {
  const file = join(repo.runFolder, "run-status.json");
  const status = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  writeFileSync(file, JSON.stringify({ ...status, state }));
}

/** Rewrites phax.json without its `records` key. */
export function turnRecordsOff(repo: FateRunRepo): void {
  const file = join(repo.repoDir, "phax.json");
  const config = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  delete config["records"];
  writeFileSync(file, JSON.stringify(config, null, 2));
}

/** Makes the next commit on the records branch fail: git cannot take the branch's lock. */
export function lockRecordsBranch(repo: FateRunRepo): void {
  const lock = join(repo.repoDir, ".git", "refs", "heads", "phax", "records", "v1.lock");
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, "");
}

/** A ref's sha in the main checkout, or null when it does not resolve. */
export function head(repo: FateRunRepo, ref: string): string | null {
  try {
    return git(["rev-parse", "--verify", "--quiet", ref], repo.repoDir).trim();
  } catch {
    return null;
  }
}

/** A commit's full message. */
export function commitMessage(repo: FateRunRepo, sha: string): string {
  return git(["show", "-s", "--format=%B", sha], repo.repoDir).trimEnd();
}

/** The paths a commit changes against its first parent. */
export function commitPaths(repo: FateRunRepo, sha: string): readonly string[] {
  return git(["show", "--name-only", "--format=", sha], repo.repoDir)
    .split("\n")
    .filter((line) => line !== "");
}

/** The porcelain v1 lines of the worktree's status. */
export function worktreeStatus(repo: FateRunRepo): readonly string[] {
  return git(["status", "--porcelain=v1"], repo.worktreePath)
    .split("\n")
    .filter((line) => line !== "");
}

/** `finding list <run> --json` through the runner, decoded as a finding-list document. */
export async function findingListJson(repo: FateRunRepo) {
  const result = await runnerCall([findingGroup], ["finding", "list", repo.shortName, "--json"]);
  if (result.code !== 0) throw new Error(`finding list exited ${result.code}: ${result.err}`);
  const decoded = decodeFindingListFile(JSON.parse(result.out) as unknown);
  if (Result.isFailure(decoded)) throw new Error("finding list answered an undecodable document");
  return { result, document: decoded.success };
}
