import { Either } from "effect";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inferLegacyBinding } from "../../src/app/inferLegacyBinding.js";
import { readAgentBinding } from "../../src/app/agentBinding.js";

const validResolution = {
  requested: { model: "claude-sonnet-4-6", family: "claude-sonnet", effort: "medium" },
  normalizedTier: "standard",
  selected: {
    provider: "claude-code",
    family: "claude-sonnet",
    thinking: "medium",
    concreteModel: "claude-sonnet-4-6",
  },
  relationship: "exact",
  reason: "test fixture",
};

const validStatus = {
  version: 1,
  phaseId: "phase-01",
  phaseIndex: 0,
  state: "review_open",
  model: "claude-sonnet-4-6",
  effort: "medium",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T01:00:00.000Z",
  branchName: "phax/test-run--phase-01",
  worktreePath: "/tmp/worktree/phase-01",
  claudeSessionId: "sess-legacy-abc",
};

const context = { shortName: "test-run", runId: "run-abc", phaseName: "Test Phase" };

describe("inferLegacyBinding — success cases", () => {
  let phaseFolder: string;

  beforeEach(async () => {
    phaseFolder = join(tmpdir(), `phax-infer-test-${Date.now()}`);
    await mkdir(phaseFolder, { recursive: true });
  });

  afterEach(async () => {
    await rm(phaseFolder, { recursive: true, force: true });
  });

  it("infers a valid binding from model-resolution.json + status.json", async () => {
    await writeFile(
      join(phaseFolder, "model-resolution.json"),
      JSON.stringify(validResolution),
      "utf8",
    );
    await writeFile(join(phaseFolder, "status.json"), JSON.stringify(validStatus), "utf8");

    const result = await inferLegacyBinding(phaseFolder, context);

    expect(Either.isRight(result)).toBe(true);
  });

  it("inferred binding has lockSource legacy_inferred", async () => {
    await writeFile(
      join(phaseFolder, "model-resolution.json"),
      JSON.stringify(validResolution),
      "utf8",
    );
    await writeFile(join(phaseFolder, "status.json"), JSON.stringify(validStatus), "utf8");

    const result = await inferLegacyBinding(phaseFolder, context);
    if (Either.isRight(result)) {
      expect(result.right.lockSource).toBe("legacy_inferred");
    }
  });

  it("inferred binding has correct provider, model, adapter", async () => {
    await writeFile(
      join(phaseFolder, "model-resolution.json"),
      JSON.stringify(validResolution),
      "utf8",
    );
    await writeFile(join(phaseFolder, "status.json"), JSON.stringify(validStatus), "utf8");

    const result = await inferLegacyBinding(phaseFolder, context);
    if (Either.isRight(result)) {
      expect(result.right.provider).toBe("claude-code");
      expect(result.right.model).toBe("claude-sonnet-4-6");
      expect(result.right.adapter).toBe("claude");
    }
  });

  it("inferred binding carries the legacy sessionId from status.claudeSessionId", async () => {
    await writeFile(
      join(phaseFolder, "model-resolution.json"),
      JSON.stringify(validResolution),
      "utf8",
    );
    await writeFile(join(phaseFolder, "status.json"), JSON.stringify(validStatus), "utf8");

    const result = await inferLegacyBinding(phaseFolder, context);
    if (Either.isRight(result)) {
      expect(result.right.sessionId).toBe("sess-legacy-abc");
    }
  });

  it("persists the inferred binding to agent-binding.json", async () => {
    await writeFile(
      join(phaseFolder, "model-resolution.json"),
      JSON.stringify(validResolution),
      "utf8",
    );
    await writeFile(join(phaseFolder, "status.json"), JSON.stringify(validStatus), "utf8");

    await inferLegacyBinding(phaseFolder, context);

    const persisted = await readAgentBinding(phaseFolder);
    expect(Either.isRight(persisted)).toBe(true);
    if (Either.isRight(persisted)) {
      expect(persisted.right.lockSource).toBe("legacy_inferred");
    }
  });

  it("uses phaseName from context when provided", async () => {
    await writeFile(
      join(phaseFolder, "model-resolution.json"),
      JSON.stringify(validResolution),
      "utf8",
    );
    await writeFile(join(phaseFolder, "status.json"), JSON.stringify(validStatus), "utf8");

    const result = await inferLegacyBinding(phaseFolder, {
      ...context,
      phaseName: "Custom Phase Title",
    });
    if (Either.isRight(result)) {
      expect(result.right.phaseName).toBe("Custom Phase Title");
    }
  });

  it("falls back to phaseId as phaseName when context omits it", async () => {
    await writeFile(
      join(phaseFolder, "model-resolution.json"),
      JSON.stringify(validResolution),
      "utf8",
    );
    await writeFile(join(phaseFolder, "status.json"), JSON.stringify(validStatus), "utf8");

    const result = await inferLegacyBinding(phaseFolder, {
      shortName: "test-run",
      runId: "run-abc",
    });
    if (Either.isRight(result)) {
      expect(result.right.phaseName).toBe("phase-01");
    }
  });

  it("uses effort from selected.thinking when present", async () => {
    await writeFile(
      join(phaseFolder, "model-resolution.json"),
      JSON.stringify({
        ...validResolution,
        selected: { ...validResolution.selected, thinking: "high" },
      }),
      "utf8",
    );
    await writeFile(join(phaseFolder, "status.json"), JSON.stringify(validStatus), "utf8");

    const result = await inferLegacyBinding(phaseFolder, context);
    if (Either.isRight(result)) {
      expect(result.right.effort).toBe("high");
    }
  });

  it("falls back to status.effort when selected.thinking is absent", async () => {
    const resolutionWithoutThinking = {
      ...validResolution,
      selected: {
        provider: "claude-code",
        family: "claude-sonnet",
        concreteModel: "claude-sonnet-4-6",
      },
    };
    await writeFile(
      join(phaseFolder, "model-resolution.json"),
      JSON.stringify(resolutionWithoutThinking),
      "utf8",
    );
    const statusWithEffort = { ...validStatus, effort: "low" };
    await writeFile(join(phaseFolder, "status.json"), JSON.stringify(statusWithEffort), "utf8");

    const result = await inferLegacyBinding(phaseFolder, context);
    if (Either.isRight(result)) {
      expect(result.right.effort).toBe("low");
    }
  });

  it("infers a codex-cli binding correctly", async () => {
    const codexResolution = {
      ...validResolution,
      selected: {
        provider: "codex-cli",
        family: "openai-gpt",
        concreteModel: "codex-mini-latest",
      },
    };
    const codexStatus = { ...validStatus, claudeSessionId: "sess-codex-001" };
    await writeFile(
      join(phaseFolder, "model-resolution.json"),
      JSON.stringify(codexResolution),
      "utf8",
    );
    await writeFile(join(phaseFolder, "status.json"), JSON.stringify(codexStatus), "utf8");

    const result = await inferLegacyBinding(phaseFolder, context);
    if (Either.isRight(result)) {
      expect(result.right.provider).toBe("codex-cli");
      expect(result.right.adapter).toBe("codex");
      expect(result.right.model).toBe("codex-mini-latest");
    }
  });
});

