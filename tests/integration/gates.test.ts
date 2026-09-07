import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { runGates, type GateScheduling } from "../../src/app/gates.js";
import { GateFailedError } from "../../src/domain/errors.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import type { GateStep, Surface } from "../../src/schemas/phaxConfig.js";
import type { GateAttribution } from "../../src/schemas/gateAttribution.js";
import { makeScopesRequest } from "../../src/domain/plan/projection.js";

const cwd = "/fake/worktrees/my-run/phase-01";
const logPath = "/fake/runs/my-run/phase-01/checks-attempt-01.log";
const attributionPath = "/fake/runs/my-run/phase-01/gate-attribution.json";
const phaseId = "phase-01";

const request = makeScopesRequest(
  [{ id: phaseId, plannedFilesToCreate: [], plannedFilesToEdit: [] }],
  phaseId,
);

/** Default scheduling: non-terminal, no provider registered, request for the
 *  single fake phase. Override per test. */
function scheduling(overrides: Partial<GateScheduling> = {}): GateScheduling {
  return { isTerminal: false, scopesProvider: undefined, request, ...overrides };
}

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
const pendingPath = "/fake/runs/my-run/phase-01/checks-attempt-01.pending.json";

function completionDoc(rule: string, scopes: readonly [string, ...string[]]): string {
  return JSON.stringify({
    diagnostics: [
      {
        rule,
        class: "completion",
        scopes,
        location: { file: "src/core/x.ts" },
        message: `${rule} pending`,
        repair: "wire it up",
      },
    ],
  });
}

