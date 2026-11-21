import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Layer, Result } from "effect";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { writeRecord, RECORDS_BRANCH_NAME } from "../../src/app/writeRecord.js";
import type { WriteRecordInput } from "../../src/app/writeRecord.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import { currentSchemaUrl, readCostLedgerFile } from "../../src/schemas/persisted.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { resolveModel } from "../../src/domain/routing/resolve.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

const fakeGitHub = makeFakeGitHub();
const LAYER = Layer.mergeAll(NodeFileSystemLayer, NodeGitLayer, fakeGitHub.layer);

function git(args: readonly string[], cwd: string): string {
  return boundedOutput("git", [...args], { boundMs: GIT_BOUND_MS, cwd });
}

const RECORDS: ResolvedRecordsConfig = {
  enabled: true,
  transcript: false,
  destination: { kind: "in-repo" },
  autoPush: false,
};

describe("Vibe model ids in records and cost ledgers", () => {
  let repoDir: string;
  let phaseFolder: string;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "phax-vibe-records-repo-"));
    git(["init"], repoDir);
    disableGitAutoMaintenance(repoDir);
    git(["config", "--local", "user.email", "test@phax.test"], repoDir);
    git(["config", "--local", "user.name", "phax test"], repoDir);
    await writeFile(join(repoDir, "README.md"), "# test\n");
    git(["add", "."], repoDir);
    git(["commit", "-m", "chore: initial commit"], repoDir);
    fakeGitHub.impl.setVisibility("private");
    phaseFolder = mkdtempSync(join(tmpdir(), "phax-vibe-records-phase-"));
    await writeFile(join(phaseFolder, "prompt.md"), "p\n");
  });

  afterEach(() => {
    removeTempDir(repoDir);
    removeTempDir(phaseFolder);
  });

  function input(phaseId: string, model: string): WriteRecordInput {
    return {
      repoRoot: repoDir,
      phaseFolderPath: phaseFolder,
      runId: "run-1",
      phaseId,
      provider: "mistral-vibe",
      model,
      effort: "high",
      outcome: "committed",
      acceptance: null,
      mode: "headless",
      stop: null,
      usage: { kind: "session", sessionId: undefined },
      records: RECORDS,
      publishRemote: "origin",
    };
  }

  function readManifest(phaseId: string): Record<string, unknown> {
    const text = git(["show", `${RECORDS_BRANCH_NAME}:run-1/${phaseId}/record.json`], repoDir);
    return JSON.parse(text) as Record<string, unknown>;
  }

  it("a new Vibe phase record names mistral-medium-3.5, and a record naming the old alias reads unchanged", async () => {
    const providers = {
      providers: {
        ...DEFAULT_PROVIDER_CONFIG.providers,
        "mistral-vibe": { ...DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"]!, enabled: true },
      },
    };
    const resolved = resolveModel(
      { model: "claude-sonnet-4-6", effort: "high" },
      { ...DEFAULT_MODEL_ROUTING, providerPriority: ["mistral-vibe", "claude-code"] },
      providers,
    );
    expect(resolved.selected.provider).toBe("mistral-vibe");

    await Effect.runPromise(
      Effect.provide(writeRecord(input("phase-01", resolved.selected.concreteModel)), LAYER),
    );
    // Each phase's record commit holds that phase's tree, so read it right after.
    expect(readManifest("phase-01")["model"]).toBe("mistral-medium-3.5");

    await Effect.runPromise(
      Effect.provide(writeRecord(input("phase-02", "phax-mistral-medium-3.5-high")), LAYER),
    );
    expect(readManifest("phase-02")["model"]).toBe("phax-mistral-medium-3.5-high");
    expect(readManifest("phase-02")).toMatchObject({
      runId: "run-1",
      phaseId: "phase-02",
      provider: "mistral-vibe",
    });
  });

  it("cost ledgers keyed by the old and the new model id both decode, and their totals sum", () => {
    const ledger = (modelId: string, costUsd: number) => ({
      $schema: currentSchemaUrl("cost-ledger"),
      entries: [
        {
          role: "phase",
          phase: "phase-01",
          completeness: "complete",
          provider: "claude-code",
          sessionId: "session-1",
          models: {
            [modelId]: {
              inputTokens: 10,
              outputTokens: 5,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              costUsd,
            },
          },
          costUsd,
          agentMs: 1000,
          endedAt: "2026-11-18T10:00:00Z",
          rateLimitSamples: [],
        },
      ],
    });

    const old = readCostLedgerFile(
      "old/cost-ledger.json",
      ledger("phax-mistral-medium-3.5-high", 0.25),
    );
    const current = readCostLedgerFile("new/cost-ledger.json", ledger("mistral-medium-3.5", 0.5));
    expect(Result.isSuccess(old)).toBe(true);
    expect(Result.isSuccess(current)).toBe(true);
    if (Result.isFailure(old) || Result.isFailure(current)) return;

    const total = [old.success, current.success]
      .flatMap((l) => l.entries)
      .reduce((sum, e) => sum + e.costUsd, 0);
    expect(total).toBeCloseTo(0.75, 6);
    expect(Object.keys(old.success.entries[0]!.models)).toEqual(["phax-mistral-medium-3.5-high"]);
    expect(Object.keys(current.success.entries[0]!.models)).toEqual(["mistral-medium-3.5"]);
  });
});
