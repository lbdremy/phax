import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { prune, type PruneInput } from "../../src/app/prune.js";
import { LockConflictError, PruneRefusedError } from "../../src/domain/errors.js";
import type { PrunePlan, PruneResult } from "../../src/domain/prune.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeLock } from "../../src/infra/fakes/lock.js";
import { FAKE_PROMPT_CANCEL, makeFakePrompt } from "../../src/infra/fakes/prompt.js";
import type { RegistryEntry } from "../../src/schemas/registry.js";

const stateRoot = "/state";
const repoRoot = "/repo";
const ns = "phax";
const registryPath = `${stateRoot}/registry.json`;

const entry = (shortName: string, overrides?: Partial<RegistryEntry>): RegistryEntry => ({
  namespace: ns,
  shortName,
  runId: `${shortName}-2026-10-01`,
  state: "archived",
  branch: `phax/${shortName}`,
  projectName: "phax",
  phasesCount: 2,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  archivePath: `${stateRoot}/archive/${ns}.${shortName}`,
  ...overrides,
});

const archiveOf = (shortName: string) => `${stateRoot}/archive/${ns}.${shortName}`;

function makeEnv(answers: Parameters<typeof makeFakePrompt>[0] = []) {
  const fs = makeFakeFileSystem();
  const git = makeFakeGit();
  const lock = makeFakeLock();
  const prompt = makeFakePrompt(answers);
  git.impl.addExistingBranch("main");
  git.impl.addWorktreeEntry({ path: repoRoot, branch: "main", prunable: false });
  const entries: RegistryEntry[] = [];

  const writeRegistry = () =>
    fs.impl.setFile(registryPath, JSON.stringify({ version: 1, runs: entries }));

  /** An archived run with its archive folder (100 + 20 bytes), its branches and a stale worktree. */
  const seedArchived = (shortName: string, overrides?: Partial<RegistryEntry>) => {
    const e = entry(shortName, overrides);
    entries.push(e);
    writeRegistry();
    fs.impl.setFile(`${archiveOf(shortName)}/runs/run-status.json`, "x".repeat(100));
    fs.impl.setFile(`${archiveOf(shortName)}/worktrees/phase-02/README.md`, "y".repeat(20));
    git.impl.addExistingBranch(e.branch);
    for (let i = 1; i <= e.phasesCount; i++) {
      git.impl.addExistingBranch(`${e.branch}--phase-0${i}`);
    }
    git.impl.addWorktreeEntry({
      path: `${stateRoot}/worktrees/${ns}.${shortName}/phase-02`,
      branch: `${e.branch}--phase-02`,
      prunable: true,
    });
    return e;
  };

  const seedEntry = (e: RegistryEntry) => {
    entries.push(e);
    writeRegistry();
  };

  const layer = Layer.mergeAll(fs.layer, git.layer, lock.layer, prompt.layer);
  const previews: PrunePlan[] = [];
  const asksAtPreview: number[] = [];

  const run = (input: Partial<PruneInput> & Pick<PruneInput, "selection">) =>
    Effect.runPromise(
      Effect.either(
        prune({
          namespace: ns,
          stateRoot,
          repoRoot,
          force: false,
          confirmation: "yes",
          onPreview: (plan) =>
            Effect.sync(() => {
              previews.push(plan);
              asksAtPreview.push(prompt.impl.asks.length);
            }),
          ...input,
        }).pipe(Effect.provide(layer)),
      ),
    );

  const registryRuns = () =>
    (JSON.parse(fs.impl.getFile(registryPath)!) as { runs: RegistryEntry[] }).runs;

  return {
    fs,
    git,
    lock,
    prompt,
    seedArchived,
    seedEntry,
    run,
    previews,
    asksAtPreview,
    registryRuns,
  };
}

const names = (...refs: string[]) => ({ kind: "names" as const, refs });

function applied(result: Either.Either<PruneResult, unknown>) {
  expect(Either.isRight(result)).toBe(true);
  const value = Either.getOrThrow(result);
  if (value.kind !== "applied") throw new Error(`expected applied, got ${value.kind}`);
  return value;
}

