import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { artifactFingerprint, readPlanApprovalRecord } from "../../src/app/approvalRecordStore.js";
import { approvalRecordPathFor } from "../../src/domain/artifact/approvalRecordFile.js";
import { makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { isolatePhaxHome } from "../helpers/isolatePhaxHome.js";
import { phaxCall } from "../helpers/runnerCall.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Plan approval records carry a required `code` key (spec code-repository,
// ac-approve-unlinked and the reader half of ac-older-record-read). Each test
// builds a temporary repository with its own git identity, a temporary HOME and
// an isolated git configuration: no real ~/.phax or global git config is read.

const PLAN = "docs/plans/2611171555-garden-sync-plan.md";
const OPERATOR = "Ada Example";
const BASELINE = "0123456789abcdef0123456789abcdef01234567";

// A plan phax reads deterministically, bound to no spec.
function planMd(approved = ""): string {
  return `---
status: ${approved === "" ? "Draft" : "Approved"}
source-spec: null
${approved}---
# Garden sync plan

## Overview

Sync the garden.

## Required commands

- pnpm check:full

## phase-01 — Sync {#phase-01-sync}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

### Planned files to create

- (none)

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Commit subject

feat: sync the garden

### Commit body

Sync it.
`;
}

let repoDir: string;
let originalCwd: string;
let restoreGit: () => void;
let phaxHome: ReturnType<typeof isolatePhaxHome>;

function git(args: readonly string[]): string {
  return boundedOutput("git", args, { cwd: repoDir, boundMs: GIT_BOUND_MS });
}

function writeRepoFile(rel: string, content: string): void {
  const abs = join(repoDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function readRepoFile(rel: string): string {
  return readFileSync(join(repoDir, rel), "utf8");
}

function recordPath(): string {
  const path = approvalRecordPathFor("plan", PLAN);
  if (path === null) throw new Error("no record path");
  return path;
}

beforeEach(() => {
  originalCwd = process.cwd();
  restoreGit = isolateGit();
  phaxHome = isolatePhaxHome();
  repoDir = mkdtempSync(join(tmpdir(), "phax-record-code-"));
  git(["init", "-q", "-b", "main"]);
  disableGitAutoMaintenance(repoDir);
  git(["config", "--local", "user.name", OPERATOR]);
  git(["config", "--local", "user.email", "ada@example.test"]);
  writeRepoFile(PLAN, planMd());
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "seed"]);
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.unstubAllEnvs();
  phaxHome.restore();
  restoreGit();
  removeTempDir(repoDir);
});

describe("An approval writes the code key", { timeout: 30_000 }, () => {
  it("ac-approve-unlinked: a project with no code link records code: null at the current shape", async () => {
    process.chdir(repoDir);
    const { code } = await phaxCall(["artifact", "approve", PLAN, "--by", "operator"]);
    expect(code).toBe(0);

    const record = JSON.parse(readRepoFile(recordPath())) as Record<string, unknown>;
    expect(record["$schema"]).toBe(currentSchemaUrl("plan-approval-record"));
    expect(Object.keys(record)).toEqual([
      "$schema",
      "artifact",
      "planFingerprint",
      "approvedAt",
      "baseline",
      "code",
      "sourceSpec",
      "approvedBy",
    ]);
    expect(record["code"]).toBeNull();
    expect(record["artifact"]).toBe(PLAN);
    expect(record["baseline"]).toBe(git(["rev-parse", "HEAD~1"]).trim());
    expect(record["sourceSpec"]).toBeNull();
    expect(record["approvedBy"]).toEqual({ kind: "operator", name: OPERATOR });

    // The frontmatter stamp is exactly date and baseline: no code line.
    const approved = /approved:\n((?: {2}.+\n)+)/.exec(readRepoFile(PLAN))?.[1] ?? "";
    expect(
      approved
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => l.trim().split(":")[0]),
    ).toEqual(["date", "baseline"]);
  });
});

describe("Older records read as code: null", { timeout: 30_000 }, () => {
  // A record as phax 0.25.0 through 0.39.x wrote it: it names its approver and has no `code`.
  function olderRecord(release: string, withApprover: boolean): string {
    const approvedPlan = planMd("approved:\n  date: 2026-09-26\n  baseline: abc1234\n");
    writeRepoFile(PLAN, approvedPlan);
    return JSON.stringify(
      {
        $schema: schemaUrl("plan-approval-record", release),
        artifact: PLAN,
        planFingerprint: artifactFingerprint(approvedPlan),
        approvedAt: "2026-09-26T10:00:00.000Z",
        baseline: BASELINE,
        sourceSpec: null,
        ...(withApprover ? { approvedBy: { kind: "machine", grant: "roadmap-loop" } } : {}),
      },
      null,
      2,
    );
  }

  function read() {
    return Effect.runPromise(
      readPlanApprovalRecord(PLAN).pipe(Effect.provide(makeRootedNodeFileSystemLayer(repoDir))),
    );
  }

  it("ac-older-record-read: a 0.25.0 record reads with code: null and its bytes are unchanged", async () => {
    const text = olderRecord("0.25.0", true);
    writeRepoFile(recordPath(), text);

    expect(await read()).toEqual({
      artifact: PLAN,
      planFingerprint: artifactFingerprint(readRepoFile(PLAN)),
      approvedAt: "2026-09-26T10:00:00.000Z",
      baseline: BASELINE,
      code: null,
      sourceSpec: null,
      approvedBy: { kind: "machine", grant: "roadmap-loop" },
    });
    expect(readRepoFile(recordPath())).toBe(text);
  });

  it("a 0.19.0 record reads with code: null and unattributed, and its bytes are unchanged", async () => {
    const text = olderRecord("0.19.0", false);
    writeRepoFile(recordPath(), text);

    expect(await read()).toMatchObject({ code: null, approvedBy: { kind: "unattributed" } });
    expect(readRepoFile(recordPath())).toBe(text);
  });
});
