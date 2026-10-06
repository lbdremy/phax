import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { transitionArtifact } from "../../src/app/artifactStatus.js";
import { computeStalenessForPlan } from "../../src/app/planStaleness.js";
import { approvalRecordPathFor } from "../../src/domain/artifact/approvalRecordFile.js";
import type { PlanStalenessVerdict } from "../../src/domain/artifact/lineage.js";
import type { ArtifactStatus } from "../../src/domain/artifact/status.js";
import { makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";

// Two ground-change rules over a real repository. Spec approval-record-files
// §5.22: another artifact's lifecycle writes only its own record file, so it is
// ground change for a plan only when that plan's footprint names that file.
// Plan own-approval-ground: a plan's own path and its own record file are never
// ground change, so its own approval commit never stales it. All repositories
// and artifacts here are made up.

const NOW = "2026-10-05T12:00:00.000Z";

const PLAN_P = "docs/plans/2610050911-pi-feature-plan.md";
const PLAN_Q = "docs/plans/2610050912-kappa-feature-plan.md";
const OLD_LEDGER = "docs/plans/approvals.json";

function recordOf(planPath: string): string {
  const path = approvalRecordPathFor("plan", planPath);
  if (path === null) throw new Error(`${planPath} has no record path`);
  return path;
}

function planMd(status: string): string {
  return `---\nstatus: ${status}\nsource-spec: null\n---\n# Some plan\n\n## Overview\n\nBody text.\n`;
}

let repoDir: string;

function git(args: readonly string[]): string {
  return execFileSync("git", args, { cwd: repoDir, stdio: "pipe" }).toString();
}

function writeRepoFile(relPath: string, content: string): void {
  const abs = join(repoDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function layer() {
  return Layer.merge(makeRootedNodeFileSystemLayer(repoDir), NodeGitLayer);
}

async function transition(path: string, target: ArtifactStatus): Promise<void> {
  const result = await Effect.runPromise(
    Effect.either(
      transitionArtifact(path, target, { repoRoot: repoDir, nowIso: NOW, commit: true }).pipe(
        Effect.provide(layer()),
      ),
    ),
  );
  if (Either.isLeft(result)) throw new Error(`transition failed: ${String(result.left)}`);
}

async function stalenessOfP(footprint: readonly string[]): Promise<PlanStalenessVerdict> {
  const md = readFileSync(join(repoDir, PLAN_P), "utf8");
  return Effect.runPromise(
    computeStalenessForPlan(PLAN_P, md, footprint, { repoRoot: repoDir }).pipe(
      Effect.provide(layer()),
    ),
  );
}

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "phax-approval-record-ground-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "--local", "user.email", "test@phax.test"]);
  git(["config", "--local", "user.name", "phax test"]);
  // A detached `git maintenance run --auto` can race the teardown (ENOTEMPTY).
  git(["config", "--local", "maintenance.auto", "false"]);
  git(["config", "--local", "gc.auto", "0"]);
  writeRepoFile("README.md", "# fixture\n");
  writeRepoFile(PLAN_P, planMd("Draft"));
  writeRepoFile(PLAN_Q, planMd("Draft"));
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "chore: fixture"]);
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe("Another plan's lifecycle no longer stales a plan", () => {
  it("approving and completing Q after P's approval leaves P fresh", async () => {
    await transition(PLAN_P, "Approved");
    await transition(PLAN_Q, "Approved");
    await transition(PLAN_Q, "Completed");

    // The footprint names the old shared ledger (which every approval used to
    // rewrite) and none of Q's own files.
    const verdict = await stalenessOfP([OLD_LEDGER, "src/feature/pi.ts"]);

    expect(verdict).toEqual({ kind: "fresh" });
  });

  it("is ground change when P's footprint names Q's own record file", async () => {
    const baseline = git(["rev-parse", "HEAD"]).trim();
    await transition(PLAN_P, "Approved");
    await transition(PLAN_Q, "Approved");

    const verdict = await stalenessOfP([OLD_LEDGER, recordOf(PLAN_Q)]);

    expect(verdict).toEqual({
      kind: "stale",
      evidence: [{ reason: "ground-changed", baseline, files: [recordOf(PLAN_Q)] }],
    });
  });

  // Q's record is deleted after P's baseline while P's own, near-identical
  // record is added. Git's rename detection paired the two and listed only P's
  // record, so this deletion went unseen until changedFilesSince used --no-renames.
  it("is ground change when Q, approved before P, is completed after P's approval", async () => {
    await transition(PLAN_Q, "Approved");
    const baseline = git(["rev-parse", "HEAD"]).trim();
    await transition(PLAN_P, "Approved");
    await transition(PLAN_Q, "Completed");

    const verdict = await stalenessOfP([recordOf(PLAN_Q)]);

    expect(verdict).toEqual({
      kind: "stale",
      evidence: [{ reason: "ground-changed", baseline, files: [recordOf(PLAN_Q)] }],
    });
  });
});

describe("A plan's own approval is never ground change", () => {
  const OWN_FOOTPRINT = [PLAN_P, recordOf(PLAN_P), "src/feature/pi.ts"];

  it("is fresh right after approve when the footprint names its own path and record", async () => {
    await transition(PLAN_P, "Approved");

    const verdict = await stalenessOfP(OWN_FOOTPRINT);

    expect(verdict).toEqual({ kind: "fresh" });
  });

  it("is ground change once another footprint file changes", async () => {
    const baseline = git(["rev-parse", "HEAD"]).trim();
    await transition(PLAN_P, "Approved");
    writeRepoFile("src/feature/pi.ts", "export const pi = 3;\n");
    git(["add", "src/feature/pi.ts"]);
    git(["commit", "-q", "-m", "feat: pi"]);

    const verdict = await stalenessOfP(OWN_FOOTPRINT);

    expect(verdict).toEqual({
      kind: "stale",
      evidence: [{ reason: "ground-changed", baseline, files: ["src/feature/pi.ts"] }],
    });
  });
});
