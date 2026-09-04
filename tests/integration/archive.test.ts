import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { archive } from "../../src/app/archive.js";
import {
  ArchiveBlockedByDirtyWorktreeError,
  ArchiveRefusedError,
  LockConflictError,
} from "../../src/domain/errors.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { makeFakeSystemTelemetry } from "../../src/infra/fakes/systemTelemetry.js";
import { makeFakeLock } from "../../src/infra/fakes/lock.js";
import type { ShortName } from "../../src/domain/branded.js";

const stateRoot = "/fake-state";
const repoRoot = "/fake-repo";
const shortName = "my-run" as ShortName;
const namespace = "fake-project";
const qualifiedKey = `${namespace}.${shortName}`;
const runPath = join(stateRoot, "runs", qualifiedKey);

const runStatusBase = {
  version: 1,
  namespace: "fake-project",
  shortName,
  runId: "my-run-2026-05-27",
  createdAt: "2026-05-27T00:00:00.000Z",
  updatedAt: "2026-05-27T00:00:00.000Z",
  phasesCount: 1,
  currentPhaseIndex: 0,
} as const;

type RunState =
  | "created"
  | "running"
  | "rate_limited"
  | "interrupted"
  | "failed"
  | "stopped"
  | "review_open"
  | "completed"
  | "archived";

function seedFs(opts: {
  runState: RunState;
  withWorktrees?: boolean;
  worktreeDirty?: boolean;
  stoppedReason?: string;
  lastError?: string;
}) {
  const fakeFs = makeFakeFileSystem();

  fakeFs.impl.setFile(
    join(runPath, "run-status.json"),
    JSON.stringify({
      ...runStatusBase,
      state: opts.runState,
      ...(opts.stoppedReason !== undefined ? { stoppedReason: opts.stoppedReason } : {}),
      ...(opts.lastError !== undefined ? { lastError: opts.lastError } : {}),
    }),
  );

  // registry.json must satisfy RegistryEntrySchema (branch + projectName required)
  fakeFs.impl.setFile(
    join(stateRoot, "registry.json"),
    JSON.stringify({
      version: 1,
      runs: [
        {
          namespace: "fake-project",
          shortName,
          runId: runStatusBase.runId,
          state: opts.runState,
          branch: `phax/${shortName}`,
          projectName: "fake-project",
          phasesCount: 1,
          createdAt: runStatusBase.createdAt,
          updatedAt: runStatusBase.updatedAt,
        },
      ],
    }),
  );

  if (opts.withWorktrees) {
    const worktreesDir = join(stateRoot, "worktrees", qualifiedKey);
    fakeFs.impl.addDir(worktreesDir);
    fakeFs.impl.addDir(join(worktreesDir, "phase-01"));
    fakeFs.impl.setFile(join(worktreesDir, "phase-01", "README.md"), "# phase-01 worktree\n");
  }

  return {
    fakeFs,
    withWorktrees: opts.withWorktrees ?? false,
    worktreeDirty: opts.worktreeDirty ?? false,
  };
}

function makeLayers(seed: ReturnType<typeof seedFs>) {
  const fakeTelemetry = makeFakeSystemTelemetry();
  const fakeGit = makeFakeGit();
  const fakeShell = makeFakeShell();
  const fakeLock = makeFakeLock();

  // Only set worktree cleanliness when worktrees were actually seeded.
  // Archive checks cleanliness only on the final worktree (from resolveRunInfo),
  // which is unrelated to the worktrees/ directory; but keep this accurate for
  // when a test seeds both and reads the phase-01 worktree path via resolveRunInfo.
  if (seed.withWorktrees && !seed.worktreeDirty) {
    fakeGit.impl.setCleanWorktree(join(stateRoot, "worktrees", qualifiedKey, "phase-01"), true);
  }

  const layer = Layer.mergeAll(
    seed.fakeFs.layer,
    fakeTelemetry.layer,
    fakeGit.layer,
    fakeShell.layer,
    fakeLock.layer,
  );
  return { layer, fakeTelemetry, fakeGit, fakeShell, fakeLock };
}

// ---------------------------------------------------------------------------
// Umbrella layout tests
// ---------------------------------------------------------------------------

