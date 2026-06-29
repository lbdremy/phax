import { Effect, Layer } from "effect";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prepareAdjustPlanSession } from "../../src/app/adjustPlan.ts";
import { ADJUST_PLAN_PROMPT_FILENAME } from "../../src/domain/planOverlap/adjustPrompt.js";
import { planCacheKey, EXTRACTOR_VERSION } from "../../src/domain/planCache/key.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { encodeAdjustPlanSession } from "../../src/schemas/adjustPlanSession.js";
import type { PrepareAdjustPlanSessionOpts } from "../../src/app/adjustPlan.ts";

// Paths
const stateRoot = "/fake-state";
const runPath = `${stateRoot}/runs/my-feature`;
const runKey = "my-feature";
const planPath = "docs/plans/40-foo.md";
const nowIso = "2026-06-29T10:00:00.000Z";
const cwd = "/repo/root";

// Session dir mirrors slugify(planPath)
const planSlug = planPath
  .replace(/[^a-zA-Z0-9]/g, "-")
  .replace(/-+/g, "-")
  .replace(/^-|-$/g, "");
const sessionDir = `${runPath}/adjust-plan-sessions/${planSlug}`;
const sessionRecordPath = `${sessionDir}/session.json`;
const promptPath = `${sessionDir}/${ADJUST_PLAN_PROMPT_FILENAME}`;

// Minimal valid global-file-reconciliation.json
const validReconciliation = JSON.stringify({
  files: [
    {
      path: "src/domain/foo.ts",
      plannedInPhases: ["phase-01"],
      touchedInPhases: ["phase-01"],
      expectedActions: ["create"],
      actualActions: ["added"],
      status: "matched",
      planned: true,
      unplanned: false,
      missing: false,
      extraTouch: false,
      attention: "ok",
    },
    {
      path: "src/app/bar.ts",
      plannedInPhases: ["phase-02"],
      touchedInPhases: ["phase-02"],
      expectedActions: ["edit"],
      actualActions: ["modified"],
      status: "matched",
      planned: true,
      unplanned: false,
      missing: false,
      extraTouch: false,
      attention: "ok",
    },
  ],
  unplanned: [],
  missing: [],
  attentionPoints: [],
});

// Minimal plan.md content that finalizeExtractedPlan can derive a title from
const planMdContent = `# My Plan

## phase-01 — Phase One {#phase-01-phase-one}

Some content.

### Planned files to create

- src/domain/foo.ts

### Planned files to edit

- src/app/bar.ts
`;

// A minimal ExtractedPhaxPlan that matches the plan.md
function buildMinimalExtracted() {
  return {
    version: 1 as const,
    run: {
      shortName: "foo",
      title: "My Plan",
      requiredCommands: [],
    },
    phases: [
      {
        id: "phase-01" as const,
        model: "claude-sonnet-4-6",
        effort: "medium" as const,
        planMarkdownAnchor: "phase-01-phase-one",
        plannedFilesToCreate: ["src/domain/foo.ts"],
        plannedFilesToEdit: ["src/app/bar.ts"],
        optionalFilesToEdit: [],
        commit: {
          subject: "feat: do something",
          body: "Do something useful.",
        },
      },
    ],
  };
}

function seedPlanCache(
  fs: ReturnType<typeof makeFakeFileSystem>["impl"],
  model: string,
  effort: string,
) {
  const key = planCacheKey(planMdContent, model, effort);
  const planMdSha256 = createHash("sha256").update(planMdContent).digest("hex");
  const entry = {
    version: 1 as const,
    key,
    planMdSha256,
    model,
    effort,
    extractorVersion: EXTRACTOR_VERSION,
    extractedAt: nowIso,
    extracted: buildMinimalExtracted(),
  };
  const cachePath = `${stateRoot}/cache/plans/${key}.json`;
  fs.setFile(cachePath, JSON.stringify(entry));
  fs.setFile(planPath, planMdContent);
}

function makeBaseOpts(
  overrides: Partial<PrepareAdjustPlanSessionOpts> = {},
): PrepareAdjustPlanSessionOpts {
  return {
    planPath,
    planMarkdown: planMdContent,
    runPath,
    runKey,
    provider: "claude-code",
    cwd,
    extract: { model: "claude-sonnet-4-6", effort: "medium", stateRoot },
    newSession: false,
    nowIso,
    model: "claude-opus-4-8",
    effort: "high",
    ...overrides,
  };
}

function makeLayer(
  fs: ReturnType<typeof makeFakeFileSystem>,
  backend: ReturnType<typeof makeFakeBackend>,
) {
  return Layer.mergeAll(fs.layer, backend.layer, NoopSystemTelemetryLayer);
}

