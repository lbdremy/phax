import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { commitRecordTree } from "../../../src/app/recordPlumbing.js";
import { RECORDS_BRANCH_NAME, writeRecord } from "../../../src/app/writeRecord.js";
import { NodeFileSystemLayer } from "../../../src/infra/fs.js";
import { NodeGitLayer } from "../../../src/infra/git.js";
import { makeFakeGitHub } from "../../../src/infra/fakes/github.js";
import type { ResolvedRecordsConfig } from "../../../src/schemas/recordsConfig.js";
import { disableGitAutoMaintenance, removeTempDir } from "../../helpers/tempGit.js";

// Real git repositories in every branch state of the records branch, for the acceptance tests of
// `phax records sync`. The caller isolates git first (tests/helpers/isolateGit.ts): every repository
// here carries its own identity, and every record is committed at a fixed, increasing date, so each
// run builds the same trees and messages.
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

/**
 * Builds the world, in a temporary directory: a bare remote holding `remoteRecords` records on
 * `phax/records/v1`, pushed by a clone of its own; a source repository with phax.json committed;
 * and the paths and configurations of a dedicated clone and of an in-repo destination. No clone
 * exists yet and the source repository has fetched nothing: the helpers below put one of them in
 * a branch state.
 */
export async function buildBranchTipWorld(options: BranchTipOptions = {}): Promise<BranchTipWorld> {
  const remoteRecords = options.remoteRecords ?? 4;
  const base = realpathSync(mkdtempSync(join(tmpdir(), "phax-branch-tip-")));
  const namespace = "branch-tip";
  const remoteDir = join(base, "remote.git");
  const remoteUrl = `ssh://records.test${remoteDir}`;
  const stateRoot = join(base, "state");
  const clonePath = join(stateRoot, "records", namespace);
  const sourceRepo = join(base, "source");
  const upstream = join(base, "upstream");
  const artifactFolder = join(base, "artifacts");
  const phaseFolder = join(base, "phase-folder");

  const sshScript = join(base, "fake-ssh.sh");
  writeFileSync(sshScript, FAKE_SSH, { mode: 0o755 });
  const savedSsh = process.env["GIT_SSH_COMMAND"];
  process.env["GIT_SSH_COMMAND"] = sshScript;
  // A clone `phax records sync` makes has no identity of its own, and git is isolated from the
  // person's config: on a machine whose hostname git cannot turn into an email (CI), a record
  // commit there would fail with "Author identity unknown".
  const savedIdentity = IDENTITY_VARIABLES.map((name) => [name, process.env[name]] as const);
  process.env["GIT_AUTHOR_NAME"] = process.env["GIT_COMMITTER_NAME"] = "Rita Recorder";
  process.env["GIT_AUTHOR_EMAIL"] = process.env["GIT_COMMITTER_EMAIL"] = "rita@records.test";

  git(["init", "-q", "--bare", "-b", "main", remoteDir], tmpdir());
  disableGitAutoMaintenance(remoteDir);
  mkdirSync(stateRoot);
  mkdirSync(artifactFolder);
  writeFileSync(join(artifactFolder, "note.md"), "A record's artifact.\n");
  mkdirSync(phaseFolder);
  writeFileSync(join(phaseFolder, "prompt.md"), "# prompt\n");

  initRepo(upstream, { name: "origin", url: remoteUrl });
  initRepo(sourceRepo, { name: PUBLISH_REMOTE, url: remoteUrl });
  writeFileSync(
    join(sourceRepo, "phax.json"),
    JSON.stringify(
      {
        version: 1,
        name: namespace,
        state: { root: stateRoot },
        gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
        publish: { auto: false, remote: PUBLISH_REMOTE },
        records: {
          transcript: false,
          destination: { kind: "repo", remote: remoteUrl },
          autoPush: false,
        },
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(join(sourceRepo, "widget.txt"), "widget\n");
  git(["add", "."], sourceRepo);
  git(["commit", "-q", "-m", "chore: initial commit"], sourceRepo);

  // Every record commit gets the next second of 2026-01-01, for author and committer alike.
  let second = 0;
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
            artifactPaths: ["note.md"],
            manifest: { kind: "seed", key, origin },
            message: [
              "records(phase-01): committed",
              "",
              `Run-Id: ${key.split("/")[0]}`,
              "Phase-Id: phase-01",
              `Origin: ${origin}`,
            ].join("\n"),
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
  const remoteKeys: string[] = [];
  async function pushRemoteRecords(count: number): Promise<string> {
    for (let i = 0; i < count; i += 1) {
      const key = recordKey("seed", remoteKeys.length + 1);
      await commitOne(upstreamTarget, key, "upstream");
      remoteKeys.push(key);
    }
    git(["push", "-q", "origin", RECORDS_BRANCH_NAME], upstream);
    return git(["rev-parse", BRANCH_REF], remoteDir);
  }
  await pushRemoteRecords(remoteRecords);

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
    namespace,
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
      if (savedSsh === undefined) delete process.env["GIT_SSH_COMMAND"];
      else process.env["GIT_SSH_COMMAND"] = savedSsh;
      for (const [name, value] of savedIdentity) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
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
