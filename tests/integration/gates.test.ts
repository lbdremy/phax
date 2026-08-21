import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { runGates } from "../../src/app/gates.js";
import { GateFailedError } from "../../src/domain/errors.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import type { GateStep, Surface } from "../../src/schemas/phaxConfig.js";
import type { GateAttribution } from "../../src/schemas/gateAttribution.js";

const cwd = "/fake/worktrees/my-run/phase-01";
const logPath = "/fake/runs/my-run/phase-01/checks-attempt-01.log";
const attributionPath = "/fake/runs/my-run/phase-01/gate-attribution.json";
const phaseId = "phase-01";

function steps(...commands: string[]): GateStep[] {
  return commands.map((command) => ({
    command,
    surface: "local",
    firing: "every-phase",
    output: "log",
  }));
}

function stepWithSurface(command: string, surface: Surface): GateStep {
  return { command, surface, firing: "every-phase", output: "log" };
}

function diagnosticsStep(command: string): GateStep {
  return { command, surface: "local", firing: "every-phase", output: "diagnostics" };
}

const diagnosticsPath = "/fake/runs/my-run/phase-01/checks-attempt-01.diagnostics.json";

describe("runGates", () => {
  it("succeeds when all commands exit 0", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "ok", stderr: "" });

    const outcome = await Effect.runPromise(
      runGates({ steps: steps("pnpm test", "pnpm lint"), cwd, attemptLogPath: logPath }).pipe(
        Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer)),
      ),
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
      runGates({ steps: steps("pnpm test"), cwd, attemptLogPath: logPath }).pipe(
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
        runGates({ steps: steps("pnpm test"), cwd, attemptLogPath: logPath }).pipe(
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
        runGates({ steps: steps("pnpm test"), cwd, attemptLogPath: logPath }).pipe(
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
        runGates({ steps: steps("pnpm test", "pnpm lint"), cwd, attemptLogPath: logPath }).pipe(
          Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer)),
        ),
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
      runGates({ steps: steps("pnpm test"), cwd, attemptLogPath: logPath }).pipe(
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
      runGates({ steps: steps("pnpm test"), cwd, attemptLogPath: logPath }).pipe(
        Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer)),
      ),
    );

    const log = fakeFs.impl.getFile(logPath);
    expect(log).toContain("stdout-output");
    expect(log).toContain("stderr-output");
  });

  describe("attribution", () => {
    it("does not write an attribution record when attributionPath/phaseId are omitted", async () => {
      const fakeFs = makeFakeFileSystem();
      const fakeShell = makeFakeShell();
      fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "", stderr: "" });

      await Effect.runPromise(
        runGates({ steps: steps("pnpm test"), cwd, attemptLogPath: logPath }).pipe(
          Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer)),
        ),
      );

      expect(fakeFs.impl.getFile(attributionPath)).toBeUndefined();
    });

    it("records every run step as pass with its surface when the profile passes", async () => {
      const fakeFs = makeFakeFileSystem();
      const fakeShell = makeFakeShell();
      fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "", stderr: "" });

      await Effect.runPromise(
        runGates({
          steps: [
            stepWithSurface("pnpm test", "local"),
            stepWithSurface("pnpm audit:architecture", "structural"),
          ],
          cwd,
          attemptLogPath: logPath,
          attributionPath,
          phaseId,
        }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
      );

      const raw = fakeFs.impl.getFile(attributionPath);
      expect(raw).toBeDefined();
      const record = JSON.parse(raw!) as GateAttribution;
      expect(record.phase).toBe(phaseId);
      expect(record.steps).toEqual([
        { command: "pnpm test", surface: "local", result: "pass" },
        { command: "pnpm audit:architecture", surface: "structural", result: "pass" },
      ]);
    });

    it("records pass for steps before the failure and fail for the failing step, omitting steps after it", async () => {
      const fakeFs = makeFakeFileSystem();
      const fakeShell = makeFakeShell();
      fakeShell.impl.setResponse("pnpm test", { exitCode: 0, stdout: "", stderr: "" });
      fakeShell.impl.setResponse("pnpm lint", { exitCode: 1, stdout: "", stderr: "lint error" });
      fakeShell.impl.setResponse("pnpm build", { exitCode: 0, stdout: "", stderr: "" });

      await Effect.runPromise(
        Effect.ignore(
          runGates({
            steps: [
              stepWithSurface("pnpm test", "local"),
              stepWithSurface("pnpm lint", "local"),
              stepWithSurface("pnpm build", "product"),
            ],
            cwd,
            attemptLogPath: logPath,
            attributionPath,
            phaseId,
          }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
        ),
      );

      const raw = fakeFs.impl.getFile(attributionPath);
      expect(raw).toBeDefined();
      const record = JSON.parse(raw!) as GateAttribution;
      expect(record.phase).toBe(phaseId);
      expect(record.steps).toEqual([
        { command: "pnpm test", surface: "local", result: "pass" },
        { command: "pnpm lint", surface: "local", result: "fail" },
      ]);
    });
  });

  describe("diagnostics output", () => {
    const oneDiagnostic = JSON.stringify({
      diagnostics: [
        {
          rule: "no-console",
          location: { file: "src/index.ts", line: 12 },
          message: "Unexpected console statement",
          repair: "Remove the console.log call",
        },
      ],
    });

    it("fails a non-empty document whatever the exit code and persists it", async () => {
      const fakeFs = makeFakeFileSystem();
      const fakeShell = makeFakeShell();
      fakeShell.impl.setResponse("pnpm audit", {
        exitCode: 1,
        stdout: oneDiagnostic,
        stderr: "",
      });

      const result = await Effect.runPromise(
        Effect.either(
          runGates({
            steps: [diagnosticsStep("pnpm audit")],
            cwd,
            attemptLogPath: logPath,
            attributionPath,
            phaseId,
          }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(GateFailedError);
        const err = result.left as GateFailedError;
        expect(err.diagnostics).toHaveLength(1);
        expect(err.diagnostics[0]?.rule).toBe("no-console");
        expect(err.diagnostics[0]?.location).toEqual({ file: "src/index.ts", line: 12 });
      }

      const record = JSON.parse(fakeFs.impl.getFile(attributionPath)!) as GateAttribution;
      expect(record.steps).toEqual([{ command: "pnpm audit", surface: "local", result: "fail" }]);

      const doc = fakeFs.impl.getFile(diagnosticsPath);
      expect(doc).toBeDefined();
      expect(JSON.parse(doc!)).toEqual(JSON.parse(oneDiagnostic));
    });

    it("passes on exit 0 with an empty list and writes no diagnostics file", async () => {
      const fakeFs = makeFakeFileSystem();
      const fakeShell = makeFakeShell();
      fakeShell.impl.setResponse("pnpm audit", {
        exitCode: 0,
        stdout: JSON.stringify({ diagnostics: [] }),
        stderr: "",
      });

      const outcome = await Effect.runPromise(
        runGates({
          steps: [diagnosticsStep("pnpm audit")],
          cwd,
          attemptLogPath: logPath,
          attributionPath,
          phaseId,
        }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
      );

      expect(outcome.attemptLogPath).toBe(logPath);
      expect(fakeFs.impl.getFile(diagnosticsPath)).toBeUndefined();
      const record = JSON.parse(fakeFs.impl.getFile(attributionPath)!) as GateAttribution;
      expect(record.steps).toEqual([{ command: "pnpm audit", surface: "local", result: "pass" }]);
    });

    it("treats a non-zero exit with an empty list as a provider error", async () => {
      const fakeFs = makeFakeFileSystem();
      const fakeShell = makeFakeShell();
      fakeShell.impl.setResponse("pnpm audit", {
        exitCode: 2,
        stdout: JSON.stringify({ diagnostics: [] }),
        stderr: "",
      });

      const result = await Effect.runPromise(
        Effect.either(
          runGates({
            steps: [diagnosticsStep("pnpm audit")],
            cwd,
            attemptLogPath: logPath,
            attributionPath,
            phaseId,
          }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        const err = result.left as GateFailedError;
        expect(err).toBeInstanceOf(GateFailedError);
        expect(err.diagnostics).toEqual([]);
        expect(err.exitCode).toBe(2);
        expect(err.message).toContain("pnpm audit");
        expect(err.message).toContain("2");
      }
      expect(fakeFs.impl.getFile(diagnosticsPath)).toBeUndefined();
      const record = JSON.parse(fakeFs.impl.getFile(attributionPath)!) as GateAttribution;
      expect(record.steps).toEqual([{ command: "pnpm audit", surface: "local", result: "fail" }]);
    });

    it("treats non-JSON stdout as a provider error naming the step", async () => {
      const fakeFs = makeFakeFileSystem();
      const fakeShell = makeFakeShell();
      fakeShell.impl.setResponse("pnpm audit", {
        exitCode: 0,
        stdout: "not json at all",
        stderr: "",
      });

      const result = await Effect.runPromise(
        Effect.either(
          runGates({
            steps: [diagnosticsStep("pnpm audit")],
            cwd,
            attemptLogPath: logPath,
            attributionPath,
            phaseId,
          }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        const err = result.left as GateFailedError;
        expect(err).toBeInstanceOf(GateFailedError);
        expect(err.diagnostics).toEqual([]);
        expect(err.message).toContain("pnpm audit");
        expect(err.message).toContain("declared diagnostics output but returned none");
      }
      expect(fakeFs.impl.getFile(diagnosticsPath)).toBeUndefined();
      const record = JSON.parse(fakeFs.impl.getFile(attributionPath)!) as GateAttribution;
      expect(record.steps).toEqual([{ command: "pnpm audit", surface: "local", result: "fail" }]);
    });
  });
});
