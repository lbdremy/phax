import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { artifactFingerprint } from "../../src/app/approvalRecordStore.js";
import { transitionArtifactBy } from "../../src/app/artifactStatus.js";
import { plansStalenessReport } from "../../src/app/planStaleness.js";
import { runArtifactStatus } from "../../src/cli/commands/artifact.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import { approvalRecordPathFor } from "../../src/domain/artifact/approvalRecordFile.js";
import type { ArtifactKind } from "../../src/domain/artifact/status.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeTerminal } from "../../src/infra/fakes/terminal.js";
import { makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { GRANT_PATTERN } from "../../src/schemas/approvedBy.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Real-git acceptance for spec artifact-decide §8 'Approvals name their
// approver' and 'Records written before attribution read as unattributed'
// (§5.40–§5.45, §5.57). The repository, the operator and the grant are made
// up; the global and system git configs are kept out through the environment.

const NOW = "2026-10-14T09:28:11.427Z";
const OPERATOR = "Ada Lovelace";
const SPEC = "docs/specs/2609251400-plan-prune.md";
const PLAN = "docs/plans/2609261000-plan-prune-store-plan.md";

function specMd(frontmatterExtra = ""): string {
  return `---\nstatus: ${frontmatterExtra === "" ? "Draft" : "Approved"}\ndate: 2026-09-25\naudience: maintainers\nscope: plan pruning\n${frontmatterExtra}---\n# Plan prune\n\n## Overview\n\nPrune finished plans.\n`;
}

// A plan phax extracts deterministically, so its staleness needs no backend.
function planMd(frontmatterExtra = ""): string {
  return `---
status: ${frontmatterExtra === "" ? "Draft" : "Approved"}
source-spec: null
${frontmatterExtra}---
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
let originalCwd: string;

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
  git(["-c", `user.name=${OPERATOR}`, "commit", "-q", "-m", message]);
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

function approve(path: string, by: string | undefined, stdinIsTerminal: boolean) {
  const layer = Layer.mergeAll(
    makeRootedNodeFileSystemLayer(repoDir),
    NodeGitLayer,
    makeFakeTerminal(stdinIsTerminal).layer,
  );
  return Effect.runPromise(
    Effect.either(
      transitionArtifactBy(path, "Approved", {
        repoRoot: repoDir,
        nowIso: NOW,
        commit: true,
        by,
      }).pipe(Effect.provide(layer)),
    ),
  );
}

// `phax artifact status <path>` as printed, run from the repository.
async function statusLines(path: string): Promise<string[]> {
  const lines: string[] = [];
  const out = {
    log: (m: string) => lines.push(m),
    warn: (m: string) => lines.push(`WARN: ${m}`),
    error: (m: string) => lines.push(`ERROR: ${m}`),
  };
  process.chdir(repoDir);
  try {
    expect(await runArtifactStatus(path, out)).toBe(0);
  } finally {
    process.chdir(originalCwd);
  }
  return lines;
}

function approvedLine(lines: readonly string[]): string | undefined {
  return lines.find((l) => l.startsWith("Approved:"));
}

function recordJson(kind: ArtifactKind, artifact: string): Record<string, unknown> {
  return JSON.parse(readRepoFile(recordOf(kind, artifact))) as Record<string, unknown>;
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
  expect(existsSync(join(repoDir, recordOf("spec", SPEC)))).toBe(false);
  expect(existsSync(join(repoDir, recordOf("plan", PLAN)))).toBe(false);
}

beforeEach(() => {
  originalCwd = process.cwd();
  configDir = mkdtempSync(join(tmpdir(), "phax-attribution-config-"));
  writeFileSync(join(configDir, "gitconfig"), "");
  vi.stubEnv("GIT_CONFIG_GLOBAL", join(configDir, "gitconfig"));
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  repoDir = mkdtempSync(join(tmpdir(), "phax-attribution-"));
  git(["init", "-q", "-b", "main"]);
  disableGitAutoMaintenance(repoDir);
  git(["config", "--local", "user.name", OPERATOR]);
  git(["config", "--local", "user.email", "ada@example.test"]);
  writeRepoFile(SPEC, specMd());
  writeRepoFile(PLAN, planMd());
  commitAll();
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.unstubAllEnvs();
  removeTempDir(repoDir);
  removeTempDir(configDir);
});

// Real git, several commands per test: generous under a loaded full run.
describe("Approvals name their approver", { timeout: 30_000 }, () => {
  it.each([
    ["spec", SPEC],
    ["plan", PLAN],
  ] as const)(
    "a %s approved with --by machine:roadmap-loop records the machine at the current shape, and status names it",
    async (kind, path) => {
      const result = await approve(path, "machine:roadmap-loop", false);

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.approvedBy).toEqual({ kind: "machine", grant: "roadmap-loop" });
      }
      const record = recordJson(kind, path);
      expect(record["$schema"]).toBe(currentSchemaUrl(`${kind}-approval-record`));
      expect(record["approvedBy"]).toEqual({ kind: "machine", grant: "roadmap-loop" });
      expect(Object.keys(record).at(-1)).toBe("approvedBy");
      expect(git(["show", "--name-only", "--format=", "HEAD"])).toContain(recordOf(kind, path));
      expect(porcelain()).toBe("");

      expect(approvedLine(await statusLines(path))).toMatch(/ by machine \(roadmap-loop\)$/);
    },
  );

  it.each([
    ["spec", SPEC],
    ["plan", PLAN],
  ] as const)(
    "a %s approved from a terminal without --by records the operator by git user.name",
    async (kind, path) => {
      const result = await approve(path, undefined, true);

      expect(Either.isRight(result)).toBe(true);
      expect(recordJson(kind, path)["approvedBy"]).toEqual({ kind: "operator", name: OPERATOR });
      expect(approvedLine(await statusLines(path))).toMatch(/ by operator \(Ada Lovelace\)$/);
    },
  );

  it("--by operator names the operator without a terminal", async () => {
    await approve(SPEC, "operator", false);
    expect(recordJson("spec", SPEC)["approvedBy"]).toEqual({ kind: "operator", name: OPERATOR });
  });

  it.each([SPEC, PLAN])(
    "approving %s with no terminal and no --by exits 12 naming --by, writing nothing",
    async (path) => {
      const before = headSha();
      const result = await approve(path, undefined, false);
      expectRefusedUntouched(result, "--by operator", before);
      if (Either.isLeft(result)) expect(result.left.message).toContain("--by machine:<grant>");
      expect(readRepoFile(path)).toContain("status: Draft");
    },
  );

  it("a grant that is not a kebab-case slug exits 12 naming the pattern, writing nothing", async () => {
    const before = headSha();
    const result = await approve(SPEC, "machine:Roadmap Loop", true);
    expectRefusedUntouched(result, GRANT_PATTERN.source, before);
  });

  it.each([
    ["--by operator", "operator", false],
    ["the terminal default", undefined, true],
  ] as const)(
    "%s without a git user.name exits 12 naming git config user.name, writing nothing",
    async (_label, by, stdinIsTerminal) => {
      git(["config", "--local", "--unset", "user.name"]);
      const before = headSha();
      const result = await approve(SPEC, by, stdinIsTerminal);
      expectRefusedUntouched(result, "git config user.name", before);
    },
  );

  it("a machine approval needs no git user.name", async () => {
    git(["config", "--local", "--unset", "user.name"]);
    const result = await approve(SPEC, "machine:roadmap-loop", false);
    expect(Either.isRight(result)).toBe(true);
  });
});

describe("Records written before attribution read as unattributed", { timeout: 30_000 }, () => {
  // Hand-built 0.19.0 record files, with no approvedBy, approving the
  // artifacts as they stand.
  function seedOlderRecords(): { readonly spec: string; readonly plan: string } {
    const baseline = headSha();
    const stamp = `approved:\n  date: 2026-09-25\n  baseline: ${baseline.slice(0, 7)}\n`;
    const approvedSpec = specMd(stamp);
    const approvedPlan = planMd(stamp);
    writeRepoFile(SPEC, approvedSpec);
    writeRepoFile(PLAN, approvedPlan);
    const spec = JSON.stringify(
      {
        $schema: schemaUrl("spec-approval-record", "0.19.0"),
        artifact: SPEC,
        specFingerprint: artifactFingerprint(approvedSpec),
        approvedAt: "2026-09-25T09:28:11.427Z",
        baseline,
      },
      null,
      2,
    );
    const plan = JSON.stringify(
      {
        $schema: schemaUrl("plan-approval-record", "0.19.0"),
        artifact: PLAN,
        planFingerprint: artifactFingerprint(approvedPlan),
        approvedAt: "2026-09-26T10:00:00.000Z",
        baseline,
        sourceSpec: null,
      },
      null,
      2,
    );
    writeRepoFile(recordOf("spec", SPEC), spec);
    writeRepoFile(recordOf("plan", PLAN), plan);
    commitAll("approve before attribution");
    return { spec, plan };
  }

  it("status prints both approvals as unattributed, never as the operator", async () => {
    seedOlderRecords();

    for (const path of [SPEC, PLAN]) {
      const lines = await statusLines(path);
      expect(approvedLine(lines)).toMatch(/^Approved: {10}2026-09-25 @ [0-9a-f]{7} unattributed$/);
      expect(lines.join("\n")).not.toContain("operator");
      expect(lines).toContain("Edited since:      no");
    }
  });

  it("plans status computes the plan's staleness as before: fresh, then stale once edited", async () => {
    seedOlderRecords();
    const { layer: backendLayer, impl: backendImpl } = makeFakeBackend();
    const report = () =>
      Effect.runPromise(
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

    expect((await report()).report).toEqual([{ path: PLAN, result: { kind: "fresh" } }]);

    writeRepoFile(PLAN, readRepoFile(PLAN).replace("Store them.", "Store them all."));
    expect((await report()).report).toEqual([
      { path: PLAN, result: { kind: "stale", evidence: [{ reason: "self-changed" }] } },
    ]);
    expect(backendImpl.runCalls).toHaveLength(0);
    expect(backendImpl.completeCalls).toHaveLength(0);
  });

  it("leaves both 0.19.0 files byte-identical after every read", async () => {
    const { spec, plan } = seedOlderRecords();
    const head = headSha();

    await statusLines(SPEC);
    await statusLines(PLAN);
    const { layer: backendLayer } = makeFakeBackend();
    await Effect.runPromise(
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

    expect(readRepoFile(recordOf("spec", SPEC))).toBe(spec);
    expect(readRepoFile(recordOf("plan", PLAN))).toBe(plan);
    expect(headSha()).toBe(head);
    expect(porcelain()).toBe("");
  });

  it("re-approving rewrites the 0.19.0 record at the current shape with the new approver", async () => {
    seedOlderRecords();

    const result = await approve(SPEC, "machine:roadmap-loop", false);

    expect(Either.isRight(result)).toBe(true);
    const record = recordJson("spec", SPEC);
    expect(record["$schema"]).toBe(currentSchemaUrl("spec-approval-record"));
    expect(record["approvedBy"]).toEqual({ kind: "machine", grant: "roadmap-loop" });
  });
});