describe("archive — umbrella layout", () => {
  it("moves runs/{short} to archive/{short}/runs/ (no worktrees dir)", async () => {
    const seed = seedFs({ runState: "review_open", withWorktrees: false });
    const { fakeFs } = seed;
    const { layer, fakeGit } = makeLayers(seed);

    await Effect.runPromise(
      archive(namespace, shortName, stateRoot, repoRoot, {}).pipe(Effect.provide(layer)),
    );

    // Source run folder must be gone
    expect(fakeFs.impl.getFile(join(runPath, "run-status.json"))).toBeUndefined();

    // run-status.json must appear under archive/{short}/runs/
    const archivedRunStatus = fakeFs.impl.getFile(
      join(stateRoot, "archive", qualifiedKey, "runs", "run-status.json"),
    );
    expect(archivedRunStatus).toBeDefined();
    const parsed = JSON.parse(archivedRunStatus!) as { state: string };
    expect(parsed.state).toBe("archived");

    // pruneWorktrees must have been called exactly once with repoRoot
    const pruneCalls = fakeGit.impl.calls.filter((c) => c.method === "pruneWorktrees");
    expect(pruneCalls).toHaveLength(1);
    expect(pruneCalls[0]).toMatchObject({ method: "pruneWorktrees", repo: repoRoot });
  });

  it("moves both runs/ and worktrees/ into archive umbrella when worktrees dir exists", async () => {
    const seed = seedFs({ runState: "review_open", withWorktrees: true });
    const { fakeFs } = seed;
    const { layer, fakeGit } = makeLayers(seed);

    await Effect.runPromise(
      archive(namespace, shortName, stateRoot, repoRoot, {}).pipe(Effect.provide(layer)),
    );

    // run-status.json under archive/{qualified}/runs/
    const archivedRunStatus = fakeFs.impl.getFile(
      join(stateRoot, "archive", qualifiedKey, "runs", "run-status.json"),
    );
    expect(archivedRunStatus).toBeDefined();
    const parsed = JSON.parse(archivedRunStatus!) as { state: string };
    expect(parsed.state).toBe("archived");

    // worktree file moved to archive/{qualified}/worktrees/phase-01/README.md
    const archivedWorktreeFile = fakeFs.impl.getFile(
      join(stateRoot, "archive", qualifiedKey, "worktrees", "phase-01", "README.md"),
    );
    expect(archivedWorktreeFile).toBeDefined();
    expect(archivedWorktreeFile).toContain("phase-01 worktree");

    // Source worktrees dir must be gone
    const sourceWorktreeFile = fakeFs.impl.getFile(
      join(stateRoot, "worktrees", qualifiedKey, "phase-01", "README.md"),
    );
    expect(sourceWorktreeFile).toBeUndefined();

    // pruneWorktrees called exactly once
    const pruneCalls = fakeGit.impl.calls.filter((c) => c.method === "pruneWorktrees");
    expect(pruneCalls).toHaveLength(1);
    expect(pruneCalls[0]).toMatchObject({ method: "pruneWorktrees", repo: repoRoot });
  });

  it("sets archivePath in the registry to the umbrella path, not a subfolder", async () => {
    const seed = seedFs({ runState: "review_open", withWorktrees: false });
    const { fakeFs } = seed;
    const { layer } = makeLayers(seed);

    await Effect.runPromise(
      archive(namespace, shortName, stateRoot, repoRoot, {}).pipe(Effect.provide(layer)),
    );

    const raw = fakeFs.impl.getFile(join(stateRoot, "registry.json"));
    expect(raw).toBeDefined();
    const registry = JSON.parse(raw!) as { runs: Array<{ archivePath?: string }> };
    expect(registry.runs).toHaveLength(1);
    const entry = registry.runs[0];
    // archivePath should be the umbrella: archive/{qualified}, not archive/{qualified}/runs
    expect(entry?.archivePath).toBe(join(stateRoot, "archive", qualifiedKey));
    expect(entry?.archivePath).not.toContain("/runs");
  });

  it("emits exactly two MoveRunToArchive effects when worktrees dir exists", async () => {
    // Test the reducer directly with the new event shape.
    const { interpret } = await import("../../src/domain/reducer.js");
    const state = { run: "review_open" as const };

    const worktreesFrom = join(stateRoot, "worktrees", shortName);
    const worktreesTo = join(stateRoot, "archive", shortName, "worktrees");
    const from = join(stateRoot, "runs", shortName);
    const to = join(stateRoot, "archive", shortName, "runs");

    const disposition = interpret(state, {
      type: "RunArchiveRequested",
      eventId: "evt-test",
      occurredAt: "2026-05-27T00:00:00.000Z",
      run: shortName as unknown as import("../../src/domain/branded.js").RunId,
      force: false,
      from,
      to,
      worktreesFrom,
      worktreesTo,
    });

    expect(disposition.kind).toBe("Handled");
    if (disposition.kind !== "Handled") return;

    const moveEffects = disposition.effects.filter((e) => e.type === "MoveRunToArchive");
    expect(moveEffects).toHaveLength(2);
    expect(moveEffects[0]).toMatchObject({ type: "MoveRunToArchive", from, to });
    expect(moveEffects[1]).toMatchObject({
      type: "MoveRunToArchive",
      from: worktreesFrom,
      to: worktreesTo,
    });
  });

  it("emits only one MoveRunToArchive effect when worktrees fields are absent", async () => {
    const { interpret } = await import("../../src/domain/reducer.js");
    const state = { run: "review_open" as const };

    const from = join(stateRoot, "runs", shortName);
    const to = join(stateRoot, "archive", shortName, "runs");

    const disposition = interpret(state, {
      type: "RunArchiveRequested",
      eventId: "evt-test2",
      occurredAt: "2026-05-27T00:00:00.000Z",
      run: shortName as unknown as import("../../src/domain/branded.js").RunId,
      force: false,
      from,
      to,
      // worktreesFrom / worktreesTo omitted
    });

    expect(disposition.kind).toBe("Handled");
    if (disposition.kind !== "Handled") return;

    const moveEffects = disposition.effects.filter((e) => e.type === "MoveRunToArchive");
    expect(moveEffects).toHaveLength(1);
    expect(moveEffects[0]).toMatchObject({ type: "MoveRunToArchive", from, to });
  });
});

