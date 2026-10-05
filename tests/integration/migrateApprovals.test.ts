import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findOrphanApprovalRecords } from "../../src/app/approvalRecordStore.js";
import { transitionArtifact } from "../../src/app/artifactStatus.js";
import { completeRunArtifacts } from "../../src/app/completeRunArtifacts.js";
import { MIGRATION_COMMIT_SUBJECT, migrateApprovals } from "../../src/app/migrateApprovals.js";
import { plansStalenessReport } from "../../src/app/planStaleness.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import {
  approvalRecordPathFor,
  type ApprovalMigrationResult,
} from "../../src/domain/artifact/approvalRecordFile.js";
import type { ArtifactStatus } from "../../src/domain/artifact/status.js";
import {
  ApprovalMigrationRefusedError,
  ApprovalRecordUnreadableError,
  ArtifactDirtyWriteSetError,
} from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeRootedNodeFileSystemLayer, NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { readPlanRecordFile, readSpecRecordFile } from "../../src/schemas/persisted.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

// Real-git acceptance for spec approval-record-files §8 (§5.15–§5.21):
// `phax artifact migrate-approvals` splits the old ledgers into record files
// in one commit, losing and duplicating nothing, and refuses — writing
// nothing — on every listed cause. All repositories, ledgers and records here
// are made up.

const NOW = "2026-10-05T12:00:00.000Z";
const BASELINE_A = "a".repeat(40);
const BASELINE_B = "b".repeat(40);

const PLAN_LEDGER = "docs/plans/approvals.json";
const SPEC_LEDGER = "docs/specs/approvals.json";

const PLAN_1 = "docs/plans/2610050921-alpha-feature-plan.md";
const PLAN_2 = "docs/plans/2610050922-beta-feature-plan.md";
const SPEC_1 = "docs/specs/2610050923-gamma-feature.md";
const SPEC_2 = "docs/specs/2610050924-delta-feature.md";
const SPEC_3 = "docs/specs/2610050925-epsilon-feature.md";
const GONE_PLAN = "docs/plans/2609010000-gone-plan.md";

const PLAN_ENTRIES = {
  [PLAN_1]: {
    planFingerprint: "plan1fp",
    approvedAt: NOW,
    baseline: BASELINE_A,
    sourceSpec: { path: SPEC_1, fingerprint: "spec1fp" },
  },
  [PLAN_2]: {
    planFingerprint: "plan2fp",
    approvedAt: NOW,
    baseline: BASELINE_B,
    sourceSpec: null,
  },
} as const;

const SPEC_ENTRIES = {
  [SPEC_1]: { specFingerprint: "spec1fp", approvedAt: NOW, baseline: BASELINE_A },
  [SPEC_2]: { specFingerprint: "spec2fp", approvedAt: NOW, baseline: BASELINE_B },
  [SPEC_3]: { specFingerprint: "spec3fp", approvedAt: NOW, baseline: BASELINE_A },
} as const;

type Shape = "pre-schema" | "0.17.0" | "0.18.0";

function ledgerJson(
  format: "plan-approvals" | "spec-approvals",
  shape: Shape,
  records: object,
): string {
  const head = shape === "pre-schema" ? { version: 1 } : { $schema: schemaUrl(format, shape) };
  return JSON.stringify({ ...head, records }, null, 2);
}

function planMd(status: string, sourceSpec = "null"): string {
  return `---\nstatus: ${status}\nsource-spec: ${sourceSpec}\n---\n# Some plan\n\n## Overview\n\nBody text.\n`;
}

function specMd(status: string): string {
  return `---\nstatus: ${status}\ndate: 2026-01-01\naudience: test\nscope: test\n---\n# Some spec\n\n## Overview\n\nBody text.\n`;
}

function recordOf(kind: "plan" | "spec", artifactPath: string): string {
  const path = approvalRecordPathFor(kind, artifactPath);
  if (path === null) throw new Error(`${artifactPath} has no record path`);
  return path;
}

let repoDir: string;
const extraDirs: string[] = [];

function gitIn(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, stdio: "pipe" }).toString();
}

function git(args: readonly string[]): string {
  return gitIn(repoDir, args);
}

