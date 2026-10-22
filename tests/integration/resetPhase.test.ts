import { Effect, Either, Layer } from "effect";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ResetPhaseError, previewResetPhase, resetPhase } from "../../src/app/resetPhase.js";
import { decodeShortName, type ShortName } from "../../src/domain/branded.js";
import { LockConflictError } from "../../src/domain/errors.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeLock } from "../../src/infra/fakes/lock.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";
import type { PhaxPlan } from "../../src/schemas/phaxPlan.js";
import { phaseStatusFile } from "../helpers/phaseStatusFixture.js";
import type { PhaseStatus } from "../../src/schemas/status.js";

const SHORT_NAME = "my-run";
const NAMESPACE = "test-project";

function nowIso(): string {
  return "2026-06-12T00:00:00.000Z";
}

async function seedRun(
  stateRoot: string,
  opts: {
    runState: "failed" | "running" | "interrupted" | "awaiting_review";
    lastError?: string;
    phases: ReadonlyArray<{
      id: string;
      index: number;
      state: PhaseStatus["state"];
      /** The phase is a declared interactive one; at `awaiting_review` it is waiting at its stop. */
      interactive?: boolean;
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
  if (opts.lastError !== undefined) runStatus["lastError"] = opts.lastError;
  // `awaiting_review` is newer than the pre-schema shape, so its run status is stamped.
  const { version: _version, ...current } = runStatus;
  await writeFile(
    join(runPath, "run-status.json"),
    JSON.stringify(
      opts.runState === "awaiting_review" ? withSchemaUrl("run-status", current) : runStatus,
    ),
  );

  for (const phase of opts.phases) {
    const phaseFolderPath = join(runPath, phase.id);
    await mkdir(phaseFolderPath, { recursive: true });
    const status: Record<string, unknown> = phaseStatusFile({
      phaseId: phase.id,
      phaseIndex: phase.index,
      state: phase.state,
      model: "claude-sonnet-4-6",
      effort: "low",
      branchName: phase.branchName,
      base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...(phase.interactive === true
        ? {
            mode: "interactive" as const,
            stop:
              phase.state === "awaiting_review"
                ? ({ cause: "declared", status: "waiting" } as const)
                : null,
          }
        : {}),
    });
    if (phase.worktreePath !== undefined) status["worktreePath"] = phase.worktreePath;
    if (phase.commitHash !== undefined) status["commitHash"] = phase.commitHash;
    await writeFile(join(phaseFolderPath, "status.json"), JSON.stringify(status));
  }

  return { runPath };
}

/** A made-up phase of a current `phax-plan.json`. */
function planPhase(id: string, oracle: PhaxPlan["phases"][number]["oracle"]) {
  return {
    id,
    title: `Made-up ${id}`,
    model: "claude-opus-5-5",
    effort: "high" as const,
    planMarkdownAnchor: `#${id}`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    mode: "headless" as const,
    oracle,
    commit: { subject: `feat: ${id}`, body: "Made up." },
  };
}

/** Every name under the run folder, with the text of its JSON files. */
async function snapshot(runPath: string) {
  const names = (await readdir(runPath, { recursive: true })).toSorted();
  return Promise.all(
    names.map(async (name) => {
      const path = join(runPath, name);
      return [name, existsSync(path) && name.endsWith(".json") ? await readFile(path, "utf8") : ""];
    }),
  );
}

function shortName(): ShortName {
  return Either.getOrThrow(decodeShortName(SHORT_NAME));
}

// A fake Git whose stopped worktree holds a modified, an added and a deleted file.
function stopLayers(stopped: string) {
  const fakeGit = makeFakeGit();
  fakeGit.impl.addExistingBranch("ai/my-run--phase-03");
  fakeGit.impl.headTrees.set(stopped, "a".repeat(40));
  fakeGit.impl.enqueueSnapshots(stopped, "b".repeat(40));
  fakeGit.impl.setTreeChanges("a".repeat(40), "b".repeat(40), [
    { status: "M", path: "src/invoiceRow.ts" },
    { status: "A", path: "src/creditNote.ts" },
    { status: "D", path: "docs/notes.md" },
  ]);
  return {
    fakeGit,
    layers: Layer.mergeAll(
      fakeGit.layer,
      makeFakeShell().layer,
      makeFakeLock().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    ),
  };
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
      makeFakeLock().layer,
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
    expect(runStatus["state"]).toBe("interrupted");
    expect(runStatus["stoppedReason"]).toBe("phase_reset");
    expect(runStatus["lastError"]).toBeUndefined();
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
      makeFakeLock().layer,
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

  describe("an oracle phase is not reset once its discharge has started", () => {
    // The refunds plan: phase-02 authors tests/refunds.test.ts, phase-03 discharges it.
    function writePairPlan(runPath: string) {
      const plan: PhaxPlan = {
        run: {
          shortName: SHORT_NAME,
          title: "Refunds",
          branch: "phax/refunds",
          requiredCommands: [],
        },
        phases: [
          planPhase("phase-01", null),
          planPhase("phase-02", { dischargedBy: "phase-03", files: ["tests/refunds.test.ts"] }),
          planPhase("phase-03", null),
        ],
      };
      return writeFile(
        join(runPath, "phax-plan.json"),
        JSON.stringify(withSchemaUrl("phax-plan", plan), null, 2),
      );
    }

    function seedPair(phase03State: PhaseStatus["state"], phase03Commit?: string) {
      const worktree = (id: string) =>
        join(stateRoot, "worktrees", `${NAMESPACE}.${SHORT_NAME}`, id);
      return seedRun(stateRoot, {
        runState: "failed",
        phases: [
          {
            id: "phase-01",
            index: 0,
            state: "committed",
            worktreePath: worktree("phase-01"),
            branchName: "ai/my-run--phase-01",
            commitHash: "aabbccdd",
          },
          {
            id: "phase-02",
            index: 1,
            state: "committed",
            worktreePath: worktree("phase-02"),
            branchName: "ai/my-run--phase-02",
            commitHash: "bbccddee",
          },
          {
            id: "phase-03",
            index: 2,
            state: phase03State,
            worktreePath: worktree("phase-03"),
            branchName: "ai/my-run--phase-03",
            ...(phase03Commit === undefined ? {} : { commitHash: phase03Commit }),
          },
        ],
      });
    }

    function reset(phaseId: string, fakeGit = makeFakeGit()) {
      const layers = Layer.mergeAll(
        fakeGit.layer,
        makeFakeShell().layer,
        makeFakeLock().layer,
        NodeFileSystemLayer,
        NoopSystemTelemetryLayer,
      );
      return Effect.runPromise(
        Effect.either(
          resetPhase({
            shortName: shortName(),
            namespace: NAMESPACE,
            phaseId,
            stateRoot,
            repoRoot: stateRoot,
          }).pipe(Effect.provide(layers)),
        ),
      );
    }

    it("refuses while the discharging phase is failed, naming it, and changes nothing", async () => {
      const { runPath } = await seedPair("failed");
      await writePairPlan(runPath);
      const before = await snapshot(runPath);
      const fakeGit = makeFakeGit();

      const result = await reset("phase-02", fakeGit);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isRight(result)) throw new Error("unreachable");
      expect(result.left).toBeInstanceOf(ResetPhaseError);
      const error = result.left as ResetPhaseError;
      expect(error.reason).toBe("phase_blocked_by_discharge");
      expect(error.message).toBe(
        `Cannot reset "phase-02" of run "my-run": its discharging phase "phase-03" is failed, and a committed oracle phase is not reset. To correct the oracle, edit it in phase-03 (\`phax enter-phase my-run phase-03\`), then run \`phax resume my-run --yes --skip-oracle\`: the configured gate still runs.`,
      );
      expect(await snapshot(runPath)).toEqual(before);
      expect(fakeGit.impl.calls.some((c) => c.method === "removeWorktree")).toBe(false);
      expect(fakeGit.impl.deletedBranches).toEqual([]);
    });

    it("names no --skip-oracle recovery once the discharge is past its gate", async () => {
      const { runPath } = await seedPair("review_open");
      await writePairPlan(runPath);

      const result = await reset("phase-02", makeFakeGit());

      if (Either.isRight(result)) throw new Error("unreachable");
      const error = result.left as ResetPhaseError;
      expect(error.reason).toBe("phase_blocked_by_discharge");
      expect(error.message).toBe(
        `Cannot reset "phase-02" of run "my-run": its discharging phase "phase-03" is review_open, and a committed oracle phase is not reset.`,
      );
    });

    it("refuses with its own reason when the discharging phase is also committed", async () => {
      const { runPath } = await seedPair("committed", "ccddeeff");
      await writePairPlan(runPath);

      const result = await reset("phase-02");

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect((result.left as ResetPhaseError).reason).toBe("phase_blocked_by_discharge");
      }
    });

    it("still refuses a committed oracle phase as not_resettable once its discharge is reset", async () => {
      const { runPath } = await seedPair("failed");
      await writePairPlan(runPath);

      expect(Either.isRight(await reset("phase-03"))).toBe(true);
      const second = await reset("phase-02");

      // The discharge no longer blocks, but the state machine never resets a
      // committed phase: a committed oracle phase is not reset.
      expect(Either.isLeft(second)).toBe(true);
      if (Either.isLeft(second)) {
        expect((second.left as ResetPhaseError).reason).toBe("not_resettable");
      }
    });

    it("adds no refusal when the run's plan is unreadable", async () => {
      const { runPath } = await seedPair("failed");
      await writeFile(join(runPath, "phax-plan.json"), "not json");

      const result = await reset("phase-02");

      // The later-committed rule does not apply (phase-03 is failed): the reset proceeds.
      expect(Either.isRight(result)).toBe(true);
    });
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
      makeFakeLock().layer,
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
      makeFakeLock().layer,
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
    expect(runStatus["state"]).toBe("interrupted");
    const entries = await readdir(runPath);
    expect(entries.some((e) => e.startsWith("phase-01.reset-"))).toBe(true);
  });

  describe("at a stop", () => {
    const worktree = (root: string, id: string) =>
      join(root, "worktrees", `${NAMESPACE}.${SHORT_NAME}`, id);

    async function seedStoppedRun(root: string) {
      const stopped = worktree(root, "phase-03");
      const seeded = await seedRun(root, {
        runState: "awaiting_review",
        phases: [
          {
            id: "phase-01",
            index: 0,
            state: "committed",
            branchName: "ai/my-run--phase-01",
            commitHash: "aabbccdd",
          },
          {
            id: "phase-02",
            index: 1,
            state: "committed",
            branchName: "ai/my-run--phase-02",
            commitHash: "eeff0011",
          },
          {
            id: "phase-03",
            index: 2,
            state: "awaiting_review",
            interactive: true,
            worktreePath: stopped,
            branchName: "ai/my-run--phase-03",
          },
        ],
      });
      await writeFile(join(seeded.runPath, "review-stop.json"), "{}");
      return { ...seeded, stopped };
    }

    it("previews every uncommitted correction of the stopped phase", async () => {
      const { stopped } = await seedStoppedRun(stateRoot);
      const { layers } = stopLayers(stopped);
      // The preview reads the worktree from disk before it asks Git.
      await mkdir(stopped, { recursive: true });

      const preview = await Effect.runPromise(
        previewResetPhase({
          shortName: shortName(),
          namespace: NAMESPACE,
          stateRoot,
          repoRoot: stateRoot,
        }).pipe(Effect.provide(layers)),
      );

      expect(preview).toEqual({
        phaseId: "phase-03",
        atStop: true,
        corrections: [
          { status: "M", path: "src/invoiceRow.ts" },
          { status: "A", path: "src/creditNote.ts" },
          { status: "D", path: "docs/notes.md" },
        ],
        personHandoff: null,
      });
    });

    it("previews the person's handoff file as something the reset discards", async () => {
      const { stopped } = await seedStoppedRun(stateRoot);
      const { layers } = stopLayers(stopped);
      await mkdir(join(stopped, ".phax-context"), { recursive: true });
      await writeFile(join(stopped, ".phax-context", "correction-handoff.md"), "## Ada's\n");

      const preview = await Effect.runPromise(
        previewResetPhase({
          shortName: shortName(),
          namespace: NAMESPACE,
          stateRoot,
          repoRoot: stateRoot,
        }).pipe(Effect.provide(layers)),
      );

      expect(preview.personHandoff).toBe(join(stopped, ".phax-context", "correction-handoff.md"));
    });

    it("resets the stopped phase, which discards review-stop.json", async () => {
      const { runPath, stopped } = await seedStoppedRun(stateRoot);
      const { layers } = stopLayers(stopped);

      const result = await Effect.runPromise(
        resetPhase({
          shortName: shortName(),
          namespace: NAMESPACE,
          stateRoot,
          repoRoot: stateRoot,
        }).pipe(Effect.provide(layers)),
      );

      expect(result).toMatchObject({
        phaseId: "phase-03",
        wasStopped: true,
        worktreeRemoved: true,
      });
      expect(existsSync(join(runPath, "review-stop.json"))).toBe(false);
      expect(existsSync(join(runPath, "phase-03"))).toBe(false);
    });

    it("refuses while the run lock is held, as by an enter-phase turn, and changes nothing", async () => {
      const { runPath, stopped } = await seedStoppedRun(stateRoot);
      const { fakeGit } = stopLayers(stopped);
      const lock = makeFakeLock();
      lock.impl.setStatus(`${NAMESPACE}.${SHORT_NAME}`, {
        kind: "active",
        pid: 4242,
        updatedAt: nowIso(),
      });
      const before = await snapshot(runPath);

      const result = await Effect.runPromise(
        Effect.either(
          resetPhase({
            shortName: shortName(),
            namespace: NAMESPACE,
            stateRoot,
            repoRoot: stateRoot,
          }).pipe(
            Effect.provide(
              Layer.mergeAll(
                fakeGit.layer,
                makeFakeShell().layer,
                lock.layer,
                NodeFileSystemLayer,
                NoopSystemTelemetryLayer,
              ),
            ),
          ),
        ),
      );

      expect(Either.isLeft(result) && result.left).toBeInstanceOf(LockConflictError);
      expect(await snapshot(runPath)).toEqual(before);
      expect(fakeGit.impl.calls.filter((c) => c.method === "removeWorktree")).toEqual([]);
      expect(fakeGit.impl.deletedBranches).toHaveLength(0);
    });

    it("refuses a phase before the stopped one, naming the stopped phase, and changes nothing", async () => {
      const { runPath, stopped } = await seedStoppedRun(stateRoot);
      const { layers, fakeGit } = stopLayers(stopped);
      const before = await snapshot(runPath);

      const result = await Effect.runPromise(
        Effect.either(
          resetPhase({
            shortName: shortName(),
            namespace: NAMESPACE,
            phaseId: "phase-02",
            stateRoot,
            repoRoot: stateRoot,
          }).pipe(Effect.provide(layers)),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isRight(result)) throw new Error("unreachable");
      expect(result.left).toBeInstanceOf(ResetPhaseError);
      expect((result.left as ResetPhaseError).reason).toBe("phase_not_at_stop");
      expect(result.left.message).toBe(
        'Cannot reset "phase-02" of run "my-run": the run is awaiting review at "phase-03". Reset "phase-03" first (`phax reset-phase my-run phase-03`).',
      );
      expect(await snapshot(runPath)).toEqual(before);
      expect(fakeGit.impl.deletedBranches).toHaveLength(0);
    });
  });

  it("rejects when the run does not exist", async () => {
    const fakeGit = makeFakeGit();
    const layers = Layer.mergeAll(
      fakeGit.layer,
      makeFakeShell().layer,
      makeFakeLock().layer,
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
