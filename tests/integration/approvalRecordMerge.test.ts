import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ArtifactTransitionResult, transitionArtifact } from "../../src/app/artifactStatus.js";
import { completeRunArtifacts } from "../../src/app/completeRunArtifacts.js";
import { approvalRecordPathFor } from "../../src/domain/artifact/approvalRecordFile.js";
import type { ArtifactStatus } from "../../src/domain/artifact/status.js";
import { renderPlanBody } from "../../src/domain/authoring/renderPlan.js";
import { makeRootedNodeFileSystemLayer, NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { decodePlanDocument } from "../../src/schemas/planDocument.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";

// Real-git acceptance for spec approval-record-files §8: every transition
// writes or deletes only its own artifact's record file, so transitions of
// different artifacts on two branches merge without conflict. All
// repositories, artifacts and records here are made up.

const NOW = "2026-10-05T12:00:00.000Z";

const PLAN_A = "docs/plans/2610050901-alpha-feature-plan.md";
const PLAN_B = "docs/plans/2610050902-beta-feature-plan.md";
const SPEC_S1 = "docs/specs/2610050903-gamma-feature.md";
const SPEC_S2 = "docs/specs/2610050904-delta-feature.md";

function recordOf(kind: "plan" | "spec", artifactPath: string): string {
  const path = approvalRecordPathFor(kind, artifactPath);
  if (path === null) throw new Error(`${artifactPath} has no record path`);
  return path;
}

function archiveOf(artifactPath: string): string {
  const slash = artifactPath.lastIndexOf("/");
  return `${artifactPath.slice(0, slash)}/archive${artifactPath.slice(slash)}`;
}

function planMd(status: string, sourceSpec = "null"): string {
  return `---\nstatus: ${status}\nsource-spec: ${sourceSpec}\n---\n# Some plan\n\n## Overview\n\nBody text.\n`;
}

function specMd(status: string): string {
  return `---\nstatus: ${status}\ndate: 2026-01-01\naudience: test\nscope: test\n---\n# Some spec\n\n## Overview\n\nBody text.\n`;
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

function repoHas(relPath: string, root: string = repoDir): boolean {
  return existsSync(join(root, relPath));
}

function commitAll(message = "chore: fixture"): void {
  git(["add", "-A"]);
  git(["commit", "-m", message]);
}

function writePlanRecord(planPath: string, sourceSpec: string | null = null): void {
  const record = withSchemaUrl("plan-approval-record", {
    artifact: planPath,
    planFingerprint: "planfp",
    approvedAt: NOW,
    baseline: "a".repeat(40),
    sourceSpec: sourceSpec === null ? null : { path: sourceSpec, fingerprint: "specfp" },
  });
  writeRepoFile(recordOf("plan", planPath), JSON.stringify(record, null, 2));
}

function writeSpecRecord(specPath: string): void {
  const record = withSchemaUrl("spec-approval-record", {
    artifact: specPath,
    specFingerprint: "specfp",
    approvedAt: NOW,
    baseline: "a".repeat(40),
  });
  writeRepoFile(recordOf("spec", specPath), JSON.stringify(record, null, 2));
}

async function transition(
  path: string,
  target: ArtifactStatus,
  root: string = repoDir,
): Promise<ArtifactTransitionResult> {
  const layer = Layer.merge(makeRootedNodeFileSystemLayer(root), NodeGitLayer);
  const result = await Effect.runPromise(
    Effect.either(
      transitionArtifact(path, target, { repoRoot: root, nowIso: NOW, commit: true }).pipe(
        Effect.provide(layer),
      ),
    ),
  );
  if (Either.isLeft(result)) throw new Error(`transition failed: ${String(result.left)}`);
  return result.right;
}

function newBranchFromMain(branch: string): void {
  git(["checkout", "-q", "main"]);
  git(["checkout", "-q", "-b", branch]);
}

// Merges each branch into main in turn; a conflict throws from execFileSync.
function mergeIntoMain(branches: readonly string[]): void {
  git(["checkout", "-q", "main"]);
  for (const branch of branches) {
    git(["merge", "--no-ff", "--no-edit", branch]);
  }
  expect(git(["ls-files", "-u"]).trim()).toBe("");
  expect(git(["status", "--porcelain"]).trim()).toBe("");
}

// Without rename detection, so a moved artifact lists both its paths.
function changedInHead(): string[] {
  return git(["show", "--no-renames", "--name-only", "--format=", "HEAD"])
    .split("\n")
    .filter((line) => line.length > 0)
    .toSorted();
}

function trackedUnder(prefix: string): string[] {
  return git(["ls-files", "--", prefix])
    .split("\n")
    .filter((line) => line.length > 0);
}

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "phax-approval-record-merge-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "--local", "user.email", "test@phax.test"]);
  git(["config", "--local", "user.name", "phax test"]);
  // A detached `git maintenance run --auto` can race the teardown (ENOTEMPTY).
  git(["config", "--local", "maintenance.auto", "false"]);
  git(["config", "--local", "gc.auto", "0"]);
  writeRepoFile("README.md", "# fixture\n");
  commitAll();
});