function writeRepoFile(relPath: string, content: string): void {
  const abs = join(repoDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function readRepoFile(relPath: string): string {
  return readFileSync(join(repoDir, relPath), "utf8");
}

function repoHas(relPath: string, root: string = repoDir): boolean {
  return existsSync(join(root, relPath));
}

function commitAll(message = "chore: fixture"): void {
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message]);
}

function headSha(): string {
  return git(["rev-parse", "HEAD"]).trim();
}

function porcelain(): string {
  return git(["status", "--porcelain"]);
}

// The name-status of HEAD's commit, one "<status>\t<path>" line each, sorted.
function headNameStatus(): string[] {
  return git(["show", "--name-status", "--format=", "HEAD"])
    .split("\n")
    .filter((l) => l.length > 0)
    .toSorted();
}

function repoLayer() {
  return Layer.merge(makeRootedNodeFileSystemLayer(repoDir), NodeGitLayer);
}

function runEither<A, E>(effect: Effect.Effect<A, E, never>): Promise<Either.Either<A, E>> {
  return Effect.runPromise(Effect.either(effect));
}

function migrate() {
  return runEither(migrateApprovals({ repoRoot: repoDir }).pipe(Effect.provide(repoLayer())));
}

async function migrateOk(): Promise<ApprovalMigrationResult> {
  const result = await migrate();
  if (Either.isLeft(result)) throw new Error(`migration failed: ${result.left.message}`);
  return result.right;
}

function seedArtifacts(): void {
  writeRepoFile(PLAN_1, planMd("Approved", SPEC_1));
  writeRepoFile(PLAN_2, planMd("Approved"));
  writeRepoFile(SPEC_1, specMd("Approved"));
  writeRepoFile(SPEC_2, specMd("Approved"));
  writeRepoFile(SPEC_3, specMd("Approved"));
}

function seedLedgers(planShape: Shape, specShape: Shape): void {
  seedArtifacts();
  writeRepoFile(PLAN_LEDGER, ledgerJson("plan-approvals", planShape, PLAN_ENTRIES));
  writeRepoFile(SPEC_LEDGER, ledgerJson("spec-approvals", specShape, SPEC_ENTRIES));
  commitAll();
}

function decodedPlanRecord(artifact: string): unknown {
  const file = recordOf("plan", artifact);
  const decoded = readPlanRecordFile(file, JSON.parse(readRepoFile(file)));
  if (Either.isLeft(decoded)) throw new Error(decoded.left.message);
  return decoded.right;
}

function decodedSpecRecord(artifact: string): unknown {
  const file = recordOf("spec", artifact);
  const decoded = readSpecRecordFile(file, JSON.parse(readRepoFile(file)));
  if (Either.isLeft(decoded)) throw new Error(decoded.left.message);
  return decoded.right;
}

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "phax-migrate-approvals-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "--local", "user.email", "test@phax.test"]);
  git(["config", "--local", "user.name", "phax test"]);
  // A detached `git maintenance run --auto` can race the teardown (ENOTEMPTY).
  git(["config", "--local", "maintenance.auto", "false"]);
  git(["config", "--local", "gc.auto", "0"]);
});

