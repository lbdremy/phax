import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transitionArtifactBy } from "../../src/app/artifactStatus.js";
import { plansStalenessReport } from "../../src/app/planStaleness.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import { approvalRecordPathFor } from "../../src/domain/artifact/approvalRecordFile.js";
import type { ArtifactKind, ArtifactStatus } from "../../src/domain/artifact/status.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeTerminal } from "../../src/infra/fakes/terminal.js";
import { makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Real-git acceptance for spec artifact-decide §8 'Artifact reopen returns an
// Approved artifact to Draft' and 'Reopening a spec names its plans and leaves
// them' (§5.35–§5.37, §5.40–§5.42), without their decide steps. The
// repository, the operator and the grant are made up; the global and system
// git configs are kept out through the environment.

const NOW = "2026-10-14T09:28:11.427Z";
const OPERATOR = "Ada Lovelace";
const SPEC = "docs/specs/2609251400-plan-prune.md";
const PLAN = "docs/plans/2609261000-plan-prune-store-plan.md";
const PLAN_SIDECAR = "docs/plans/2609261000-plan-prune-store-plan.json";

function specMd(): string {
  return `---\nstatus: Draft\ndate: 2026-09-25\naudience: maintainers\nscope: plan pruning\n---\n# Plan prune\n\n## Overview\n\nPrune finished plans.\n`;
}

// A plan phax extracts deterministically, so its staleness needs no backend.
function planMd(sourceSpec: string | null): string {
  const binding =
    sourceSpec === null ? "source-spec: null" : `source-spec: ${sourceSpec}\ncompletes-spec: true`;
  return `---
status: Draft
${binding}
---
# Plan prune store

## Overview

Store the pruned plans.

## Required commands

- pnpm check:full

## phase-01 — Store {#phase-01-store}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

### Planned files to create

- (none)

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Commit subject

feat: store pruned plans

### Commit body

Store them.
`;
}

let repoDir: string;
let configDir: string;

function git(args: readonly string[]): string {
  return execFileSync("git", args, { cwd: repoDir, stdio: "pipe" }).toString();
}

function writeRepoFile(rel: string, content: string): void {
  const abs = join(repoDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function readRepoFile(rel: string): string {
  return readFileSync(join(repoDir, rel), "utf8");
}

function commitAll(message = "seed"): void {
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message]);
}

function headSha(): string {
  return git(["rev-parse", "HEAD"]).trim();
}

function porcelain(): string {
  return git(["status", "--porcelain"]);
}

function recordOf(kind: ArtifactKind, artifact: string): string {
  const path = approvalRecordPathFor(kind, artifact);
  if (path === null) throw new Error(`${artifact} has no record path`);
  return path;
}

// The paths the HEAD commit touched, with their change letter.
function headChanges(): string[] {
  return git(["show", "--name-status", "--format=", "HEAD"])
    .trim()
    .split("\n")
    .map((l) => l.replace(/\t/, " "));
}

function headBody(): string {
  return git(["log", "-1", "--format=%B"]).trim();
}

function transition(
  path: string,
  target: ArtifactStatus,
  by: string | undefined,
  stdinIsTerminal = false,
) {
  const layer = Layer.mergeAll(
    makeRootedNodeFileSystemLayer(repoDir),
    NodeGitLayer,
    makeFakeTerminal(stdinIsTerminal).layer,
  );
  return Effect.runPromise(
    Effect.either(
      transitionArtifactBy(path, target, { repoRoot: repoDir, nowIso: NOW, commit: true, by }).pipe(
        Effect.provide(layer),
      ),
    ),
  );
}

async function approve(path: string): Promise<void> {
  const result = await transition(path, "Approved", "operator");
  if (Either.isLeft(result)) throw new Error(`fixture approval failed: ${result.left.message}`);
}

function plansReport() {
  const { layer: backendLayer } = makeFakeBackend();
  return Effect.runPromise(
    plansStalenessReport({
      repoRoot: repoDir,
      stateRoot: join(configDir, "state"),
      model: "claude-sonnet-5",
      effort: "medium",
      nowIso: NOW,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(makeRootedNodeFileSystemLayer(repoDir), NodeGitLayer, backendLayer),
      ),
    ),
  );
}

// A refusal: exit 12, the message naming `expected`, nothing written, HEAD unchanged.
function expectRefusedUntouched(
  result: Either.Either<unknown, { readonly message: string }>,
  expected: string,
  before: string,
): void {
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isLeft(result)) {
    expect(exitCodeForError(result.left)).toBe(12);
    expect(result.left.message).toContain(expected);
  }
  expect(headSha()).toBe(before);
  expect(porcelain()).toBe("");
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "phax-reopen-config-"));
  // Never let git guess an identity from the account, as on a CI runner.
  writeFileSync(join(configDir, "gitconfig"), "[user]\n\tuseConfigOnly = true\n");
  vi.stubEnv("GIT_CONFIG_GLOBAL", join(configDir, "gitconfig"));
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  // The operator is named as git commits: the caller's own identity stays out.
  vi.stubEnv("GIT_COMMITTER_NAME", undefined);
  vi.stubEnv("GIT_AUTHOR_NAME", undefined);
  repoDir = mkdtempSync(join(tmpdir(), "phax-reopen-"));
  git(["init", "-q", "-b", "main"]);
  disableGitAutoMaintenance(repoDir);
  git(["config", "--local", "user.name", OPERATOR]);
  git(["config", "--local", "user.email", "ada@example.test"]);
  writeRepoFile(SPEC, specMd());
  commitAll();
});

