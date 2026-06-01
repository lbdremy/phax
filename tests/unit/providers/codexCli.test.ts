import { describe, expect, it } from "vitest";
import { buildCodexArgs } from "../../../src/infra/providers/codexCli.js";
import {
  findCodexResultEvent,
  hasCodexErroredResultEvent,
} from "../../../src/schemas/codexOutput.js";

const baseEntry = {
  executable: "codex",
  families: { "openai-chatgpt": { model: "gpt-5.5" } },
};

describe("buildCodexArgs", () => {
  it("includes model, approval-mode, reasoning-effort, and output format flags", () => {
    const args = buildCodexArgs(baseEntry, "gpt-5.5", "medium");
    expect(args).toEqual([
      "--model",
      "gpt-5.5",
      "--approval-mode",
      "full-auto",
      "--reasoning-effort",
      "medium",
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
  });

  it("appends --resume when a session id is provided", () => {
    const args = buildCodexArgs(baseEntry, "gpt-5.5", "medium", "session-abc-123");
    expect(args).toContain("--resume");
    expect(args).toContain("session-abc-123");
    const resumeIdx = args.indexOf("--resume");
    expect(args[resumeIdx + 1]).toBe("session-abc-123");
  });

  it("maps effort levels to reasoning-effort correctly", () => {
    expect(buildCodexArgs(baseEntry, "gpt-5.5", "off")).toContain("low");
    expect(buildCodexArgs(baseEntry, "gpt-5.5", "low")).toContain("low");
    expect(buildCodexArgs(baseEntry, "gpt-5.5", "medium")).toContain("medium");
    expect(buildCodexArgs(baseEntry, "gpt-5.5", "high")).toContain("high");
    expect(buildCodexArgs(baseEntry, "gpt-5.5", "xhigh")).toContain("high");
    expect(buildCodexArgs(baseEntry, "gpt-5.5", "max")).toContain("high");
  });
});

describe("findCodexResultEvent", () => {
  const goodLine = JSON.stringify({
    type: "result",
    session_id: "sess-codex-0001",
    result: "Here is the codex answer.",
    is_error: false,
  });

  it("extracts sessionId and finalText from a valid result line", () => {
    const found = findCodexResultEvent([goodLine]);
    expect(found).toEqual({
      sessionId: "sess-codex-0001",
      finalText: "Here is the codex answer.",
    });
  });

  it("returns the last result event when multiple lines exist", () => {
    const earlier = JSON.stringify({
      type: "result",
      session_id: "sess-first",
      result: "first",
      is_error: false,
    });
    const later = JSON.stringify({
      type: "result",
      session_id: "sess-last",
      result: "last",
      is_error: false,
    });
    const found = findCodexResultEvent([earlier, later]);
    expect(found?.sessionId).toBe("sess-last");
  });

  it("returns undefined when no valid result line is present", () => {
    expect(findCodexResultEvent([])).toBeUndefined();
    expect(findCodexResultEvent(['{"type":"assistant","content":"hello"}'])).toBeUndefined();
    expect(findCodexResultEvent(["not json at all"])).toBeUndefined();
  });

  it("skips blank lines without error", () => {
    const found = findCodexResultEvent(["", "  ", goodLine, ""]);
    expect(found?.sessionId).toBe("sess-codex-0001");
  });
});

describe("hasCodexErroredResultEvent", () => {
  it("returns true when a result event has is_error: true", () => {
    const errorLine = JSON.stringify({
      type: "result",
      session_id: "sess-err",
      result: "something went wrong",
      is_error: true,
    });
    expect(hasCodexErroredResultEvent([errorLine])).toBe(true);
  });

  it("returns false when all result events have is_error: false", () => {
    const okLine = JSON.stringify({
      type: "result",
      session_id: "sess-ok",
      result: "all good",
      is_error: false,
    });
    expect(hasCodexErroredResultEvent([okLine])).toBe(false);
  });

  it("returns false for an empty line array", () => {
    expect(hasCodexErroredResultEvent([])).toBe(false);
  });
});
