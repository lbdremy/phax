import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { recordPhaseWorktreeAndBranch } from "../../src/app/phaseStatusUpdates.js";
import type { BranchName, WorktreePath } from "../../src/domain/branded.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { PHAX_RELEASE } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

const phaseFolderPath = "/fake/runs/my-run/phase-01";
const now = new Date().toISOString();

function makePhaseStatusJson(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    $schema: schemaUrl("phase-status", PHAX_RELEASE),
    phaseId: "phase-01",
    phaseIndex: 0,
    state: "setting_up_worktree",
    model: "claude-sonnet-4-6",
    effort: "low",
    branchName: "ai/my-run--phase-01",
    base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    createdAt: now,
    updatedAt: now,
    ...extra,
  });
}

describe("recordPhaseWorktreeAndBranch", () => {
  it("persists worktreePath and branchName matching the <base>--<phaseId> pattern", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(`${phaseFolderPath}/status.json`, makePhaseStatusJson());

    const worktreePath = "/fake/worktrees/my-run/phase-01" as WorktreePath;
    const branchName = "ai/my-run--phase-01" as BranchName;

    await Effect.runPromise(
      recordPhaseWorktreeAndBranch(phaseFolderPath, worktreePath, branchName).pipe(
        Effect.provide(fakeFs.layer),
      ),
    );

    const raw = fakeFs.impl.getFile(`${phaseFolderPath}/status.json`);
    expect(raw).toBeDefined();
    const persisted = JSON.parse(raw!) as {
      worktreePath?: string;
      branchName?: string;
    };
    expect(persisted.worktreePath).toBe("/fake/worktrees/my-run/phase-01");
    expect(persisted.branchName).toBe("ai/my-run--phase-01");
    expect(persisted.branchName).toMatch(/^ai\/my-run--phase-\d{2}$/);
  });

  it("the persisted JSON round-trips through decodePhaseStatusFile with branchName present", async () => {
    const { decodePhaseStatusFile } = await import("../../src/schemas/status.js");
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(`${phaseFolderPath}/status.json`, makePhaseStatusJson());

    const worktreePath = "/fake/worktrees/my-run/phase-01" as WorktreePath;
    const branchName = "ai/my-run--phase-01" as BranchName;

    await Effect.runPromise(
      recordPhaseWorktreeAndBranch(phaseFolderPath, worktreePath, branchName).pipe(
        Effect.provide(fakeFs.layer),
      ),
    );

    const raw = fakeFs.impl.getFile(`${phaseFolderPath}/status.json`);
    const decoded = decodePhaseStatusFile(JSON.parse(raw!));
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(decoded.right.branchName).toBe("ai/my-run--phase-01");
      expect(decoded.right.worktreePath).toBe("/fake/worktrees/my-run/phase-01");
    }
  });

  it("leaves a status.json written before $schema untouched: it never noted base, so it is refused", async () => {
    const fakeFs = makeFakeFileSystem();
    const current = JSON.parse(makePhaseStatusJson()) as Record<string, unknown>;
    const { $schema: _schema, base: _base, ...preSchema } = current;
    const original = JSON.stringify({ version: 1, ...preSchema });
    fakeFs.impl.setFile(`${phaseFolderPath}/status.json`, original);

    await Effect.runPromise(
      recordPhaseWorktreeAndBranch(
        phaseFolderPath,
        "/fake/worktrees/my-run/phase-01" as WorktreePath,
        "ai/my-run--phase-01" as BranchName,
      ).pipe(Effect.provide(fakeFs.layer)),
    );

    expect(fakeFs.impl.getFile(`${phaseFolderPath}/status.json`)).toBe(original);
  });

  it("is a no-op when status.json does not exist", async () => {
    const fakeFs = makeFakeFileSystem();
    // No status.json seeded — readText will fail, effect should propagate the error
    const worktreePath = "/fake/worktrees/my-run/phase-01" as WorktreePath;
    const branchName = "ai/my-run--phase-01" as BranchName;

    const result = await Effect.runPromise(
      Effect.either(
        recordPhaseWorktreeAndBranch(phaseFolderPath, worktreePath, branchName).pipe(
          Effect.provide(fakeFs.layer),
        ),
      ),
    );
    // FsError expected when file is missing
    expect(Either.isLeft(result)).toBe(true);
  });
});