afterEach(() => {
  for (const dir of extraDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
  rmSync(repoDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe("Migration splits made-up ledgers with no record lost", () => {
  const SHAPES: ReadonlyArray<readonly [Shape, Shape]> = [
    ["pre-schema", "0.18.0"],
    ["pre-schema", "pre-schema"],
    ["0.17.0", "0.17.0"],
    ["0.18.0", "0.18.0"],
  ];

  for (const [planShape, specShape] of SHAPES) {
    it(`splits a ${planShape} plan ledger and a ${specShape} spec ledger in one commit`, async () => {
      seedLedgers(planShape, specShape);
      const before = headSha();

      const result = await migrateOk();

      expect(git(["rev-parse", "HEAD~1"]).trim()).toBe(before);
      expect(git(["log", "-1", "--format=%s"]).trim()).toBe(MIGRATION_COMMIT_SUBJECT);
      expect(headNameStatus()).toEqual(
        [
          `D\t${PLAN_LEDGER}`,
          `D\t${SPEC_LEDGER}`,
          `A\t${recordOf("plan", PLAN_1)}`,
          `A\t${recordOf("plan", PLAN_2)}`,
          `A\t${recordOf("spec", SPEC_1)}`,
          `A\t${recordOf("spec", SPEC_2)}`,
          `A\t${recordOf("spec", SPEC_3)}`,
        ].toSorted(),
      );
      expect(porcelain()).toBe("");

      for (const [artifact, entry] of Object.entries(PLAN_ENTRIES)) {
        expect(decodedPlanRecord(artifact)).toEqual({ artifact, ...entry });
      }
      for (const [artifact, entry] of Object.entries(SPEC_ENTRIES)) {
        expect(decodedSpecRecord(artifact)).toEqual({ artifact, ...entry });
      }

      expect(result).toEqual({
        kind: "migrated",
        ledgers: [
          {
            ledgerPath: PLAN_LEDGER,
            recordFiles: [recordOf("plan", PLAN_1), recordOf("plan", PLAN_2)],
          },
          {
            ledgerPath: SPEC_LEDGER,
            recordFiles: [
              recordOf("spec", SPEC_1),
              recordOf("spec", SPEC_2),
              recordOf("spec", SPEC_3),
            ],
          },
        ],
        orphans: [],
        commit: { hash: headSha(), subject: MIGRATION_COMMIT_SUBJECT },
      });
    });
  }

  it("writes each record file with $schema, artifact, then the record fields", async () => {
    seedLedgers("pre-schema", "pre-schema");
    await migrateOk();
    expect(Object.keys(JSON.parse(readRepoFile(recordOf("plan", PLAN_1))))).toEqual([
      "$schema",
      "artifact",
      "planFingerprint",
      "approvedAt",
      "baseline",
      "sourceSpec",
    ]);
    expect(Object.keys(JSON.parse(readRepoFile(recordOf("spec", SPEC_1))))).toEqual([
      "$schema",
      "artifact",
      "specFingerprint",
      "approvedAt",
      "baseline",
    ]);
  });

  it("migrates a lone spec ledger, leaving the plan side untouched", async () => {
    seedArtifacts();
    writeRepoFile(SPEC_LEDGER, ledgerJson("spec-approvals", "pre-schema", SPEC_ENTRIES));
    commitAll();

    const result = await migrateOk();

    expect(headNameStatus()).toEqual(
      [
        `D\t${SPEC_LEDGER}`,
        `A\t${recordOf("spec", SPEC_1)}`,
        `A\t${recordOf("spec", SPEC_2)}`,
        `A\t${recordOf("spec", SPEC_3)}`,
      ].toSorted(),
    );
    expect(repoHas("docs/plans/approvals")).toBe(false);
    expect(result.kind === "migrated" ? result.ledgers.map((l) => l.ledgerPath) : []).toEqual([
      SPEC_LEDGER,
    ]);
  });
});

describe("Running the migration again is a no-op", () => {
  it("reports nothing to migrate on an already-migrated repository", async () => {
    seedLedgers("pre-schema", "0.18.0");
    await migrateOk();
    const migratedHead = headSha();

    expect(await migrateOk()).toEqual({ kind: "nothing-to-migrate" });
    expect(headSha()).toBe(migratedHead);
    expect(porcelain()).toBe("");
  });

  it("reports nothing to migrate on a repository that never had a ledger", async () => {
    seedArtifacts();
    commitAll();
    const before = headSha();

    expect(await migrateOk()).toEqual({ kind: "nothing-to-migrate" });
    expect(headSha()).toBe(before);
    expect(porcelain()).toBe("");
  });
});

describe("An empty ledger is deleted", () => {
  it("commits the deletion of an empty pre-schema plan ledger and creates no record file", async () => {
    seedArtifacts();
    writeRepoFile(PLAN_LEDGER, ledgerJson("plan-approvals", "pre-schema", {}));
    commitAll();
    const before = headSha();

    const result = await migrateOk();

    expect(git(["rev-parse", "HEAD~1"]).trim()).toBe(before);
    expect(headNameStatus()).toEqual([`D\t${PLAN_LEDGER}`]);
    expect(repoHas("docs/plans/approvals")).toBe(false);
    expect(porcelain()).toBe("");
    expect(result.kind === "migrated" ? result.ledgers : []).toEqual([
      { ledgerPath: PLAN_LEDGER, recordFiles: [] },
    ]);
  });
});

describe("A gone artifact's entry migrates as an orphan", () => {
  it("creates the orphan's record file, reports it, and plans status then warns about it", async () => {
    seedArtifacts();
    writeRepoFile(
      PLAN_LEDGER,
      ledgerJson("plan-approvals", "pre-schema", {
        [PLAN_2]: PLAN_ENTRIES[PLAN_2],
        [GONE_PLAN]: { ...PLAN_ENTRIES[PLAN_2], planFingerprint: "gonefp" },
      }),
    );
    commitAll();

    const result = await migrateOk();

    const orphan = { recordFile: recordOf("plan", GONE_PLAN), artifact: GONE_PLAN };
    expect(result.kind === "migrated" ? result.orphans : []).toEqual([orphan]);
    expect(headNameStatus()).toContain(`A\t${orphan.recordFile}`);
    expect(decodedPlanRecord(GONE_PLAN)).toEqual({
      artifact: GONE_PLAN,
      ...PLAN_ENTRIES[PLAN_2],
      planFingerprint: "gonefp",
    });

    const found = await runEither(
      findOrphanApprovalRecords("plan").pipe(Effect.provide(repoLayer())),
    );
    expect(found).toEqual(Either.right([orphan]));

    const { layer: backendLayer } = makeFakeBackend();
    const report = await runEither(
      plansStalenessReport({
        repoRoot: repoDir,
        stateRoot: join(repoDir, ".phax-state"),
        model: "claude-sonnet-5",
        effort: "medium",
        nowIso: NOW,
      }).pipe(Effect.provide(Layer.merge(repoLayer(), backendLayer))),
    );
    expect(Either.isRight(report) ? report.right.orphanRecords : null).toEqual([orphan]);
  });
});

describe("Migration refusals write nothing", () => {
  function expectRefusedUntouched(
    result: Either.Either<unknown, unknown>,
    before: { readonly head: string; readonly status: string },
  ): unknown {
    expect(Either.isLeft(result)).toBe(true);
    if (!Either.isLeft(result)) return undefined;
    expect(exitCodeForError(result.left)).toBe(12);
    expect(headSha()).toBe(before.head);
    expect(porcelain()).toBe(before.status);
    return result.left;
  }

  function snapshot() {
    return { head: headSha(), status: porcelain() };
  }

  it("refuses an unreadable (non-JSON) ledger", async () => {
    seedArtifacts();
    writeRepoFile(PLAN_LEDGER, "{ not json");
    writeRepoFile(SPEC_LEDGER, ledgerJson("spec-approvals", "pre-schema", SPEC_ENTRIES));
    commitAll();
    const before = snapshot();

    const err = expectRefusedUntouched(await migrate(), before);

    expect(err).toBeInstanceOf(ApprovalRecordUnreadableError);
    expect((err as ApprovalRecordUnreadableError).recordPath).toBe(PLAN_LEDGER);
    expect((err as ApprovalRecordUnreadableError).message).toMatch(
      /^docs\/plans\/approvals\.json: /,
    );
    expect(repoHas("docs/specs/approvals")).toBe(false);
  });

  it("refuses a ledger that fails to decode", async () => {
    seedArtifacts();
    writeRepoFile(SPEC_LEDGER, JSON.stringify({ version: 2, records: {} }));
    commitAll();
    const before = snapshot();

    const err = expectRefusedUntouched(await migrate(), before);

    expect(err).toBeInstanceOf(ApprovalRecordUnreadableError);
    expect((err as ApprovalRecordUnreadableError).message.startsWith(SPEC_LEDGER)).toBe(true);
  });

  it("refuses an entry keyed by an archive path", async () => {
    seedArtifacts();
    writeRepoFile(
      PLAN_LEDGER,
      ledgerJson("plan-approvals", "pre-schema", {
        ...PLAN_ENTRIES,
        "docs/plans/archive/2609010000-old-plan.md": PLAN_ENTRIES[PLAN_2],
      }),
    );
    commitAll();
    const before = snapshot();

    const err = expectRefusedUntouched(await migrate(), before);

    expect(err).toBeInstanceOf(ApprovalMigrationRefusedError);
    expect((err as ApprovalMigrationRefusedError).path).toBe(PLAN_LEDGER);
    expect((err as ApprovalMigrationRefusedError).message).toBe(
      "docs/plans/approvals.json: entry docs/plans/archive/2609010000-old-plan.md is not a live plan path — remove the entry, then rerun",
    );
    expect(repoHas("docs/plans/approvals")).toBe(false);
  });

  it("refuses a spec ledger entry keyed by a plan path", async () => {
    seedArtifacts();
    writeRepoFile(
      SPEC_LEDGER,
      ledgerJson("spec-approvals", "pre-schema", { [PLAN_1]: SPEC_ENTRIES[SPEC_1] }),
    );
    commitAll();
    const before = snapshot();

    const err = expectRefusedUntouched(await migrate(), before);

    expect((err as ApprovalMigrationRefusedError).message).toBe(
      `${SPEC_LEDGER}: entry ${PLAN_1} is not a live spec path — remove the entry, then rerun`,
    );
  });

  it("refuses a ledger with uncommitted changes", async () => {
    seedLedgers("pre-schema", "pre-schema");
    writeRepoFile(
      PLAN_LEDGER,
      ledgerJson("plan-approvals", "pre-schema", { [PLAN_2]: PLAN_ENTRIES[PLAN_2] }),
    );
    const before = snapshot();

    const err = expectRefusedUntouched(await migrate(), before);

    expect(err).toBeInstanceOf(ArtifactDirtyWriteSetError);
    expect((err as ArtifactDirtyWriteSetError).paths).toEqual([PLAN_LEDGER]);
    expect(repoHas("docs/plans/approvals")).toBe(false);
    expect(repoHas("docs/specs/approvals")).toBe(false);
  });

  it("refuses an untracked ledger", async () => {
    seedArtifacts();
    commitAll();
    writeRepoFile(SPEC_LEDGER, ledgerJson("spec-approvals", "pre-schema", SPEC_ENTRIES));
    const before = snapshot();

    const err = expectRefusedUntouched(await migrate(), before);

    expect(err).toBeInstanceOf(ArtifactDirtyWriteSetError);
    expect(repoHas(SPEC_LEDGER)).toBe(true);
  });

  it("refuses an existing target record file holding a different record", async () => {
    seedArtifacts();
    writeRepoFile(PLAN_LEDGER, ledgerJson("plan-approvals", "pre-schema", PLAN_ENTRIES));
    const target = recordOf("plan", PLAN_2);
    const existing = JSON.stringify(
      {
        $schema: schemaUrl("plan-approval-record", "0.18.0"),
        artifact: PLAN_2,
        ...PLAN_ENTRIES[PLAN_2],
        planFingerprint: "otherfp",
      },
      null,
      2,
    );
    writeRepoFile(target, existing);
    commitAll();
    const before = snapshot();

    const err = expectRefusedUntouched(await migrate(), before);

    expect(err).toBeInstanceOf(ApprovalMigrationRefusedError);
    expect((err as ApprovalMigrationRefusedError).path).toBe(target);
    expect((err as ApprovalMigrationRefusedError).message).toBe(
      `${PLAN_LEDGER}: entry ${PLAN_2} cannot migrate — ${target} already holds a different record; delete it or make it match the entry, then rerun`,
    );
    expect(readRepoFile(target)).toBe(existing);
    expect(repoHas(recordOf("plan", PLAN_1))).toBe(false);
  });

  it("refuses an existing target record file that is unreadable", async () => {
    seedArtifacts();
    writeRepoFile(SPEC_LEDGER, ledgerJson("spec-approvals", "0.18.0", SPEC_ENTRIES));
    const target = recordOf("spec", SPEC_2);
    writeRepoFile(target, "not json");
    commitAll();
    const before = snapshot();

    const err = expectRefusedUntouched(await migrate(), before);

    expect(err).toBeInstanceOf(ApprovalMigrationRefusedError);
    expect((err as ApprovalMigrationRefusedError).path).toBe(target);
    expect((err as ApprovalMigrationRefusedError).message.startsWith(SPEC_LEDGER)).toBe(true);
    expect(readRepoFile(target)).toBe("not json");
  });

  it("proceeds over an existing target holding the same record, keeping its bytes", async () => {
    seedArtifacts();
    writeRepoFile(PLAN_LEDGER, ledgerJson("plan-approvals", "pre-schema", PLAN_ENTRIES));
    const target = recordOf("plan", PLAN_1);
    // Same record, different formatting: kept as is, never rewritten.
    const existing = JSON.stringify({
      $schema: schemaUrl("plan-approval-record", "0.18.0"),
      artifact: PLAN_1,
      ...PLAN_ENTRIES[PLAN_1],
    });
    writeRepoFile(target, existing);
    commitAll();

    const result = await migrateOk();

    expect(readRepoFile(target)).toBe(existing);
    expect(headNameStatus()).toEqual(
      [`D\t${PLAN_LEDGER}`, `A\t${recordOf("plan", PLAN_2)}`].toSorted(),
    );
    expect(result.kind === "migrated" ? result.ledgers[0]?.recordFiles : []).toEqual([
      target,
      recordOf("plan", PLAN_2),
    ]);
    expect(porcelain()).toBe("");
  });
});

describe("Old formats stay readable and are never written", () => {
  const DRAFT_PLAN = "docs/plans/2610050931-zeta-feature-plan.md";
  const DRAFT_SPEC = "docs/specs/2610050932-eta-feature.md";
  const DROPPED_SPEC = "docs/specs/2610050933-theta-feature.md";

  function expectNoLedger(root: string = repoDir): void {
    expect(repoHas(PLAN_LEDGER, root)).toBe(false);
    expect(repoHas(SPEC_LEDGER, root)).toBe(false);
  }

  async function transition(path: string, target: ArtifactStatus): Promise<void> {
    const result = await runEither(
      transitionArtifact(path, target, { repoRoot: repoDir, nowIso: NOW, commit: true }).pipe(
        Effect.provide(repoLayer()),
      ),
    );
    if (Either.isLeft(result)) throw new Error(`${path} → ${target}: ${result.left.message}`);
    expectNoLedger();
  }

  it("writes no ledger through any transition or run completion after migration", async () => {
    seedLedgers("pre-schema", "0.17.0");
    writeRepoFile(DRAFT_PLAN, planMd("Draft"));
    writeRepoFile(DRAFT_SPEC, specMd("Draft"));
    writeRepoFile(DROPPED_SPEC, specMd("Draft"));
    commitAll();

    await migrateOk();
    expectNoLedger();

    await transition(DRAFT_PLAN, "Approved");
    await transition(DRAFT_PLAN, "Stale");
    await transition(DRAFT_PLAN, "Draft");
    await transition(DRAFT_PLAN, "Approved");
    await transition(DRAFT_PLAN, "Completed");
    await transition(DRAFT_SPEC, "Approved");
    await transition(DROPPED_SPEC, "Abandoned");

    const worktree = mkdtempSync(join(tmpdir(), "phax-migrate-approvals-run-"));
    extraDirs.push(worktree);
    rmSync(worktree, { recursive: true, force: true });
    git(["worktree", "add", "-q", "-b", "phax/beta-run", worktree, "main"]);
    const completion = await runEither(
      completeRunArtifacts({ worktreePath: worktree, planRepoRelPath: PLAN_2, nowIso: NOW }).pipe(
        Effect.provide(Layer.merge(NodeFileSystemLayer, NodeGitLayer)),
      ),
    );
    if (Either.isLeft(completion)) throw new Error(completion.left.message);
    expect(completion.right.transitions.length).toBeGreaterThan(0);
    expectNoLedger(worktree);
    expect(repoHas(recordOf("plan", PLAN_2), worktree)).toBe(false);

    // No commit since the migration ever touched a ledger path.
    expect(
      git(["log", "--format=%H", "--", PLAN_LEDGER, SPEC_LEDGER]).trim().split("\n"),
    ).toHaveLength(2);
  });
});
