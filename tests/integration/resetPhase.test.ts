import { Effect, Either, Layer } from "effect";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ResetPhaseError, resetPhase } from "../../src/app/resetPhase.js";
import { decodeShortName, type ShortName } from "../../src/domain/branded.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";

const SHORT_NAME = "my-run";
const NAMESPACE = "test-project";

function nowIso(): string {
  return "2026-06-12T00:00:00.000Z";
}

async function seedRun(
  stateRoot: string,
  opts: {
    runState: "failed" | "running" | "interrupted";
    lastError?: string;
    phases: ReadonlyArray<{
      id: string;
      index: number;
      state: string;
      worktreePath?: string;
      branchName: string;
      commitHash?: string;
    }>;
  },
): Promise<{ runPath: string }> {
  const runPath = join(stateRoot, "runs", `${NAMESPACE}.${SHORT_NAME}`);
  await mkdir(runPath, { recursive: true });
  const runStatus: Record<string, unknown> = {
    version: 1,
    namespace: "test-project",
    shortName: SHORT_NAME,
    runId: `${SHORT_NAME}-2026-06-12`,
    state: opts.runState,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    phasesCount: opts.phases.length,
    gateProfileId: "full",
  };
  if (opts.lastError !== undefined) runStatus.lastError = opts.lastError;
  await writeFile(join(runPath, "run-status.json"), JSON.stringify(runStatus));

  for (const phase of opts.phases) {
    const phaseFolderPath = join(runPath, phase.id);
    await mkdir(phaseFolderPath, { recursive: true });
    const status: Record<string, unknown> = {
      version: 1,
      phaseId: phase.id,
      phaseIndex: phase.index,
      state: phase.state,
      model: "claude-sonnet-4-6",
      effort: "low",
      branchName: phase.branchName,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    if (phase.worktreePath !== undefined) status.worktreePath = phase.worktreePath;
    if (phase.commitHash !== undefined) status.commitHash = phase.commitHash;
    await writeFile(join(phaseFolderPath, "status.json"), JSON.stringify(status));
  }

  return { runPath };
}

function shortName(): ShortName {
  return Either.getOrThrow(decodeShortName(SHORT_NAME));
}

describe("resetPhase", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-reset-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("archives the phase folder, removes the worktree, deletes the branch, and flips the run to interrupted", async () => {
    const worktreePath = join(stateRoot, "worktrees", `${NAMESPACE}.${SHORT_NAME}`, "phase-02");
    const branchName = "ai/my-run--phase-02";
    const { runPath } = await seedRun(stateRoot, {
      runState: "failed",
      lastError: "agent invocation crashed",
      phases: [
        {
          id: "phase-01",
          index: 0,
          state: "committed",
          worktreePath: join(stateRoot, "worktrees", `${NAMESPACE}.${SHORT_NAME}`, "phase-01"),
          branchName: "ai/my-run--phase-01",
          commitHash: "aabbccdd",
        },
        {
          id: "phase-02",
          index: 1,
          state: "gates_exhausted",
          worktreePath,
          branchName,
        },
      ],
    });

    const fakeGit = makeFakeGit();
    fakeGit.impl.addExistingBranch(branchName);
    const layers = Layer.mergeAll(
      fakeGit.layer,
      makeFakeShell().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const result = await Effect.runPromise(
      Effect.either(
        resetPhase({
          shortName: shortName(),
          namespace: NAMESPACE,
          stateRoot,
          repoRoot: stateRoot,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) throw new Error("unreachable");
    const value = result.right;
    expect(value.phaseId).toBe("phase-02");
    expect(value.worktreeRemoved).toBe(true);
    expect(value.branchDeleted).toBe(true);
    expect(value.archivedPath).toBeDefined();

    // Original phase folder is gone; archived folder is present.
    expect(existsSync(join(runPath, "phase-02"))).toBe(false);
    const entries = await readdir(runPath);
    const archived = entries.find((e) => e.startsWith("phase-02.reset-"));
    expect(archived).toBeDefined();
    expect(value.archivedPath).toBe(join(runPath, archived!));

    // Git fake recorded the worktree removal and branch deletion.
    expect(
      fakeGit.impl.calls.some(
        (c) => c.method === "removeWorktree" && c.path === worktreePath && c.force === true,
      ),
    ).toBe(true);
    expect(
      fakeGit.impl.deletedBranches.some((b) => b.name === branchName && b.force === true),
    ).toBe(true);

    // Run is now interrupted with stoppedReason=phase_reset and no lastError.
    const runStatus = JSON.parse(
      await readFile(join(runPath, "run-status.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(runStatus.state).toBe("interrupted");
    expect(runStatus.stoppedReason).toBe("phase_reset");
    expect(runStatus.lastError).toBeUndefined();
  });

  it("rejects resetting a phase whose later sibling is already committed", async () => {
    await seedRun(stateRoot, {
      runState: "running",
      phases: [
        {
          id: "phase-01",
          index: 0,
          state: "gates_exhausted",
          worktreePath: join(stateRoot, "worktrees", `${NAMESPACE}.${SHORT_NAME}`, "phase-01"),
          branchName: "ai/my-run--phase-01",
        },
        {
          id: "phase-02",
          index: 1,
          state: "committed",
          worktreePath: join(stateRoot, "worktrees", `${NAMESPACE}.${SHORT_NAME}`, "phase-02"),
          branchName: "ai/my-run--phase-02",
          commitHash: "aabbccdd",
        },
      ],
    });

    const fakeGit = makeFakeGit();
    const layers = Layer.mergeAll(
      fakeGit.layer,
      makeFakeShell().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const result = await Effect.runPromise(
      Effect.either(
        resetPhase({
          shortName: shortName(),
          namespace: NAMESPACE,
          phaseId: "phase-01",
          stateRoot,
          repoRoot: stateRoot,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) throw new Error("unreachable");
    expect(result.left).toBeInstanceOf(ResetPhaseError);
    expect((result.left as ResetPhaseError).reason).toBe("phase_blocked_by_later_committed");

    // No side effects on the registry / git fake.
    expect(fakeGit.impl.calls.some((c) => c.method === "removeWorktree")).toBe(false);
    expect(fakeGit.impl.deletedBranches.length).toBe(0);
  });

  it("rejects resetting a phase that is not in a resettable state", async () => {
    await seedRun(stateRoot, {
      runState: "running",
      phases: [
        {
          id: "phase-01",
          index: 0,
          state: "running",
          worktreePath: join(stateRoot, "worktrees", `${NAMESPACE}.${SHORT_NAME}`, "phase-01"),
          branchName: "ai/my-run--phase-01",
        },
      ],
    });

    const fakeGit = makeFakeGit();
    const layers = Layer.mergeAll(
      fakeGit.layer,
      makeFakeShell().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const result = await Effect.runPromise(
      Effect.either(
        resetPhase({
          shortName: shortName(),
          namespace: NAMESPACE,
          stateRoot,
          repoRoot: stateRoot,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) throw new Error("unreachable");
    expect(result.left).toBeInstanceOf(ResetPhaseError);
    expect((result.left as ResetPhaseError).reason).toBe("not_resettable");
  });

  it("is tolerant of an already-missing worktree and branch", async () => {
    const worktreePath = join(stateRoot, "worktrees", `${NAMESPACE}.${SHORT_NAME}`, "phase-01");
    const branchName = "ai/my-run--phase-01";
    const { runPath } = await seedRun(stateRoot, {
      runState: "failed",
      lastError: "agent invocation crashed",
      phases: [
        {
          id: "phase-01",
          index: 0,
          state: "gates_exhausted",
          worktreePath,
          branchName,
        },
      ],
    });

    // Branch is intentionally NOT added to the fake's existingBranches set, so
    // branchExists returns false and deleteBranch is never called.
    const fakeGit = makeFakeGit();
    const layers = Layer.mergeAll(
      fakeGit.layer,
      makeFakeShell().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const result = await Effect.runPromise(
      Effect.either(
        resetPhase({
          shortName: shortName(),
          namespace: NAMESPACE,
          stateRoot,
          repoRoot: stateRoot,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) throw new Error("unreachable");
    expect(result.right.branchDeleted).toBe(false);
    expect(fakeGit.impl.deletedBranches.length).toBe(0);

    // Run still flipped to interrupted; phase folder still archived.
    const runStatus = JSON.parse(
      await readFile(join(runPath, "run-status.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(runStatus.state).toBe("interrupted");
    const entries = await readdir(runPath);
    expect(entries.some((e) => e.startsWith("phase-01.reset-"))).toBe(true);
  });

  it("rejects when the run does not exist", async () => {
    const fakeGit = makeFakeGit();
    const layers = Layer.mergeAll(
      fakeGit.layer,
      makeFakeShell().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const result = await Effect.runPromise(
      Effect.either(
        resetPhase({
          shortName: shortName(),
          namespace: NAMESPACE,
          stateRoot,
          repoRoot: stateRoot,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) throw new Error("unreachable");
    expect(result.left).toBeInstanceOf(ResetPhaseError);
    expect((result.left as ResetPhaseError).reason).toBe("run_not_found");
  });
});