afterEach(() => {
  vi.unstubAllEnvs();
  removeTempDir(repoDir);
  removeTempDir(configDir);
});

// Real git, several commands per test: generous under a loaded full run.
describe("Artifact reopen returns an Approved artifact to Draft", { timeout: 30_000 }, () => {
  it("an Approved spec reopened by a machine is Draft, unstamped and unrecorded, in one commit naming the machine", async () => {
    await approve(SPEC);
    expect(existsSync(join(repoDir, recordOf("spec", SPEC)))).toBe(true);

    const result = await transition(SPEC, "Draft", "machine:roadmap-loop");

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toMatchObject({
        status: "Draft",
        previousStatus: "Approved",
        reopenedBy: { kind: "machine", grant: "roadmap-loop" },
        deletedRecord: recordOf("spec", SPEC),
        boundPlans: [],
      });
    }
    const md = readRepoFile(SPEC);
    expect(md).toContain("status: Draft");
    expect(md).not.toContain("approved:");
    expect(existsSync(join(repoDir, recordOf("spec", SPEC)))).toBe(false);
    expect(headChanges().toSorted()).toEqual([`D ${recordOf("spec", SPEC)}`, `M ${SPEC}`]);
    expect(git(["log", "-1", "--format=%s"]).trim()).toBe("chore(specs): reopen plan-prune");
    expect(headBody()).toMatch(/\n\nReopened-By: machine \(roadmap-loop\)$/);
    expect(porcelain()).toBe("");
  });

  it("an Approved headless plan reopens the same way, its sidecar carried along untouched", async () => {
    writeRepoFile(PLAN, planMd(null));
    commitAll();
    await approve(PLAN);
    // Reopen carries a sidecar whatever its agreement, so any sidecar stamped
    // at the current shape marks the plan headless here (an older stamp would
    // refuse the reopen until migrate-documents has run).
    const sidecar = `${JSON.stringify({ $schema: currentSchemaUrl("plan-document"), kind: "plan" }, null, 2)}\n`;
    writeRepoFile(PLAN_SIDECAR, sidecar);
    commitAll("headless");

    const result = await transition(PLAN, "Draft", "machine:roadmap-loop");

    expect(Either.isRight(result)).toBe(true);
    expect(readRepoFile(PLAN)).not.toContain("approved:");
    expect(readRepoFile(PLAN_SIDECAR)).toBe(sidecar);
    expect(headChanges().toSorted()).toEqual([`D ${recordOf("plan", PLAN)}`, `M ${PLAN}`]);
    expect(git(["log", "-1", "--format=%s"]).trim()).toBe("chore(plans): reopen plan-prune-store");
    expect(headBody()).toMatch(/\n\nReopened-By: machine \(roadmap-loop\)$/);
    expect(porcelain()).toBe("");
  });

  it("a Draft spec's reopen exits 12, writing nothing", async () => {
    const before = headSha();
    const result = await transition(SPEC, "Draft", "machine:roadmap-loop");
    expectRefusedUntouched(result, "Draft → Draft", before);
  });

  it("a Draft spec's reopen with no terminal and no --by says it is Draft, not --by", async () => {
    const before = headSha();
    const result = await transition(SPEC, "Draft", undefined, false);
    expectRefusedUntouched(result, "Draft → Draft", before);
  });

  it.each(["Completed", "Abandoned"] as const)(
    "a %s spec's reopen exits 12, writing nothing",
    async (terminal) => {
      await approve(SPEC);
      const retired = await transition(SPEC, terminal, undefined);
      expect(Either.isRight(retired)).toBe(true);
      const archived = Either.isRight(retired) ? retired.right.path : "";

      const before = headSha();
      const result = await transition(archived, "Draft", "machine:roadmap-loop");
      expectRefusedUntouched(result, `${terminal} → Draft`, before);
    },
  );

  it("a Stale plan reopens to Draft as before, its commit naming the arbiter", async () => {
    writeRepoFile(PLAN, planMd(null));
    commitAll();
    await approve(PLAN);
    expect(Either.isRight(await transition(PLAN, "Stale", undefined))).toBe(true);

    const result = await transition(PLAN, "Draft", "operator");

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) expect(result.right.previousStatus).toBe("Stale");
    expect(readRepoFile(PLAN)).toContain("status: Draft");
    expect(readRepoFile(PLAN)).not.toContain("approved:");
    expect(existsSync(join(repoDir, recordOf("plan", PLAN)))).toBe(false);
    expect(headBody()).toMatch(/\n\nReopened-By: operator \(Ada Lovelace\)$/);
  });

  it("reopen with no terminal and no --by exits 12 naming --by, writing nothing", async () => {
    await approve(SPEC);
    const before = headSha();
    const result = await transition(SPEC, "Draft", undefined, false);
    expectRefusedUntouched(result, "--by operator", before);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("--by machine:<grant>");
      expect(result.left.message).toMatch(/^Reopen refused: /);
    }
    expect(readRepoFile(SPEC)).toContain("status: Approved");
    expect(existsSync(join(repoDir, recordOf("spec", SPEC)))).toBe(true);
  });

  it("reopen from a terminal without --by names the operator by git user.name", async () => {
    await approve(SPEC);
    const result = await transition(SPEC, "Draft", undefined, true);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.reopenedBy).toEqual({ kind: "operator", name: OPERATOR });
    }
    expect(headBody()).toMatch(/\n\nReopened-By: operator \(Ada Lovelace\)$/);
  });

  it("an operator reopen without git user.name exits 12 naming git config user.name, writing nothing", async () => {
    await approve(SPEC);
    git(["config", "--local", "--unset", "user.name"]);
    const before = headSha();
    const result = await transition(SPEC, "Draft", "operator");
    expectRefusedUntouched(result, "git config user.name", before);
  });
});

describe("Reopening a spec names its plans and leaves them", { timeout: 30_000 }, () => {
  it("names the Approved bound plan, leaves its files byte-identical, and plans status reads it fresh", async () => {
    await approve(SPEC);
    writeRepoFile(PLAN, planMd(SPEC));
    commitAll();
    await approve(PLAN);
    const planBefore = readRepoFile(PLAN);
    const planRecordBefore = readRepoFile(recordOf("plan", PLAN));
    expect((await plansReport()).report).toEqual([{ path: PLAN, result: { kind: "fresh" } }]);

    const result = await transition(SPEC, "Draft", "operator");

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.boundPlans).toEqual([{ path: PLAN, status: "Approved" }]);
    }
    expect(readRepoFile(PLAN)).toBe(planBefore);
    expect(readRepoFile(recordOf("plan", PLAN))).toBe(planRecordBefore);
    expect(headChanges().toSorted()).toEqual([`D ${recordOf("spec", SPEC)}`, `M ${SPEC}`]);
    expect(porcelain()).toBe("");
    expect((await plansReport()).report).toEqual([{ path: PLAN, result: { kind: "fresh" } }]);
  });
});
