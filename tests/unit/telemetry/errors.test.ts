import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeRunId } from "../../../src/domain/branded.js";
import { makeSystemErrorReport } from "../../../src/domain/telemetry/errors.js";

const runId = Either.getOrThrow(decodeRunId("test-run-001"));

const MAX_STDERR_BYTES = 4 * 1024;

describe("makeSystemErrorReport", () => {
  it("preserves all provided fields", () => {
    const report = makeSystemErrorReport({
      type: "adapter.command_failed",
      runId,
      operationId: "op-1",
      adapter: "shell",
      operation: "gate.typecheck",
      expected: "exit 0",
      actual: "exit 1",
      exitCode: 1,
      stderrExcerpt: "error TS2345",
      cause: new Error("shell failure"),
    });
    expect(report.type).toBe("adapter.command_failed");
    expect(report.runId).toBe(runId);
    expect(report.operationId).toBe("op-1");
    expect(report.adapter).toBe("shell");
    expect(report.operation).toBe("gate.typecheck");
    expect(report.expected).toBe("exit 0");
    expect(report.actual).toBe("exit 1");
    expect(report.exitCode).toBe(1);
    expect(report.stderrExcerpt).toBe("error TS2345");
  });

  it("works without optional fields", () => {
    const report = makeSystemErrorReport({
      type: "gate.failed",
      runId,
      cause: new Error("gate failed"),
    });
    expect(report.type).toBe("gate.failed");
    expect("operationId" in report).toBe(false);
    expect("stderrExcerpt" in report).toBe(false);
  });

  it("truncates stderrExcerpt at 4 KB with …<truncated> suffix", () => {
    const longStderr = "x".repeat(MAX_STDERR_BYTES + 100);
    const report = makeSystemErrorReport({
      type: "adapter.command_failed",
      runId,
      stderrExcerpt: longStderr,
      cause: null,
    });
    expect(report.stderrExcerpt).toBeDefined();
    const excerpt = report.stderrExcerpt!;
    const encoded = Buffer.from(excerpt, "utf8");
    expect(encoded.byteLength).toBeLessThanOrEqual(MAX_STDERR_BYTES + 20);
    expect(excerpt.endsWith("…<truncated>")).toBe(true);
  });

  it("does not truncate stderrExcerpt at exactly 4 KB", () => {
    const exactStderr = "y".repeat(MAX_STDERR_BYTES);
    const report = makeSystemErrorReport({
      type: "adapter.command_failed",
      runId,
      stderrExcerpt: exactStderr,
      cause: null,
    });
    expect(report.stderrExcerpt).toBe(exactStderr);
  });

  it("does not add truncation suffix for short stderrExcerpt", () => {
    const report = makeSystemErrorReport({
      type: "adapter.command_failed",
      runId,
      stderrExcerpt: "short error",
      cause: null,
    });
    expect(report.stderrExcerpt).toBe("short error");
  });

  it("truncation is deterministic — same input yields same output", () => {
    const longStderr = "a".repeat(MAX_STDERR_BYTES + 500);
    const report1 = makeSystemErrorReport({
      type: "t",
      runId,
      stderrExcerpt: longStderr,
      cause: null,
    });
    const report2 = makeSystemErrorReport({
      type: "t",
      runId,
      stderrExcerpt: longStderr,
      cause: null,
    });
    expect(report1.stderrExcerpt).toBe(report2.stderrExcerpt);
  });
});