afterEach(() => {
  for (const dir of extraDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
  rmSync(repoDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

const ORDERS = [
  { name: "branch one first", order: ["one", "two"] },
  { name: "branch two first", order: ["two", "one"] },
] as const;

describe("Plan transitions on two branches merge cleanly", () => {
  const VARIANTS = [
    { name: "complete", from: "Approved", target: "Completed", archived: true },
    { name: "abandon", from: "Approved", target: "Abandoned", archived: true },
    { name: "reopen", from: "Stale", target: "Draft", archived: false },
  ] as const;

  for (const variant of VARIANTS) {
    for (const { name, order } of ORDERS) {
      it(`approve A on one branch, ${variant.name} B on the other — ${name}`, async () => {
        writeRepoFile(PLAN_A, planMd("Draft"));
        writeRepoFile(PLAN_B, planMd(variant.from));
        writePlanRecord(PLAN_B);
        commitAll();

        newBranchFromMain("one");
        await transition(PLAN_A, "Approved");
        newBranchFromMain("two");
        await transition(PLAN_B, variant.target);

        mergeIntoMain(order);

        expect(repoHas(recordOf("plan", PLAN_A))).toBe(true);
        expect(readFileSync(join(repoDir, PLAN_A), "utf8")).toContain("status: Approved");
        expect(repoHas(recordOf("plan", PLAN_B))).toBe(false);
        const bPath = variant.archived ? archiveOf(PLAN_B) : PLAN_B;
        expect(readFileSync(join(repoDir, bPath), "utf8")).toContain(`status: ${variant.target}`);
        expect(trackedUnder("docs/plans/approvals/")).toEqual([recordOf("plan", PLAN_A)]);
        expect(repoHas("docs/plans/approvals.json")).toBe(false);
      });
    }
  }
});

describe("Spec transitions on two branches merge cleanly", () => {
  const VARIANTS = [
    { name: "complete", target: "Completed" },
    { name: "abandon", target: "Abandoned" },
  ] as const;

  for (const variant of VARIANTS) {
    for (const { name, order } of ORDERS) {
      it(`approve S1 on one branch, ${variant.name} S2 on the other — ${name}`, async () => {
        writeRepoFile(SPEC_S1, specMd("Draft"));
        writeRepoFile(SPEC_S2, specMd("Approved"));
        writeSpecRecord(SPEC_S2);
        commitAll();

        newBranchFromMain("one");
        await transition(SPEC_S1, "Approved");
        newBranchFromMain("two");
        await transition(SPEC_S2, variant.target);

        mergeIntoMain(order);

        expect(repoHas(recordOf("spec", SPEC_S1))).toBe(true);
        expect(repoHas(recordOf("spec", SPEC_S2))).toBe(false);
        expect(readFileSync(join(repoDir, archiveOf(SPEC_S2)), "utf8")).toContain(
          `status: ${variant.target}`,
        );
        expect(trackedUnder("docs/specs/approvals/")).toEqual([recordOf("spec", SPEC_S1)]);
        expect(repoHas("docs/specs/approvals.json")).toBe(false);
      });
    }
  }
});

describe("A run's PR merges after an approval on main", () => {
  const RUN_SPEC = "docs/specs/2610050905-epsilon-feature.md";

  // The approval on main lands either before or after the run's completion
  // commits; the run branch then merges into main.
  for (const approveFirst of [true, false]) {
    it(`merges the run branch cleanly (approval on main ${approveFirst ? "before" : "after"} completion)`, async () => {
      writeRepoFile(PLAN_A, planMd("Draft"));
      writeRepoFile(RUN_SPEC, specMd("Approved"));
      writeRepoFile(PLAN_B, planMd("Approved", RUN_SPEC));
      writePlanRecord(PLAN_B, RUN_SPEC);
      writeSpecRecord(RUN_SPEC);
      commitAll();

      const worktree = mkdtempSync(join(tmpdir(), "phax-approval-record-run-"));
      extraDirs.push(worktree);
      rmSync(worktree, { recursive: true, force: true });
      git(["worktree", "add", "-q", "-b", "phax/beta-run", worktree, "main"]);

      if (approveFirst) await transition(PLAN_A, "Approved");

      const completion = await Effect.runPromise(
        Effect.either(
          completeRunArtifacts({
            worktreePath: worktree,
            planRepoRelPath: PLAN_B,
            nowIso: NOW,
          }).pipe(Effect.provide(Layer.merge(NodeFileSystemLayer, NodeGitLayer))),
        ),
      );
      expect(Either.isRight(completion)).toBe(true);
      if (!Either.isRight(completion)) return;
      expect(completion.right.transitions.map((t) => t.kind)).toEqual(["plan", "spec"]);
      expect(repoHas(recordOf("plan", PLAN_B), worktree)).toBe(false);
      expect(repoHas(recordOf("spec", RUN_SPEC), worktree)).toBe(false);

      if (!approveFirst) await transition(PLAN_A, "Approved");

      mergeIntoMain(["phax/beta-run"]);

      expect(repoHas(recordOf("plan", PLAN_A))).toBe(true);
      expect(repoHas(recordOf("plan", PLAN_B))).toBe(false);
      expect(repoHas(recordOf("spec", RUN_SPEC))).toBe(false);
      expect(repoHas(archiveOf(PLAN_B))).toBe(true);
      expect(repoHas(archiveOf(RUN_SPEC))).toBe(true);
      expect(trackedUnder("docs/plans/approvals/")).toEqual([recordOf("plan", PLAN_A)]);
      expect(trackedUnder("docs/specs/approvals/")).toEqual([]);
    });
  }
});

describe("Complete and abandon delete the record file", () => {
  const CASES = [
    { kind: "plan", path: PLAN_B, target: "Completed" },
    { kind: "plan", path: PLAN_B, target: "Abandoned" },
    { kind: "spec", path: SPEC_S2, target: "Completed" },
    { kind: "spec", path: SPEC_S2, target: "Abandoned" },
  ] as const;

  for (const { kind, path, target } of CASES) {
    it(`${kind} → ${target} moves the artifact and deletes its record file in one commit`, async () => {
      writeRepoFile(path, kind === "plan" ? planMd("Approved") : specMd("Approved"));
      if (kind === "plan") writePlanRecord(path);
      else writeSpecRecord(path);
      commitAll();

      const result = await transition(path, target);

      expect(result.path).toBe(archiveOf(path));
      const hash = result.commit?.hash;
      expect(hash).toBeDefined();
      const diff = git(["show", "--no-renames", "--name-status", "--format=", hash as string]);
      expect(diff).toContain(`D\t${recordOf(kind, path)}`);
      expect(diff).toContain(archiveOf(path));
      expect(repoHas(recordOf(kind, path))).toBe(false);
      expect(trackedUnder(`docs/${kind}s/archive/approvals/`)).toEqual([]);
      expect(repoHas(`docs/${kind}s/archive/approvals`)).toBe(false);
      expect(git(["status", "--porcelain"]).trim()).toBe("");
    });
  }

  it("abandoning a never-approved Draft spec commits without a record file", async () => {
    writeRepoFile(SPEC_S1, specMd("Draft"));
    commitAll();

    const result = await transition(SPEC_S1, "Abandoned");

    expect(result.commit?.hash).toBeDefined();
    expect(changedInHead()).toEqual([archiveOf(SPEC_S1), SPEC_S1].toSorted());
    expect(trackedUnder("docs/specs/approvals/")).toEqual([]);
    expect(git(["status", "--porcelain"]).trim()).toBe("");
  });
});

describe("Plan approval writes its own record file", () => {
  it("the approve commit holds exactly the plan and its record file", async () => {
    writeRepoFile(PLAN_A, planMd("Draft"));
    writeRepoFile(PLAN_B, planMd("Approved"));
    writePlanRecord(PLAN_B);
    commitAll();
    const otherRecord = readFileSync(join(repoDir, recordOf("plan", PLAN_B)), "utf8");

    const result = await transition(PLAN_A, "Approved");

    expect(result.commit?.hash).toBe(git(["rev-parse", "HEAD"]).trim());
    expect(changedInHead()).toEqual([PLAN_A, recordOf("plan", PLAN_A)].toSorted());
    expect(readFileSync(join(repoDir, recordOf("plan", PLAN_B)), "utf8")).toBe(otherRecord);
    expect(git(["status", "--porcelain"]).trim()).toBe("");
  });

  it("a headless plan's approve commit holds nothing beyond the plan, its sidecar and its record file", async () => {
    const planDocument = {
      version: 1,
      kind: "plan",
      sourceSpec: null,
      run: { shortName: "alpha-feature", title: "Alpha feature", requiredCommands: [] },
      preamble: {
        summary: "One phase: the alpha command.",
        requiredCommandsNote: "No extra commands.",
        technicalArbitrations: [],
      },
      phases: [
        {
          id: "phase-01",
          title: "Alpha command",
          model: "claude-sonnet-5",
          effort: "high",
          planMarkdownAnchor: "#phase-01-alpha-command",
          plannedFilesToCreate: ["src/app/alpha.ts"],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "feat(cli): phax alpha", body: "Add `phax alpha`." },
          objective: "Ship the alpha command.",
          detailedInstructions: ["Add the use case."],
          boundaryContracts: null,
          testStrategy: "Unit.",
          implementationOrder: ["Use case"],
          excludedScope: [],
          verification: "The `standard` gate profile.",
          expectedHandoff: "The exit codes.",
        },
      ],
    };
    const decoded = decodePlanDocument(planDocument);
    if (Either.isLeft(decoded)) throw new Error("fixture plan document must decode");
    const sidecar = PLAN_A.replace(/\.md$/, ".json");
    writeRepoFile(
      PLAN_A,
      `---\nstatus: Draft\nsource-spec: null\n---\n${renderPlanBody(decoded.right)}`,
    );
    writeRepoFile(sidecar, JSON.stringify(planDocument, null, 2));
    commitAll();

    await transition(PLAN_A, "Approved");

    // The sidecar is in the write-set but the approval leaves it unchanged, so
    // git records only the plan and its record file.
    const allowed = new Set([PLAN_A, sidecar, recordOf("plan", PLAN_A)]);
    const changed = changedInHead();
    expect(changed.every((path) => allowed.has(path))).toBe(true);
    expect(changed).toContain(PLAN_A);
    expect(changed).toContain(recordOf("plan", PLAN_A));
    expect(repoHas(sidecar)).toBe(true);
    expect(git(["status", "--porcelain"]).trim()).toBe("");
  });
});
