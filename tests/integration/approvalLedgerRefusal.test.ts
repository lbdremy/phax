import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectArtifact, transitionArtifact } from "../../src/app/artifactStatus.js";
import { completeRunArtifacts } from "../../src/app/completeRunArtifacts.js";
import { computeStalenessForPlan, plansStalenessReport } from "../../src/app/planStaleness.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import { approvalRecordPathFor } from "../../src/domain/artifact/approvalRecordFile.js";
import { ApprovalLedgerMigrationRequiredError } from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeRootedNodeFileSystemLayer, NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";

// Real-git acceptance for spec approval-record-files §8 'An old ledger refuses
// until migrated': while either old ledger is committed, every command that
// reads or writes records refuses with exit 12 before writing anything. All
// repositories, ledgers and records here are made up.

const NOW = "2026-10-05T12:00:00.000Z";

const DRAFT_PLAN = "docs/plans/2610050911-alpha-feature-plan.md";
const APPROVED_PLAN = "docs/plans/2610050912-beta-feature-plan.md";
const SPEC = "docs/specs/2610050913-gamma-feature.md";

// A made-up pre-schema ledger: its contents never matter, only its presence.
const LEDGERS = [
  {
    path: "docs/plans/approvals.json",
    content: JSON.stringify({ version: 1, records: {} }, null, 2),
  },
  {
    path: "docs/specs/approvals.json",
    content: JSON.stringify({ version: 1, records: {} }, null, 2),
  },
] as const;

function planMd(status: string, sourceSpec = "null"): string {
  const completes = sourceSpec === "null" ? "" : "completes-spec: true\n";
  return `---\nstatus: ${status}\nsource-spec: ${sourceSpec}\n${completes}---\n# Some plan\n\n## Overview\n\nBody text.\n`;
}

function specMd(status: string): string {
  return `---\nstatus: ${status}\ndate: 2026-01-01\naudience: test\nscope: test\n---\n# Some spec\n\n## Overview\n\nBody text.\n`;
}

let repoDir: string;
const extraDirs: string[] = [];

function git(args: readonly string[], cwd: string = repoDir): string {
  return execFileSync("git", args, { cwd, stdio: "pipe" }).toString();
}

function writeRepoFile(relPath: string, content: string): void {
  const abs = join(repoDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function recordOf(kind: "plan" | "spec", artifactPath: string): string {
  const path = approvalRecordPathFor(kind, artifactPath);
  if (path === null) throw new Error(`${artifactPath} has no record path`);
  return path;
}

function seedRepo(ledger: { readonly path: string; readonly content: string }): void {
  writeRepoFile(DRAFT_PLAN, planMd("Draft"));
  writeRepoFile(SPEC, specMd("Approved"));
  writeRepoFile(APPROVED_PLAN, planMd("Approved", SPEC));
  writeRepoFile(
    recordOf("plan", APPROVED_PLAN),
    JSON.stringify(
      withSchemaUrl("plan-approval-record", {
        artifact: APPROVED_PLAN,
        planFingerprint: "planfp",
        approvedAt: NOW,
        baseline: "a".repeat(40),
        sourceSpec: { path: SPEC, fingerprint: "specfp" },
      }),
      null,
      2,
    ),
  );
  writeRepoFile(
    recordOf("spec", SPEC),
    JSON.stringify(
      withSchemaUrl("spec-approval-record", {
        artifact: SPEC,
        specFingerprint: "specfp",
        approvedAt: NOW,
        baseline: "a".repeat(40),
      }),
      null,
      2,
    ),
  );
  writeRepoFile(ledger.path, ledger.content);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "chore: fixture"]);
}

function repoLayer(root: string = repoDir) {
  return Layer.merge(makeRootedNodeFileSystemLayer(root), NodeGitLayer);
}

function runEither<A, E>(effect: Effect.Effect<A, E, never>): Promise<Either.Either<A, E>> {
  return Effect.runPromise(Effect.either(effect));
}

