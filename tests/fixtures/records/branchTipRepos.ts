import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { commitRecordTree } from "../../../src/app/recordPlumbing.js";
import { RECORDS_BRANCH_NAME, writeRecord } from "../../../src/app/writeRecord.js";
import { NodeFileSystemLayer } from "../../../src/infra/fs.js";
import { NodeGitLayer } from "../../../src/infra/git.js";
import { makeFakeGitHub } from "../../../src/infra/fakes/github.js";
import type { ResolvedRecordsConfig } from "../../../src/schemas/recordsConfig.js";
import { isolateGit } from "../../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../../helpers/tempGit.js";
import { assertNoBuildPath, cachedWorld, copyWorld } from "../worlds/worldCache.js";
import {
  SEED_ARTIFACT_NAME,
  SEED_ARTIFACT_TEXT,
  seedRecordManifest,
  seedRecordMessage,
  writeRecordsInBulk,
} from "./bulkRecords.js";

// Real git repositories in every branch state of the records branch, for the acceptance tests of
// `phax records sync`. Every repository here carries its own identity, every commit has a fixed
// date (records one second apart from 2026-01-01T00:00:01Z), and the build runs under
// `isolateGit()`, so each run builds the same trees, messages and commits.
//
// A world has two parts. The path-free part (the bare remote with its seed records, written by one
// `git fast-import`, and the plain files) is built once per test file through the world cache
// (tests/fixtures/worlds/worldCache.ts) and copied for every test. The path-bound part (the fake
// ssh script, the upstream clone and the source repository, whose configurations name the world's
// own path) is built at the test's own path, after the copy.
//
// The records remote is a bare repository reached through an `ssh://` URL, the only kind a
// dedicated destination accepts besides https and scp-like ones. `GIT_SSH_COMMAND` points at a
// script that runs the remote command locally, so the URL works for this process and for a
// spawned `phax`, with no ssh server and nothing rewritten (a URL rewrite would also change what
// `git remote get-url` answers, which sync compares with the configured remote).

export const BRANCH_REF = `refs/heads/${RECORDS_BRANCH_NAME}`;

/** The remote name a source repository publishes to; the in-repo destination's remote. */
export const PUBLISH_REMOTE = "mirror";

const LAYER = Layer.mergeAll(NodeFileSystemLayer, NodeGitLayer, makeFakeGitHub().layer);

const FAKE_SSH = [
  "#!/bin/sh",
  "# Stands in for ssh: drops the options and the host, then runs the remote command here.",
  "while [ $# -gt 0 ]; do",
  '  case "$1" in',
  "    -G) exit 0 ;;",
  "    -o|-p|-i|-l|-F) shift 2 ;;",
  "    -*) shift ;;",
  "    *) break ;;",
  "  esac",
  "done",
  "shift",
  'exec sh -c "$1"',
  "",
].join("\n");

export function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/** Whether `ancestor` is `of` or one of its ancestors. */
export function isAncestor(repo: string, ancestor: string, of: string): boolean {
  try {
    git(["merge-base", "--is-ancestor", ancestor, of], repo);
    return true;
  } catch {
    return false;
  }
}

export type Destination = "dedicated" | "in-repo";

const IDENTITY_VARIABLES = [
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
] as const;

/** A repository holding the records branch, and the remote it is measured against. */
interface RecordsRepo {
  readonly repo: string;
  readonly remote: string;
}

/** A records repository put in one branch state, with what the tests compare against. */
export interface PreparedBranch extends RecordsRepo {
  /** The local records branch's tip; null when the branch does not exist. */
  readonly localTip: string | null;
  /** The remote-tracking tip as last fetched. */
  readonly remoteTip: string | null;
  /** The local-only commits, oldest first. */
  readonly localOnlyCommits: readonly string[];
}

