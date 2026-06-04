import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildVibeArgs } from "../../../src/infra/providers/mistralVibe.js";
import { SecurityEnforcementError } from "../../../src/domain/errors.js";
import type { AgentRunOptions } from "../../../src/ports/backend.js";
import type { SecurityPolicy } from "../../../src/domain/security/types.js";
import {
  findVibeResultEvent,
  findVibeSessionId,
  hasVibeErroredResultEvent,
} from "../../../src/schemas/vibeOutput.js";

const baseEntry = {
  executable: "vibe",
  modelEnvVar: "VIBE_ACTIVE_MODEL",
  defaultAgent: "auto-approve",
};

const unsafePolicy: SecurityPolicy = {
  mode: "unsafe",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "open", allowDomains: [] },
  mcp: { mode: "provider-default", allow: [] },
  failClosed: false,
};

const securePolicy: SecurityPolicy = {
  mode: "secure",
  filesystem: {
    allowRead: ["/tmp/work", "/home/me/.phax"],
    allowWrite: ["/tmp/work", "/home/me/.phax"],
  },
  network: { profile: "provider-only", allowDomains: ["api.mistral.ai"] },
  mcp: { mode: "disabled", allow: [] },
  failClosed: true,
};

const baseOptions = (security: SecurityPolicy, cwd = "/tmp/work"): AgentRunOptions => ({
  provider: "mistral-vibe",
  model: "mistral-large",
  effort: "medium",
  cwd,
  security,
});

describe("buildVibeArgs — unsafe mode", () => {
  it("emits the host-trusted vector with --trust and unscoped workdir", () => {
    const args = buildVibeArgs(baseEntry, "print ok", baseOptions(unsafePolicy));
    expect(args).toEqual([
      "-p",
      "print ok",
      "--agent",
      "auto-approve",
      "--output",
      "streaming",
      "--trust",
      "--workdir",
      "/tmp/work",
    ]);
  });

  it("appends --resume when a session id is provided", () => {
    const args = buildVibeArgs(baseEntry, "do thing", baseOptions(unsafePolicy), "sess-abc-123");
    const resumeIdx = args.indexOf("--resume");
    expect(resumeIdx).toBeGreaterThan(0);
    expect(args[resumeIdx + 1]).toBe("sess-abc-123");
  });

  it("defaults --agent to auto-approve when entry has no defaultAgent", () => {
    const args = buildVibeArgs({ executable: "vibe" }, "p", baseOptions(unsafePolicy));
    const agentIdx = args.indexOf("--agent");
    expect(agentIdx).toBeGreaterThan(0);
    expect(args[agentIdx + 1]).toBe("auto-approve");
  });
});

describe("buildVibeArgs — secure mode", () => {
  it("drops blanket --trust", () => {
    const args = buildVibeArgs(baseEntry, "p", baseOptions(securePolicy));
    expect(args).not.toContain("--trust");
  });

  it("scopes --workdir to the cwd (worktree)", () => {
    const args = buildVibeArgs(baseEntry, "p", baseOptions(securePolicy));
    const idx = args.indexOf("--workdir");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("/tmp/work");
  });

  it("emits --add-dir for writable paths outside cwd (e.g. ~/.phax)", () => {
    const args = buildVibeArgs(baseEntry, "p", baseOptions(securePolicy));
    const addDirs: string[] = [];
    for (let i = 0; i < args.length - 1; i += 1) {
      if (args[i] === "--add-dir") {
        const v = args[i + 1];
        if (v !== undefined) addDirs.push(v);
      }
    }
    expect(addDirs).toEqual(["/home/me/.phax"]);
  });

  it("uses entry.defaultAgent as the (restricted) agent injection point", () => {
    const restrictedEntry = { ...baseEntry, defaultAgent: "phax-restricted" };
    const args = buildVibeArgs(restrictedEntry, "p", baseOptions(securePolicy));
    const idx = args.indexOf("--agent");
    expect(args[idx + 1]).toBe("phax-restricted");
  });

  it("appends --resume while keeping the secure vector", () => {
    const args = buildVibeArgs(baseEntry, "p", baseOptions(securePolicy), "sess-xyz");
    expect(args).not.toContain("--trust");
    const resumeIdx = args.indexOf("--resume");
    expect(args[resumeIdx + 1]).toBe("sess-xyz");
  });

  it("isolated mode follows the secure branch for type totality (CLI gates it earlier)", () => {
    const args = buildVibeArgs(baseEntry, "p", baseOptions({ ...securePolicy, mode: "isolated" }));
    expect(args).not.toContain("--trust");
    expect(args).toContain("--workdir");
  });
});

