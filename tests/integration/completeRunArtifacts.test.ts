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
import { approvalRecordPathFor } from "../../src/domain/artifact/approvalRecordFile.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";

const LAYER = Layer.merge(NodeFileSystemLayer, NodeGitLayer);
const NOW = "2026-08-14T12:00:00.000Z";

const PLAN_PATH = "docs/plans/2609101270-run-carry-plan.md";
const SPEC_PATH = "docs/specs/2609101270-run-carry.md";
const PLAN_ARCHIVE = "docs/plans/archive/2609101270-run-carry-plan.md";
const SPEC_ARCHIVE = "docs/specs/archive/2609101270-run-carry.md";
const PLAN_RECORD = "docs/plans/approvals/2609101270-run-carry-plan.json";
const SPEC_RECORD = "docs/specs/approvals/2609101270-run-carry.json";

function planMd(status: string, sourceSpec: string): string {
  const completes = sourceSpec === "null" ? "" : "completes-spec: true\n";
  return `---\nstatus: ${status}\nsource-spec: ${sourceSpec}\n${completes}---\n# Some plan\n\n## Overview\n\nBody text.\n`;
}

function specMd(status: string): string {
  return `---\nstatus: ${status}\ndate: 2026-01-01\naudience: test\nscope: test\n---\n# Some spec\n\n## Overview\n\nBody text.\n`;
}

function ownRecordPath(kind: "plan" | "spec", artifactPath: string): string {
  const path = approvalRecordPathFor(kind, artifactPath);
  if (path === null) throw new Error(`${artifactPath} has no record path`);
  return path;
}

// Writes the plan's own approval record file.
function writePlanRecord(planPath: string, specPath: string): void {
  const record = withSchemaUrl("plan-approval-record", {
    artifact: planPath,
    planFingerprint: "planfp",
    approvedAt: NOW,
    baseline: "a".repeat(40),
    sourceSpec: { path: specPath, fingerprint: "specfp" },
  });
  writeRepoFile(ownRecordPath("plan", planPath), JSON.stringify(record, null, 2));
}

// Writes the spec's own approval record file.
function writeSpecRecord(specPath: string): void {
  const record = withSchemaUrl("spec-approval-record", {
    artifact: specPath,
    specFingerprint: "specfp",
    approvedAt: NOW,
    baseline: "a".repeat(40),
  });
  writeRepoFile(ownRecordPath("spec", specPath), JSON.stringify(record, null, 2));
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
  // `git commit` otherwise spawns a detached `git maintenance run --auto`,
  // which can still be writing into .git when afterEach removes the tree —
  // the teardown then fails with ENOTEMPTY.
  git(["config", "--local", "maintenance.auto", "false"]);
  git(["config", "--local", "gc.auto", "0"]);
  writeRepoFile("README.md", "# fixture\n");
  commitAll();
});

