import { describe, expect, it } from "vitest";
import { buildVibeArgs } from "../../../src/infra/providers/mistralVibe.js";
import { findVibeResultEvent, hasVibeErroredResultEvent } from "../../../src/schemas/vibeOutput.js";

const baseEntry = {
  executable: "vibe",
  modelEnvVar: "VIBE_ACTIVE_MODEL",
  defaultAgent: "auto-approve",
};

describe("buildVibeArgs", () => {
  it("includes agent flag and output format flags", () => {
    const args = buildVibeArgs(baseEntry);
    expect(args).toEqual([
      "--agent",
      "auto-approve",
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
  });

  it("appends --resume when a session id is provided", () => {
    const args = buildVibeArgs(baseEntry, "session-abc-123");
    expect(args).toContain("--resume");
    expect(args).toContain("session-abc-123");
    const resumeIdx = args.indexOf("--resume");
    expect(args[resumeIdx + 1]).toBe("session-abc-123");
  });

  it("omits --agent when defaultAgent is absent", () => {
    const args = buildVibeArgs({ executable: "vibe" });
    expect(args).not.toContain("--agent");
    expect(args).toContain("--print");
  });
});

describe("findVibeResultEvent", () => {
  const goodLine = JSON.stringify({
    type: "result",
    session_id: "sess-abc-0001",
    result: "Here is the answer.",
    is_error: false,
  });

  it("extracts sessionId and finalText from a valid result line", () => {
    const found = findVibeResultEvent([goodLine]);
    expect(found).toEqual({ sessionId: "sess-abc-0001", finalText: "Here is the answer." });
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
    const found = findVibeResultEvent([earlier, later]);
    expect(found?.sessionId).toBe("sess-last");
  });

  it("returns undefined when no valid result line is present", () => {
    expect(findVibeResultEvent([])).toBeUndefined();
    expect(findVibeResultEvent(['{"type":"assistant","content":"hello"}'])).toBeUndefined();
    expect(findVibeResultEvent(["not json at all"])).toBeUndefined();
  });

  it("skips blank lines without error", () => {
    const found = findVibeResultEvent(["", "  ", goodLine, ""]);
    expect(found?.sessionId).toBe("sess-abc-0001");
  });
});

describe("hasVibeErroredResultEvent", () => {
  it("returns true when a result event has is_error: true", () => {
    const errorLine = JSON.stringify({
      type: "result",
      session_id: "sess-err",
      result: "something went wrong",
      is_error: true,
    });
    expect(hasVibeErroredResultEvent([errorLine])).toBe(true);
  });

  it("returns false when all result events have is_error: false", () => {
    const okLine = JSON.stringify({
      type: "result",
      session_id: "sess-ok",
      result: "all good",
      is_error: false,
    });
    expect(hasVibeErroredResultEvent([okLine])).toBe(false);
  });

  it("returns false for an empty line array", () => {
    expect(hasVibeErroredResultEvent([])).toBe(false);
  });
});