export interface BranchTipWorld {
  readonly base: string;
  readonly namespace: string;
  /** The bare records remote. */
  readonly remoteDir: string;
  /** The `ssh://` URL of the bare remote, as phax.json and a dedicated clone's origin hold it. */
  readonly remoteUrl: string;
  readonly stateRoot: string;
  /** Where the dedicated clone lives: `<stateRoot>/records/<namespace>`. */
  readonly clonePath: string;
  /** The source repository: phax.json is committed here and `mirror` points at the remote. */
  readonly sourceRepo: string;
  /** The keys of the records the remote holds after the build, oldest first. */
  readonly remoteKeys: readonly string[];
  readonly dedicated: ResolvedRecordsConfig;
  readonly inRepo: ResolvedRecordsConfig;
  /** The remote's records branch tip. */
  remoteTip(): string;
  /** Another clone pushes `count` more records to the remote; answers the new remote tip. */
  pushRemoteRecords(count: number): Promise<string>;
  /** One commit per key on `repo`'s records branch, through the real plumbing; oldest first. */
  writeRecords(
    target: RecordsRepo,
    keys: readonly string[],
    origin: string,
  ): Promise<readonly string[]>;
  /** `count` phase records through the real `writeRecord`; answers their commits, oldest first. */
  writePhaseRecords(destination: Destination, count: number): Promise<readonly string[]>;
  cleanup(): void;
}

export interface BranchTipOptions {
  /** How many records the remote holds after the build. */
  readonly remoteRecords?: number;
}

function recordKey(tag: string, index: number): string {
  return `run-${tag}-${String(index).padStart(4, "0")}/phase-01`;
}

function initRepo(dir: string, remote: { name: string; url: string } | null): void {
  git(["init", "-q", "-b", "main", dir], tmpdir());
  disableGitAutoMaintenance(dir);
  git(["config", "--local", "user.name", "Rita Recorder"], dir);
  git(["config", "--local", "user.email", "rita@records.test"], dir);
  if (remote !== null) git(["remote", "add", remote.name, remote.url], dir);
}

const NAMESPACE = "branch-tip";
const SEED_IDENTITY = { name: "Rita Recorder", email: "rita@records.test" } as const;
/** The origin every seed record names: the other clone that pushed it. */
const SEED_ORIGIN = "upstream";
/** The source repository's initial commit date; record i is committed i seconds later. */
const SOURCE_COMMIT_DATE = "2026-01-01T00:00:00Z";
/** The variables a world sets in the test's process until its `cleanup()`. */
const WORLD_VARIABLES = ["GIT_SSH_COMMAND", ...IDENTITY_VARIABLES] as const;

function recordDate(second: number): Date {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, second));
}

function seedKeys(count: number): string[] {
  return Array.from({ length: count }, (_, index) => recordKey("seed", index + 1));
}

/** The world's paths at `base`: where its repositories, files and configurations sit. */
function worldPaths(base: string) {
  const remoteDir = join(base, "remote.git");
  const stateRoot = join(base, "state");
  return {
    remoteDir,
    remoteUrl: `ssh://records.test${remoteDir}`,
    stateRoot,
    clonePath: join(stateRoot, "records", NAMESPACE),
    sourceRepo: join(base, "source"),
    upstream: join(base, "upstream"),
    artifactFolder: join(base, "artifacts"),
    phaseFolder: join(base, "phase-folder"),
    sshScript: join(base, "fake-ssh.sh"),
  };
}

/**
 * The path-free part, built into `dir` (which must not exist): the bare remote with
 * `remoteRecords` seed records on its records branch, written by one `git fast-import`, and the
 * plain files. Nothing written here holds `dir`'s path, so a copy of it is a world at the copy's
 * path once the path-bound part is built there.
 */
