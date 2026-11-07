import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Either, Layer } from "effect";
import { commitRecordTree } from "../../src/app/recordPlumbing.js";
import { describeRecordWriteBranch, readRecordsBranch } from "../../src/app/recordsBranch.js";
import { RECORDS_BRANCH_NAME, writeRecord } from "../../src/app/writeRecord.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { Git, type GitOps, type WriteTreeCommitInput } from "../../src/ports/git.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Real git, a bare remote and clones: where does a record's commit parent?
// Missing or behind the remote tip: on the remote tip. Anything else: on the
// local tip, with a diverged or unrelated branch reported, not refused.

const LAYER = Layer.mergeAll(NodeFileSystemLayer, NodeGitLayer, makeFakeGitHub().layer);
const BRANCH_REF = `refs/heads/${RECORDS_BRANCH_NAME}`;
const TRACKING_REF = `refs/remotes/origin/${RECORDS_BRANCH_NAME}`;

function sh(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

type Destination = "dedicated" | "in-repo";

describe("record write parent rule", () => {
  let restoreGit: () => void;
  let root: string;
  let remoteDir: string;
  let seedFolder: string;
  let phaseFolder: string;
  let counter = 0;

  beforeEach(() => {
    restoreGit = isolateGit();
    root = mkdtempSync(join(tmpdir(), "phax-write-parent-"));
    remoteDir = join(root, "remote.git");
    sh(["init", "--bare", remoteDir], root);
    disableGitAutoMaintenance(remoteDir);
    seedFolder = join(root, "seed-artifacts");
    mkdirSync(seedFolder);
    writeFileSync(join(seedFolder, "a.md"), "artifact\n");
    phaseFolder = join(root, "phase-folder");
    mkdirSync(phaseFolder);
    writeFileSync(join(phaseFolder, "prompt.md"), "# prompt\n");
  });

  afterEach(() => {
    removeTempDir(root);
    restoreGit();
  });

  /** A repository with `origin` pointing at the bare remote. */
  function makeRepo(name: string): string {
    const dir = join(root, name);
    sh(["init", dir], root);
    disableGitAutoMaintenance(dir);
    sh(["config", "--local", "user.name", "Rita Writer"], dir);
    sh(["config", "--local", "user.email", "rita@write.test"], dir);
    sh(["remote", "add", "origin", remoteDir], dir);
    return dir;
  }

  /** One seed record committed on `repo`'s records branch through the shared plumbing. */
  async function commitSeed(repo: string, key: string): Promise<string> {
    const { commitSha } = await Effect.runPromise(
      Effect.provide(
        commitRecordTree({
          repo,
          remote: "origin",
          folder: seedFolder,
          key,
          artifactPaths: ["a.md"],
          manifest: { kind: "seed" },
          message: `records(seed): ${key}`,
        }),
        LAYER,
      ),
    );
    return commitSha;
  }

  /** Another clone that writes `keys` to the remote's records branch, in order. */
  async function pushFromElsewhere(name: string, keys: readonly string[]): Promise<string> {
    const repo = makeRepo(name);
    let tip = "";
    for (const key of keys) tip = await commitSeed(repo, key);
    sh(["push", "origin", RECORDS_BRANCH_NAME], repo);
    return tip;
  }

  function fetchRecords(repo: string): void {
    sh(["fetch", "origin", `+${BRANCH_REF}:${TRACKING_REF}`], repo);
  }

  function destinationFor(kind: Destination): {
    records: ResolvedRecordsConfig;
    repoRoot: string;
    recordsClonePath: string | undefined;
    recordsRepo: string;
  } {
    const recordsRepo = makeRepo(`${kind}-records`);
    if (kind === "in-repo") {
      return {
        records: {
          enabled: true,
          transcript: false,
          destination: { kind: "in-repo" },
          autoPush: false,
        },
        repoRoot: recordsRepo,
        recordsClonePath: undefined,
        recordsRepo,
      };
    }
    return {
      records: {
        enabled: true,
        transcript: false,
        destination: { kind: "repo", remote: remoteDir },
        autoPush: false,
      },
      repoRoot: join(root, "source"),
      recordsClonePath: recordsRepo,
      recordsRepo,
    };
  }

  async function writePhaseRecord(destination: ReturnType<typeof destinationFor>) {
    counter += 1;
    const result = await Effect.runPromise(
      Effect.provide(
        writeRecord({
          repoRoot: destination.repoRoot,
          recordsClonePath: destination.recordsClonePath,
          phaseFolderPath: phaseFolder,
          runId: `run-${counter}`,
          phaseId: "phase-01",
          provider: "claude-code",
          model: "claude-opus-5-5",
          effort: "high",
          outcome: "committed",
          acceptance: null,
          mode: "headless",
          stop: null,
          usage: { kind: "none" },
          records: destination.records,
          publishRemote: "origin",
        }),
        LAYER,
      ),
    );
    if (result.kind !== "written") throw new Error(`expected written, got ${result.kind}`);
    return result;
  }

  const parentOf = (repo: string, sha: string): string => sh(["rev-parse", `${sha}^`], repo);
  const isAncestor = (repo: string, ancestor: string, of: string): boolean => {
    try {
      sh(["merge-base", "--is-ancestor", ancestor, of], repo);
      return true;
    } catch {
      return false;
    }
  };

  it.each<Destination>(["dedicated", "in-repo"])(
    "ac-missing-at-write: parents on the remote tip when only the remote-tracking ref exists (%s)",
    async (kind) => {
      const remoteTip = await pushFromElsewhere("seeder", ["seed/one"]);
      const destination = destinationFor(kind);
      fetchRecords(destination.recordsRepo);
      expect(sh(["branch", "--list", RECORDS_BRANCH_NAME], destination.recordsRepo)).toBe("");

      const result = await writePhaseRecord(destination);

      expect(result.branchState).toEqual({
        state: "no-local-branch",
        localTip: null,
        remoteTip,
      });
      expect(parentOf(destination.recordsRepo, result.commitSha)).toBe(remoteTip);
      expect(sh(["rev-parse", BRANCH_REF], destination.recordsRepo)).toBe(result.commitSha);
    },
  );

  it.each<Destination>(["dedicated", "in-repo"])(
    "ac-behind-at-write: parents on the remote tip and keeps the old local tip as an ancestor (%s)",
    async (kind) => {
      const firstTip = await pushFromElsewhere("seeder", ["seed/one"]);
      const destination = destinationFor(kind);
      fetchRecords(destination.recordsRepo);
      sh(["update-ref", BRANCH_REF, firstTip], destination.recordsRepo);
      // The remote moves on while the local branch stays at `firstTip`.
      const seeder = join(root, "seeder");
      const remoteTip = await commitSeed(seeder, "seed/two");
      sh(["push", "origin", RECORDS_BRANCH_NAME], seeder);
      fetchRecords(destination.recordsRepo);

      const result = await writePhaseRecord(destination);

      expect(result.branchState).toEqual({ state: "behind", localTip: firstTip, remoteTip });
      expect(parentOf(destination.recordsRepo, result.commitSha)).toBe(remoteTip);
      expect(isAncestor(destination.recordsRepo, firstTip, result.commitSha)).toBe(true);
    },
  );

  it.each<Destination>(["dedicated", "in-repo"])(
    "ac-diverged-write: keeps an unrelated branch on the local tip and reports the --replay remedy (%s)",
    async (kind) => {
      const remoteTip = await pushFromElsewhere("seeder", ["seed/remote"]);
      const destination = destinationFor(kind);
      const localTip = await commitSeed(destination.recordsRepo, "seed/local");
      fetchRecords(destination.recordsRepo);

      const result = await writePhaseRecord(destination);

      expect(result.branchState).toEqual({ state: "unrelated", localTip, remoteTip });
      expect(parentOf(destination.recordsRepo, result.commitSha)).toBe(localTip);
      expect(result.branchNote).toBe(
        `record kept on the local records branch, which is unrelated to origin's (local ${localTip.slice(0, 7)}, origin ${remoteTip.slice(0, 7)}); run \`phax records sync --replay\`, then push`,
      );
    },
  );

  it("keeps a diverged branch on the local tip too", async () => {
    const baseTip = await pushFromElsewhere("seeder", ["seed/base"]);
    const destination = destinationFor("in-repo");
    fetchRecords(destination.recordsRepo);
    sh(["update-ref", BRANCH_REF, baseTip], destination.recordsRepo);
    const localTip = await commitSeed(destination.recordsRepo, "seed/local");
    const seeder = join(root, "seeder");
    const remoteTip = await commitSeed(seeder, "seed/remote");
    sh(["push", "origin", RECORDS_BRANCH_NAME], seeder);
    fetchRecords(destination.recordsRepo);

    const result = await writePhaseRecord(destination);

    expect(result.branchState).toEqual({ state: "diverged", localTip, remoteTip });
    expect(parentOf(destination.recordsRepo, result.commitSha)).toBe(localTip);
    expect(result.branchNote).toContain("diverged from origin's");
    expect(result.branchNote).toContain("`phax records sync --replay`");
  });

  it("parents on the local tip when the branch is in sync, ahead, or has no remote branch", async () => {
    const destination = destinationFor("in-repo");
    const repo = destination.recordsRepo;

    // Nothing anywhere yet: the first record is an orphan, the second sits on it.
    const first = await writePhaseRecord(destination);
    expect(first.branchState).toEqual({ state: "in-sync", localTip: null, remoteTip: null });
    const second = await writePhaseRecord(destination);
    expect(second.branchState.state).toBe("no-remote-branch");
    expect(parentOf(repo, second.commitSha)).toBe(first.commitSha);

    // In sync: the remote-tracking ref equals the local tip.
    sh(["push", "origin", RECORDS_BRANCH_NAME], repo);
    const inSync = await writePhaseRecord(destination);
    expect(inSync.branchState.state).toBe("in-sync");
    expect(parentOf(repo, inSync.commitSha)).toBe(second.commitSha);

    // Ahead: the local tip is past the remote-tracking ref.
    const ahead = await writePhaseRecord(destination);
    expect(ahead.branchState.state).toBe("ahead");
    expect(parentOf(repo, ahead.commitSha)).toBe(inSync.commitSha);
    expect(
      describeRecordWriteBranch(ahead.branchState, { localPath: repo, remote: "origin" }),
    ).toBe(null);
  });

  it("reads the same reading the writer reports", async () => {
    const remoteTip = await pushFromElsewhere("seeder", ["seed/one"]);
    const destination = destinationFor("in-repo");
    fetchRecords(destination.recordsRepo);

    const reading = await Effect.runPromise(
      Effect.provide(readRecordsBranch(destination.recordsRepo, "origin"), NodeGitLayer),
    );

    expect(reading).toEqual({ state: "no-local-branch", localTip: null, remoteTip });
  });
});

describe("record write compare-and-swap retry", () => {
  const FOLDER = "/artifacts";

  /**
   * FakeGit whose branch is moved by a concurrent writer just before each of
   * the first `moves` compare-and-swaps, so those swaps find a stale tip.
   */
  function racingGit(moves: number) {
    const fake = makeFakeGit();
    const fs = makeFakeFileSystem();
    fs.impl.setFile(`${FOLDER}/a.md`, "artifact\n");
    let attempts = 0;
    let remaining = moves;
    const concurrent: string[] = [];
    const git = new Proxy(fake.impl, {
      get(target, prop) {
        if (prop === "writeTreeCommit") {
          return (input: WriteTreeCommitInput) => {
            attempts += 1;
            if (remaining > 0) {
              remaining -= 1;
              const rival = target.addFakeCommit({
                parent: target.fakeRefs.get(BRANCH_REF) ?? null,
                paths: [`rival/${attempts}/record.json`],
              });
              target.setBranchRef(RECORDS_BRANCH_NAME, rival);
              concurrent.push(rival);
            }
            return target.writeTreeCommit(input);
          };
        }
        const value: unknown = Reflect.get(target, prop);
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    }) as GitOps;
    const layer = Layer.mergeAll(fs.layer, Layer.succeed(Git, git));
    return { fake, layer, concurrent, attempts: () => attempts };
  }

  const commit = {
    repo: "/repo",
    remote: "origin",
    folder: FOLDER,
    key: "run-1/phase-01",
    artifactPaths: ["a.md"],
    manifest: { kind: "phase" },
    message: "records(phase-01): committed",
  } as const;

  it("rewrites the record on the new tip when the branch moved between the read and the swap", async () => {
    const world = racingGit(1);
    const base = world.fake.impl.addFakeCommit({ parent: null, paths: ["base/record.json"] });
    world.fake.impl.setBranchRef(RECORDS_BRANCH_NAME, base);

    const result = await Effect.runPromise(Effect.provide(commitRecordTree(commit), world.layer));

    expect(world.attempts()).toBe(2);
    expect(world.concurrent).toHaveLength(1);
    expect(world.fake.impl.fakeRefs.get(BRANCH_REF)).toBe(result.commitSha);
    // The rival's record and the original tip are both reachable from the new tip.
    const parent = world.fake.impl.fakeCommits.get(result.commitSha)?.parent;
    expect(parent).toBe(world.concurrent[0]);
    expect(world.fake.impl.fakeCommits.get(world.concurrent[0]!)?.parent).toBe(base);
    expect(result.branchState.localTip).toBe(world.concurrent[0]);
  });

  it("fails with the stale-tip error after three attempts", async () => {
    const world = racingGit(3);

    const outcome = await Effect.runPromise(
      Effect.either(Effect.provide(commitRecordTree(commit), world.layer)),
    );

    expect(world.attempts()).toBe(3);
    expect(Either.isLeft(outcome)).toBe(true);
    if (Either.isLeft(outcome)) expect(outcome.left).toMatchObject({ _tag: "GitError" });
    if (Either.isLeft(outcome)) expect(outcome.left).toHaveProperty("command");
    if (Either.isLeft(outcome) && "command" in outcome.left) {
      expect(outcome.left.command).toContain("update-ref");
      expect(outcome.left.message).toMatch(
        /^the records branch kept moving under other writers in .+; record not written after 3 attempts$/,
      );
    }
  });

  it("does not retry an error that is not a stale tip", async () => {
    const world = racingGit(0);
    world.fake.impl.failNextWriteTreeCommit("fatal: unable to write the object\n");

    const outcome = await Effect.runPromise(
      Effect.either(Effect.provide(commitRecordTree(commit), world.layer)),
    );

    expect(world.attempts()).toBe(1);
    expect(Either.isLeft(outcome)).toBe(true);
  });
});
