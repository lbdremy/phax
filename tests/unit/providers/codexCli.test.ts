import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCodexArgs } from "../../../src/infra/providers/codexCli.js";
import {
  findCodexResultEvent,
  hasCodexErroredResultEvent,
} from "../../../src/schemas/codexOutput.js";

const baseEntry = {
  executable: "codex",
  families: { "openai-gpt": { model: "gpt-5.5" } },
};

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const sampleLines = readFileSync(join(fixtureDir, "codex-exec-sample.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim().length > 0);

describe("buildCodexArgs", () => {
  it("emits `codex exec` with --json, sandbox bypass, model, cwd, and reasoning-effort config", () => {
    const args = buildCodexArgs(baseEntry, "gpt-5.5", "medium", "/tmp/work");
    expect(args).toEqual([
      "exec",
      "-C",
      "/tmp/work",
      "--json",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "-m",
      "gpt-5.5",
      "-c",
      'model_reasoning_effort="medium"',
    ]);
  });

  it("omits -C when cwd is undefined", () => {
    const args = buildCodexArgs(baseEntry, "gpt-5.5", "low", undefined);
    expect(args).not.toContain("-C");
    expect(args[0]).toBe("exec");
  });

  it("emits `codex exec resume <id>` for resume invocations (no -C)", () => {
    const args = buildCodexArgs(baseEntry, "gpt-5.5", "medium", "/tmp/work", "session-abc-123");
    expect(args.slice(0, 3)).toEqual(["exec", "resume", "session-abc-123"]);
    expect(args).not.toContain("-C");
    expect(args).toContain("--json");
    expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).toContain('model_reasoning_effort="medium"');
  });

  it("maps openai-gpt effort levels to codex reasoning effort", () => {
    const effortValue = (effort: string): string => {
      const args = buildCodexArgs(baseEntry, "gpt-5.5", effort, "/cwd");
      const idx = args.indexOf("-c");
      return args[idx + 1] ?? "";
    };
    expect(effortValue("low")).toBe('model_reasoning_effort="low"');
    expect(effortValue("medium")).toBe('model_reasoning_effort="medium"');
    expect(effortValue("high")).toBe('model_reasoning_effort="high"');
    // xhigh is not accepted by codex; clamp to high
    expect(effortValue("xhigh")).toBe('model_reasoning_effort="high"');
    // legacy synonyms
    expect(effortValue("off")).toBe('model_reasoning_effort="low"');
    expect(effortValue("max")).toBe('model_reasoning_effort="high"');
  });
});

describe("findCodexResultEvent", () => {
  it("extracts sessionId and finalText from the captured codex --json sample", () => {
    const found = findCodexResultEvent(sampleLines);
    expect(found).toEqual({
      sessionId: "019e8fb5-be1b-7040-b45a-150db63ddff2",
      finalText: "ok",
    });
  });

  it("returns the last agent_message text when multiple item.completed events exist", () => {
    const lines = [
      JSON.stringify({ type: "thread.started", thread_id: "tid-1" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "item_0", type: "agent_message", text: "first" },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "item_1", type: "agent_message", text: "last" },
      }),
    ];
    expect(findCodexResultEvent(lines)?.finalText).toBe("last");
  });

  it("returns undefined when no thread.started event is present", () => {
    expect(findCodexResultEvent([])).toBeUndefined();
    expect(findCodexResultEvent(['{"type":"turn.started"}'])).toBeUndefined();
    expect(findCodexResultEvent(["not json"])).toBeUndefined();
  });

  it("returns sessionId with empty finalText when no agent_message item is emitted", () => {
    const found = findCodexResultEvent([
      JSON.stringify({ type: "thread.started", thread_id: "tid-only" }),
    ]);
    expect(found).toEqual({ sessionId: "tid-only", finalText: "" });
  });

  it("ignores non-agent-message item.completed events", () => {
    const lines = [
      JSON.stringify({ type: "thread.started", thread_id: "tid-x" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "i", type: "reasoning", text: "should-be-ignored" },
      }),
    ];
    expect(findCodexResultEvent(lines)).toEqual({ sessionId: "tid-x", finalText: "" });
  });
});

describe("hasCodexErroredResultEvent", () => {
  it("returns true on a turn.failed event (codex emits this with exit 0)", () => {
    const errorLines = [
      JSON.stringify({ type: "thread.started", thread_id: "tid-err" }),
      JSON.stringify({ type: "error", message: "boom" }),
      JSON.stringify({ type: "turn.failed", error: { message: "boom" } }),
    ];
    expect(hasCodexErroredResultEvent(errorLines)).toBe(true);
  });

  it("returns false for the happy-path captured sample", () => {
    expect(hasCodexErroredResultEvent(sampleLines)).toBe(false);
  });

  it("returns false for an empty line array", () => {
    expect(hasCodexErroredResultEvent([])).toBe(false);
  });
});
