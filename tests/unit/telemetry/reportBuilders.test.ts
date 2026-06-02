import { describe, expect, it } from "vitest";
import type { RunId } from "../../../src/domain/branded.js";
import { AgentInvocationError, GateFailedError } from "../../../src/domain/errors.js";
import { GitError } from "../../../src/ports/git.js";
import { ShellError } from "../../../src/ports/shell.js";
import {
  reportAgentFailure,
  reportGitFailure,
  reportShellFailure,
  type ReportContext,
} from "../../../src/app/telemetry/reportBuilders.js";

const runId = "my-run-2026-05-28" as RunId;

const ctx: ReportContext = {
  runId,
  operationId: "phase-01",
  adapter: "shell",
  operation: "gate.pnpm test",
};

describe("reportShellFailure", () => {
  it("maps ShellError fields onto SystemErrorReport", () => {
    const e = new ShellError({
      message: "spawn failed",
      argv: ["pnpm", "test"],
      exitCode: 1,
      stderrExcerpt: "error: module not found",
    });

    const report = reportShellFailure(e, ctx);

    expect(report.type).toBe("adapter.shell_failed");
    expect(report.runId).toBe(runId);
    expect(report.operationId).toBe("phase-01");
    expect(report.adapter).toBe("shell");
    expect(report.operation).toBe("gate.pnpm test");
    expect(report.exitCode).toBe(1);
    expect(report.stderrExcerpt).toBe("error: module not found");
    expect(report.cause).toBe(e);
  });

  it("omits undefined optional fields", () => {
    const e = new ShellError({ message: "spawn failed" });
    const report = reportShellFailure(e, { runId, adapter: "shell", operation: "run" });

    expect("exitCode" in report).toBe(false);
    expect("stderrExcerpt" in report).toBe(false);
    expect("operationId" in report).toBe(false);
  });

  it("truncates stderrExcerpt beyond 4 KB", () => {
    const longStderr = "x".repeat(5000);
    const e = new ShellError({ message: "fail", stderrExcerpt: longStderr });
    const report = reportShellFailure(e, ctx);

    expect(report.stderrExcerpt).toBeDefined();
    expect(report.stderrExcerpt!.endsWith("…<truncated>")).toBe(true);
    expect(Buffer.byteLength(report.stderrExcerpt!, "utf8")).toBeLessThanOrEqual(
      4 * 1024 + Buffer.byteLength("…<truncated>", "utf8"),
    );
  });
});

describe("reportGitFailure", () => {
  it("maps GitError fields onto SystemErrorReport", () => {
    const e = new GitError({
      message: "git worktree add failed",
      command: "git worktree add /path branch",
      args: ["worktree", "add", "/path", "branch"],
      stderr: "fatal: branch already checked out",
      stderrExcerpt: "fatal: branch already checked out",
      exitCode: 128,
    });

    const report = reportGitFailure(e, {
      runId,
      operationId: "phase-01",
      adapter: "git",
      operation: "worktree.create",
    });

    expect(report.type).toBe("adapter.git_failed");
    expect(report.adapter).toBe("git");
    expect(report.operation).toBe("worktree.create");
    expect(report.exitCode).toBe(128);
    expect(report.stderrExcerpt).toBe("fatal: branch already checked out");
    expect(report.cause).toBe(e);
  });

  it("falls back to stderr when stderrExcerpt absent", () => {
    const e = new GitError({
      message: "git failed",
      command: "git commit",
      stderr: "nothing to commit",
    });

    const report = reportGitFailure(e, { runId, adapter: "git", operation: "commit" });
    expect(report.stderrExcerpt).toBe("nothing to commit");
  });
});

describe("reportAgentFailure", () => {
  it("maps AgentInvocationError fields onto SystemErrorReport", () => {
    const e = new AgentInvocationError({
      message: "claude exited with code 1",
      exitCode: 1,
      stderr: "Error: rate limit",
      stderrExcerpt: "Error: rate limit",
      argv: ["claude", "--print", "--model", "claude-sonnet-4-6"],
    });

    const report = reportAgentFailure(e, {
      runId,
      operationId: "phase-01",
      adapter: "claude-code-cli",
      operation: "agent.run",
    });

    expect(report.type).toBe("adapter.agent_failed");
    expect(report.adapter).toBe("claude-code-cli");
    expect(report.operation).toBe("agent.run");
    expect(report.exitCode).toBe(1);
    expect(report.stderrExcerpt).toBe("Error: rate limit");
    expect(report.cause).toBe(e);
  });

  it("falls back to stderr when stderrExcerpt absent", () => {
    const e = new AgentInvocationError({
      message: "fail",
      exitCode: 1,
      stderr: "unexpected error",
    });

    const report = reportAgentFailure(e, { runId, adapter: "claude-code-cli", operation: "run" });
    expect(report.stderrExcerpt).toBe("unexpected error");
  });

  it("handles missing optional fields gracefully", () => {
    const e = new AgentInvocationError({ message: "no responses queued" });
    const report = reportAgentFailure(e, { runId, adapter: "claude-code-cli", operation: "run" });

    expect(report.type).toBe("adapter.agent_failed");
    expect("exitCode" in report).toBe(false);
    expect("stderrExcerpt" in report).toBe(false);
  });

  it("expected field is forwarded from ReportContext", () => {
    const e = new AgentInvocationError({ message: "fail", exitCode: 1 });
    const report = reportAgentFailure(e, {
      runId,
      adapter: "claude-code-cli",
      operation: "agent.run",
      expected: "exit 0",
    });

    expect(report.expected).toBe("exit 0");
  });
});

describe("GateFailedError stderrExcerpt", () => {
  it("preserves stderrExcerpt from gate failure", () => {
    const e = new GateFailedError({
      message: "Gate command failed",
      command: "pnpm test",
      exitCode: 1,
      logPath: "/runs/my-run/phase-01/checks-attempt-01.log",
      stderrExcerpt: "test suite failed",
    });

    expect(e.stderrExcerpt).toBe("test suite failed");
  });
});
