import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { runGates } from "../../src/app/gates.js";
import { GateFailedError } from "../../src/domain/errors.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import type { GateStep } from "../../src/schemas/phaxConfig.js";
import type { GateAttribution } from "../../src/schemas/gateAttribution.js";

const cwd = "/fake/worktrees/my-run/phase-01";
const logPath = "/fake/runs/my-run/phase-01/checks-attempt-01.log";
const attributionPath = "/fake/runs/my-run/phase-01/gate-attribution.json";

function step(
  command: string,
  surface = "local",
  firing: "every-phase" | "terminal" = "every-phase",
): GateStep {
  return { command, surface, firing };
}

describe("runGates", () => {
  it("succeeds when all commands exit 0", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "ok", stderr: "" });

    const outcome = await Effect.runPromise(
      runGates({
        steps: [step("pnpm test"), step("pnpm lint")],
        cwd,
        attemptLogPath: logPath,
      }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
    );

    expect(outcome.attemptLogPath).toBe(logPath);
    expect(fakeShell.impl.calls).toHaveLength(2);
    expect(fakeShell.impl.calls[0]?.command).toEqual(["pnpm", "test"]);
    expect(fakeShell.impl.calls[1]?.command).toEqual(["pnpm", "lint"]);
  });

  it("writes a log file on success", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "all good", stderr: "" });

    await Effect.runPromise(
      runGates({ steps: [step("pnpm test")], cwd, attemptLogPath: logPath }).pipe(
        Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer)),
      ),
    );

    const log = fakeFs.impl.getFile(logPath);
    expect(log).toBeDefined();
    expect(log).toContain("$ pnpm test");
    expect(log).toContain("exit 0");
  });

  it("fails with GateFailedError when a command exits non-zero", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("pnpm test", {
      exitCode: 1,
      stdout: "",
      stderr: "Test failures found",
    });

    const result = await Effect.runPromise(
      Effect.either(
        runGates({ steps: [step("pnpm test")], cwd, attemptLogPath: logPath }).pipe(
          Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer)),
        ),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GateFailedError);
      const err = result.left as GateFailedError;
      expect(err.exitCode).toBe(1);
      expect(err.command).toBe("pnpm test");
      expect(err.logPath).toBe(logPath);
    }
  });

  it("writes a log file on failure", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 2, stdout: "", stderr: "error output" });

    await Effect.runPromise(
      Effect.ignore(
        runGates({ steps: [step("pnpm test")], cwd, attemptLogPath: logPath }).pipe(
          Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer)),
        ),
      ),
    );

    const log = fakeFs.impl.getFile(logPath);
    expect(log).toBeDefined();
    expect(log).toContain("exit 2");
    expect(log).toContain("error output");
  });

  it("stops at the first failing command and does not run subsequent ones", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("pnpm test", { exitCode: 1, stdout: "", stderr: "fail" });
    fakeShell.impl.setResponse("pnpm lint", { exitCode: 0, stdout: "ok", stderr: "" });

    await Effect.runPromise(
      Effect.ignore(
        runGates({
          steps: [step("pnpm test"), step("pnpm lint")],
          cwd,
          attemptLogPath: logPath,
        }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
      ),
    );

    expect(fakeShell.impl.calls).toHaveLength(1);
    expect(fakeShell.impl.calls[0]?.command).toEqual(["pnpm", "test"]);
  });

  it("uses cwd for all shell commands", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "", stderr: "" });

    await Effect.runPromise(
      runGates({ steps: [step("pnpm test")], cwd, attemptLogPath: logPath }).pipe(
        Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer)),
      ),
    );

    expect(fakeShell.impl.calls[0]?.cwd).toBe(cwd);
  });

  it("includes stdout and stderr in the log", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({
      exitCode: 0,
      stdout: "stdout-output",
      stderr: "stderr-output",
    });

    await Effect.runPromise(
      runGates({ steps: [step("pnpm test")], cwd, attemptLogPath: logPath }).pipe(
        Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer)),
      ),
    );

    const log = fakeFs.impl.getFile(logPath);
    expect(log).toContain("stdout-output");
    expect(log).toContain("stderr-output");
  });

  it("does not write attribution when attributionPath is omitted", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "ok", stderr: "" });

    await Effect.runPromise(
      runGates({ steps: [step("pnpm test")], cwd, attemptLogPath: logPath }).pipe(
        Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer)),
      ),
    );

    expect(fakeFs.impl.getFile(attributionPath)).toBeUndefined();
  });

  it("records all steps as pass when all commands succeed", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "ok", stderr: "" });

    await Effect.runPromise(
      runGates({
        steps: [step("pnpm test", "local"), step("pnpm lint", "structural")],
        cwd,
        attemptLogPath: logPath,
        attributionPath,
        phaseId: "phase-01",
      }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
    );

    const raw = fakeFs.impl.getFile(attributionPath);
    expect(raw).toBeDefined();
    const record = JSON.parse(raw!) as GateAttribution;
    expect(record.phase).toBe("phase-01");
    expect(record.steps).toHaveLength(2);
    expect(record.steps[0]).toEqual({ command: "pnpm test", surface: "local", result: "pass" });
    expect(record.steps[1]).toEqual({
      command: "pnpm lint",
      surface: "structural",
      result: "pass",
    });
  });

  it("records first step as pass and second as fail when second command fails (fail-fast)", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("pnpm test", { exitCode: 0, stdout: "ok", stderr: "" });
    fakeShell.impl.setResponse("pnpm lint", { exitCode: 1, stdout: "", stderr: "lint error" });

    await Effect.runPromise(
      Effect.ignore(
        runGates({
          steps: [
            step("pnpm test", "local"),
            step("pnpm lint", "structural"),
            step("pnpm build", "product"),
          ],
          cwd,
          attemptLogPath: logPath,
          attributionPath,
          phaseId: "phase-01",
        }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
      ),
    );

    const raw = fakeFs.impl.getFile(attributionPath);
    expect(raw).toBeDefined();
    const record = JSON.parse(raw!) as GateAttribution;
    expect(record.phase).toBe("phase-01");
    // Only the first two steps ran; pnpm build was not executed
    expect(record.steps).toHaveLength(2);
    expect(record.steps[0]).toEqual({ command: "pnpm test", surface: "local", result: "pass" });
    expect(record.steps[1]).toEqual({
      command: "pnpm lint",
      surface: "structural",
      result: "fail",
    });
  });

  it("writes attribution on failure path as well as success path", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 1, stdout: "", stderr: "fail" });

    await Effect.runPromise(
      Effect.ignore(
        runGates({
          steps: [step("pnpm test", "local")],
          cwd,
          attemptLogPath: logPath,
          attributionPath,
          phaseId: "phase-01",
        }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
      ),
    );

    const raw = fakeFs.impl.getFile(attributionPath);
    expect(raw).toBeDefined();
    const record = JSON.parse(raw!) as GateAttribution;
    expect(record.steps[0]?.result).toBe("fail");
  });
});