async function buildPathFreePart(dir: string, remoteRecords: number): Promise<void> {
  const paths = worldPaths(dir);
  mkdirSync(dir);
  git(["init", "-q", "--bare", "-b", "main", paths.remoteDir], tmpdir());
  disableGitAutoMaintenance(paths.remoteDir);
  await writeRecordsInBulk({
    repo: paths.remoteDir,
    parent: null,
    identity: SEED_IDENTITY,
    records: seedKeys(remoteRecords).map((key, index) => ({
      key,
      origin: SEED_ORIGIN,
      date: recordDate(index + 1),
    })),
  });
  mkdirSync(paths.artifactFolder);
  writeFileSync(join(paths.artifactFolder, SEED_ARTIFACT_NAME), SEED_ARTIFACT_TEXT);
  mkdirSync(paths.phaseFolder);
  writeFileSync(join(paths.phaseFolder, "prompt.md"), "# prompt\n");
  mkdirSync(paths.stateRoot);
}

/**
 * The path-bound part, built at `base` next to the path-free part: the fake ssh script (and
 * `GIT_SSH_COMMAND` pointing at it), the upstream clone holding the remote's records branch and
 * its tracking ref, as a push leaves them, and the source repository with phax.json committed at
 * a fixed date. Its git processes do not depend on the number of records.
 */
