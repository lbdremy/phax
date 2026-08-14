import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  completeRunArtifacts,
  type RunCompletionReport,
} from "../../src/app/completeRunArtifacts.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { InvalidArtifactTransitionError } from "../../src/domain/errors.js";

const LAYER = Layer.merge(NodeFileSystemLayer, NodeGitLayer);
const NOW = "2026-08-14T12:00:00.000Z";

const PLAN_PATH = "docs/plans/70-run-carry-plan.md";
const SPEC_PATH = "docs/specs/70-run-carry.md";
const PLAN_ARCHIVE = "docs/plans/archive/70-run-carry-plan.md";
const SPEC_ARCHIVE = "docs/specs/archive/70-run-carry.md";
const APPROVALS = "docs/plans/approvals.json";

function planMd(status: string, sourceSpec: string): string {
  return `---\nstatus: ${status}\nsource-spec: ${sourceSpec}\n---\n# Some plan\n\n## Overview\n\nBody text.\n`;
}

function specMd(status: string): string {
  return `---\nstatus: ${status}\ndate: 2026-01-01\naudience: test\nscope: test\n---\n# Some spec\n\n## Overview\n\nBody text.\n`;
}

function approvalsJson(planPath: string, specPath: string): string {
  return JSON.stringify(
    {
      version: 1,
      records: {
        [planPath]: {
          planFingerprint: "planfp",
          approvedAt: NOW,
          baseline: "a".repeat(40),
          sourceSpec: { path: specPath, fingerprint: "specfp" },
        },
      },
    },
    null,
    2,
  );
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

function commitAll(): void {
  git(["add", "-A"]);
  git(["commit", "-m", "chore: fixture"]);
}

function readRepoFile(relPath: string): string | undefined {
  const abs = join(repoDir, relPath);
  return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
}

function headCount(): number {
  return Number(git(["rev-list", "--count", "HEAD"]).trim());
}

function run(
  input: Parameters<typeof completeRunArtifacts>[0],
): Promise<Either.Either<RunCompletionReport, unknown>> {
  return Effect.runPromise(Effect.either(completeRunArtifacts(input).pipe(Effect.provide(LAYER))));
}

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "phax-complete-run-artifacts-"));
  git(["init"]);
  git(["config", "--local", "user.email", "test@phax.test"]);
  git(["config", "--local", "user.name", "phax test"]);
  writeRepoFile("README.md", "# fixture\n");
  commitAll();
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("completeRunArtifacts", () => {
  it("completes the plan on the branch in a path-scoped commit", async () => {
    writeRepoFile(PLAN_PATH, planMd("Approved", "null"));
    writeRepoFile(APPROVALS, approvalsJson(PLAN_PATH, SPEC_PATH));
    commitAll();

    const result = await run({ worktreePath: repoDir, planRepoRelPath: PLAN_PATH, nowIso: NOW });

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    const [plan] = result.right.transitions;
    expect(plan).toMatchObject({ kind: "plan", path: PLAN_ARCHIVE, alreadyComplete: false });
    expect(plan?.commit?.hash).toBeDefined();

    expect(readRepoFile(PLAN_ARCHIVE)).toContain("status: Completed");
    expect(readRepoFile(PLAN_PATH)).toBeUndefined();

    const diff = git(["show", "--name-status", plan?.commit?.hash as string]);
    expect(diff).toContain(PLAN_PATH);
    expect(diff).toContain(PLAN_ARCHIVE);
    expect(diff).toContain(APPROVALS);
  });

  it("rides the source spec along in a second, separate commit", async () => {
    writeRepoFile(SPEC_PATH, specMd("Approved"));
    writeRepoFile(PLAN_PATH, planMd("Approved", SPEC_PATH));
    writeRepoFile(APPROVALS, approvalsJson(PLAN_PATH, SPEC_PATH));
    commitAll();

    const result = await run({ worktreePath: repoDir, planRepoRelPath: PLAN_PATH, nowIso: NOW });

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    const { transitions, skippedSpec } = result.right;
    expect(skippedSpec).toBeUndefined();
    expect(transitions).toHaveLength(2);
    const plan = transitions.find((t) => t.kind === "plan");
    const spec = transitions.find((t) => t.kind === "spec");
    expect(spec).toMatchObject({ kind: "spec", path: SPEC_ARCHIVE, alreadyComplete: false });
    expect(readRepoFile(SPEC_ARCHIVE)).toContain("status: Completed");
    expect(readRepoFile(SPEC_PATH)).toBeUndefined();
    // Two distinct commits, plan first then spec.
    expect(plan?.commit?.hash).toBeDefined();
    expect(spec?.commit?.hash).toBeDefined();
    expect(plan?.commit?.hash).not.toBe(spec?.commit?.hash);
  });

  it("skips the spec when a sibling plan still depends on it, naming the blocker", async () => {
    const siblingPath = "docs/plans/71-sibling-plan.md";
    writeRepoFile(SPEC_PATH, specMd("Approved"));
    writeRepoFile(PLAN_PATH, planMd("Approved", SPEC_PATH));
    writeRepoFile(siblingPath, planMd("Approved", SPEC_PATH));
    writeRepoFile(APPROVALS, approvalsJson(PLAN_PATH, SPEC_PATH));
    commitAll();

    const result = await run({ worktreePath: repoDir, planRepoRelPath: PLAN_PATH, nowIso: NOW });

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    const { transitions, skippedSpec } = result.right;
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ kind: "plan", alreadyComplete: false });
    expect(skippedSpec).toEqual({
      path: SPEC_PATH,
      blockedBy: [{ path: siblingPath, status: "Approved" }],
    });
    // The spec stays put and Approved.
    expect(readRepoFile(SPEC_PATH)).toContain("status: Approved");
    expect(readRepoFile(SPEC_ARCHIVE)).toBeUndefined();
  });

  it("is idempotent: a second run creates no commit and reports both already complete", async () => {
    writeRepoFile(SPEC_PATH, specMd("Approved"));
    writeRepoFile(PLAN_PATH, planMd("Approved", SPEC_PATH));
    writeRepoFile(APPROVALS, approvalsJson(PLAN_PATH, SPEC_PATH));
    commitAll();

    const first = await run({ worktreePath: repoDir, planRepoRelPath: PLAN_PATH, nowIso: NOW });
    expect(Either.isRight(first)).toBe(true);
    const commitsAfterFirst = headCount();

    const second = await run({ worktreePath: repoDir, planRepoRelPath: PLAN_PATH, nowIso: NOW });
    expect(Either.isRight(second)).toBe(true);
    if (!Either.isRight(second)) return;
    expect(headCount()).toBe(commitsAfterFirst);
    expect(second.right.transitions).toEqual([
      { kind: "plan", path: PLAN_ARCHIVE, alreadyComplete: true },
      { kind: "spec", path: SPEC_ARCHIVE, alreadyComplete: true },
    ]);
  });

  it("fails with InvalidArtifactTransitionError and leaves no commit for an illegal plan", async () => {
    writeRepoFile(PLAN_PATH, planMd("Draft", "null"));
    writeRepoFile(APPROVALS, approvalsJson(PLAN_PATH, SPEC_PATH));
    commitAll();
    const before = headCount();

    const result = await run({ worktreePath: repoDir, planRepoRelPath: PLAN_PATH, nowIso: NOW });

    expect(Either.isLeft(result)).toBe(true);
    if (!Either.isLeft(result)) return;
    expect(result.left).toBeInstanceOf(InvalidArtifactTransitionError);
    expect(headCount()).toBe(before);
    expect(readRepoFile(PLAN_PATH)).toContain("status: Draft");
  });

  it("is a no-op with an empty report for a plan outside docs/plans/", async () => {
    const loosePath = "notes/loose-plan.md";
    writeRepoFile(loosePath, planMd("Approved", "null"));
    commitAll();
    const before = headCount();

    const result = await run({ worktreePath: repoDir, planRepoRelPath: loosePath, nowIso: NOW });

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right).toEqual({ transitions: [] });
    expect(headCount()).toBe(before);
  });

  it("lands the transition only under the worktree, leaving the test-process repo untouched", async () => {
    const probePlan = "docs/plans/98765-phax-rooting-probe-plan.md";
    const probeArchive = "docs/plans/archive/98765-phax-rooting-probe-plan.md";
    const cwdProbe = join(process.cwd(), probeArchive);
    expect(existsSync(cwdProbe)).toBe(false);

    writeRepoFile(probePlan, planMd("Approved", "null"));
    writeRepoFile(APPROVALS, approvalsJson(probePlan, SPEC_PATH));
    commitAll();

    const result = await run({ worktreePath: repoDir, planRepoRelPath: probePlan, nowIso: NOW });

    expect(Either.isRight(result)).toBe(true);
    expect(readRepoFile(probeArchive)).toContain("status: Completed");
    // The rooting kept the write inside the worktree — the process cwd never saw it.
    expect(existsSync(cwdProbe)).toBe(false);
  });
});