function deletionCalls(env: ReturnType<typeof makeEnv>) {
  return env.git.impl.calls.filter(
    (c) =>
      c.method === "deleteBranch" || c.method === "removeWorktree" || c.method === "pruneWorktrees",
  );
}

describe("prune: a full prune", () => {
  it("deletes the archive folder, the worktree metadata, every branch, and the entry last", async () => {
    const env = makeEnv();
    env.seedArchived("old-idea");
    env.seedArchived("keeper");

    const result = applied(await env.run({ selection: names("old-idea") }));

    expect(await Effect.runPromise(env.fs.impl.exists(archiveOf("old-idea")))).toBe(false);
    expect(await Effect.runPromise(env.fs.impl.exists(archiveOf("keeper")))).toBe(true);
    expect(env.git.impl.deletedBranches.map((d) => [d.name, d.force])).toEqual([
      ["phax/old-idea", true],
      ["phax/old-idea--phase-01", true],
      ["phax/old-idea--phase-02", true],
    ]);
    expect(env.git.impl.calls.some((c) => c.method === "pruneWorktrees")).toBe(true);
    expect(env.git.impl.worktreeEntries.map((w) => w.path)).not.toContain(
      `${stateRoot}/worktrees/${ns}.old-idea/phase-02`,
    );
    expect(env.registryRuns().map((r) => r.shortName)).toEqual(["keeper"]);

    const [report] = result.report.runs;
    expect(report).toMatchObject({
      qualifiedName: "phax.old-idea",
      outcome: "pruned",
      archiveBytes: 120,
      bytesFreed: 120,
      branchesDeleted: ["phax/old-idea", "phax/old-idea--phase-01", "phax/old-idea--phase-02"],
      alreadyAbsent: [],
      kept: null,
    });
    expect(result.report.totals).toEqual({ pruned: 1, kept: 0, bytesFreed: 120 });
  });

  it("removes a run-owned worktree that git worktree prune left behind", async () => {
    const env = makeEnv();
    env.seedArchived("old-idea");
    const livePath = `${archiveOf("old-idea")}/worktrees/phase-01`;
    env.git.impl.addWorktreeEntry({
      path: livePath,
      branch: "phax/old-idea--phase-01",
      prunable: false,
    });

    applied(await env.run({ selection: names("old-idea") }));

    expect(env.git.impl.calls).toContainEqual({
      method: "removeWorktree",
      path: livePath,
      force: true,
      repo: repoRoot,
    });
    expect(env.git.impl.worktreeEntries.map((w) => w.path)).toEqual([repoRoot]);
  });

  it("measures the archive folder from entry.archivePath, else <stateRoot>/archive/<ns>.<name>", async () => {
    const env = makeEnv();
    env.seedArchived("old-idea");
    const { archivePath: _dropped, ...withoutPath } = entry("old-idea");
    env.fs.impl.setFile(registryPath, JSON.stringify({ version: 1, runs: [withoutPath] }));

    await env.run({ selection: names("old-idea"), confirmation: "dry-run" });
    expect(env.previews[0]?.runs[0]).toMatchObject({
      archivePath: archiveOf("old-idea"),
      archiveBytes: 120,
    });
  });
});