describe("inferLegacyBinding — failure cases", () => {
  let phaseFolder: string;

  beforeEach(async () => {
    phaseFolder = join(tmpdir(), `phax-infer-fail-${Date.now()}`);
    await mkdir(phaseFolder, { recursive: true });
  });

  afterEach(async () => {
    await rm(phaseFolder, { recursive: true, force: true });
  });

  it("returns Left when model-resolution.json is absent", async () => {
    await writeFile(join(phaseFolder, "status.json"), JSON.stringify(validStatus), "utf8");

    const result = await inferLegacyBinding(phaseFolder, context);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("returns Left when model-resolution.json has unrecognized provider", async () => {
    const badResolution = {
      ...validResolution,
      selected: { ...validResolution.selected, provider: "openai" },
    };
    await writeFile(
      join(phaseFolder, "model-resolution.json"),
      JSON.stringify(badResolution),
      "utf8",
    );
    await writeFile(join(phaseFolder, "status.json"), JSON.stringify(validStatus), "utf8");

    const result = await inferLegacyBinding(phaseFolder, context);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("returns Left when model-resolution.json has no concreteModel", async () => {
    const badResolution = {
      ...validResolution,
      selected: { provider: "claude-code", family: "claude-sonnet" },
    };
    await writeFile(
      join(phaseFolder, "model-resolution.json"),
      JSON.stringify(badResolution),
      "utf8",
    );
    await writeFile(join(phaseFolder, "status.json"), JSON.stringify(validStatus), "utf8");

    const result = await inferLegacyBinding(phaseFolder, context);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("returns Left when status.json is absent", async () => {
    await writeFile(
      join(phaseFolder, "model-resolution.json"),
      JSON.stringify(validResolution),
      "utf8",
    );

    const result = await inferLegacyBinding(phaseFolder, context);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("returns Left when status.json has no worktreePath", async () => {
    const { worktreePath: _wt, ...statusWithoutWorktree } = validStatus;
    await writeFile(
      join(phaseFolder, "model-resolution.json"),
      JSON.stringify(validResolution),
      "utf8",
    );
    await writeFile(
      join(phaseFolder, "status.json"),
      JSON.stringify(statusWithoutWorktree),
      "utf8",
    );

    const result = await inferLegacyBinding(phaseFolder, context);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("returns Left when neither artifact is present", async () => {
    const result = await inferLegacyBinding(phaseFolder, context);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("error message mentions relevant context when model-resolution.json is absent", async () => {
    await writeFile(join(phaseFolder, "status.json"), JSON.stringify(validStatus), "utf8");
    const result = await inferLegacyBinding(phaseFolder, context);
    if (Either.isLeft(result)) {
      expect(result.left).toContain("model-resolution.json");
    }
  });
});
