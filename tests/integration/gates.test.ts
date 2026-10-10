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
import { GateFailedError, GateStepRefusedError } from "../../src/domain/errors.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import type { GateStep } from "../../src/schemas/phaxConfig.js";
import type { Surface } from "../../src/schemas/surface.js";
import type { GateAttribution } from "../../src/schemas/gateAttribution.js";
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

/** A checked report stamped gate-report at `release`. */
function stamped(findings: ReadonlyArray<object>, release: string): string {
  return JSON.stringify({
    $schema: schemaUrl("gate-report", release),
    outcome: "checked",
    findings,
    review: [],
  });
}

/** A checked report at the current stamp. */
function report(findings: ReadonlyArray<object>): string {
  return JSON.stringify({
    $schema: currentSchemaUrl("gate-report"),
    outcome: "checked",
    findings,
    review: [],
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

  describe("the versioned report", () => {
    const reportUrl = currentSchemaUrl("gate-report");
    const cycle = {
      id: "no-cycles src/example/a.ts",
      rule: "no module imports itself through another",
      location: { file: "src/example/a.ts", lines: [2, 2] },
      message: "a imports b, which imports a",
      related: [],
      guide: null,
    } as const;

    async function gate(stdout: string, exitCode = 0) {
      const fakeFs = makeFakeFileSystem();
      const fakeShell = makeFakeShell();
      fakeShell.impl.setResponse("node ./audit.mjs", { exitCode, stdout, stderr: "" });
      const result = await Effect.runPromise(
        Effect.either(
          runGates({
            steps: [reportStep("node ./audit.mjs")],
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
        saved: savedReports(fakeFs),
        results: attribution.steps.map((step) => step.result),
      };
    }

    it("refuses a document without $schema, naming the URL phax reads", async () => {
      const { error, log, saved, results } = await gate(
        JSON.stringify({ outcome: "checked", findings: [cycle], review: [] }),
        1,
      );
      const refusal = `a gate-report document carries $schema; this phax reads ${reportUrl}`;
      expect(error?.message).toBe(`Gate step "node ./audit.mjs": ${refusal}`);
      expect(error?.reportFindings).toBeNull();
      expect(log).toContain(`provider error: ${refusal}`);
      expect(saved).toEqual([]);
      expect(results).toEqual(["fail"]);
    });

    it("refuses a newer release by name and lists none of its findings", async () => {
      const { error, log, saved, results } = await gate(stamped([cycle], "99.0.0"), 1);
      const refusal = `gate-report 99.0.0 is newer than this phax (${PHAX_RELEASE}) — upgrade phax to read it; this phax reads ${reportUrl}`;
      expect(error?.message).toBe(`Gate step "node ./audit.mjs": ${refusal}`);
      expect(error?.reportFindings).toBeNull();
      expect(log).toContain(`provider error: ${refusal}`);
      expect(saved).toEqual([]);
      expect(results).toEqual(["fail"]);
    });

    it("refuses an older shape, naming the URL phax reads, and lists none of its findings", async () => {
      // A made-up stamp below the current one.
      const { error, log, saved, results } = await gate(stamped([cycle], "0.20.0"), 1);
      const refusal = `gate-report 0.20.0 is an older shape — this phax reads ${reportUrl}`;
      expect(error?.message).toBe(`Gate step "node ./audit.mjs": ${refusal}`);
      expect(error?.reportFindings).toBeNull();
      expect(log).toContain(`provider error: ${refusal}`);
      expect(saved).toEqual([]);
      expect(results).toEqual(["fail"]);
    });

    it("names the saved report in the log, in place of its text", async () => {
      const print = stamped([cycle], CURRENT_STAMPS["gate-report"]);
      const { error, log, saved } = await gate(print, 1);
      expect(error?.reportFindings).toEqual({ step: 1, findings: [cycle] });
      expect(log.split("\n")).toContain("report: checks-attempt-01.report-01.json");
      expect(log).not.toContain(print);
      expect(saved).toHaveLength(1);
    });
  });

  describe("verdict", () => {
    const wiring = {
      id: "wire-adapters src/core/x.ts",
      rule: "every adapter is wired",
      location: { file: "src/core/x.ts", lines: null },
      message: "the adapter is not wired",
      related: [],
      guide: null,
    } as const;

    const noConsole = {
      id: "no-console src/index.ts",
      rule: "no console call ships",
      location: { file: "src/index.ts", lines: [3, 3] },
      message: "no console",
      related: [],
      guide: null,
    } as const;

    const auditStep: GateStep = reportStep("node ./audit.mjs");

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

    it("gives the same verdict, file and failure on a terminal and a non-terminal phase", async () => {
      const reportPath = "/fake/runs/my-run/phase-01/checks-attempt-01.report-01.json";
      const outcomes = await Promise.all(
        [false, true].map(async (isTerminal) => {
          const { fakeFs, effect } = run({
            steps: selectGateSteps([auditStep], isTerminal),
            setup: (shell) => {
              shell.impl.setResponse("node ./audit.mjs", {
                exitCode: 1,
                stdout: report([wiring, noConsole]),
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
            reportFindings: err.reportFindings,
            saved: fakeFs.impl.getFile(reportPath),
            attribution: fakeFs.impl.getFile(attributionPath),
          };
        }),
      );

      expect(outcomes[0]?.reportFindings).toEqual({ step: 1, findings: [wiring, noConsole] });
      expect(outcomes[0]?.message).toBe("Gate command failed: node ./audit.mjs (2 findings)");
      expect(outcomes[0]?.saved).toBe(report([wiring, noConsole]));
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
            stdout: report([]),
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

    it("records only pass or fail and writes only report files beside the log", async () => {
      const fakeFs = makeFakeFileSystem();
      const answers = [[wiring], [noConsole, wiring], []];
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
              stdout: report(answer),
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
        [...fakeFs.impl.files.keys()].filter((path) => path.endsWith(".json")).toSorted(),
      ).toEqual([
        "/fake/runs/my-run/phase-01/checks-attempt-01.report-01.json",
        "/fake/runs/my-run/phase-01/checks-attempt-02.report-01.json",
        "/fake/runs/my-run/phase-01/checks-attempt-03.report-01.json",
        attributionPath,
      ]);
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
            stdout: report([wiring]),
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
    id: "no-node-io src/io.ts",
    rule: "a module under src/ does no node: I/O",
    location: { file: "src/io.ts", lines: null },
    message: "src/io.ts imports node:fs",
    related: [],
    guide: null,
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
    // Reads stdin to end of file, then prints a gate report with one finding.
    "report.mjs": [
      "for await (const _ of process.stdin);",
      `console.log(${JSON.stringify(
        JSON.stringify({
          $schema: currentSchemaUrl("gate-report"),
          outcome: "checked",
          findings: [finding],
          review: [],
        }),
      )});`,
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

  it("fails a declaring report step that reports one finding", async () => {
    const ws = workspace();

    const result = await runReal(ws, [declaring("node ./report.mjs", { output: "gate-report" })]);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect((result.left as GateFailedError).reportFindings).toEqual({
        step: 1,
        findings: [finding],
      });
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

function reportStep(command: string): GateStep {
  return { command, surface: "structural", firing: "every-phase", output: "gate-report" };
}

/** The gate's failure; fails the test when the gate passed. */
function failure(result: Either.Either<unknown, unknown>): GateFailedError {
  if (Either.isRight(result)) throw new Error("expected the gate to fail");
  expect(result.left).toBeInstanceOf(GateFailedError);
  return result.left as GateFailedError;
}

/** The gate's refusal; fails the test when the gate did not refuse. */
function refusedWith(result: Either.Either<unknown, unknown>): GateStepRefusedError {
  if (Either.isRight(result)) throw new Error("expected the gate to refuse");
  expect(result.left).toBeInstanceOf(GateStepRefusedError);
  return result.left as GateStepRefusedError;
}

/** The paths of every gate report the fake filesystem holds. */
function savedReports(fakeFs: ReturnType<typeof makeFakeFileSystem>): string[] {
  return [...fakeFs.impl.files.keys()].filter((path) => /\.report-\d+\.json$/.test(path));
}

// A step that declares "output": "gate-report", on fakes. Every report is made
// up, after the spec's examples.
describe("runGates with a report step", () => {
  const reportUrl = currentSchemaUrl("gate-report");
  const reportPath = "/fake/runs/my-run/phase-01/checks-attempt-01.report-01.json";

  const greetFinding = {
    id: "no-node-import src/greet.ts node:fs",
    rule: "a module under src/ imports no node: module",
    location: { file: "src/greet.ts", lines: [1, 1] },
    message: "imports node:fs",
    related: [{ file: "src/cli.ts", lines: [3, 5], why: "the caller, where the read belongs" }],
    guide: { summary: "keep I/O in the module's caller", read: "guides/no-node-import.md" },
  };
  const farewellFinding = {
    id: "exports-function src/farewell.ts",
    rule: "a module under src/ exports its function",
    location: { file: "src/farewell.ts", lines: null },
    message: "no exported function",
    related: [],
    guide: null,
  };
  const reviewNote = {
    owner: "hw-maintainers",
    note: "whether 'Hello, <name>!' is the greeting the product wants",
  };

  function checked(findings: ReadonlyArray<object>, review: ReadonlyArray<object> = []): string {
    return JSON.stringify({ $schema: reportUrl, outcome: "checked", findings, review });
  }

  const refused = {
    $schema: reportUrl,
    outcome: "refused",
    reason: "the checks need hw-rules 2, and 1 is installed",
    remedy: "pnpm add -D hw-rules@2",
  };

  async function runWith(
    gateSteps: readonly GateStep[],
    responses: Readonly<Record<string, { exitCode: number; stdout: string }>>,
    fakeFs = makeFakeFileSystem(),
    attemptLogPath = logPath,
  ) {
    const fakeShell = makeFakeShell();
    for (const [command, response] of Object.entries(responses)) {
      fakeShell.impl.setResponse(command, { ...response, stderr: "" });
    }
    const result = await Effect.runPromise(
      Effect.either(
        runGates({
          steps: gateSteps,
          cwd,
          attemptLogPath,
          gateRequest,
          attributionPath,
          phaseId,
        }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
      ),
    );
    const attribution = JSON.parse(fakeFs.impl.getFile(attributionPath)!) as GateAttribution;
    return { result, fakeFs, fakeShell, attribution };
  }

  describe("a finding fails the step, whatever the exit code", () => {
    for (const exitCode of [0, 1]) {
      it(`fails on exit ${exitCode}, carrying the findings in the report's order`, async () => {
        const { result, attribution } = await runWith([reportStep("node ./audit.mjs")], {
          "node ./audit.mjs": { exitCode, stdout: checked([greetFinding, farewellFinding]) },
        });

        const err = failure(result);
        expect(err.exitCode).toBe(exitCode);
        expect(err.reportFindings).toEqual({ step: 1, findings: [greetFinding, farewellFinding] });
        expect(attribution.steps).toEqual([
          { command: "node ./audit.mjs", surface: "structural", result: "fail" },
        ]);
      });
    }
  });

  it("passes an empty list on exit 0 and saves it byte for byte beside checks-attempt-01.log", async () => {
    const stdout = checked([], [reviewNote]);
    const { result, fakeFs, attribution } = await runWith([reportStep("node ./audit.mjs")], {
      "node ./audit.mjs": { exitCode: 0, stdout },
    });

    expect(Either.isRight(result)).toBe(true);
    expect(fakeFs.impl.getFile(reportPath)).toBe(stdout);
    expect(attribution.steps).toEqual([
      { command: "node ./audit.mjs", surface: "structural", result: "pass" },
    ]);
  });

  it("keeps a passing report's review notes out of the log a later failing step's fix prompt pastes", async () => {
    const stdout = checked([], [reviewNote]);
    const { result, fakeFs } = await runWith(
      [reportStep("node ./audit.mjs"), stepWithSurface("pnpm test", "local")],
      {
        "node ./audit.mjs": { exitCode: 0, stdout },
        "pnpm test": { exitCode: 1, stdout: "1 test failed" },
      },
    );

    const err = failure(result);
    expect(err.command).toBe("pnpm test");
    expect(err.reportFindings).toBeNull();
    const log = fakeFs.impl.getFile(logPath)!;
    expect(log).toContain("report: checks-attempt-01.report-01.json");
    expect(log).toContain("1 test failed");
    expect(log).not.toContain(reviewNote.note);
    expect(log).not.toContain(reviewNote.owner);
    expect(fakeFs.impl.getFile(reportPath)).toBe(stdout);
  });

  it("treats an empty list with a non-zero exit as a broken step, and saves the report", async () => {
    const stdout = checked([]);
    const { result, fakeFs, attribution } = await runWith([reportStep("node ./audit.mjs")], {
      "node ./audit.mjs": { exitCode: 2, stdout },
    });

    const err = failure(result);
    expect(err.reportFindings).toBeNull();
    expect(err.exitCode).toBe(2);
    expect(err.logPath).toBe(logPath);
    expect(err.message).toBe('Gate step "node ./audit.mjs" exited 2 with no finding');
    expect(fakeFs.impl.getFile(reportPath)).toBe(stdout);
    expect(attribution.steps).toEqual([
      { command: "node ./audit.mjs", surface: "structural", result: "fail" },
    ]);
  });

  for (const [label, stdout] of [
    ["empty stdout", ""],
    ["stdout that is not JSON", "not json"],
  ] as const) {
    it(`treats ${label} as a broken step naming the gate-report URL, saving nothing`, async () => {
      const { result, fakeFs, attribution } = await runWith([reportStep("node ./audit.mjs")], {
        "node ./audit.mjs": { exitCode: 0, stdout },
      });

      const err = failure(result);
      expect(err.reportFindings).toBeNull();
      expect(err.message.startsWith('Gate step "node ./audit.mjs": ')).toBe(true);
      expect(err.message.endsWith(reportUrl)).toBe(true);
      expect(savedReports(fakeFs)).toEqual([]);
      expect(fakeFs.impl.getFile(logPath)).toContain("provider error: ");
      expect(attribution.steps).toEqual([
        { command: "node ./audit.mjs", surface: "structural", result: "fail" },
      ]);
    });
  }

  it("refuses another format by name, naming the gate-report URL", async () => {
    const others = [
      // A retired format, refused by name all the same.
      [
        "gate-diagnostics",
        {
          $schema: "https://docs.phax.run/schemas/gate-diagnostics/0.20.0.json",
          diagnostics: [],
        },
      ],
      [
        "brief-report",
        {
          $schema: schemaUrl("brief-report", CURRENT_STAMPS["brief-report"]),
          rules: [],
          findings: [],
        },
      ],
    ] as const;
    for (const [format, document] of others) {
      const { result, fakeFs } = await runWith([reportStep("node ./audit.mjs")], {
        "node ./audit.mjs": { exitCode: 0, stdout: JSON.stringify(document) },
      });

      const err = failure(result);
      expect(err.message).toBe(
        `Gate step "node ./audit.mjs": ${format} is not read by this phax — it reads ${reportUrl}`,
      );
      expect(err.reportFindings).toBeNull();
      expect(savedReports(fakeFs)).toEqual([]);
    }
  });

  describe("a malformed report is a broken step", () => {
    const cases: ReadonlyArray<readonly [string, object, string]> = [
      [
        "a finding id used twice",
        {
          outcome: "checked",
          findings: [greetFinding, { ...farewellFinding, id: greetFinding.id }],
          review: [],
        },
        `finding id "${greetFinding.id}" is used twice`,
      ],
      [
        "lines out of order",
        {
          outcome: "checked",
          findings: [{ ...greetFinding, location: { file: "src/greet.ts", lines: [3, 1] } }],
          review: [],
        },
        "lines [3, 1] of src/greet.ts are out of order",
      ],
      [
        "related lines out of order",
        {
          outcome: "checked",
          findings: [
            {
              ...greetFinding,
              related: [{ file: "src/cli.ts", lines: [5, 3], why: "the caller" }],
            },
          ],
          review: [],
        },
        "lines [5, 3] of src/cli.ts are out of order",
      ],
      [
        "a top-level key the format does not name",
        { outcome: "checked", findings: [], review: [], debt: [] },
        "debt",
      ],
      [
        "a nested key the format does not name",
        {
          outcome: "checked",
          findings: [{ ...greetFinding, guide: { ...greetFinding.guide, kind: "how-to" } }],
          review: [],
        },
        "findings[0].guide.kind",
      ],
      [
        "a brief finding's due",
        { outcome: "checked", findings: [{ ...greetFinding, due: "this-phase" }], review: [] },
        "findings[0].due",
      ],
      ["a checked report without review", { outcome: "checked", findings: [] }, "review"],
      [
        "a refused report carrying findings",
        { outcome: "refused", reason: "r", remedy: "m", findings: [] },
        "findings",
      ],
      ["an unknown outcome", { outcome: "passed", findings: [], review: [] }, "outcome"],
    ];

    for (const [label, body, named] of cases) {
      it(`refuses ${label}, naming ${named}`, async () => {
        const { result, fakeFs, attribution } = await runWith([reportStep("node ./audit.mjs")], {
          "node ./audit.mjs": {
            exitCode: 0,
            stdout: JSON.stringify({ $schema: reportUrl, ...body }),
          },
        });

        const err = failure(result);
        expect(err.reportFindings).toBeNull();
        expect(err.message).toContain(named);
        expect(err.message.endsWith(reportUrl)).toBe(true);
        expect(savedReports(fakeFs)).toEqual([]);
        expect(attribution.steps[0]?.result).toBe("fail");
      });
    }
  });

  it("runs no step after a step its findings failed", async () => {
    const { result, fakeFs, fakeShell, attribution } = await runWith(
      [reportStep("node ./audit.mjs"), ...steps("pnpm test")],
      {
        "node ./audit.mjs": { exitCode: 0, stdout: checked([farewellFinding]) },
        "pnpm test": { exitCode: 0, stdout: "ok" },
      },
    );

    failure(result);
    expect(fakeShell.impl.calls).toHaveLength(1);
    expect(fakeFs.impl.getFile(logPath)).not.toContain("$ pnpm test");
    expect(attribution.steps).toHaveLength(1);
  });

  it("numbers a saved report by the step's position among the steps the attempt runs", async () => {
    const { result, fakeFs } = await runWith(
      [...steps("pnpm test"), reportStep("node ./audit.mjs")],
      {
        "pnpm test": { exitCode: 0, stdout: "ok" },
        "node ./audit.mjs": { exitCode: 1, stdout: checked([farewellFinding]) },
      },
    );

    expect(failure(result).reportFindings?.step).toBe(2);
    expect(savedReports(fakeFs)).toEqual([
      "/fake/runs/my-run/phase-01/checks-attempt-01.report-02.json",
    ]);
  });

  it("saves every readable report as printed: attempt 1 checked, attempt 2 refused", async () => {
    const fakeFs = makeFakeFileSystem();
    const first = `${JSON.stringify(
      {
        $schema: reportUrl,
        outcome: "checked",
        findings: [greetFinding, farewellFinding],
        review: [reviewNote],
      },
      null,
      2,
    )}\n`;
    const second = `${JSON.stringify(refused, null, 4)}\n`;
    const secondLog = "/fake/runs/my-run/phase-01/checks-attempt-02.log";

    await runWith(
      [reportStep("node ./audit.mjs")],
      { "node ./audit.mjs": { exitCode: 1, stdout: first } },
      fakeFs,
    );
    const { result } = await runWith(
      [reportStep("node ./audit.mjs")],
      { "node ./audit.mjs": { exitCode: 0, stdout: second } },
      fakeFs,
      secondLog,
    );

    expect(fakeFs.impl.getFile(reportPath)).toBe(first);
    expect(fakeFs.impl.getFile("/fake/runs/my-run/phase-01/checks-attempt-02.report-01.json")).toBe(
      second,
    );

    expect(refusedWith(result).logPath).toBe(secondLog);
    expect(savedReports(fakeFs)).toHaveLength(2);
  });

  describe("a refused report stops the gate for the operator", () => {
    for (const exitCode of [0, 1]) {
      it(`fails with the step, the reason and the remedy on exit ${exitCode}`, async () => {
        const { result, fakeFs, attribution } = await runWith([reportStep("node ./audit.mjs")], {
          "node ./audit.mjs": { exitCode, stdout: JSON.stringify(refused) },
        });

        const err = refusedWith(result);
        expect(err).toMatchObject({
          command: "node ./audit.mjs",
          reason: "the checks need hw-rules 2, and 1 is installed",
          remedy: "pnpm add -D hw-rules@2",
          exitCode,
          logPath,
          phaseId,
        });
        expect(err.message).toBe(
          'Gate step "node ./audit.mjs" refused to run: the checks need hw-rules 2, and 1 is installed (remedy: pnpm add -D hw-rules@2)',
        );
        expect(attribution.steps).toEqual([
          { command: "node ./audit.mjs", surface: "structural", result: "refused" },
        ]);
        expect(fakeFs.impl.getFile(logPath)).toContain(
          "refused: the checks need hw-rules 2, and 1 is installed — remedy: pnpm add -D hw-rules@2",
        );
        expect(fakeFs.impl.getFile(logPath)).not.toContain("provider error");
      });
    }

    it("saves the refused report as printed", async () => {
      const stdout = `${JSON.stringify(refused, null, 2)}\n`;
      const { fakeFs } = await runWith([reportStep("node ./audit.mjs")], {
        "node ./audit.mjs": { exitCode: 3, stdout },
      });

      expect(fakeFs.impl.getFile(reportPath)).toBe(stdout);
    });

    it("runs no step after a refusal", async () => {
      const { result, fakeFs, fakeShell, attribution } = await runWith(
        [reportStep("node ./audit.mjs"), ...steps("pnpm test")],
        {
          "node ./audit.mjs": { exitCode: 0, stdout: JSON.stringify(refused) },
          "pnpm test": { exitCode: 0, stdout: "ok" },
        },
      );

      refusedWith(result);
      expect(fakeShell.impl.calls).toHaveLength(1);
      expect(fakeFs.impl.getFile(logPath)).not.toContain("$ pnpm test");
      expect(attribution.steps).toHaveLength(1);
    });
  });

  it("judges nothing in the content: a missing file and a missing guide still fail the step", async () => {
    const nowhere = {
      ...greetFinding,
      id: "no-node-import src/nowhere.ts node:fs",
      location: { file: "src/nowhere.ts", lines: [4, 4] },
      related: [],
      guide: { summary: "keep I/O in the module's caller", read: "guides/missing.md" },
    };
    const { result } = await runWith([reportStep("node ./audit.mjs")], {
      "node ./audit.mjs": { exitCode: 0, stdout: checked([nowhere]) },
    });

    expect(failure(result).reportFindings).toEqual({ step: 1, findings: [nowhere] });
  });

  it("keeps a declaring report step's request and stdin line", async () => {
    const { result, fakeFs, fakeShell } = await runWith(
      [{ ...reportStep("node ./audit.mjs"), input: "gate-request" }],
      { "node ./audit.mjs": { exitCode: 0, stdout: checked([]) } },
    );

    expect(Either.isRight(result)).toBe(true);
    expect(fakeShell.impl.calls[0]?.stdin).toBe(gateRequest);
    expect(fakeFs.impl.getFile(logPath)).toContain("stdin: checks-attempt-01.request.json");
  });
});