describe("prune: whole-command refusals delete nothing", () => {
  it.each([
    ["an unknown name", "ghost", "not-found"],
    ["a non-archived run", "live", "not-archived"],
    ["another namespace", "louloupapers.cover-flow", "other-namespace"],
  ])("refuses %s with PruneRefusedError", async (_label, ref, kind) => {
    const env = makeEnv();
    env.seedArchived("old-idea");
    env.seedEntry(entry("live", { state: "review_open" }));
    env.seedEntry(entry("cover-flow", { namespace: "louloupapers" }));
    const registryBefore = env.fs.impl.getFile(registryPath);

    const result = await env.run({ selection: names("old-idea", ref) });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(PruneRefusedError);
      const error = result.left as PruneRefusedError;
      expect(error.refusals.map((r) => r.kind)).toEqual([kind]);
      expect(error.message.split("\n")).toHaveLength(1);
    }
    expect(env.previews).toEqual([]);
    expect(deletionCalls(env)).toEqual([]);
    expect(env.fs.impl.getFile(registryPath)).toBe(registryBefore);
    expect(await Effect.runPromise(env.fs.impl.exists(archiveOf("old-idea")))).toBe(true);
  });

  it("names every offending run, one per line", async () => {
    const env = makeEnv();
    env.seedEntry(entry("live", { state: "review_open" }));

    const result = await env.run({ selection: names("ghost", "live") });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message.split("\n")).toEqual([
        'run "phax.ghost" not found',
        'run "phax.live" is review_open, not archived — archive it first: phax archive live',
      ]);
    }
  });

  it("refuses a locked run with LockConflictError naming phax unlock", async () => {
    const env = makeEnv();
    env.seedArchived("old-idea");
    env.seedArchived("locked-one");
    env.lock.impl.setStatus("phax.locked-one", {
      kind: "active",
      pid: 4242,
      updatedAt: "2026-10-03T00:00:00.000Z",
    });
    const registryBefore = env.fs.impl.getFile(registryPath);

    const result = await env.run({ selection: { kind: "all" } });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(LockConflictError);
      const error = result.left as LockConflictError;
      expect(error.message).toContain("phax.locked-one");
      expect(error.message).toContain("phax unlock locked-one");
      expect(error.shortName).toBe("phax.locked-one");
      expect(error.lockingPid).toBe(4242);
      expect(error.lockPath).toBe(`${stateRoot}/locks/phax.locked-one.lock`);
    }
    expect(deletionCalls(env)).toEqual([]);
    expect(env.fs.impl.getFile(registryPath)).toBe(registryBefore);
  });

  it("does not refuse on a stale lock", async () => {
    const env = makeEnv();
    env.seedArchived("old-idea");
    env.lock.impl.setStatus("phax.old-idea", { kind: "stale", pid: 1, reason: "pid_dead" });

    const result = applied(await env.run({ selection: names("old-idea") }));
    expect(result.report.runs[0]?.outcome).toBe("pruned");
  });
});

describe("prune: unpreserved commits and checked-out branches", () => {
  it("keeps a run whole when a branch holds unpreserved commits", async () => {
    const env = makeEnv();
    env.seedArchived("old-idea");
    env.git.impl.setUnpreservedCount("phax/old-idea--phase-02", 2);

    const result = applied(await env.run({ selection: names("old-idea") }));

    expect(result.report.runs[0]).toMatchObject({
      outcome: "kept",
      bytesFreed: 0,
      branchesDeleted: [],
      kept: {
        reason: "unpreserved-commits",
        branches: [{ branch: "phax/old-idea--phase-02", unpreservedCommits: 2 }],
      },
    });
    expect(deletionCalls(env)).toEqual([]);
    expect(await Effect.runPromise(env.fs.impl.exists(archiveOf("old-idea")))).toBe(true);
    expect(env.registryRuns().map((r) => r.shortName)).toEqual(["old-idea"]);
  });

  it("discards unpreserved commits under --force", async () => {
    const env = makeEnv();
    env.seedArchived("old-idea");
    env.git.impl.setUnpreservedCount("phax/old-idea--phase-02", 2);

    const result = applied(await env.run({ selection: names("old-idea"), force: true }));

    expect(result.report.runs[0]).toMatchObject({
      outcome: "pruned",
      branchesDiscarded: [{ branch: "phax/old-idea--phase-02", unpreservedCommits: 2 }],
    });
    expect(env.registryRuns()).toEqual([]);
  });

  it("counts against the union of every selected run's present branches", async () => {
    const env = makeEnv();
    env.seedArchived("a", { phasesCount: 1 });
    env.seedArchived("b", { phasesCount: 1 });

    await env.run({ selection: { kind: "all" }, confirmation: "dry-run" });

    const counts = env.git.impl.calls.filter((c) => c.method === "countUnpreservedCommits");
    expect(counts.map((c) => c.branch)).toEqual([
      "phax/a",
      "phax/a--phase-01",
      "phax/b",
      "phax/b--phase-01",
    ]);
    for (const call of counts) {
      expect(call.deleting).toEqual(["phax/a", "phax/a--phase-01", "phax/b", "phax/b--phase-01"]);
    }
  });

  it("keeps a run whose branch is checked out, even under --force", async () => {
    const env = makeEnv();
    env.seedArchived("old-idea");
    env.git.impl.addWorktreeEntry({
      path: "/elsewhere/wt",
      branch: "phax/old-idea--phase-01",
      prunable: false,
    });

    const result = applied(await env.run({ selection: names("old-idea"), force: true }));

    expect(result.report.runs[0]).toMatchObject({
      outcome: "kept",
      kept: {
        reason: "branch-checked-out",
        worktrees: [{ branch: "phax/old-idea--phase-01", worktreePath: "/elsewhere/wt" }],
      },
    });
    expect(deletionCalls(env)).toEqual([]);
  });
});