// ---------------------------------------------------------------------------
// Unfinished run archiving tests
// ---------------------------------------------------------------------------

const unfinishedStates = ["created", "failed", "interrupted", "rate_limited", "stopped"] as const;

describe("archive — unfinished runs", () => {
  for (const runState of unfinishedStates) {
    describe(`state: ${runState}`, () => {
      it("without --force → Left ArchiveRefusedError naming the state and --force", async () => {
        const seed = seedFs({ runState });
        const { layer } = makeLayers(seed);

        const result = await Effect.runPromise(
          archive(namespace, shortName, stateRoot, repoRoot, {}).pipe(
            Effect.provide(layer),
            Effect.either,
          ),
        );

        expect(Either.isLeft(result)).toBe(true);
        if (!Either.isLeft(result)) return;
        expect(result.left instanceof ArchiveRefusedError).toBe(true);
        const err = result.left as ArchiveRefusedError;
        expect(err.message).toContain(runState);
        expect(err.message).toContain("--force");

        // run-status.json still reports the original state
        const { fakeFs } = seed;
        const raw = fakeFs.impl.getFile(join(runPath, "run-status.json"));
        expect(raw).toBeDefined();
        const parsed = JSON.parse(raw!) as { state: string };
        expect(parsed.state).toBe(runState);
      });

      it("with force: true → run folder moves to archive", async () => {
        const seed = seedFs({ runState, withWorktrees: true });
        const { fakeFs } = seed;
        const { layer, fakeGit } = makeLayers(seed);

        await Effect.runPromise(
          archive(namespace, shortName, stateRoot, repoRoot, { force: true }).pipe(
            Effect.provide(layer),
          ),
        );

        // Source run folder gone
        expect(fakeFs.impl.getFile(join(runPath, "run-status.json"))).toBeUndefined();

        // run-status.json under archive
        const archivedStatus = fakeFs.impl.getFile(
          join(stateRoot, "archive", qualifiedKey, "runs", "run-status.json"),
        );
        expect(archivedStatus).toBeDefined();
        const parsed = JSON.parse(archivedStatus!) as { state: string };
        expect(parsed.state).toBe("archived");

        // registry entry updated
        const regRaw = fakeFs.impl.getFile(join(stateRoot, "registry.json"));
        const registry = JSON.parse(regRaw!) as { runs: Array<{ state: string }> };
        expect(registry.runs[0]?.state).toBe("archived");

        // pruneWorktrees called
        const pruneCalls = fakeGit.impl.calls.filter((c) => c.method === "pruneWorktrees");
        expect(pruneCalls).toHaveLength(1);
      });
    });
  }

  it("created with no worktrees dir and force:true → only run folder moves", async () => {
    const seed = seedFs({ runState: "created", withWorktrees: false });
    const { fakeFs } = seed;
    const { layer } = makeLayers(seed);

    await Effect.runPromise(
      archive(namespace, shortName, stateRoot, repoRoot, { force: true }).pipe(
        Effect.provide(layer),
      ),
    );

    const archivedStatus = fakeFs.impl.getFile(
      join(stateRoot, "archive", qualifiedKey, "runs", "run-status.json"),
    );
    expect(archivedStatus).toBeDefined();
    // No worktrees entry in archive
    expect(
      fakeFs.impl.getFile(join(stateRoot, "archive", qualifiedKey, "worktrees")),
    ).toBeUndefined();
  });

  it("interrupted with dirty worktree and force:true → archived (no dirty-worktree check)", async () => {
    // Dirty check only applies to finished runs; interrupted is unfinished, so
    // force bypasses state refusal and the dirty-worktree guard never fires.
    const seed = seedFs({ runState: "interrupted", withWorktrees: true, worktreeDirty: true });
    const { fakeFs } = seed;
    const { layer } = makeLayers(seed);

    await Effect.runPromise(
      archive(namespace, shortName, stateRoot, repoRoot, { force: true }).pipe(
        Effect.provide(layer),
      ),
    );

    const archivedStatus = fakeFs.impl.getFile(
      join(stateRoot, "archive", qualifiedKey, "runs", "run-status.json"),
    );
    expect(archivedStatus).toBeDefined();
    const parsed = JSON.parse(archivedStatus!) as { state: string };
    expect(parsed.state).toBe("archived");
  });

  it("interrupted without force → ArchiveRefusedError (not ArchiveBlockedByDirtyWorktreeError)", async () => {
    // Even when a worktree exists, the state-based refusal is the one shown —
    // the dirty-worktree guard never runs for unfinished runs.
    const seed = seedFs({ runState: "interrupted", withWorktrees: true, worktreeDirty: true });
    const { layer } = makeLayers(seed);

    const result = await Effect.runPromise(
      archive(namespace, shortName, stateRoot, repoRoot, {}).pipe(
        Effect.provide(layer),
        Effect.either,
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (!Either.isLeft(result)) return;
    expect(result.left instanceof ArchiveRefusedError).toBe(true);
    expect(result.left instanceof ArchiveBlockedByDirtyWorktreeError).toBe(false);
  });

  it("running with force:true → Left ArchiveRefusedError (running is always refused)", async () => {
    const seed = seedFs({ runState: "running" });
    const { layer } = makeLayers(seed);

    const result = await Effect.runPromise(
      archive(namespace, shortName, stateRoot, repoRoot, { force: true }).pipe(
        Effect.provide(layer),
        Effect.either,
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (!Either.isLeft(result)) return;
    expect(result.left instanceof ArchiveRefusedError).toBe(true);

    // run-status still unchanged
    const { fakeFs } = seed;
    const raw = fakeFs.impl.getFile(join(runPath, "run-status.json"));
    const parsed = JSON.parse(raw!) as { state: string };
    expect(parsed.state).toBe("running");
  });

  it("active lock with force:true → LockConflictError", async () => {
    const seed = seedFs({ runState: "stopped" });
    const { layer, fakeLock } = makeLayers(seed);
    fakeLock.impl.setStatus(qualifiedKey, {
      kind: "active",
      pid: 12345,
      updatedAt: new Date().toISOString(),
    });

    const result = await Effect.runPromise(
      archive(namespace, shortName, stateRoot, repoRoot, { force: true }).pipe(
        Effect.provide(layer),
        Effect.either,
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (!Either.isLeft(result)) return;
    expect(result.left instanceof LockConflictError).toBe(true);
    const err = result.left as LockConflictError;
    expect(err.lockingPid).toBe(12345);
  });

  it("archived without force → Left ArchiveRefusedError (already archived)", async () => {
    const seed = seedFs({ runState: "archived" });
    const { layer } = makeLayers(seed);

    const result = await Effect.runPromise(
      archive(namespace, shortName, stateRoot, repoRoot, {}).pipe(
        Effect.provide(layer),
        Effect.either,
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (!Either.isLeft(result)) return;
    expect(result.left instanceof ArchiveRefusedError).toBe(true);
    const err = result.left as ArchiveRefusedError;
    expect(err.message).toContain("already archived");
  });

  it("archived with force:true → Left ArchiveRefusedError (already archived)", async () => {
    const seed = seedFs({ runState: "archived" });
    const { layer } = makeLayers(seed);

    const result = await Effect.runPromise(
      archive(namespace, shortName, stateRoot, repoRoot, { force: true }).pipe(
        Effect.provide(layer),
        Effect.either,
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (!Either.isLeft(result)) return;
    expect(result.left instanceof ArchiveRefusedError).toBe(true);
    const err = result.left as ArchiveRefusedError;
    expect(err.message).toContain("already archived");
  });

  it("rate_limited with stoppedReason and lastError → archived run-status preserves both", async () => {
    const seed = seedFs({
      runState: "rate_limited",
      stoppedReason: "rate_limited",
      lastError: "Rate limit exceeded at 2026-09-04",
    });
    const { fakeFs } = seed;
    const { layer } = makeLayers(seed);

    await Effect.runPromise(
      archive(namespace, shortName, stateRoot, repoRoot, { force: true }).pipe(
        Effect.provide(layer),
      ),
    );

    const archivedRaw = fakeFs.impl.getFile(
      join(stateRoot, "archive", qualifiedKey, "runs", "run-status.json"),
    );
    expect(archivedRaw).toBeDefined();
    const parsed = JSON.parse(archivedRaw!) as {
      state: string;
      stoppedReason?: string;
      lastError?: string;
    };
    expect(parsed.state).toBe("archived");
    expect(parsed.stoppedReason).toBe("rate_limited");
    expect(parsed.lastError).toBe("Rate limit exceeded at 2026-09-04");
  });

  it("review_open with dirty final worktree and no force → ArchiveBlockedByDirtyWorktreeError", async () => {
    // resolveRun uses the real filesystem, so we need a real temp state directory
    // for this test so that resolveRun returns a Right with worktreePath set.
    const tempStateRoot = mkdtempSync(join(tmpdir(), "phax-archive-test-"));
    const worktreePath = join(tempStateRoot, "wt-phase-01");

    try {
      const tempQualifiedKey = `${namespace}.${shortName}`;
      const tempRunPath = join(tempStateRoot, "runs", tempQualifiedKey);
      mkdirSync(join(tempRunPath, "phase-01"), { recursive: true });

      writeFileSync(
        join(tempRunPath, "run-status.json"),
        JSON.stringify({
          ...runStatusBase,
          namespace,
          shortName: String(shortName),
          state: "review_open",
        }),
      );
      writeFileSync(
        join(tempRunPath, "phase-01", "status.json"),
        JSON.stringify({
          version: 1,
          phaseId: "phase-01",
          phaseIndex: 0,
          state: "review_open",
          model: "claude-sonnet-4-6",
          effort: "low",
          branchName: `phax/${String(shortName)}--phase-01`,
          worktreePath,
          createdAt: runStatusBase.createdAt,
          updatedAt: runStatusBase.updatedAt,
        }),
      );

      const fakeFs = makeFakeFileSystem();
      // run-status.json for the dispatcher (FileSystem port)
      fakeFs.impl.setFile(
        join(tempRunPath, "run-status.json"),
        JSON.stringify({
          ...runStatusBase,
          namespace,
          shortName: String(shortName),
          state: "review_open",
        }),
      );
      // registry.json
      fakeFs.impl.setFile(
        join(tempStateRoot, "registry.json"),
        JSON.stringify({
          version: 1,
          runs: [
            {
              namespace,
              shortName,
              runId: runStatusBase.runId,
              state: "review_open",
              branch: `phax/${String(shortName)}`,
              projectName: namespace,
              phasesCount: 1,
              createdAt: runStatusBase.createdAt,
              updatedAt: runStatusBase.updatedAt,
            },
          ],
        }),
      );
      // Worktree exists in fakeFs but is dirty (fake git returns false)
      fakeFs.impl.addDir(worktreePath);
      fakeFs.impl.setFile(join(worktreePath, "dirty.txt"), "uncommitted content");

      const fakeGit = makeFakeGit();
      fakeGit.impl.setCleanWorktree(worktreePath, false);
      const fakeTelemetry = makeFakeSystemTelemetry();
      const fakeShell = makeFakeShell();
      const fakeLock = makeFakeLock();
      const layer = Layer.mergeAll(
        fakeFs.layer,
        fakeTelemetry.layer,
        fakeGit.layer,
        fakeShell.layer,
        fakeLock.layer,
      );

      const result = await Effect.runPromise(
        archive(namespace, shortName, tempStateRoot, repoRoot, {}).pipe(
          Effect.provide(layer),
          Effect.either,
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (!Either.isLeft(result)) return;
      expect(result.left instanceof ArchiveBlockedByDirtyWorktreeError).toBe(true);
    } finally {
      rmSync(tempStateRoot, { recursive: true, force: true });
    }
  });
});
