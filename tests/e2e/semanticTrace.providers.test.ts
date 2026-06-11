/**
 * Doctrine §15 — proof-preserving iteration, per provider.
 *
 * Sibling to semanticTrace.test.ts. That test pins the trace *shape* once; this
 * one pins the trace for each routing outcome that the multi-provider e2e
 * exercises. It drives the happy path through `executePlan` with controlled
 * fakes (no real `claude`/`vibe`/`codex` binary), but feeds the REAL routing and
 * security resolution a per-provider `routing` + `providerConfig` + `securityMode`
 * so the snapshot captures which provider was selected and under which posture.
 *
 * This is the regression guard for the routing/selection layer:
 *   - codex must resolve to codex-cli/openai-gpt (a family-key mismatch silently
 *     falls back to claude-code — the bug that shipped once);
 *   - vibe must resolve to mistral-vibe in unsafe mode, and DOWNGRADE to
 *     claude-code under strict secure mode (partial filesystem jail).
 * A change to any of those alters the pinned trace and fails loudly.
 *
 * It does NOT exercise provider adapter argv (the fakes bypass the real CLIs),
 * so adapter-flag bugs (e.g. `codex exec resume` rejecting `--sandbox`) are still
 * the real e2e's job. Gate: set PHAX_E2E_RUN=1 to run.
 */

import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import type { NonEmptyArray } from "../../src/domain/routing/priorityOverride.js";
import type { ProviderId } from "../../src/domain/routing/types.js";
import type { SecurityMode } from "../../src/domain/security/types.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { ModelRouting } from "../../src/schemas/modelRouting.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { decodePhaxPlan } from "../../src/schemas/phaxPlan.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";
import { withTelemetryCapture } from "./helpers/telemetry.js";

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

const UNSTABLE_FIELD_NAMES = ["timestamp", "traceId", "spanId", "durationMs"] as const;

const shouldRun = process.env["PHAX_E2E_RUN"] === "1";

const shortName = Either.getOrThrow(decodeShortName("my-run"));

const rawPlan = {
  version: 1,
  run: { shortName: "my-run", title: "My Run", branch: "ai/my-run" },
  phases: [
    {
      id: "phase-01",
      title: "First Phase",
      model: "claude-sonnet-4-6",
      effort: "low" as const,
      planMarkdownAnchor: "#phase-01-first",
      plannedFilesToCreate: [] as const,
      plannedFilesToEdit: [] as const,
      optionalFilesToEdit: [] as const,
      commit: { subject: "ai(phase-01): do thing", body: "Does the thing." },
    },
  ],
} as const;

// Routing with a forced provider priority; claude-code stays as the terminal
// fallback so the secure-downgrade case can resolve to it.
function routingForcing(priority: NonEmptyArray<ProviderId>): ModelRouting {
  return { ...DEFAULT_MODEL_ROUTING, providerPriority: priority };
}

// Provider config with the named provider enabled (claude-code is always on as
// the terminal fallback).
function providerConfigEnabling(provider: ProviderId): ProviderConfig {
  const providers = Object.fromEntries(
    Object.entries(DEFAULT_PROVIDER_CONFIG.providers).map(([id, entry]) => [
      id,
      id === provider || id === "claude-code" ? { ...entry, enabled: true } : entry,
    ]),
  );
  return { providers };
}

interface ProviderTraceCase {
  /** Snapshot label and describe suffix. */
  readonly name: string;
  readonly providerPriority: NonEmptyArray<ProviderId>;
  readonly enable: ProviderId;
  readonly securityMode: SecurityMode;
}

