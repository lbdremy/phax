import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { runGates, serializeGateRequest } from "../../src/app/gates.js";
import { makeGateRequest } from "../../src/domain/gate/gateRequest.js";
import { selectGateSteps } from "../../src/domain/gate/selectSteps.js";
import { GateFailedError } from "../../src/domain/errors.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import type { GateStep } from "../../src/schemas/phaxConfig.js";
import type { Surface } from "../../src/schemas/surface.js";
import type { GateAttribution } from "../../src/schemas/gateAttribution.js";
import { decodeGateDiagnosticsFile } from "../../src/schemas/gateDiagnostics.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import { CURRENT_STAMPS, PHAX_RELEASE } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

const cwd = "/fake/worktrees/my-run/phase-01";
const logPath = "/fake/runs/my-run/phase-01/checks-attempt-01.log";
const attributionPath = "/fake/runs/my-run/phase-01/gate-attribution.json";
const phaseId = "phase-01";
// A made-up gate request; only declaring steps ever see it.
const gateRequest = serializeGateRequest(
  makeGateRequest({
    phaseId,
    base: "0123456789abcdef0123456789abcdef01234567",
    terminal: false,
    phases: [
      { id: "phase-01", plannedFilesToCreate: ["src/greet.ts"], plannedFilesToEdit: [] },
      { id: "phase-02", plannedFilesToCreate: [], plannedFilesToEdit: ["src/greet.ts"] },
    ],
  }),
);

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

/** The document a diagnostics step prints: `$schema` naming gate-diagnostics at `release`. */
function printed(
  diagnostics: ReadonlyArray<object>,
  release: string = CURRENT_STAMPS["gate-diagnostics"],
): string {
  return JSON.stringify({ $schema: schemaUrl("gate-diagnostics", release), diagnostics });
}

// The expected document every malformed-answer error states, verbatim.
const expectedDocument = `expected {"$schema": "${currentSchemaUrl("gate-diagnostics")}", "diagnostics": [{"rule", "class": "invariant"|"completion", "location": {"file", "line"?}, "message", "repair"}]} on stdout`;