describe("buildVibeArgs — secure mode fail-closed", () => {
  it("throws SecurityEnforcementError when secure policy has no writable paths", () => {
    const impossiblePolicy: SecurityPolicy = {
      ...securePolicy,
      filesystem: { allowRead: [], allowWrite: [] },
    };
    try {
      buildVibeArgs(baseEntry, "p", baseOptions(impossiblePolicy));
      throw new Error("expected buildVibeArgs to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SecurityEnforcementError);
      const e = err as SecurityEnforcementError;
      expect(e.provider).toBe("mistral-vibe");
      expect(e.mode).toBe("secure");
      expect(e.message).toMatch(/--trust/);
    }
  });
});

describe("findVibeResultEvent (streaming sample)", () => {
  it("extracts the final assistant content from the captured live fixture", async () => {
    const fixturePath = join(__dirname, "fixtures", "vibe-streaming-sample.jsonl");
    const text = await readFile(fixturePath, "utf8");
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    const found = findVibeResultEvent(lines);
    expect(found).toEqual({ finalText: "ok" });
  });

  it("returns the last assistant message when multiple are present", () => {
    const a = JSON.stringify({ role: "assistant", content: "first" });
    const b = JSON.stringify({ role: "assistant", content: "second" });
    expect(findVibeResultEvent([a, b])?.finalText).toBe("second");
  });

  it("skips non-assistant roles and empty content", () => {
    const sys = JSON.stringify({ role: "system", content: "prompt" });
    const user = JSON.stringify({ role: "user", content: "hi" });
    expect(findVibeResultEvent([sys, user])).toBeUndefined();
  });

  it("ignores invalid JSON and blank lines", () => {
    const assistant = JSON.stringify({ role: "assistant", content: "ok" });
    expect(findVibeResultEvent(["", "not json", assistant, "  "])).toEqual({ finalText: "ok" });
  });

  it("returns undefined for empty input", () => {
    expect(findVibeResultEvent([])).toBeUndefined();
  });
});

describe("hasVibeErroredResultEvent", () => {
  it("returns false for the captured live fixture", async () => {
    const fixturePath = join(__dirname, "fixtures", "vibe-streaming-sample.jsonl");
    const text = await readFile(fixturePath, "utf8");
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    expect(hasVibeErroredResultEvent(lines)).toBe(false);
  });

  it("returns true when a line carries role: error", () => {
    const err = JSON.stringify({ role: "error", content: "boom" });
    expect(hasVibeErroredResultEvent([err])).toBe(true);
  });

  it("returns false for an empty array", () => {
    expect(hasVibeErroredResultEvent([])).toBe(false);
  });
});

describe("findVibeSessionId", () => {
  async function makeSessionDir(
    root: string,
    name: string,
    meta: Record<string, unknown>,
  ): Promise<string> {
    const dir = join(root, "logs", "session", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "meta.json"), JSON.stringify(meta), "utf8");
    return dir;
  }

  it("returns the session id whose working_directory matches cwd", async () => {
    const vibeHome = await mkdtemp(join(tmpdir(), "vibe-home-"));
    const cwd = "/tmp/project-a";
    await makeSessionDir(vibeHome, "session_20260604_063015_aaaa", {
      session_id: "aaaa-aaaa",
      environment: { working_directory: "/tmp/other" },
    });
    await makeSessionDir(vibeHome, "session_20260604_063020_bbbb", {
      session_id: "bbbb-bbbb",
      environment: { working_directory: cwd },
    });
    const id = await findVibeSessionId({ cwd, sinceMs: 0, vibeHome });
    expect(id).toBe("bbbb-bbbb");
  });

  it("prefers the most recent matching session dir", async () => {
    const vibeHome = await mkdtemp(join(tmpdir(), "vibe-home-"));
    const cwd = "/tmp/project-b";
    const older = await makeSessionDir(vibeHome, "session_20260101_000000_old1", {
      session_id: "older-id",
      environment: { working_directory: cwd },
    });
    const newer = await makeSessionDir(vibeHome, "session_20260604_000000_new1", {
      session_id: "newer-id",
      environment: { working_directory: cwd },
    });
    const past = new Date("2020-01-01T00:00:00Z");
    const now = new Date();
    await import("node:fs/promises").then((fs) => fs.utimes(older, past, past));
    await import("node:fs/promises").then((fs) => fs.utimes(newer, now, now));
    const id = await findVibeSessionId({ cwd, sinceMs: 0, vibeHome });
    expect(id).toBe("newer-id");
  });

  it("ignores session dirs modified strictly before sinceMs", async () => {
    const vibeHome = await mkdtemp(join(tmpdir(), "vibe-home-"));
    const cwd = "/tmp/project-c";
    const stale = await makeSessionDir(vibeHome, "session_20200101_000000_old1", {
      session_id: "stale-id",
      environment: { working_directory: cwd },
    });
    const past = new Date("2020-01-01T00:00:00Z");
    await import("node:fs/promises").then((fs) => fs.utimes(stale, past, past));
    const id = await findVibeSessionId({ cwd, sinceMs: Date.now(), vibeHome });
    expect(id).toBeUndefined();
  });

  it("returns undefined when the vibe home does not exist", async () => {
    const id = await findVibeSessionId({
      cwd: "/tmp/whatever",
      sinceMs: 0,
      vibeHome: join(tmpdir(), `does-not-exist-${Date.now()}`),
    });
    expect(id).toBeUndefined();
  });
});