function buildPathBoundPart(base: string): void {
  const paths = worldPaths(base);
  writeFileSync(paths.sshScript, FAKE_SSH, { mode: 0o755 });
  process.env["GIT_SSH_COMMAND"] = paths.sshScript;

  initRepo(paths.upstream, { name: "origin", url: paths.remoteUrl });
  git(["fetch", "-q", "origin"], paths.upstream);
  git(["update-ref", BRANCH_REF, `refs/remotes/origin/${RECORDS_BRANCH_NAME}`], paths.upstream);

  initRepo(paths.sourceRepo, { name: PUBLISH_REMOTE, url: paths.remoteUrl });
  writeFileSync(
    join(paths.sourceRepo, "phax.json"),
    JSON.stringify(
      {
        version: 1,
        name: NAMESPACE,
        state: { root: paths.stateRoot },
        gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
        publish: { auto: false, remote: PUBLISH_REMOTE },
        records: {
          transcript: false,
          destination: { kind: "repo", remote: paths.remoteUrl },
          autoPush: false,
        },
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(join(paths.sourceRepo, "widget.txt"), "widget\n");
  git(["add", "."], paths.sourceRepo);
  // The identity is the repository's own; it is also named here so that an identity a test set
  // in its environment (under its own isolation) cannot reach the commit.
  execFileSync("git", ["commit", "-q", "-m", "chore: initial commit"], {
    cwd: paths.sourceRepo,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: SEED_IDENTITY.name,
      GIT_AUTHOR_EMAIL: SEED_IDENTITY.email,
      GIT_COMMITTER_NAME: SEED_IDENTITY.name,
      GIT_COMMITTER_EMAIL: SEED_IDENTITY.email,
      GIT_AUTHOR_DATE: SOURCE_COMMIT_DATE,
      GIT_COMMITTER_DATE: SOURCE_COMMIT_DATE,
    },
  });
}

function normalise(options: BranchTipOptions): { readonly remoteRecords: number } {
  return { remoteRecords: options.remoteRecords ?? 4 };
}

/** The cached world for `remoteRecords` in this test file, built at the first request. */
function cachedBranchTipWorld(remoteRecords: number): Promise<string> {
  return cachedWorld(`branch-tip-${remoteRecords}`, (dir) => buildPathFreePart(dir, remoteRecords));
}

/**
 * The build path of the cached world for these parameters in this test file, building it if it
 * is absent. For the fixture's own tests.
 */
export function branchTipBuildPath(options: BranchTipOptions = {}): Promise<string> {
  return cachedBranchTipWorld(normalise(options).remoteRecords);
}

type SavedVariables = readonly (readonly [string, string | undefined])[];

function restoreVariables(saved: SavedVariables): void {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

/**
 * Builds the world, in a temporary directory: a bare remote holding `remoteRecords` records on
 * `phax/records/v1`, which a clone of its own (`upstream`) holds too; a source repository with
 * phax.json committed; and the paths and configurations of a dedicated clone and of an in-repo
 * destination. No clone exists yet and the source repository has fetched nothing: the helpers
 * below put one of them in a branch state. The path-free part is a copy of this test file's
 * cached world.
 */
export async function buildBranchTipWorld(options: BranchTipOptions = {}): Promise<BranchTipWorld> {
  // mkdtemp reserves a unique name; the copy needs a path that does not exist yet.
  const base = realpathSync(mkdtempSync(join(tmpdir(), "phax-branch-tip-")));
  rmdirSync(base);
  return buildBranchTipWorldAt(base, { ...options, fresh: false });
}

/**
 * Builds the world at `base`, which must not exist. `fresh: true` bypasses the cache and builds
 * both parts at `base`; `fresh: false` copies this test file's cached world for these parameters
 * to `base`, builds the path-bound part there, and refuses a copy that still holds the cached
 * world's build path. The world's environment is set in this process until its `cleanup()`.
 */
export async function buildBranchTipWorldAt(
  base: string,
  options: BranchTipOptions & { readonly fresh: boolean },
): Promise<BranchTipWorld> {
  if (existsSync(base))
    throw new Error(`a branch-tip world is built at a new path: ${base} exists`);
  const { remoteRecords } = normalise(options);
  const saved: SavedVariables = WORLD_VARIABLES.map((name) => [name, process.env[name]] as const);
  const release = isolateGit();
  try {
    let buildPath: string | null = null;
    if (options.fresh) {
      await buildPathFreePart(base, remoteRecords);
    } else {
      buildPath = await cachedBranchTipWorld(remoteRecords);
      copyWorld(buildPath, base);
    }
    buildPathBoundPart(base);
    if (buildPath !== null) assertNoBuildPath(base, buildPath);
  } catch (error) {
    release();
    restoreVariables(saved);
    removeTempDir(base);
    throw error;
  }
  release();
  // A clone `phax records sync` makes has no identity of its own, and git is isolated from the
  // person's config: on a machine whose hostname git cannot turn into an email (CI), a record
  // commit there would fail with "Author identity unknown".
  process.env["GIT_AUTHOR_NAME"] = process.env["GIT_COMMITTER_NAME"] = SEED_IDENTITY.name;
  process.env["GIT_AUTHOR_EMAIL"] = process.env["GIT_COMMITTER_EMAIL"] = SEED_IDENTITY.email;
  return worldAt(base, remoteRecords, saved);
}

/** The world's handle once both parts are built at `base`. */
function worldAt(
  base: string,
  remoteRecords: number,
  savedVariables: SavedVariables,
): BranchTipWorld {
  const paths = worldPaths(base);
  const { remoteDir, remoteUrl, stateRoot, clonePath, sourceRepo, upstream } = paths;
  const { artifactFolder, phaseFolder } = paths;

  // Every record commit gets the next second of 2026-01-01, for author and committer alike; the
  // seed records took the first `remoteRecords` seconds.
  let second = remoteRecords;
  async function commitOne(target: RecordsRepo, key: string, origin: string): Promise<string> {
    second += 1;
    const date = new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString();
    const saved = [process.env["GIT_AUTHOR_DATE"], process.env["GIT_COMMITTER_DATE"]] as const;
    process.env["GIT_AUTHOR_DATE"] = date;
    process.env["GIT_COMMITTER_DATE"] = date;
    try {
      const { commitSha } = await Effect.runPromise(
        Effect.provide(
          commitRecordTree({
            repo: target.repo,
            remote: target.remote,
            folder: artifactFolder,
            key,
            artifactPaths: [SEED_ARTIFACT_NAME],
            manifest: seedRecordManifest(key, origin),
            message: seedRecordMessage(key, origin),
          }),
          LAYER,
        ),
      );
      return commitSha;
    } finally {
      for (const [name, value] of [
        ["GIT_AUTHOR_DATE", saved[0]],
        ["GIT_COMMITTER_DATE", saved[1]],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }

  const upstreamTarget: RecordsRepo = { repo: upstream, remote: "origin" };
  const remoteKeys: string[] = seedKeys(remoteRecords);
  async function pushRemoteRecords(count: number): Promise<string> {
    for (let i = 0; i < count; i += 1) {
      const key = recordKey("seed", remoteKeys.length + 1);
      await commitOne(upstreamTarget, key, SEED_ORIGIN);
      remoteKeys.push(key);
    }
    git(["push", "-q", "origin", RECORDS_BRANCH_NAME], upstream);
    return git(["rev-parse", BRANCH_REF], remoteDir);
  }

  let phaseRuns = 0;
  async function writePhaseRecords(
    destination: Destination,
    count: number,
  ): Promise<readonly string[]> {
    const commits: string[] = [];
    for (let i = 0; i < count; i += 1) {
      phaseRuns += 1;
      const result = await Effect.runPromise(
        Effect.provide(
          writeRecord({
            repoRoot: sourceRepo,
            recordsClonePath: destination === "dedicated" ? clonePath : undefined,
            phaseFolderPath: phaseFolder,
            runId: `run-phase-${String(phaseRuns).padStart(4, "0")}`,
            phaseId: "phase-01",
            provider: "claude-code",
            model: "claude-opus-5-5",
            effort: "high",
            outcome: "committed",
            acceptance: null,
            mode: "headless",
            stop: null,
            usage: { kind: "none" },
            records: destination === "dedicated" ? dedicated : inRepo,
            publishRemote: PUBLISH_REMOTE,
          }),
          LAYER,
        ),
      );
      if (result.kind !== "written") throw new Error(`expected written, got ${result.kind}`);
      commits.push(result.commitSha);
    }
    return commits;
  }

  const dedicated: ResolvedRecordsConfig = {
    enabled: true,
    transcript: false,
    destination: { kind: "repo", remote: remoteUrl },
    autoPush: true,
  };
  const inRepo: ResolvedRecordsConfig = {
    enabled: true,
    transcript: false,
    destination: { kind: "in-repo" },
    autoPush: true,
  };

  return {
    base,
    namespace: NAMESPACE,
    remoteDir,
    remoteUrl,
    stateRoot,
    clonePath,
    sourceRepo,
    remoteKeys,
    dedicated,
    inRepo,
    remoteTip: () => git(["rev-parse", BRANCH_REF], remoteDir),
    pushRemoteRecords,
    writeRecords: async (target, keys, origin) => {
      const commits: string[] = [];
      for (const key of keys) commits.push(await commitOne(target, key, origin));
      return commits;
    },
    writePhaseRecords,
    cleanup: () => {
      restoreVariables(savedVariables);
      removeTempDir(base);
    },
  };
}

// ── Branch states ───────────────────────────────────────────────────────────────

function fetchTracking(target: RecordsRepo): void {
  git(["fetch", "-q", target.remote], target.repo);
}

function trackingTip(target: RecordsRepo): string | null {
  try {
    return git(["rev-parse", `refs/remotes/${target.remote}/${RECORDS_BRANCH_NAME}`], target.repo);
  } catch {
    return null;
  }
}

/**
 * A records repository that has fetched the remote and whose local records branch sits at the
 * fetched tip. A dedicated clone is cloned (`origin`); an in-repo destination is the source
 * repository, which fetches `mirror`.
 */
function prepareAtRemoteTip(world: BranchTipWorld, destination: Destination): PreparedBranch {
  let target: RecordsRepo;
  if (destination === "dedicated") {
    git(["clone", "-q", world.remoteUrl, world.clonePath], world.base);
    disableGitAutoMaintenance(world.clonePath);
    git(["config", "--local", "user.name", "Rita Recorder"], world.clonePath);
    git(["config", "--local", "user.email", "rita@records.test"], world.clonePath);
    target = { repo: world.clonePath, remote: "origin" };
  } else {
    target = { repo: world.sourceRepo, remote: PUBLISH_REMOTE };
    fetchTracking(target);
  }
  const tip = trackingTip(target);
  if (tip === null) throw new Error("the remote holds no records branch to start from");
  git(["update-ref", BRANCH_REF, tip], target.repo);
  return { ...target, localTip: tip, remoteTip: tip, localOnlyCommits: [] };
}

/**
 * The local branch is a strict ancestor of the remote's: another clone pushed `newRecords` more
 * records. The tracking ref has seen them when `fetched` is true (the default); otherwise it is
 * still at the old tip and only a fetch tells.
 */
export async function putBranchBehind(
  world: BranchTipWorld,
  options: {
    readonly destination?: Destination;
    readonly newRecords?: number;
    readonly fetched?: boolean;
  } = {},
): Promise<PreparedBranch> {
  const prepared = prepareAtRemoteTip(world, options.destination ?? "dedicated");
  await world.pushRemoteRecords(options.newRecords ?? 2);
  if (options.fetched ?? true) fetchTracking(prepared);
  return { ...prepared, remoteTip: trackingTip(prepared) };
}

/** The local branch holds `localOnly` records on top of the remote tip, which it has fetched. */
export async function putBranchAhead(
  world: BranchTipWorld,
  options: { readonly destination?: Destination; readonly localOnly?: number } = {},
): Promise<PreparedBranch> {
  const prepared = prepareAtRemoteTip(world, options.destination ?? "dedicated");
  const keys = localKeys(options.localOnly ?? 2);
  const commits = await world.writeRecords(prepared, keys, "local");
  return { ...prepared, localTip: commits.at(-1) ?? null, localOnlyCommits: commits };
}

/**
 * The branch has split: the clone holds `localOnly` records on top of the old remote tip, and
 * another clone pushed `remoteNew` records on top of the same tip. The clone has fetched.
 */
export async function putBranchDiverged(
  world: BranchTipWorld,
  options: { readonly localOnly?: number; readonly remoteNew?: number } = {},
): Promise<PreparedBranch> {
  const prepared = prepareAtRemoteTip(world, "dedicated");
  const commits = await world.writeRecords(prepared, localKeys(options.localOnly ?? 3), "local");
  await world.pushRemoteRecords(options.remoteNew ?? 1);
  fetchTracking(prepared);
  return {
    ...prepared,
    localTip: commits.at(-1) ?? null,
    remoteTip: trackingTip(prepared),
    localOnlyCommits: commits,
  };
}

/** The records of a branch with no common commit with the remote's: an orphan local branch. */
async function putOrphanBranch(
  world: BranchTipWorld,
  keys: readonly string[],
): Promise<PreparedBranch> {
  initRepo(world.clonePath, { name: "origin", url: world.remoteUrl });
  const target: RecordsRepo = { repo: world.clonePath, remote: "origin" };
  // Nothing fetched yet: each record is an orphan, the first of its own branch.
  const commits = await world.writeRecords(target, keys, "local");
  fetchTracking(target);
  return {
    ...target,
    localTip: commits.at(-1) ?? null,
    remoteTip: trackingTip(target),
    localOnlyCommits: commits,
  };
}

/** The local branch shares no commit with the remote's: `localOnly` orphan records. */
export function putBranchUnrelated(
  world: BranchTipWorld,
  options: { readonly localOnly?: number } = {},
): Promise<PreparedBranch> {
  return putOrphanBranch(world, localKeys(options.localOnly ?? 3));
}

/** A local-only record sharing its key with one the remote holds. */
export interface KeyCollision extends PreparedBranch {
  readonly key: string;
  /** The local-only commit holding the key. */
  readonly localCommit: string;
  /** The commit reachable from the remote tip holding the same key. */
  readonly remoteCommit: string;
}

/**
 * An unrelated branch of three local-only records, the second of which has the key of the
 * remote's second record, with other content.
 */
export async function putKeyCollision(world: BranchTipWorld): Promise<KeyCollision> {
  const key = world.remoteKeys[1];
  if (key === undefined) throw new Error("the remote needs at least two records");
  const keys = [localKeys(3)[0] ?? "", key, localKeys(3)[2] ?? ""];
  const prepared = await putOrphanBranch(world, keys);
  const localCommit = prepared.localOnlyCommits[1];
  if (localCommit === undefined || prepared.remoteTip === null) throw new Error("fixture broken");
  const remoteCommit = git(
    // Each commit's tree holds only its own record, so the next commit "deletes" the path: only
    // the commit that adds it holds the record.
    ["log", "--diff-filter=A", "--format=%H", prepared.remoteTip, "--", `${key}/record.json`],
    prepared.repo,
  );
  return { ...prepared, key, localCommit, remoteCommit };
}

function localKeys(count: number): string[] {
  return Array.from({ length: count }, (_, index) => recordKey("local", index + 1));
}

// ── Observing git ───────────────────────────────────────────────────────────────

/**
 * Run `run` with GIT_TRACE pointed at a file, and answer what it returned with every git command
 * the trace saw (built-in, spawned and exec'd), each as its words. The trace covers this process's
 * git and the processes git itself starts, but not the fixture builders: call them outside.
 */
export async function withGitTrace<T>(
  run: () => Promise<T>,
): Promise<{ readonly value: T; readonly commands: readonly (readonly string[])[] }> {
  const dir = mkdtempSync(join(tmpdir(), "phax-git-trace-"));
  const file = join(dir, "trace.log");
  writeFileSync(file, "");
  const saved = process.env["GIT_TRACE"];
  process.env["GIT_TRACE"] = file;
  try {
    const value = await run();
    return { value, commands: tracedCommands(readFileSync(file, "utf8")) };
  } finally {
    if (saved === undefined) delete process.env["GIT_TRACE"];
    else process.env["GIT_TRACE"] = saved;
    removeTempDir(dir);
  }
}

function tracedCommands(trace: string): (readonly string[])[] {
  const commands: string[][] = [];
  for (const line of trace.split("\n")) {
    const match = /trace: (?:built-in|run_command|exec): (.*)$/.exec(line);
    if (match?.[1] === undefined) continue;
    const words = [...match[1].matchAll(/'([^']*)'|(\S+)/g)].map(
      (word) => word[1] ?? word[2] ?? "",
    );
    commands.push(words);
  }
  return commands;
}

/** One move of the local records branch. */
export interface BranchUpdate {
  readonly old: string | null;
  readonly new: string;
  /** `create`: no previous tip. `fast-forward`: the old tip is an ancestor. `rewrite`: neither. */
  readonly kind: "create" | "fast-forward" | "rewrite";
}

/** The local records branch's reflog, newest first. */
export function branchReflog(repo: string): readonly string[] {
  try {
    const out = git(["reflog", "show", "--format=%H", BRANCH_REF], repo);
    return out === "" ? [] : out.split("\n");
  } catch {
    return [];
  }
}

/**
 * Every move of the local records branch since `before` (a `branchReflog` taken earlier), oldest
 * first, whichever command made it.
 */
export function branchUpdatesSince(repo: string, before: readonly string[]): BranchUpdate[] {
  const after = branchReflog(repo);
  const updates: BranchUpdate[] = [];
  for (let index = after.length - before.length - 1; index >= 0; index -= 1) {
    const next = after[index];
    if (next === undefined) continue;
    const old = after[index + 1] ?? null;
    const kind = old === null ? "create" : isAncestor(repo, old, next) ? "fast-forward" : "rewrite";
    updates.push({ old, new: next, kind });
  }
  return updates;
}