describe("runGates", () => {
  it("succeeds when all commands exit 0", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "ok", stderr: "" });

    const outcome = await Effect.runPromise(
      runGates({
        steps: steps("pnpm test", "pnpm lint"),
        cwd,
        attemptLogPath: logPath,
        gateRequest,
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
        attemptLogPath: logPath,
        gateRequest,
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
          attemptLogPath: logPath,
          gateRequest,
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
          attemptLogPath: logPath,
          gateRequest,
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
          attemptLogPath: logPath,
          gateRequest,
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
        attemptLogPath: logPath,
        gateRequest,
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
        attemptLogPath: logPath,
        gateRequest,
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
          attemptLogPath: logPath,
          gateRequest,
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
          attemptLogPath: logPath,
          gateRequest,
          attributionPath,
          phaseId,
        }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
      );

      const raw = fakeFs.impl.getFile(attributionPath);
      expect(raw).toBeDefined();
      const record = JSON.parse(raw!) as GateAttribution;
      expect(Object.keys(record)[0]).toBe("$schema");
      expect(record).toHaveProperty("$schema", currentSchemaUrl("gate-attribution"));
      expect(record).not.toHaveProperty("version");
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
            gateRequest,
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
    const consoleFinding = {
      rule: "no-console",
      class: "invariant",
      location: { file: "src/index.ts", line: 12 },
      message: "Unexpected console statement",
      repair: "Remove the console.log call",
    } as const;
    const oneDiagnostic = printed([consoleFinding]);

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
            gateRequest,
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
      const written = JSON.parse(doc!) as Record<string, unknown>;
      expect(Object.keys(written)[0]).toBe("$schema");
      expect(written).toEqual({
        $schema: currentSchemaUrl("gate-diagnostics"),
        diagnostics: [consoleFinding],
      });
    });

    it("passes on exit 0 with an empty list and writes no diagnostics file", async () => {
      const fakeFs = makeFakeFileSystem();
      const fakeShell = makeFakeShell();
      fakeShell.impl.setResponse("pnpm audit", {
        exitCode: 0,
        stdout: printed([]),
        stderr: "",
      });

      const outcome = await Effect.runPromise(
        runGates({
          steps: [diagnosticsStep("pnpm audit")],
          cwd,
          attemptLogPath: logPath,
          gateRequest,
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
        stdout: printed([]),
        stderr: "",
      });

      const result = await Effect.runPromise(
        Effect.either(
          runGates({
            steps: [diagnosticsStep("pnpm audit")],
            cwd,
            attemptLogPath: logPath,
            gateRequest,
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
            attemptLogPath: logPath,
            gateRequest,
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
        stdout: JSON.stringify({
          $schema: currentSchemaUrl("gate-diagnostics"),
          wrong: "shape",
        }),
        stderr: "",
      });

      const result = await Effect.runPromise(
        Effect.either(
          runGates({
            steps: [diagnosticsStep("pnpm audit")],
            cwd,
            attemptLogPath: logPath,
            gateRequest,
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

  describe("the versioned document", () => {
    const cycle = {
      rule: "no-cycles",
      class: "invariant",
      location: { file: "src/example/a.ts", line: 2 },
      message: "a imports b, which imports a",
      repair: "move the shared type into its own module",
    } as const;

    async function gate(
      stdout: string,
      exitCode = 0,
      gateSteps: readonly GateStep[] = [diagnosticsStep("node ./audit.mjs")],
    ) {
      const fakeFs = makeFakeFileSystem();
      const fakeShell = makeFakeShell();
      fakeShell.impl.setResponse("node ./audit.mjs", { exitCode, stdout, stderr: "" });
      const result = await Effect.runPromise(
        Effect.either(
          runGates({
            steps: gateSteps,
            cwd,
            attemptLogPath: logPath,
            gateRequest,
            attributionPath,
            phaseId,
          }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
        ),
      );
      const attribution = JSON.parse(fakeFs.impl.getFile(attributionPath)!) as GateAttribution;
      return {
        result,
        error: Either.isLeft(result) ? (result.left as GateFailedError) : undefined,
        log: fakeFs.impl.getFile(logPath)!,
        saved: fakeFs.impl.getFile(diagnosticsPath),
        results: attribution.steps.map((step) => step.result),
      };
    }

    it("passes an empty list at the current stamp on exit 0", async () => {
      const { result, saved, results } = await gate(printed([]));
      expect(Either.isRight(result)).toBe(true);
      expect(saved).toBeUndefined();
      expect(results).toEqual(["pass"]);
    });

    it("treats an empty list at the current stamp on a non-zero exit as a provider error", async () => {
      const { error, saved, results } = await gate(printed([]), 1);
      expect(error?.message).toBe('Gate step "node ./audit.mjs" exited 1 with no diagnostics');
      expect(error?.diagnostics).toEqual([]);
      expect(saved).toBeUndefined();
      expect(results).toEqual(["fail"]);
    });

    it("states the expected document, with the current stamp, when stdout is not JSON", async () => {
      const { error, log, saved, results } = await gate("not json");
      expect(error?.message).toContain(
        "declared diagnostics output but returned none: invalid JSON",
      );
      expect(error?.message).toContain(expectedDocument);
      expect(log).toContain(`provider error: step declared diagnostics output but returned none`);
      expect(log).toContain(expectedDocument);
      expect(saved).toBeUndefined();
      expect(results).toEqual(["fail"]);
    });

    it.each([
      ["no $schema", JSON.stringify({ diagnostics: [] })],
      [
        "a gate-attribution $schema",
        JSON.stringify({ $schema: currentSchemaUrl("gate-attribution"), diagnostics: [] }),
      ],
      ["a gate-diagnostics 0.18.0 $schema", printed([], "0.18.0")],
    ])("fails a document with %s as malformed", async (_name, stdout) => {
      const { error, saved, results } = await gate(stdout);
      expect(error).toBeInstanceOf(GateFailedError);
      expect(error?.message).toContain("declared diagnostics output but returned none");
      expect(error?.message.endsWith(expectedDocument)).toBe(true);
      expect(error?.diagnostics).toEqual([]);
      expect(saved).toBeUndefined();
      expect(results).toEqual(["fail"]);
    });

    it("refuses a newer release by name, states the expected document and lists none of its findings", async () => {
      const { error, log, saved, results } = await gate(printed([cycle], "99.0.0"), 1);
      const refusal = `gate-diagnostics 99.0.0 is newer than this phax (${PHAX_RELEASE}) — upgrade phax to read it — ${expectedDocument}`;
      expect(error?.message).toBe(`Gate step "node ./audit.mjs": ${refusal}`);
      expect(error?.diagnostics).toEqual([]);
      expect(log).toContain(`provider error: ${refusal}`);
      expect(saved).toBeUndefined();
      expect(results).toEqual(["fail"]);
    });

    it("refuses an older shape, naming the URL phax reads, and lists none of its findings", async () => {
      // A made-up stamp between the last saved-file-only release and the current stamp.
      const { error, log, saved, results } = await gate(printed([cycle], "0.19.5"), 1);
      const refusal = `gate-diagnostics 0.19.5 is an older shape — this phax reads ${currentSchemaUrl("gate-diagnostics")}`;
      expect(error?.message).toBe(`Gate step "node ./audit.mjs": ${refusal}`);
      expect(error?.diagnostics).toEqual([]);
      expect(log).toContain(`provider error: ${refusal}`);
      expect(saved).toBeUndefined();
      expect(results).toEqual(["fail"]);
    });

    it("keeps the print verbatim in the log and re-stamps the saved file", async () => {
      const print = JSON.stringify({
        $schema: currentSchemaUrl("gate-diagnostics"),
        diagnostics: [cycle],
        generator: "audit.mjs",
      });
      const { error, log, saved } = await gate(print, 1);
      expect(error?.diagnostics).toEqual([cycle]);
      expect(log.split("\n")).toContain(print);
      const file = JSON.parse(saved!) as Record<string, unknown>;
      expect(Object.keys(file)).toEqual(["$schema", "diagnostics"]);
      expect(file).toEqual({
        $schema: currentSchemaUrl("gate-diagnostics"),
        diagnostics: [cycle],
      });
    });

    it("fails a stamped completion finding on a non-terminal phase and saves the current shape", async () => {
      const completion = {
        rule: "wire-adapters",
        class: "completion",
        location: { file: "src/example/b.ts" },
        message: "the adapter is not wired",
        repair: "wire it up",
      } as const;
      const nonTerminal = selectGateSteps([diagnosticsStep("node ./audit.mjs")], false);
      const { error, saved, results } = await gate(printed([completion]), 0, nonTerminal);
      expect(error?.diagnostics).toEqual([completion]);
      expect(results).toEqual(["fail"]);
      expect(decodeGateDiagnosticsFile(JSON.parse(saved!))).toEqual(
        Either.right({
          $schema: currentSchemaUrl("gate-diagnostics"),
          diagnostics: [completion],
        }),
      );
    });
  });

  describe("verdict", () => {
    const completion = {
      rule: "wire-adapters",
      class: "completion",
      location: { file: "src/core/x.ts" },
      message: "the adapter is not wired",
      repair: "wire it up",
    } as const;

    const invariant = {
      rule: "no-console",
      class: "invariant",
      location: { file: "src/index.ts", line: 3 },
      message: "no console",
      repair: "remove it",
    } as const;

    const auditStep: GateStep = {
      command: "node ./audit.mjs",
      surface: "structural",
      firing: "every-phase",
      output: "diagnostics",
    };

    function run(opts: {
      readonly steps: readonly GateStep[];
      readonly setup: (shell: ReturnType<typeof makeFakeShell>) => void;
      readonly fakeFs?: ReturnType<typeof makeFakeFileSystem>;
      readonly attemptLogPath?: string;
    }) {
      const fakeFs = opts.fakeFs ?? makeFakeFileSystem();
      const fakeShell = makeFakeShell();
      opts.setup(fakeShell);
      const effect = runGates({
        steps: opts.steps,
        cwd,
        attemptLogPath: opts.attemptLogPath ?? logPath,
        gateRequest,
        attributionPath,
        phaseId,
      }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer)));
      return { fakeFs, fakeShell, effect };
    }

    it("fails a completion finding on a non-terminal phase, records fail and saves the file", async () => {
      const { fakeFs, effect } = run({
        steps: selectGateSteps([auditStep], false),
        setup: (shell) => {
          shell.impl.setResponse("node ./audit.mjs", {
            exitCode: 0,
            stdout: printed([completion]),
            stderr: "",
          });
        },
      });

      const result = await Effect.runPromise(Effect.either(effect));

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        const err = result.left as GateFailedError;
        expect(err).toBeInstanceOf(GateFailedError);
        expect(err.message).toBe("Gate command failed: node ./audit.mjs (1 diagnostic(s))");
        expect(err.diagnostics).toEqual([completion]);
      }
      const record = JSON.parse(fakeFs.impl.getFile(attributionPath)!) as GateAttribution;
      expect(record.steps).toEqual([
        { command: "node ./audit.mjs", surface: "structural", result: "fail" },
      ]);
      expect(JSON.parse(fakeFs.impl.getFile(diagnosticsPath)!)).toEqual({
        $schema: currentSchemaUrl("gate-diagnostics"),
        diagnostics: [completion],
      });
    });

    it("gives the same verdict, file and failure on a terminal and a non-terminal phase", async () => {
      const outcomes = await Promise.all(
        [false, true].map(async (isTerminal) => {
          const { fakeFs, effect } = run({
            steps: selectGateSteps([auditStep], isTerminal),
            setup: (shell) => {
              shell.impl.setResponse("node ./audit.mjs", {
                exitCode: 1,
                stdout: printed([completion, invariant]),
                stderr: "",
              });
            },
          });
          const result = await Effect.runPromise(Effect.either(effect));
          if (Either.isRight(result)) throw new Error("the gate passed");
          const err = result.left as GateFailedError;
          return {
            message: err.message,
            command: err.command,
            exitCode: err.exitCode,
            diagnostics: err.diagnostics,
            saved: fakeFs.impl.getFile(diagnosticsPath),
            attribution: fakeFs.impl.getFile(attributionPath),
          };
        }),
      );

      expect(outcomes[0]?.diagnostics).toEqual([completion, invariant]);
      expect(outcomes[0]?.message).toBe("Gate command failed: node ./audit.mjs (2 diagnostic(s))");
      expect(outcomes[1]).toEqual(outcomes[0]);
    });

    it("starts only the selected steps and logs only their entries", async () => {
      const { fakeFs, fakeShell, effect } = run({
        steps: selectGateSteps(
          [
            { command: "pnpm test", surface: "local", firing: "every-phase", output: "log" },
            auditStep,
          ],
          false,
        ),
        setup: (shell) => {
          shell.impl.setResponse("pnpm test", { exitCode: 0, stdout: "ok", stderr: "" });
          shell.impl.setResponse("node ./audit.mjs", {
            exitCode: 0,
            stdout: printed([]),
            stderr: "",
          });
        },
      });

      await Effect.runPromise(effect);

      expect(fakeShell.impl.calls.map((call) => call.command)).toEqual([
        ["pnpm", "test"],
        ["node", "./audit.mjs"],
      ]);
      const log = fakeFs.impl.getFile(logPath)!.split("\n");
      expect(log.filter((line) => line.startsWith("$ "))).toEqual([
        "$ pnpm test",
        "$ node ./audit.mjs",
      ]);
      expect(log.some((line) => line.startsWith("stdin:"))).toBe(false);
    });

    it("records only pass or fail and writes only diagnostics files beside the log", async () => {
      const fakeFs = makeFakeFileSystem();
      const answers = [[completion], [invariant, completion], []];
      const results: string[] = [];
      for (const [index, answer] of answers.entries()) {
        const attemptLogPath = `/fake/runs/my-run/phase-01/checks-attempt-0${index + 1}.log`;
        const { effect } = run({
          fakeFs,
          attemptLogPath,
          steps: [auditStep],
          setup: (shell) => {
            shell.impl.setResponse("node ./audit.mjs", {
              exitCode: 0,
              stdout: printed(answer),
              stderr: "",
            });
          },
        });
        await Effect.runPromise(Effect.either(effect));
        const record = JSON.parse(fakeFs.impl.getFile(attributionPath)!) as GateAttribution;
        results.push(...record.steps.map((step) => step.result));
      }

      expect(results).toEqual(["fail", "fail", "pass"]);
      expect(
        [...fakeFs.impl.files.keys()].filter(
          (path) => /\.[a-z]+\.json$/.test(path) && !path.endsWith(".diagnostics.json"),
        ),
      ).toEqual([]);
    });

    it("keeps the profile order, the stop at the first failure, terminal firing and attribution", async () => {
      const profile: readonly GateStep[] = [
        { command: "pnpm lint", surface: "local", firing: "every-phase", output: "log" },
        auditStep,
        { command: "pnpm test", surface: "local", firing: "every-phase", output: "log" },
        { command: "pnpm build", surface: "product", firing: "terminal", output: "log" },
      ];
      expect(selectGateSteps(profile, false).map((step) => step.command)).toEqual([
        "pnpm lint",
        "node ./audit.mjs",
        "pnpm test",
      ]);
      expect(selectGateSteps(profile, true).map((step) => step.command)).toEqual([
        "pnpm lint",
        "node ./audit.mjs",
        "pnpm test",
        "pnpm build",
      ]);

      const { fakeFs, fakeShell, effect } = run({
        steps: selectGateSteps(profile, true),
        setup: (shell) => {
          shell.impl.setDefaultResponse({ exitCode: 0, stdout: "", stderr: "" });
          shell.impl.setResponse("node ./audit.mjs", {
            exitCode: 0,
            stdout: printed([completion]),
            stderr: "",
          });
        },
      });

      const result = await Effect.runPromise(Effect.either(effect));

      expect(Either.isLeft(result)).toBe(true);
      expect(fakeShell.impl.calls.map((call) => call.command.join(" "))).toEqual([
        "pnpm lint",
        "node ./audit.mjs",
      ]);
      const record = JSON.parse(fakeFs.impl.getFile(attributionPath)!) as GateAttribution;
      expect(record.steps).toEqual([
        { command: "pnpm lint", surface: "local", result: "pass" },
        { command: "node ./audit.mjs", surface: "structural", result: "fail" },
      ]);
    });
  });
});

function plainStep(command: string, extra: Partial<GateStep> = {}): GateStep {
  return { command, surface: "structural", firing: "every-phase", output: "log", ...extra };
}

function declaring(command: string, extra: Partial<GateStep> = {}): GateStep {
  return plainStep(command, { input: "gate-request", ...extra });
}

/** The log line right after `line`, or undefined when `line` is absent. */
function lineAfter(lines: readonly string[], line: string): string | undefined {
  const index = lines.indexOf(line);
  return index === -1 ? undefined : lines[index + 1];
}

/** A temp dir holding the made-up scripts, and the attempt's paths in it. */
interface Workspace {
  readonly dir: string;
  readonly logPath: string;
  readonly requestPath: string;
  readonly attributionPath: string;
}

function runReal(ws: Workspace, gateSteps: readonly GateStep[], request: string = gateRequest) {
  return Effect.runPromise(
    Effect.either(
      runGates({
        steps: gateSteps,
        cwd: ws.dir,
        attemptLogPath: ws.logPath,
        attributionPath: ws.attributionPath,
        phaseId,
        gateRequest: request,
      }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystemLayer, NodeShellLayer))),
    ),
  );
}

function readLogLines(ws: Workspace): string[] {
  return readFileSync(ws.logPath, "utf8").split("\n");
}

function readAttribution(ws: Workspace): GateAttribution {
  return JSON.parse(readFileSync(ws.attributionPath, "utf8")) as GateAttribution;
}

// The request on stdin, through the real Node shell so the pipe behaviour is
// exercised. Every script and request is made up and lives in a temp dir.
describe("runGates with a declaring step (Node shell)", () => {
  const finding = {
    rule: "no-node-io",
    class: "invariant",
    location: { file: "src/io.ts" },
    message: "src/io.ts imports node:fs",
    repair: "move the I/O behind a port",
  };
  const scripts: Readonly<Record<string, string>> = {
    // Copies stdin to the file named by its argument, then summarises it.
    "echo.mjs": [
      'import { writeFileSync } from "node:fs";',
      'let input = "";',
      "for await (const chunk of process.stdin) input += chunk;",
      'writeFileSync(process.argv[2] ?? "stdin-copy.json", input);',
      "const request = JSON.parse(input);",
      "console.log(`phase=${request.phase} base=${request.base} terminal=${request.terminal} bytes=${Buffer.byteLength(input)}`);",
    ].join("\n"),
    // Counts the bytes it reads on stdin.
    "count.mjs": [
      "let bytes = 0;",
      "for await (const chunk of process.stdin) bytes += chunk.length;",
      "console.log(`bytes=${bytes}`);",
    ].join("\n"),
    // Exits with its argument at once, never reading stdin.
    "exit.mjs": "process.exit(Number(process.argv[2] ?? 0));",
    // Reads stdin to end of file, then reports one finding.
    "diag.mjs": [
      "for await (const _ of process.stdin);",
      `console.log(${JSON.stringify(printed([finding]))});`,
    ].join("\n"),
  };

  const tempDirs: string[] = [];
  afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  function workspace(): Workspace {
    const dir = mkdtempSync(join(tmpdir(), "phax-gate-request-"));
    tempDirs.push(dir);
    for (const [name, content] of Object.entries(scripts)) {
      writeFileSync(join(dir, name), content);
    }
    const phaseFolder = join(dir, "phase-01");
    mkdirSync(phaseFolder);
    return {
      dir,
      logPath: join(phaseFolder, "checks-attempt-01.log"),
      requestPath: join(phaseFolder, "checks-attempt-01.request.json"),
      attributionPath: join(phaseFolder, "gate-attribution.json"),
    };
  }

  it("saves exactly the bytes a declaring step reads to end of file", async () => {
    const ws = workspace();

    const result = await runReal(ws, [declaring("node ./echo.mjs copy.json")]);

    expect(Either.isRight(result)).toBe(true);
    const saved = readFileSync(ws.requestPath);
    expect(readFileSync(join(ws.dir, "copy.json")).equals(saved)).toBe(true);
    expect(saved.toString("utf8")).toBe(gateRequest);
  });

  it("writes the same bytes to every declaring step of the attempt", async () => {
    const ws = workspace();

    await runReal(ws, [declaring("node ./echo.mjs a.json"), declaring("node ./echo.mjs b.json")]);

    const saved = readFileSync(ws.requestPath);
    expect(readFileSync(join(ws.dir, "a.json")).equals(saved)).toBe(true);
    expect(readFileSync(join(ws.dir, "b.json")).equals(saved)).toBe(true);
    expect(readLogLines(ws).filter((line) => line.startsWith("stdin:"))).toEqual([
      "stdin: checks-attempt-01.request.json",
      "stdin: checks-attempt-01.request.json",
    ]);
  });

  it("leaves a non-declaring step's stdin unconnected: no bytes, no line, no file", async () => {
    const ws = workspace();

    const result = await runReal(ws, [plainStep("node ./count.mjs")]);

    expect(Either.isRight(result)).toBe(true);
    const lines = readLogLines(ws);
    expect(lineAfter(lines, "$ node ./count.mjs")).toBe("bytes=0");
    expect(lines.some((line) => line.startsWith("stdin:"))).toBe(false);
    expect(existsSync(ws.requestPath)).toBe(false);
  });

  it("writes no request when a non-declaring step fails before the declaring one", async () => {
    const ws = workspace();

    const result = await runReal(ws, [
      plainStep("node ./exit.mjs 1"),
      declaring("node ./echo.mjs"),
    ]);

    expect(Either.isLeft(result)).toBe(true);
    expect(existsSync(ws.requestPath)).toBe(false);
    expect(readLogLines(ws).some((line) => line.startsWith("stdin:"))).toBe(false);
  });

  it("logs the stdin line directly after the declaring step's $ line only", async () => {
    const ws = workspace();
    writeFileSync(join(ws.dir, "audit.mjs"), scripts["echo.mjs"]!);

    await runReal(ws, [plainStep("node ./count.mjs"), declaring("node ./audit.mjs")]);

    const lines = readLogLines(ws);
    expect(lineAfter(lines, "$ node ./audit.mjs")).toBe("stdin: checks-attempt-01.request.json");
    expect(lineAfter(lines, "$ node ./count.mjs")).toBe("bytes=0");
  });

  it("keeps the exit-code verdict for a declaring log step", async () => {
    for (const [code, verdict] of [
      [0, "pass"],
      [1, "fail"],
    ] as const) {
      const ws = workspace();
      await runReal(ws, [declaring(`node ./exit.mjs ${code}`)]);
      expect(readAttribution(ws).steps.map((s) => s.result)).toEqual([verdict]);
    }
  });

  it("fails a declaring diagnostics step that reports one finding", async () => {
    const ws = workspace();

    const result = await runReal(ws, [declaring("node ./diag.mjs", { output: "diagnostics" })]);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect((result.left as GateFailedError).diagnostics).toEqual([finding]);
    }
    expect(readAttribution(ws).steps.map((s) => s.result)).toEqual(["fail"]);
  });

  it("passes a declaring step that exits at once without reading a request over 128 KiB", async () => {
    const ws = workspace();
    const large = serializeGateRequest(
      makeGateRequest({
        phaseId,
        base: "0123456789abcdef0123456789abcdef01234567",
        terminal: false,
        phases: [
          {
            id: "phase-01",
            plannedFilesToCreate: Array.from(
              { length: 5000 },
              (_, i) => `src/generated/module-${String(i).padStart(4, "0")}.ts`,
            ),
            plannedFilesToEdit: [],
          },
        ],
      }),
    );
    expect(Buffer.byteLength(large)).toBeGreaterThan(128 * 1024);

    const result = await runReal(ws, [declaring("node ./exit.mjs 0")], large);

    expect(Either.isRight(result)).toBe(true);
    expect(readFileSync(ws.requestPath, "utf8")).toBe(large);
  });

  it("replays the step's gate-time output from the saved request", async () => {
    const ws = workspace();
    await runReal(ws, [declaring("node ./echo.mjs")]);
    const gateTime = lineAfter(readLogLines(ws), "stdin: checks-attempt-01.request.json");

    // node echo.mjs < phase-01/checks-attempt-01.request.json
    const fd = openSync(ws.requestPath, "r");
    const replay = spawnSync(process.execPath, ["echo.mjs", "replay.json"], {
      cwd: ws.dir,
      stdio: [fd, "pipe", "pipe"],
      encoding: "utf8",
    });
    closeSync(fd);

    expect(replay.status).toBe(0);
    expect(gateTime).toMatch(/^phase=phase-01 base=[0-9a-f]{40} terminal=false bytes=\d+$/);
    expect(replay.stdout.trimEnd()).toBe(gateTime);
  });
});
