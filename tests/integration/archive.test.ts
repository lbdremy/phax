import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { archive } from "../../src/app/archive.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { makeFakeSystemTelemetry } from "../../src/infra/fakes/systemTelemetry.js";
import { makeFakeLock } from "../../src/infra/fakes/lock.js";
import type { ShortName } from "../../src/domain/branded.js";

const stateRoot = "/fake-state";
const repoRoot = "/fake-repo";
const shortName = "my-run" as ShortName;
const runPath = join(stateRoot, "runs", shortName);

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

function seedFs(opts: {
  runState: "review_open" | "completed";
  withWorktrees?: boolean;
  worktreeDirty?: boolean;
}) {
  const fakeFs = makeFakeFileSystem();

  fakeFs.impl.setFile(
    join(runPath, "run-status.json"),
    JSON.stringify({ ...runStatusBase, state: opts.runState }),
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
    const worktreesDir = join(stateRoot, "worktrees", shortName);
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
    fakeGit.impl.setCleanWorktree(join(stateRoot, "worktrees", shortName, "phase-01"), true);
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
      archive(shortName, stateRoot, repoRoot, {}).pipe(Effect.provide(layer)),
    );

    // Source run folder must be gone
    expect(fakeFs.impl.getFile(join(runPath, "run-status.json"))).toBeUndefined();

    // run-status.json must appear under archive/{short}/runs/
    const archivedRunStatus = fakeFs.impl.getFile(
      join(stateRoot, "archive", shortName, "runs", "run-status.json"),
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
      archive(shortName, stateRoot, repoRoot, {}).pipe(Effect.provide(layer)),
    );

    // run-status.json under archive/{short}/runs/
    const archivedRunStatus = fakeFs.impl.getFile(
      join(stateRoot, "archive", shortName, "runs", "run-status.json"),
    );
    expect(archivedRunStatus).toBeDefined();
    const parsed = JSON.parse(archivedRunStatus!) as { state: string };
    expect(parsed.state).toBe("archived");

    // worktree file moved to archive/{short}/worktrees/phase-01/README.md
    const archivedWorktreeFile = fakeFs.impl.getFile(
      join(stateRoot, "archive", shortName, "worktrees", "phase-01", "README.md"),
    );
    expect(archivedWorktreeFile).toBeDefined();
    expect(archivedWorktreeFile).toContain("phase-01 worktree");

    // Source worktrees dir must be gone
    const sourceWorktreeFile = fakeFs.impl.getFile(
      join(stateRoot, "worktrees", shortName, "phase-01", "README.md"),
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
      archive(shortName, stateRoot, repoRoot, {}).pipe(Effect.provide(layer)),
    );

    const raw = fakeFs.impl.getFile(join(stateRoot, "registry.json"));
    expect(raw).toBeDefined();
    const registry = JSON.parse(raw!) as { runs: Array<{ archivePath?: string }> };
    expect(registry.runs).toHaveLength(1);
    const entry = registry.runs[0];
    // archivePath should be the umbrella: archive/{short}, not archive/{short}/runs
    expect(entry?.archivePath).toBe(join(stateRoot, "archive", shortName));
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