describe("runGates", () => {
  it("succeeds when all commands exit 0", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "ok", stderr: "" });

    const outcome = await Effect.runPromise(
      runGates({
        steps: steps("pnpm test", "pnpm lint"),
        cwd,
        scheduling: scheduling(),
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
      runGates({
        steps: steps("pnpm test"),
        cwd,
        scheduling: scheduling(),
        attemptLogPath: logPath,
      }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
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
        runGates({
          steps: steps("pnpm test"),
          cwd,
          scheduling: scheduling(),
          attemptLogPath: logPath,
        }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
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
        runGates({
          steps: steps("pnpm test"),
          cwd,
          scheduling: scheduling(),
          attemptLogPath: logPath,
        }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
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
          steps: steps("pnpm test", "pnpm lint"),
          cwd,
          scheduling: scheduling(),
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
      runGates({
        steps: steps("pnpm test"),
        cwd,
        scheduling: scheduling(),
        attemptLogPath: logPath,
      }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
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
      runGates({
        steps: steps("pnpm test"),
        cwd,
        scheduling: scheduling(),
        attemptLogPath: logPath,
      }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
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
        runGates({
          steps: steps("pnpm test"),
          cwd,
          scheduling: scheduling(),
          attemptLogPath: logPath,
        }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
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
          scheduling: scheduling(),
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
            scheduling: scheduling(),
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
          class: "invariant",
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
            scheduling: scheduling(),
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
          scheduling: scheduling(),
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
            scheduling: scheduling(),
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

    it("treats non-JSON stdout as a provider error naming the step and expected shape", async () => {
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
            scheduling: scheduling(),
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
        expect(err.message).toContain("diagnostics");
        expect(err.message).toContain("rule");
        expect(err.message).toContain("location");
        expect(err.message).toContain("message");
        expect(err.message).toContain("repair");
      }
      expect(fakeFs.impl.getFile(diagnosticsPath)).toBeUndefined();
      const record = JSON.parse(fakeFs.impl.getFile(attributionPath)!) as GateAttribution;
      expect(record.steps).toEqual([{ command: "pnpm audit", surface: "local", result: "fail" }]);
    });

    it("treats a schema-mismatch document as a provider error naming the expected shape", async () => {
      const fakeFs = makeFakeFileSystem();
      const fakeShell = makeFakeShell();
      fakeShell.impl.setResponse("pnpm audit", {
        exitCode: 0,
        stdout: JSON.stringify({ wrong: "shape" }),
        stderr: "",
      });

      const result = await Effect.runPromise(
        Effect.either(
          runGates({
            steps: [diagnosticsStep("pnpm audit")],
            cwd,
            scheduling: scheduling(),
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
        expect(err.message).toContain("diagnostics");
        expect(err.message).toContain("rule");
        expect(err.message).toContain("location");
        expect(err.message).toContain("message");
        expect(err.message).toContain("repair");
      }
      expect(fakeFs.impl.getFile(diagnosticsPath)).toBeUndefined();
      const record = JSON.parse(fakeFs.impl.getFile(attributionPath)!) as GateAttribution;
      expect(record.steps).toEqual([{ command: "pnpm audit", surface: "local", result: "fail" }]);
    });
  });

  describe("scheduling", () => {
    const scopesConfig = { command: "scopes-provider" } as const;

    const invariantDoc = JSON.stringify({
      diagnostics: [
        {
          rule: "no-console",
          class: "invariant",
          location: { file: "src/index.ts", line: 3 },
          message: "no console",
          repair: "remove it",
        },
      ],
    });

    function run(opts: {
      readonly steps: readonly GateStep[];
      readonly scheduling: GateScheduling;
      readonly setup: (shell: ReturnType<typeof makeFakeShell>) => void;
    }) {
      const fakeFs = makeFakeFileSystem();
      const fakeShell = makeFakeShell();
      opts.setup(fakeShell);
      const effect = runGates({
        steps: opts.steps,
        cwd,
        scheduling: opts.scheduling,
        attemptLogPath: logPath,
        attributionPath,
        phaseId,
      }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer)));
      return { fakeFs, fakeShell, effect };
    }

    it("fails an invariant diagnostic whatever the provider answers", async () => {
      const { fakeFs, effect } = run({
        steps: [diagnosticsStep("pnpm audit")],
        scheduling: scheduling({ scopesProvider: scopesConfig }),
        setup: (shell) => {
          shell.impl.setResponse("pnpm audit", { exitCode: 0, stdout: invariantDoc, stderr: "" });
          shell.impl.setResponse("scopes-provider", {
            exitCode: 0,
            stdout: JSON.stringify({ closed: ["core", "adapters"] }),
            stderr: "",
          });
        },
      });

      const result = await Effect.runPromise(Effect.either(effect));

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        const err = result.left as GateFailedError;
        expect(err.diagnostics).toHaveLength(1);
        expect(err.diagnostics[0]?.rule).toBe("no-console");
        expect(err.pending).toEqual([]);
      }
      expect(fakeFs.impl.getFile(pendingPath)).toBeUndefined();
    });

    it("records a completion as pending while a scope is open", async () => {
      const { fakeFs, effect } = run({
        steps: [diagnosticsStep("pnpm audit")],
        scheduling: scheduling({ scopesProvider: scopesConfig }),
        setup: (shell) => {
          shell.impl.setResponse("pnpm audit", {
            exitCode: 0,
            stdout: completionDoc("wire-adapters", ["core", "adapters"]),
            stderr: "",
          });
          shell.impl.setResponse("scopes-provider", {
            exitCode: 0,
            stdout: JSON.stringify({ closed: ["core"] }),
            stderr: "",
          });
        },
      });

      const outcome = await Effect.runPromise(effect);

      expect(outcome.pending).toHaveLength(1);
      expect(outcome.pending[0]?.command).toBe("pnpm audit");
      expect(outcome.pending[0]?.pending[0]?.openScopes).toEqual(["adapters"]);

      const record = JSON.parse(fakeFs.impl.getFile(attributionPath)!) as GateAttribution;
      expect(record.steps).toEqual([
        { command: "pnpm audit", surface: "local", result: "pending" },
      ]);

      const pendingDoc = fakeFs.impl.getFile(pendingPath);
      expect(pendingDoc).toBeDefined();
      const parsed = JSON.parse(pendingDoc!) as { closed: string[]; steps: unknown[] };
      expect(parsed.closed).toEqual(["core"]);

      expect(fakeFs.impl.getFile(diagnosticsPath)).toBeUndefined();
    });

    it("fails a completion once all its scopes are closed", async () => {
      const { fakeFs, effect } = run({
        steps: [diagnosticsStep("pnpm audit")],
        scheduling: scheduling({ scopesProvider: scopesConfig }),
        setup: (shell) => {
          shell.impl.setResponse("pnpm audit", {
            exitCode: 0,
            stdout: completionDoc("wire-adapters", ["core", "adapters"]),
            stderr: "",
          });
          shell.impl.setResponse("scopes-provider", {
            exitCode: 0,
            stdout: JSON.stringify({ closed: ["core", "adapters"] }),
            stderr: "",
          });
        },
      });

      const result = await Effect.runPromise(Effect.either(effect));

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        const err = result.left as GateFailedError;
        expect(err.diagnostics).toHaveLength(1);
        expect(err.diagnostics[0]?.rule).toBe("wire-adapters");
        expect(err.pending).toEqual([]);
      }
      expect(fakeFs.impl.getFile(diagnosticsPath)).toBeDefined();
      expect(fakeFs.impl.getFile(pendingPath)).toBeUndefined();
    });

    it("closes every scope at the terminal phase without querying the provider", async () => {
      const { fakeShell, effect } = run({
        steps: [diagnosticsStep("pnpm audit")],
        scheduling: scheduling({ isTerminal: true, scopesProvider: scopesConfig }),
        setup: (shell) => {
          shell.impl.setResponse("pnpm audit", {
            exitCode: 0,
            stdout: completionDoc("wire-adapters", ["core", "adapters"]),
            stderr: "",
          });
        },
      });

      const result = await Effect.runPromise(Effect.either(effect));

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        const err = result.left as GateFailedError;
        expect(err.diagnostics).toHaveLength(1);
      }
      expect(fakeShell.impl.calls.filter((c) => c.command[0] === "scopes-provider")).toHaveLength(
        0,
      );
    });

    it("queries the provider with the projection before any step runs", async () => {
      const { fakeShell, effect } = run({
        steps: [diagnosticsStep("pnpm audit")],
        scheduling: scheduling({ scopesProvider: scopesConfig }),
        setup: (shell) => {
          shell.impl.setResponse("pnpm audit", {
            exitCode: 0,
            stdout: completionDoc("wire-adapters", ["core"]),
            stderr: "",
          });
          shell.impl.setResponse("scopes-provider", {
            exitCode: 0,
            stdout: JSON.stringify({ closed: [] }),
            stderr: "",
          });
        },
      });

      await Effect.runPromise(effect);

      expect(fakeShell.impl.calls[0]?.command).toEqual(["scopes-provider"]);
      expect(fakeShell.impl.calls[0]?.stdin).toBe(JSON.stringify(request));
      expect(fakeShell.impl.calls[1]?.command).toEqual(["pnpm", "audit"]);
    });

    it("treats a completion with no provider registered as a configuration error", async () => {
      const { fakeFs, fakeShell, effect } = run({
        steps: [diagnosticsStep("pnpm audit")],
        scheduling: scheduling(),
        setup: (shell) => {
          shell.impl.setResponse("pnpm audit", {
            exitCode: 0,
            stdout: completionDoc("wire-adapters", ["core"]),
            stderr: "",
          });
        },
      });

      const result = await Effect.runPromise(Effect.either(effect));

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        const err = result.left as GateFailedError;
        expect(err.message).toContain("scopes");
        expect(err.message).toContain("phax.json");
        expect(err.diagnostics).toEqual([]);
        expect(err.pending).toEqual([]);
      }
      expect(fakeShell.impl.calls.filter((c) => c.command[0] === "scopes-provider")).toHaveLength(
        0,
      );
      expect(fakeFs.impl.getFile(diagnosticsPath)).toBeDefined();
      const record = JSON.parse(fakeFs.impl.getFile(attributionPath)!) as GateAttribution;
      expect(record.steps).toEqual([{ command: "pnpm audit", surface: "local", result: "fail" }]);
    });

    it("fails the gate when the scope provider exits non-zero, before any step runs", async () => {
      const { fakeFs, fakeShell, effect } = run({
        steps: [diagnosticsStep("pnpm audit")],
        scheduling: scheduling({ scopesProvider: scopesConfig }),
        setup: (shell) => {
          shell.impl.setResponse("pnpm audit", {
            exitCode: 0,
            stdout: completionDoc("wire-adapters", ["core"]),
            stderr: "",
          });
          shell.impl.setResponse("scopes-provider", { exitCode: 1, stdout: "", stderr: "boom" });
        },
      });

      const result = await Effect.runPromise(Effect.either(effect));

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        const err = result.left as GateFailedError;
        expect(err.command).toBe("scopes-provider");
        expect(err.exitCode).toBe(1);
        expect(err.message).toContain("Scope provider");
      }
      expect(fakeShell.impl.calls.filter((c) => c.command[0] === "pnpm")).toHaveLength(0);
      const record = JSON.parse(fakeFs.impl.getFile(attributionPath)!) as GateAttribution;
      expect(record.steps).toEqual([]);
    });

    it("fails the gate when the scope provider returns non-JSON", async () => {
      const { effect } = run({
        steps: [diagnosticsStep("pnpm audit")],
        scheduling: scheduling({ scopesProvider: scopesConfig }),
        setup: (shell) => {
          shell.impl.setResponse("pnpm audit", {
            exitCode: 0,
            stdout: completionDoc("wire-adapters", ["core"]),
            stderr: "",
          });
          shell.impl.setResponse("scopes-provider", {
            exitCode: 0,
            stdout: "not json",
            stderr: "",
          });
        },
      });

      const result = await Effect.runPromise(Effect.either(effect));

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        const err = result.left as GateFailedError;
        expect(err.command).toBe("scopes-provider");
        expect(err.message).toContain("invalid JSON");
      }
    });

    it("splits a mixed document into failing invariants and pending completions", async () => {
      const mixedDoc = JSON.stringify({
        diagnostics: [
          {
            rule: "no-console",
            class: "invariant",
            location: { file: "src/index.ts", line: 3 },
            message: "no console",
            repair: "remove it",
          },
          {
            rule: "wire-adapters",
            class: "completion",
            scopes: ["core"],
            location: { file: "src/core/x.ts" },
            message: "wire it",
            repair: "wire it up",
          },
        ],
      });

      const { fakeFs, effect } = run({
        steps: [diagnosticsStep("pnpm audit")],
        scheduling: scheduling({ scopesProvider: scopesConfig }),
        setup: (shell) => {
          shell.impl.setResponse("pnpm audit", { exitCode: 0, stdout: mixedDoc, stderr: "" });
          shell.impl.setResponse("scopes-provider", {
            exitCode: 0,
            stdout: JSON.stringify({ closed: [] }),
            stderr: "",
          });
        },
      });

      const result = await Effect.runPromise(Effect.either(effect));

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        const err = result.left as GateFailedError;
        expect(err.diagnostics).toHaveLength(1);
        expect(err.diagnostics[0]?.class).toBe("invariant");
        expect(err.pending).toHaveLength(1);
        expect(err.pending[0]?.pending[0]?.diagnostic.rule).toBe("wire-adapters");
      }
      expect(fakeFs.impl.getFile(pendingPath)).toBeDefined();
    });

    it("carries earlier pending on a later plain-step failure and writes the pending file", async () => {
      const { fakeFs, effect } = run({
        steps: [diagnosticsStep("pnpm audit"), stepWithSurface("pnpm test", "local")],
        scheduling: scheduling({ scopesProvider: scopesConfig }),
        setup: (shell) => {
          shell.impl.setResponse("pnpm audit", {
            exitCode: 0,
            stdout: completionDoc("wire-adapters", ["core"]),
            stderr: "",
          });
          shell.impl.setResponse("scopes-provider", {
            exitCode: 0,
            stdout: JSON.stringify({ closed: [] }),
            stderr: "",
          });
          shell.impl.setResponse("pnpm test", { exitCode: 1, stdout: "", stderr: "fail" });
        },
      });

      const result = await Effect.runPromise(Effect.either(effect));

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        const err = result.left as GateFailedError;
        expect(err.command).toBe("pnpm test");
        expect(err.pending).toHaveLength(1);
        expect(err.pending[0]?.command).toBe("pnpm audit");
      }
      expect(fakeFs.impl.getFile(pendingPath)).toBeDefined();
    });

    it("leaves pending empty for a passing plain profile", async () => {
      const fakeFs = makeFakeFileSystem();
      const fakeShell = makeFakeShell();
      fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "", stderr: "" });

      const outcome = await Effect.runPromise(
        runGates({
          steps: steps("pnpm test"),
          cwd,
          scheduling: scheduling(),
          attemptLogPath: logPath,
        }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
      );

      expect(outcome.pending).toEqual([]);
      expect(fakeFs.impl.getFile(pendingPath)).toBeUndefined();
    });
  });
});