function expectRefused(result: Either.Either<unknown, unknown>, ledgerPath: string): void {
  expect(Either.isLeft(result)).toBe(true);
  if (!Either.isLeft(result)) return;
  expect(result.left).toBeInstanceOf(ApprovalLedgerMigrationRequiredError);
  const err = result.left as ApprovalLedgerMigrationRequiredError;
  expect(err.ledgerPath).toBe(ledgerPath);
  expect(err.message).toBe(
    `${ledgerPath} is an approval ledger from an older phax — run \`phax artifact migrate-approvals\` first`,
  );
  expect(exitCodeForError(err)).toBe(12);
}

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "phax-approval-ledger-refusal-"));
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

describe("An old ledger refuses until migrated", () => {
  for (const ledger of LEDGERS) {
    describe(`with only ${ledger.path} committed`, () => {
      let head: string;

      beforeEach(() => {
        seedRepo(ledger);
        head = git(["rev-parse", "HEAD"]).trim();
      });

      function expectUntouched(root: string = repoDir): void {
        expect(git(["rev-parse", "HEAD"], root).trim()).toBe(head);
        expect(git(["status", "--porcelain"], root)).toBe("");
      }

      it("approve refuses with exit 12 and writes nothing", async () => {
        const result = await runEither(
          transitionArtifact(DRAFT_PLAN, "Approved", {
            repoRoot: repoDir,
            nowIso: NOW,
            commit: true,
          }).pipe(Effect.provide(repoLayer())),
        );
        expectRefused(result, ledger.path);
        expectUntouched();
      });

      it("complete refuses with exit 12 and writes nothing", async () => {
        const result = await runEither(
          transitionArtifact(APPROVED_PLAN, "Completed", {
            repoRoot: repoDir,
            nowIso: NOW,
            commit: true,
          }).pipe(Effect.provide(repoLayer())),
        );
        expectRefused(result, ledger.path);
        expectUntouched();
      });

      it("inspectArtifact refuses with exit 12 and writes nothing", async () => {
        const result = await runEither(inspectArtifact(SPEC).pipe(Effect.provide(repoLayer())));
        expectRefused(result, ledger.path);
        expectUntouched();
      });

      it("plansStalenessReport refuses with exit 12 without reaching the backend", async () => {
        const { impl: backendImpl, layer: backendLayer } = makeFakeBackend();
        const result = await runEither(
          plansStalenessReport({
            repoRoot: repoDir,
            stateRoot: join(repoDir, ".phax-state"),
            model: "claude-sonnet-5",
            effort: "medium",
            nowIso: NOW,
          }).pipe(Effect.provide(Layer.merge(repoLayer(), backendLayer))),
        );
        expectRefused(result, ledger.path);
        expect(backendImpl.runCalls).toHaveLength(0);
        expect(backendImpl.completeCalls).toHaveLength(0);
        expectUntouched();
      });

      it("computeStalenessForPlan (the phax run staleness gate) refuses with exit 12", async () => {
        const result = await runEither(
          computeStalenessForPlan(APPROVED_PLAN, planMd("Approved", SPEC), [], {
            repoRoot: repoDir,
          }).pipe(Effect.provide(repoLayer())),
        );
        expectRefused(result, ledger.path);
        expectUntouched();
      });

      it("run completion in a worktree refuses with exit 12 and commits nothing", async () => {
        const worktree = mkdtempSync(join(tmpdir(), "phax-approval-ledger-run-"));
        extraDirs.push(worktree);
        rmSync(worktree, { recursive: true, force: true });
        git(["worktree", "add", "-q", "-b", "phax/beta-run", worktree, "main"]);

        const result = await runEither(
          completeRunArtifacts({
            worktreePath: worktree,
            planRepoRelPath: APPROVED_PLAN,
            nowIso: NOW,
          }).pipe(Effect.provide(Layer.merge(NodeFileSystemLayer, NodeGitLayer))),
        );
        expectRefused(result, ledger.path);
        expectUntouched(worktree);
        expectUntouched();
      });
    });
  }
});