describe("prune: confirmation", () => {
  it("dry-run previews and deletes nothing", async () => {
    const env = makeEnv();
    env.seedArchived("old-idea");
    const registryBefore = env.fs.impl.getFile(registryPath);

    const result = await env.run({ selection: names("old-idea"), confirmation: "dry-run" });

    expect(Either.getOrThrow(result).kind).toBe("previewed");
    expect(env.previews).toHaveLength(1);
    expect(env.previews[0]?.runs[0]).toMatchObject({
      outcome: "would-prune",
      archiveBytes: 120,
      branches: ["phax/old-idea", "phax/old-idea--phase-01", "phax/old-idea--phase-02"],
    });
    expect(env.prompt.impl.asks).toEqual([]);
    expect(deletionCalls(env)).toEqual([]);
    expect(env.fs.impl.getFile(registryPath)).toBe(registryBefore);
  });

  it("prompt: yes prunes, after the preview", async () => {
    const env = makeEnv([true]);
    env.seedArchived("old-idea");

    const result = applied(await env.run({ selection: names("old-idea"), confirmation: "prompt" }));

    expect(env.prompt.impl.asks).toEqual(["Prune 1 run(s), freeing 120 B?"]);
    expect(env.asksAtPreview).toEqual([0]);
    expect(result.report.runs[0]?.outcome).toBe("pruned");
  });

  it("prompt: no declines and deletes nothing", async () => {
    const env = makeEnv([false]);
    env.seedArchived("old-idea");

    const result = await env.run({ selection: names("old-idea"), confirmation: "prompt" });

    expect(Either.getOrThrow(result).kind).toBe("declined");
    expect(env.asksAtPreview).toEqual([0]);
    expect(deletionCalls(env)).toEqual([]);
    expect(env.registryRuns()).toHaveLength(1);
  });

  it("prompt: a cancelled prompt declines", async () => {
    const env = makeEnv([FAKE_PROMPT_CANCEL]);
    env.seedArchived("old-idea");

    const result = await env.run({ selection: names("old-idea"), confirmation: "prompt" });

    expect(Either.getOrThrow(result).kind).toBe("declined");
    expect(deletionCalls(env)).toEqual([]);
  });

  it("prompt: asks nothing when no run is planned for pruning, and reports the kept runs", async () => {
    const env = makeEnv();
    env.seedArchived("old-idea");
    env.git.impl.setUnpreservedCount("phax/old-idea", 1);

    const result = applied(await env.run({ selection: names("old-idea"), confirmation: "prompt" }));

    expect(env.prompt.impl.asks).toEqual([]);
    expect(result.report.runs[0]?.outcome).toBe("kept");
  });

  it("missing never asks and returns confirmation-missing, even when every run would be kept", async () => {
    for (const keepAll of [false, true]) {
      const env = makeEnv([true]);
      env.seedArchived("old-idea");
      if (keepAll) env.git.impl.setUnpreservedCount("phax/old-idea", 1);

      const result = await env.run({ selection: names("old-idea"), confirmation: "missing" });

      expect(Either.getOrThrow(result).kind).toBe("confirmation-missing");
      expect(env.previews).toHaveLength(1);
      expect(env.prompt.impl.asks).toEqual([]);
      expect(deletionCalls(env)).toEqual([]);
    }
  });

  it("returns nothing-to-prune for --all with no archived run, before any preview", async () => {
    const env = makeEnv();
    env.seedEntry(entry("live", { state: "review_open" }));

    const result = await env.run({ selection: { kind: "all" }, confirmation: "prompt" });

    expect(Either.getOrThrow(result)).toEqual({ kind: "nothing-to-prune" });
    expect(env.previews).toEqual([]);
    expect(env.prompt.impl.asks).toEqual([]);
  });
});