afterEach(() => {
  // Retries cover any other late writer: rmSync does not retry by default, so
  // a single racing entry is enough to fail the whole removal.
  rmSync(repoDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe("completeRunArtifacts", () => {
  it("completes the plan on the branch in a path-scoped commit", async () => {
    writeRepoFile(PLAN_PATH, planMd("Approved", "null"));
    writePlanRecord(PLAN_PATH, SPEC_PATH);
    commitAll();

    const result = await run({ worktreePath: repoDir, planRepoRelPath: PLAN_PATH, nowIso: NOW });

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    const [plan] = result.right.transitions;
    expect(plan).toMatchObject({ kind: "plan", path: PLAN_ARCHIVE, alreadyComplete: false });
    expect(plan?.commit?.hash).toBeDefined();

    expect(readRepoFile(PLAN_ARCHIVE)).toContain("status: Completed");
    expect(readRepoFile(PLAN_PATH)).toBeUndefined();
    expect(readRepoFile(PLAN_RECORD)).toBeUndefined();

    const diff = git(["show", "--name-status", plan?.commit?.hash as string]);
    expect(diff).toContain(PLAN_PATH);
    expect(diff).toContain(PLAN_ARCHIVE);
    expect(diff).toContain(`D\t${PLAN_RECORD}`);
    expect(diff).not.toContain("approvals.json");
    expect(git(["status", "--porcelain"]).trim()).toBe("");
  });

  it("completes a plan that has no record file", async () => {
    writeRepoFile(PLAN_PATH, planMd("Approved", "null"));
    commitAll();

    const result = await run({ worktreePath: repoDir, planRepoRelPath: PLAN_PATH, nowIso: NOW });

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right.transitions[0]?.commit?.hash).toBeDefined();
    expect(readRepoFile(PLAN_ARCHIVE)).toContain("status: Completed");
    expect(git(["status", "--porcelain"]).trim()).toBe("");
  });

  it("carries a headless plan's JSON sidecar into archive/ in the same commit", async () => {
    const sidecar = "docs/plans/2609101270-run-carry-plan.json";
    const archivedSidecar = "docs/plans/archive/2609101270-run-carry-plan.json";
    writeRepoFile(PLAN_PATH, planMd("Approved", "null"));
    writeRepoFile(sidecar, "{}\n");
    writePlanRecord(PLAN_PATH, SPEC_PATH);
    commitAll();

    const result = await run({ worktreePath: repoDir, planRepoRelPath: PLAN_PATH, nowIso: NOW });

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    const [plan] = result.right.transitions;
    expect(readRepoFile(archivedSidecar)).toBe("{}\n");
    expect(readRepoFile(sidecar)).toBeUndefined();
    const diff = git(["show", "--name-status", plan?.commit?.hash as string]);
    expect(diff).toContain(sidecar);
    expect(diff).toContain(archivedSidecar);
    expect(git(["status", "--porcelain"]).trim()).toBe("");
  });

  it("rides the source spec along in a second, separate commit", async () => {
    writeRepoFile(SPEC_PATH, specMd("Approved"));
    writeRepoFile(PLAN_PATH, planMd("Approved", SPEC_PATH));
    writePlanRecord(PLAN_PATH, SPEC_PATH);
    writeSpecRecord(SPEC_PATH);
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
    // Each commit deletes only its own artifact's record file.
    const planDiff = git(["show", "--name-status", plan?.commit?.hash as string]);
    const specDiff = git(["show", "--name-status", spec?.commit?.hash as string]);
    expect(planDiff).toContain(`D\t${PLAN_RECORD}`);
    expect(planDiff).not.toContain(SPEC_RECORD);
    expect(specDiff).toContain(`D\t${SPEC_RECORD}`);
    expect(specDiff).not.toContain(PLAN_RECORD);
    expect(git(["status", "--porcelain"]).trim()).toBe("");
  });

  it("skips the spec when a sibling plan still depends on it, naming the blocker", async () => {
    const siblingPath = "docs/plans/2609101271-sibling-plan.md";
    writeRepoFile(SPEC_PATH, specMd("Approved"));
    writeRepoFile(PLAN_PATH, planMd("Approved", SPEC_PATH));
    writeRepoFile(siblingPath, planMd("Approved", SPEC_PATH));
    writePlanRecord(PLAN_PATH, SPEC_PATH);
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
    writePlanRecord(PLAN_PATH, SPEC_PATH);
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
    writePlanRecord(PLAN_PATH, SPEC_PATH);
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
    const probePlan = "docs/plans/2609109876-phax-rooting-probe-plan.md";
    const probeArchive = "docs/plans/archive/2609109876-phax-rooting-probe-plan.md";
    const cwdProbe = join(process.cwd(), probeArchive);
    expect(existsSync(cwdProbe)).toBe(false);

    writeRepoFile(probePlan, planMd("Approved", "null"));
    writePlanRecord(probePlan, SPEC_PATH);
    commitAll();

    const result = await run({ worktreePath: repoDir, planRepoRelPath: probePlan, nowIso: NOW });

    expect(Either.isRight(result)).toBe(true);
    expect(readRepoFile(probeArchive)).toContain("status: Completed");
    // The rooting kept the write inside the worktree — the process cwd never saw it.
    expect(existsSync(cwdProbe)).toBe(false);
  });
});
