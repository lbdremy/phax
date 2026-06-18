import { Either } from "effect";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  writeAgentBinding,
  patchAgentBindingSession,
  patchAgentBindingStatus,
  readAgentBinding,
} from "../../src/app/agentBinding.js";
import type { PhaseAgentBinding } from "../../src/schemas/phaseAgentBinding.js";

const validBinding: PhaseAgentBinding = {
  version: 1,
  shortName: "agent-binding",
  runId: "run-abc123",
  phaseId: "phase-01",
  phaseIndex: 0,
  phaseName: "Test Phase",
  provider: "claude-code",
  adapter: "claude",
  model: "claude-sonnet-4-6",
  effort: "low",
  sessionId: null,
  sessionHandle: null,
  worktreePath: "/tmp/worktree",
  cwd: "/tmp/worktree",
  launchedAt: "2026-06-18T00:00:00.000Z",
  lockSource: "routing_at_phase_start",
  status: "launching",
};

describe("writeAgentBinding + readAgentBinding", () => {
  let phaseFolder: string;

  beforeEach(async () => {
    phaseFolder = join(tmpdir(), `phax-ab-test-${Date.now()}`);
    await mkdir(phaseFolder, { recursive: true });
  });

  afterEach(async () => {
    await rm(phaseFolder, { recursive: true, force: true });
  });

  it("round-trips: writeAgentBinding then readAgentBinding returns the original binding", async () => {
    await writeAgentBinding(phaseFolder, validBinding);
    const result = await readAgentBinding(phaseFolder);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(validBinding);
    }
  });

  it("writeAgentBinding persists as valid JSON in agent-binding.json", async () => {
    await writeAgentBinding(phaseFolder, validBinding);
    const raw = await readFile(join(phaseFolder, "agent-binding.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    expect(typeof parsed).toBe("object");
    expect((parsed as Record<string, unknown>)["version"]).toBe(1);
  });

  it("readAgentBinding returns Left when file is absent", async () => {
    const result = await readAgentBinding(phaseFolder);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("readAgentBinding returns Left when file contains malformed JSON", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(phaseFolder, "agent-binding.json"), "not-json", "utf8");
    const result = await readAgentBinding(phaseFolder);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("readAgentBinding returns Left when binding fails schema validation", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(phaseFolder, "agent-binding.json"),
      JSON.stringify({ version: 1, provider: "unknown-provider" }),
      "utf8",
    );
    const result = await readAgentBinding(phaseFolder);
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("patchAgentBindingSession", () => {
  let phaseFolder: string;

  beforeEach(async () => {
    phaseFolder = join(tmpdir(), `phax-ab-patch-test-${Date.now()}`);
    await mkdir(phaseFolder, { recursive: true });
  });

  afterEach(async () => {
    await rm(phaseFolder, { recursive: true, force: true });
  });

  it("sets sessionId and status on an existing binding", async () => {
    await writeAgentBinding(phaseFolder, validBinding);
    await patchAgentBindingSession(phaseFolder, { sessionId: "sess-xyz", status: "running" });
    const result = await readAgentBinding(phaseFolder);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.sessionId).toBe("sess-xyz");
      expect(result.right.status).toBe("running");
      // Other fields unchanged
      expect(result.right.provider).toBe("claude-code");
      expect(result.right.model).toBe("claude-sonnet-4-6");
    }
  });

  it("is a no-op when the file is absent (does not throw)", async () => {
    await expect(
      patchAgentBindingSession(phaseFolder, { sessionId: "sess-xyz", status: "running" }),
    ).resolves.toBeUndefined();
  });

  it("is a no-op when the file is malformed (does not throw)", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(phaseFolder, "agent-binding.json"), "not-json", "utf8");
    await expect(
      patchAgentBindingSession(phaseFolder, { sessionId: "sess-xyz", status: "running" }),
    ).resolves.toBeUndefined();
  });
});

describe("patchAgentBindingStatus", () => {
  let phaseFolder: string;

  beforeEach(async () => {
    phaseFolder = join(tmpdir(), `phax-ab-status-test-${Date.now()}`);
    await mkdir(phaseFolder, { recursive: true });
  });

  afterEach(async () => {
    await rm(phaseFolder, { recursive: true, force: true });
  });

  it("sets status on an existing binding without touching other fields", async () => {
    await writeAgentBinding(phaseFolder, validBinding);
    await patchAgentBindingStatus(phaseFolder, "completed");
    const result = await readAgentBinding(phaseFolder);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.status).toBe("completed");
      // sessionId and other fields unchanged
      expect(result.right.sessionId).toBeNull();
      expect(result.right.provider).toBe("claude-code");
      expect(result.right.model).toBe("claude-sonnet-4-6");
    }
  });

  it("round-trips all terminal status values", async () => {
    const statuses = ["awaiting_manual_review", "failed", "archived"] as const;
    for (const status of statuses) {
      await writeAgentBinding(phaseFolder, validBinding);
      await patchAgentBindingStatus(phaseFolder, status);
      const result = await readAgentBinding(phaseFolder);
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.status).toBe(status);
      }
    }
  });

  it("is a no-op when the file is absent (does not throw)", async () => {
    await expect(patchAgentBindingStatus(phaseFolder, "failed")).resolves.toBeUndefined();
  });

  it("is a no-op when the file is malformed (does not throw)", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(phaseFolder, "agent-binding.json"), "not-json", "utf8");
    await expect(patchAgentBindingStatus(phaseFolder, "archived")).resolves.toBeUndefined();
  });
});
