import { describe, it, expect } from "vitest";
import { AgentInvocationError } from "../../src/domain/errors.js";
import { describeCause } from "../../src/domain/reducer.js";

describe("describeCause", () => {
  it("formats AgentInvocationError with stderrExcerpt", () => {
    const err = new AgentInvocationError({
      message: "claude exited with code 1",
      exitCode: 1,
      stderrExcerpt: "Error: API key is invalid",
    });
    expect(describeCause(err)).toBe("claude exited with code 1: Error: API key is invalid");
  });

  it("falls back to message when no stderr excerpt is available", () => {
    const err = new AgentInvocationError({
      message: "claude exited with code 1",
      exitCode: 1,
    });
    expect(describeCause(err)).toBe("claude exited with code 1");
  });

  it("prefers stderrExcerpt over stderr when both are present", () => {
    const err = new AgentInvocationError({
      message: "claude exited with code 1",
      exitCode: 1,
      stderr: "full stderr output",
      stderrExcerpt: "excerpt only",
    });
    expect(describeCause(err)).toBe("claude exited with code 1: excerpt only");
  });

  it("falls back to stderr when stderrExcerpt is absent", () => {
    const err = new AgentInvocationError({
      message: "claude exited with code 1",
      exitCode: 1,
      stderr: "authentication failed",
    });
    expect(describeCause(err)).toBe("claude exited with code 1: authentication failed");
  });

  it("bounds the excerpt to the last 500 characters", () => {
    const longStderr = "x".repeat(600) + "END";
    const err = new AgentInvocationError({
      message: "claude exited with code 1",
      exitCode: 1,
      stderrExcerpt: longStderr,
    });
    const result = describeCause(err);
    expect(result.endsWith("END")).toBe(true);
    // message prefix + ": " + 500 chars (last 500 of 603-char string = "x"*497 + "END")
    expect(result.length).toBeLessThanOrEqual("claude exited with code 1: ".length + 500);
  });

  it("falls back to message when stderrExcerpt is only whitespace", () => {
    const err = new AgentInvocationError({
      message: "claude exited with code 1",
      exitCode: 1,
      stderrExcerpt: "   \n   ",
    });
    expect(describeCause(err)).toBe("claude exited with code 1");
  });

  it("returns message for a plain Error", () => {
    expect(describeCause(new Error("something broke"))).toBe("something broke");
  });

  it("returns the string itself for a string cause", () => {
    expect(describeCause("bad thing happened")).toBe("bad thing happened");
  });

  it("returns 'unknown' for null", () => {
    expect(describeCause(null)).toBe("unknown");
  });

  it("returns 'unknown' for undefined", () => {
    expect(describeCause(undefined)).toBe("unknown");
  });
});
