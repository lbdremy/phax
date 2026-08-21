import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { MAX_ORIENTATION_ROWS } from "../../src/app/promptGeneration.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { decodeOrientBrief } from "../../src/schemas/orientBrief.js";
import type { OrientConfig, ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { decodePhaxPlan } from "../../src/schemas/phaxPlan.js";

const HANDOFF_CONTENT = [
  "## What was delivered",
  "Phase completed successfully.",
  "## Key decisions and why",
  "No major decisions.",
  "## Exact locations (file paths and exported names)",
  "No new exports.",
  "## What the next phase needs to know",
  "Ready to proceed.",
].join("\n");

const shortName = Either.getOrThrow(decodeShortName("my-run"));

const orientRawPlan = {
  version: 1,
  run: {
    shortName: "my-run",
    title: "My Run",
    branch: "ai/my-run",
    requiredCommands: [],
  },
  phases: [
    {
      id: "phase-01",
      title: "First Phase",
      model: "claude-sonnet-4-6",
      effort: "low" as const,
      planMarkdownAnchor: "#phase-01-first",
      plannedFilesToCreate: ["src/foo.ts"],
      plannedFilesToEdit: ["src/bar.ts"],
      optionalFilesToEdit: [],
      commit: { subject: "ai(phase-01): do thing", body: "Does the thing." },
    },
  ],
} as const;

function makeConfig(root: string, orient?: OrientConfig): ResolvedConfig {
  const base: ResolvedConfig = {
    raw: {
      version: 1,
      project: { name: "test-project", type: "single-package" },
      state: { root },
      gateProfiles: { full: [{ command: "true", surface: "local", firing: "every-phase" }] },
      commands: { setup: ["true"], cleanup: ["true"] },
    },
    stateRoot: root,
    namespace: "test-project",
    repoRoot: root,
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low" as const,
    fileReconciliationMode: "report_only" as const,
    records: {
      enabled: false,
      transcript: false,
      destination: { kind: "in-repo" as const },
      autoPush: false,
    },
    security: {
      profile: "unsafe",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only", allowDomains: [] },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
  };
  return orient !== undefined ? { ...base, orient } : base;
}

function setupCommonFakes(worktreePath: string) {
  const fakeGit = makeFakeGit();
  fakeGit.impl.setRepoIsClean(true);
  fakeGit.impl.enqueueWorktreeIsClean(worktreePath, false);

  const fakeShell = makeFakeShell();
  fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
  fakeShell.impl.setResponse("git rev-parse HEAD", {
    exitCode: 0,
    stdout: "deadbeef12345678\n",
    stderr: "",
  });
  fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

  const fakeBackend = makeFakeBackend();
  fakeBackend.impl.addRunResponse({
    sessionId: "sess-01" as ClaudeSessionId,
    outputPath: "",
    finalText: "",
  });
  fakeBackend.impl.addResumeResponse({
    sessionId: "sess-01-handoff" as ClaudeSessionId,
    outputPath: "",
    finalText: "",
  });

  return { fakeGit, fakeShell, fakeBackend };
}

describe("executePlan — orient-brief.json artifact", () => {
  let stateRoot: string;
  let worktreePath: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-orient-brief-test-"));
    worktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-01");
    await mkdir(join(worktreePath, ".phax-context"), { recursive: true });
    await writeFile(join(worktreePath, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("writes the ok variant with the full row set, the row count, and how many rows the prompt wove", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(orientRawPlan));
    const config = makeConfig(stateRoot, { command: "orient-provider" });

    const { fakeGit, fakeShell, fakeBackend } = setupCommonFakes(worktreePath);
    // Return more rows than the prompt can weave, so the artifact's full row
    // set must exceed what prompt.md actually carries.
    const totalRows = MAX_ORIENTATION_ROWS + 5;
    const rows = Array.from({ length: totalRows }, (_, idx) => ({
      id: `row-${idx}`,
      title: `Watch X ${idx}`,
      severity: "warn" as const,
      trigger: "touches foo.ts",
    }));
    fakeShell.impl.setResponse("orient-provider", {
      exitCode: 0,
      stdout: JSON.stringify({ rows }),
      stderr: "",
    });

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          namespace: "test-project",
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);

    const raw = JSON.parse(
      await readFile(join(runPath, "phase-01", "orient-brief.json"), "utf8"),
    ) as unknown;
    const decoded = decodeOrientBrief(raw);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded) && decoded.right.kind === "ok") {
      expect(decoded.right.files).toEqual(["src/foo.ts", "src/bar.ts"]);
      expect(decoded.right.rows).toHaveLength(totalRows);
      expect(decoded.right.rowCount).toBe(totalRows);
      expect(decoded.right.wovenRowCount).toBe(MAX_ORIENTATION_ROWS);
    } else {
      throw new Error(`expected kind "ok", got ${JSON.stringify(decoded)}`);
    }

    const promptText = await readFile(join(runPath, "phase-01", "prompt.md"), "utf8");
    expect(promptText).toContain(`…and ${totalRows - MAX_ORIENTATION_ROWS} more not shown.`);
  });

  it("writes the failed variant and still dispatches the phase with an unchanged prompt", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(orientRawPlan));
    const config = makeConfig(stateRoot, { command: "orient-provider" });

    const { fakeGit, fakeShell, fakeBackend } = setupCommonFakes(worktreePath);
    fakeShell.impl.setResponse("orient-provider", { exitCode: 1, stdout: "", stderr: "boom" });

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          namespace: "test-project",
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    // Advisory: a provider failure never blocks dispatch.
    expect(Either.isRight(result)).toBe(true);
    expect(fakeBackend.impl.runCalls).toHaveLength(1);

    const raw = JSON.parse(
      await readFile(join(runPath, "phase-01", "orient-brief.json"), "utf8"),
    ) as unknown;
    const decoded = decodeOrientBrief(raw);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded) && decoded.right.kind === "failed") {
      expect(decoded.right.files).toEqual(["src/foo.ts", "src/bar.ts"]);
      expect(decoded.right.error.length).toBeGreaterThan(0);
    } else {
      throw new Error(`expected kind "failed", got ${JSON.stringify(decoded)}`);
    }

    const promptText = await readFile(join(runPath, "phase-01", "prompt.md"), "utf8");
    expect(promptText).not.toContain("## Orientation for this phase");
  });

  it("writes the not-configured variant when no orient block is configured", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(orientRawPlan));
    const config = makeConfig(stateRoot);

    const { fakeGit, fakeShell, fakeBackend } = setupCommonFakes(worktreePath);

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          namespace: "test-project",
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);

    const raw = JSON.parse(
      await readFile(join(runPath, "phase-01", "orient-brief.json"), "utf8"),
    ) as unknown;
    const decoded = decodeOrientBrief(raw);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(decoded.right.kind).toBe("not-configured");
    }

    const orientCalls = fakeShell.impl.calls.filter(
      (c) => c.command.join(" ") === "orient-provider",
    );
    expect(orientCalls).toHaveLength(0);
  });
});