describe("prune: idempotent and partial removal", () => {
  it("reports parts of an interrupted prune as already absent and removes the entry", async () => {
    const env = makeEnv();
    env.seedEntry(entry("old-idea"));

    const result = applied(await env.run({ selection: names("old-idea") }));

    expect(result.report.runs[0]).toMatchObject({
      outcome: "pruned",
      bytesFreed: 0,
      branchesDeleted: [],
      alreadyAbsent: [
        "archive folder",
        "worktree metadata",
        "branch phax/old-idea",
        "branch phax/old-idea--phase-01",
        "branch phax/old-idea--phase-02",
      ],
    });
    expect(env.registryRuns()).toEqual([]);
    expect(deletionCalls(env)).toEqual([]);
  });

  it("keeps a run's entry when its folder cannot be removed and prunes the next run", async () => {
    const env = makeEnv();
    env.seedArchived("stuck");
    env.seedArchived("old-idea");
    env.fs.impl.failRemove(archiveOf("stuck"), "EACCES: permission denied, rmdir\n    at stack");

    const result = applied(await env.run({ selection: { kind: "all" } }));

    expect(result.report.runs.map((r) => [r.qualifiedName, r.outcome])).toEqual([
      ["phax.stuck", "kept"],
      ["phax.old-idea", "pruned"],
    ]);
    expect(result.report.runs[0]).toMatchObject({
      bytesFreed: 0,
      kept: {
        reason: "removal-failed",
        part: "archive folder",
        message: "EACCES: permission denied, rmdir",
      },
    });
    expect(env.registryRuns().map((r) => r.shortName)).toEqual(["stuck"]);
    expect(env.git.impl.deletedBranches.map((d) => d.name)).not.toContain("phax/stuck");
    expect(result.report.totals).toEqual({ pruned: 1, kept: 1, bytesFreed: 120 });
  });

  it("keeps the entry when a branch cannot be deleted, after the folder is gone", async () => {
    const env = makeEnv();
    env.seedArchived("old-idea");
    env.git.impl.failNextDeleteBranch("error: cannot lock ref");

    const result = applied(await env.run({ selection: names("old-idea") }));

    expect(result.report.runs[0]).toMatchObject({
      outcome: "kept",
      bytesFreed: 120,
      kept: { reason: "removal-failed", part: "branch phax/old-idea" },
    });
    expect(env.registryRuns().map((r) => r.shortName)).toEqual(["old-idea"]);
  });
});

describe("prune: what it never touches", () => {
  it("passes only the selected runs' branches to deleteBranch and never contacts a remote", async () => {
    const env = makeEnv();
    env.seedArchived("old-idea");
    env.git.impl.addExistingBranch("phax/records/v1");
    env.git.impl.addExistingBranch("phax/old-idea-2");
    env.git.impl.addExistingBranch("phax/old-idea-2--phase-01");
    env.git.impl.addRef("refs/remotes/origin/phax/old-idea--phase-02");
    env.git.impl.addRef("refs/remotes/origin/HEAD");
    env.git.impl.addRef("refs/tags/v1");

    const result = applied(await env.run({ selection: { kind: "all" } }));

    expect(env.git.impl.deletedBranches.map((d) => d.name)).toEqual([
      "phax/old-idea",
      "phax/old-idea--phase-01",
      "phax/old-idea--phase-02",
    ]);
    expect(env.git.impl.existingBranches.has("phax/records/v1")).toBe(true);
    expect(env.git.impl.existingBranches.has("phax/old-idea-2--phase-01")).toBe(true);
    expect(result.report.runs[0]?.remoteBranchesKept).toEqual(["origin/phax/old-idea--phase-02"]);
    const remoteCalls = env.git.impl.calls.filter((c) =>
      ["fetchRemote", "pushBranch", "remoteExists", "remoteUrl", "cloneRepo"].includes(c.method),
    );
    expect(remoteCalls).toEqual([]);
  });
});