describe("prepareAdjustPlanSession", () => {
  it("new session, target plan already cached: writes prompt with impact, persists record, returns mode 'new'", async () => {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();

    fs.impl.setFile(`${runPath}/global-file-reconciliation.json`, validReconciliation);
    seedPlanCache(fs.impl, "claude-sonnet-4-6", "medium");

    const result = await Effect.runPromise(
      prepareAdjustPlanSession(makeBaseOpts()).pipe(Effect.provide(makeLayer(fs, backend))),
    );

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.mode).toBe("new");

    // Claude argv: --session-id <id> --model <m> --effort <e> <prompt>
    expect(result.invocation.executable).toBe("claude");
    expect(result.invocation.args[0]).toBe("--session-id");
    expect(result.invocation.args).toContain("--model");
    expect(result.invocation.args).toContain("claude-opus-4-8");
    expect(result.invocation.args).toContain("--effort");
    expect(result.invocation.args).toContain("high");
    expect(result.invocation.cwd).toBe(cwd);

    // Backend not called (cache hit)
    expect(backend.impl.completeCalls.length).toBe(0);
    expect(backend.impl.runCalls.length).toBe(0);

    // Prompt written with landed changes and plan path
    const promptContent = fs.impl.getFile(promptPath);
    expect(promptContent).toBeDefined();
    expect(promptContent).toContain(planPath);
    expect(promptContent).toContain(runKey);
    expect(promptContent).toContain("src/domain/foo.ts"); // added file in reconciliation
    expect(promptContent).toContain("src/app/bar.ts"); // modified file in reconciliation
    // Impact block present since the target plan shares src/app/bar.ts with the landed run
    expect(promptContent).toContain("Deterministic impact");

    // Session record persisted
    const recordRaw = fs.impl.getFile(sessionRecordPath);
    expect(recordRaw).toBeDefined();
    const record = JSON.parse(recordRaw!);
    expect(record.version).toBe(1);
    expect(record.planPath).toBe(planPath);
    expect(record.landedRunKey).toBe(runKey);
    expect(record.provider).toBe("claude-code");
    expect(record.cwd).toBe(cwd);
    expect(record.createdAt).toBe(nowIso);
    expect(record.updatedAt).toBe(nowIso);
    expect(typeof record.sessionId).toBe("string");
    expect(record.sessionId.length).toBeGreaterThan(0);
  });

  it("new session, target plan unextractable: writes prompt without impact block", async () => {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();
    // No cache seeded, no plan.md in fake fs — loadOrExtractPlan will fail
    // (readText on planPath fails), so impact is omitted

    fs.impl.setFile(`${runPath}/global-file-reconciliation.json`, validReconciliation);
    // planPath is NOT seeded in fs — loadOrExtractPlan will fail gracefully

    const result = await Effect.runPromise(
      prepareAdjustPlanSession(makeBaseOpts()).pipe(Effect.provide(makeLayer(fs, backend))),
    );

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.mode).toBe("new");

    const promptContent = fs.impl.getFile(promptPath);
    expect(promptContent).toBeDefined();
    expect(promptContent).toContain(planPath);
    // Impact block NOT present
    expect(promptContent).not.toContain("Deterministic impact");

    // Session record still persisted
    expect(fs.impl.getFile(sessionRecordPath)).toBeDefined();
  });

  it("resume (no overrides): returns mode 'resume' with --resume, no --model/--effort, updatedAt refreshed", async () => {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();

    const existingRecord = encodeAdjustPlanSession({
      version: 1,
      planPath,
      landedRunKey: runKey,
      provider: "claude-code",
      sessionId: "stored-session-abc",
      cwd,
      createdAt: "2026-06-28T10:00:00.000Z",
      updatedAt: "2026-06-28T10:00:00.000Z",
    });
    fs.impl.setFile(sessionRecordPath, JSON.stringify(existingRecord));

    const result = await Effect.runPromise(
      prepareAdjustPlanSession(makeBaseOpts({ newSession: false })).pipe(
        Effect.provide(makeLayer(fs, backend)),
      ),
    );

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.mode).toBe("resume");

    expect(result.invocation.args[0]).toBe("--resume");
    expect(result.invocation.args[1]).toBe("stored-session-abc");
    expect(result.invocation.args).not.toContain("--model");
    expect(result.invocation.args).not.toContain("--effort");
    expect(result.invocation.args.length).toBe(2);
    expect(result.invocation.cwd).toBe(cwd);

    // updatedAt refreshed in the persisted record
    const updatedRaw = fs.impl.getFile(sessionRecordPath);
    const updated = JSON.parse(updatedRaw!);
    expect(updated.updatedAt).toBe(nowIso);
    expect(updated.createdAt).toBe("2026-06-28T10:00:00.000Z");
    expect(updated.sessionId).toBe("stored-session-abc");

    // Backend not called on resume
    expect(backend.impl.completeCalls.length).toBe(0);
  });

  it("missing global-file-reconciliation.json: returns kind 'refused', no record written", async () => {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();
    // No reconciliation file seeded

    const result = await Effect.runPromise(
      prepareAdjustPlanSession(makeBaseOpts({ newSession: true })).pipe(
        Effect.provide(makeLayer(fs, backend)),
      ),
    );

    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.message).toContain(runPath);
    expect(result.message).toContain("global-file-reconciliation.json");

    expect(fs.impl.getFile(sessionRecordPath)).toBeUndefined();
    expect(fs.impl.getFile(promptPath)).toBeUndefined();
  });

  it("unsupported provider for new session: returns kind 'unsupported', no record written", async () => {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();

    fs.impl.setFile(`${runPath}/global-file-reconciliation.json`, validReconciliation);

    const result = await Effect.runPromise(
      prepareAdjustPlanSession(makeBaseOpts({ provider: "codex-cli", newSession: true })).pipe(
        Effect.provide(makeLayer(fs, backend)),
      ),
    );

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.message).toMatch(/codex-cli/i);
    expect(result.message).toMatch(/does not support/i);

    // No session record or prompt leaked
    expect(fs.impl.getFile(sessionRecordPath)).toBeUndefined();
    expect(fs.impl.getFile(promptPath)).toBeUndefined();
  });
});
