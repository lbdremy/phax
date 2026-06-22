import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runReviewHandoff } from "../../src/cli/commands/reviewHandoff.js";
import { encodePhaseFileReconciliation } from "../../src/schemas/reconciliation.js";

interface TestOutput {
  logs: string[];
  errors: string[];
}

function makeOutput(): TestOutput & { port: Parameters<typeof runReviewHandoff>[2] } {
  const o: TestOutput = { logs: [], errors: [] };
  return {
    ...o,
    port: {
      log: (m: string) => o.logs.push(m),
      error: (m: string) => o.errors.push(m),
    },
  };
}

const SHORT_NAME = "cmd-test-run";
const RUN_ID = "cmd-test-run-1234";
const NOW = "2024-01-01T00:00:00.000Z";

function makeRunStatusJson(state: string): string {
  return JSON.stringify({
    version: 1,
    namespace: "test",
    shortName: SHORT_NAME,
    runId: RUN_ID,
    state,
    createdAt: NOW,
    updatedAt: NOW,
    phasesCount: 1,
  });
}

function makePhaseStatusJson(phaseId: string): string {
  return JSON.stringify({
    version: 1,
    phaseId,
    phaseIndex: 0,
    state: "committed",
    model: "claude-sonnet-4-6",
    effort: "low",
    branchName: `feature/${SHORT_NAME}--${phaseId}`,
    createdAt: NOW,
    updatedAt: NOW,
    worktreePath: `/fake/worktrees/${SHORT_NAME}/${phaseId}`,
    claudeSessionId: "sess-abc",
  });
}

function makePhaseReconJson(phaseId: string): string {
  return JSON.stringify(
    encodePhaseFileReconciliation({
      phaseId,
      createdAsPlanned: [],
      editedAsPlanned: [],
      missingPlannedCreate: [],
      missingPlannedEdit: [],
      unplannedCreated: [],
      unplannedEdited: [],
      optionalTouched: [],
      deletions: [],
      renames: [],
      hasDeviations: false,
    }),
  );
}

describe("runReviewHandoff command", () => {
  let repoRoot: string;
  let stateRoot: string;
  let runPath: string;
  let origCwd: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "phax-cmd-test-"));
    stateRoot = join(repoRoot, ".phax-state");
    runPath = join(stateRoot, "runs", SHORT_NAME);

    // Make a git repo so loadConfig can find a git root
    execSync("git init -q", { cwd: repoRoot });

    // Write phax.json pointing stateRoot to our temp dir
    await writeFile(
      join(repoRoot, "phax.json"),
      JSON.stringify({
        version: 1,
        name: "test",
        state: { root: stateRoot },
        gateProfiles: { fast: ["pnpm test"] },
      }),
    );

    origCwd = process.cwd();
    process.chdir(repoRoot);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    await rm(repoRoot, { recursive: true, force: true });
  });

  async function seedRun(state: string, includePhaseArtifacts = true): Promise<void> {
    const phaseDir = join(runPath, "phase-01");
    await mkdir(phaseDir, { recursive: true });

    await writeFile(join(runPath, "run-status.json"), makeRunStatusJson(state));
    await writeFile(join(phaseDir, "status.json"), makePhaseStatusJson("phase-01"));

    if (includePhaseArtifacts) {
      await writeFile(join(phaseDir, "file-reconciliation.json"), makePhaseReconJson("phase-01"));
      await writeFile(join(phaseDir, "file-reconciliation.md"), "## PHAX File Reconciliation\n");
      await writeFile(
        join(phaseDir, "phase-handoff.md"),
        [
          "## What was delivered",
          "Done.",
          "## Key decisions and why",
          "N/A",
          "## Exact locations (file paths and exported names)",
          "N/A",
          "## What the next phase needs to know",
          "Nothing.",
        ].join("\n"),
      );
    }
  }

  it("happy path: regenerates review-handoff.md idempotently for review_open run", async () => {
    await seedRun("review_open");
    const out = makeOutput();

    const exitCode1 = await runReviewHandoff(SHORT_NAME, {}, out.port);
    expect(exitCode1).toBe(0);
    expect(out.errors).toHaveLength(0);

    const content1 = await readFile(join(runPath, "review-handoff.md"), "utf8");
    expect(content1).toContain("# Run Review Handoff");
    expect(content1).toContain(SHORT_NAME);

    // Second run should produce identical output (idempotent)
    const out2 = makeOutput();
    const exitCode2 = await runReviewHandoff(SHORT_NAME, {}, out2.port);
    expect(exitCode2).toBe(0);
    const content2 = await readFile(join(runPath, "review-handoff.md"), "utf8");
    expect(content2).toBe(content1);
  });

  it("non-review_open run: returns non-zero exit with diagnostic", async () => {
    await seedRun("running");
    const out = makeOutput();

    const exitCode = await runReviewHandoff(SHORT_NAME, {}, out.port);
    expect(exitCode).toBe(1);
    expect(out.errors.some((e) => e.includes("review_open"))).toBe(true);
    expect(out.errors.some((e) => e.includes("running"))).toBe(true);
  });

  it("missing artifacts without --allow-partial: returns non-zero with diagnostic", async () => {
    await seedRun("review_open", false);
    const out = makeOutput();

    const exitCode = await runReviewHandoff(SHORT_NAME, {}, out.port);
    expect(exitCode).toBe(1);
    expect(out.errors.some((e) => e.includes("phase"))).toBe(true);
  });

  it("missing artifacts with --allow-partial: generates partial doc and exits zero", async () => {
    await seedRun("review_open", false);
    // Write only the file-reconciliation.json (required for generateGlobalReconciliation),
    // but omit file-reconciliation.md and phase-handoff.md
    await writeFile(
      join(runPath, "phase-01", "file-reconciliation.json"),
      makePhaseReconJson("phase-01"),
    );

    const out = makeOutput();
    const exitCode = await runReviewHandoff(SHORT_NAME, { allowPartial: true }, out.port);
    expect(exitCode).toBe(0);

    const content = await readFile(join(runPath, "review-handoff.md"), "utf8");
    expect(content).toContain("PARTIAL");
  });
});