const CASES: readonly ProviderTraceCase[] = [
  // claude-code, strong jail, runs natively under strict secure.
  {
    name: "claude-code-secure",
    providerPriority: ["claude-code"],
    enable: "claude-code",
    securityMode: "secure",
  },
  // codex-cli, strong jail; must resolve to codex-cli/openai-gpt (not fall back).
  {
    name: "codex-cli-secure",
    providerPriority: ["codex-cli", "claude-code"],
    enable: "codex-cli",
    securityMode: "secure",
  },
  // mistral-vibe in unsafe mode runs natively (the mode the e2e uses for vibe).
  {
    name: "mistral-vibe-unsafe",
    providerPriority: ["mistral-vibe", "claude-code"],
    enable: "mistral-vibe",
    securityMode: "unsafe",
  },
  // mistral-vibe under strict secure: partial jail can't satisfy the policy, so
  // routing skips it and downgrades to claude-code (recorded as skippedForSecurity).
  {
    name: "mistral-vibe-secure-downgrade",
    providerPriority: ["mistral-vibe", "claude-code"],
    enable: "mistral-vibe",
    securityMode: "secure",
  },
];

describe.skipIf(!shouldRun)("E2E semantic trace — per-provider snapshots", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-e2e-semantic-trace-providers-"));
    const phase01Worktree = join(stateRoot, "worktrees", "my-run", "phase-01");
    await mkdir(join(phase01Worktree, ".phax-context"), { recursive: true });
    await writeFile(join(phase01Worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  for (const testCase of CASES) {
    it(`pins the semantic trace for ${testCase.name}`, async () => {
      const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));

      const config: ResolvedConfig = {
        raw: {
          version: 1,
          project: { name: "test-project", type: "single-package" },
          state: { root: stateRoot },
          gateProfiles: { full: ["true"] },
          commands: { setup: ["true"], cleanup: ["true"] },
        },
        stateRoot,
        repoRoot: stateRoot,
        editorCommand: "echo",
        maxFixAttempts: 1,
        extractPlanModel: "claude-haiku-4-5-20251001",
        extractPlanEffort: "low" as const,
        fileReconciliationMode: "report_only" as const,

        security: {
          profile: testCase.securityMode,
          filesystem: { allowRead: [], allowWrite: [] },
          network: { profile: "provider-only", allowDomains: [] },
          mcp: { mode: "disabled", allow: [] },
        },
      };

      const phase01WorktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

      const fakeGit = makeFakeGit();
      fakeGit.impl.setRepoIsClean(true);
      fakeGit.impl.enqueueWorktreeIsClean(phase01WorktreePath, false);

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

      const telemetry = withTelemetryCapture(NoopSystemTelemetryLayer);

      const layers = Layer.mergeAll(
        fakeGit.layer,
        fakeShell.layer,
        fakeBackend.layer,
        NodeFileSystemLayer,
        telemetry.layer,
      );

      const { runPath, runId } = await Effect.runPromise(
        createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
      );

      const result = await Effect.runPromise(
        Effect.either(
          executePlan({
            shortName,
            plan,
            planMd: "# My Plan",
            config,
            gateProfileId: "full",
            allowDirty: false,
            runPath,
            runId,
            startIndex: 0,
            routing: routingForcing(testCase.providerPriority),
            providerConfig: providerConfigEnabling(testCase.enable),
            securityMode: testCase.securityMode,
          }).pipe(Effect.provide(layers)),
        ),
      );

      expect(Either.isRight(result)).toBe(true);

      const snapshot = telemetry.impl.getSemanticTraceSnapshot();

      // Guard: the projection must never leak unstable transport fields.
      const serialized = JSON.stringify(snapshot);
      for (const field of UNSTABLE_FIELD_NAMES) {
        expect(serialized, `snapshot must not contain unstable field "${field}"`).not.toContain(
          `"${field}"`,
        );
      }
      expect(serialized, "snapshot must not contain raw Unix timestamps").not.toMatch(
        /\b\d{13,}\b/,
      );

      // Pin the per-provider projection. A future routing/security change that
      // alters provider selection or posture must update this baseline with
      // --update-snapshot.
      expect(snapshot).toMatchSnapshot(`semantic-trace-${testCase.name}`);
    });
  }
});
