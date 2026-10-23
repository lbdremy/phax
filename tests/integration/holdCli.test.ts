/**
 * `phax run --hold` end to end through the real `runRun`, in a temporary git
 * repository and a separate temporary state root: a malformed value is refused
 * with exit 1 before anything is read, a plan that cannot honour the selection
 * with exit 11, and a valid one is recorded with the run it names. `phax
 * resume` takes no `--hold`. Only the HOME-derived loaders and the provider
 * backend are replaced, as in runPreflightBeforeNaming.test.ts, and HOME is a
 * temporary directory, so the developer's ~/.phax/config.json is never read.
 */
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runRun } from "../../src/cli/commands/run.js";
import { registerResumeCommand } from "../../src/cli/commands/resumeRegister.js";
import { buildProgram } from "../../src/cli/program.js";
import {
  createPreflightRepo,
  type Fixture,
  type PreflightRepo,
  recordingOutput,
  removePreflightRepo,
  snapshotRepo,
} from "./helpers/preflightRepo.js";
import { removeTempDir } from "../helpers/tempGit.js";

vi.mock("../../src/app/loadTelemetryConfig.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/app/loadTelemetryConfig.js")>();
  const effect = await import("effect");
  return { ...actual, loadTelemetryConfig: vi.fn(() => effect.Either.right({ enabled: false })) };
});
// The routing loaders read ~/.phax; serve the built-in defaults instead.
vi.mock("../../src/app/loadRouting.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/app/loadRouting.js")>();
  const effect = await import("effect");
  const defaults = await import("../../src/domain/routing/defaults.js");
  return {
    ...actual,
    loadModelRouting: vi.fn(() => effect.Effect.succeed(defaults.DEFAULT_MODEL_ROUTING)),
    loadProviderConfig: vi.fn(() => effect.Effect.succeed(defaults.DEFAULT_PROVIDER_CONFIG)),
  };
});
// No test may reach a real provider CLI.
vi.mock("../../src/infra/providers/dispatcher.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/infra/providers/dispatcher.js")>();
  const fakes = await import("../../src/infra/fakes/backend.js");
  return { ...actual, makeNodeBackendLayer: vi.fn(() => fakes.makeFakeBackend().layer) };
});

const INTERACTIVE_LINE = "**Mode:** interactive";
const ORACLE_PAIR_LINES = ["**Oracle phase:** yes", "**Oracle files:** `src/step-02.ts`"];

// The made-up six-phase plan: phase-03 is declared interactive and phase-06 is the final phase.
const SIX_PHASES: Fixture = {
  plan: {
    phases: [{}, {}, { headerLines: [INTERACTIVE_LINE], plannedFilesToCreate: [] }, {}, {}, {}],
  },
};

const HOLD_USAGE = "give no value, oracle, or phase ids such as phase-02,phase-04";
const HINT = "(put the run's name before --hold, or write --hold=<selection>)";

const recordedHold = (r: PreflightRepo): unknown => {
  const [run] = snapshotRepo(r).runs;
  expect(run).toBeDefined();
  const status = JSON.parse(
    readFileSync(join(r.stateRoot, "runs", run!, "run-status.json"), "utf8"),
  ) as { hold: unknown };
  return status.hold;
};

function expectNothingNamed(r: PreflightRepo): void {
  const after = snapshotRepo(r);
  expect(after.runs).toEqual([]);
  expect(after.registry).toBeNull();
  expect(after.phaxBranches).toBe("");
  expect(after.worktrees).not.toContain("phase-");
}

describe("phax run --hold", { timeout: 60_000 }, () => {
  let roots: PreflightRepo | undefined;
  let origCwd: string;
  let home: string;

  beforeEach(() => {
    origCwd = process.cwd();
    // loadConfig reads ~/.phax/config.json through homedir(), which follows HOME.
    home = realpathSync(mkdtempSync(join(tmpdir(), "phax-hold-cli-home-")));
    vi.stubEnv("HOME", home);
  });

  afterEach(() => {
    process.chdir(origCwd);
    removePreflightRepo(roots);
    roots = undefined;
    vi.unstubAllEnvs();
    removeTempDir(home);
    vi.resetAllMocks();
  });

  function enter(fixture?: Fixture): PreflightRepo {
    roots = createPreflightRepo(fixture);
    process.chdir(roots.repo);
    return roots;
  }

  describe("records the resolved hold with the run", () => {
    it.each([
      ["no --hold", undefined, { selection: "none" }],
      [
        "a bare --hold",
        true,
        { selection: "all", phases: ["phase-01", "phase-02", "phase-04", "phase-05"] },
      ],
      [
        "--hold phase-02,phase-04",
        "phase-02,phase-04",
        { selection: "listed", phases: ["phase-02", "phase-04"] },
      ],
    ] as const)("%s", async (_label, hold, expected) => {
      const r = enter(SIX_PHASES);
      const out = recordingOutput();

      await runRun({ plan: "plan.md", ...(hold !== undefined ? { hold } : {}) }, out.port);

      expect(out.logs).toContain(`Run: ${r.namespace}.foo`);
      expect(recordedHold(r)).toEqual(expected);
    });

    it("takes the run's name before --hold=<selection>", async () => {
      const r = enter(SIX_PHASES);
      const out = recordingOutput();

      await runRun({ shortName: "foo", plan: "plan.md", hold: "phase-02" }, out.port);

      expect(out.logs).toContain(`Run: ${r.namespace}.foo`);
      expect(recordedHold(r)).toEqual({ selection: "listed", phases: ["phase-02"] });
    });
  });

  describe("refuses a malformed value with exit 1 before the run is named", () => {
    it.each([
      ["phase-2", `--hold 'phase-2' is not a hold selection: ${HOLD_USAGE}`],
      ["phase-100", `--hold 'phase-100' is not a hold selection: ${HOLD_USAGE}`],
      ["oracle,phase-02", "--hold 'oracle,phase-02' is not a hold selection: oracle stands alone"],
      ["phase-02,,phase-04", `--hold 'phase-02,,phase-04' is not a hold selection: ${HOLD_USAGE}`],
      ["phase-02,phase-02", `--hold 'phase-02,phase-02' is not a hold selection: ${HOLD_USAGE}`],
      // `phax run --hold foo --plan plan.md`: the run's name swallowed by the flag.
      ["foo", `--hold 'foo' is not a hold selection: ${HOLD_USAGE}\n${HINT}`],
    ])("--hold %s", async (value, message) => {
      const r = enter(SIX_PHASES);
      const out = recordingOutput();

      const code = await runRun({ plan: "plan.md", hold: value }, out.port);

      expect(code).toBe(1);
      expect(out.errors).toEqual([message]);
      expectNothingNamed(r);
    });
  });

  describe("refuses a selection the plan cannot honour with exit 11 before the run is named", () => {
    const REFUSED: readonly (readonly [string, Fixture, true | string, string])[] = [
      [
        "a phase the plan does not have",
        SIX_PHASES,
        "phase-09",
        "Hold preflight failed: 1 error(s).\n  phase-09  is not a phase of this plan",
      ],
      [
        "a declared interactive phase",
        SIX_PHASES,
        "phase-02,phase-03",
        "Hold preflight failed: 1 error(s).\n  phase-03  is interactive: it already stops for review; remove it from --hold",
      ],
      [
        "the final phase",
        SIX_PHASES,
        "phase-06",
        "Hold preflight failed: 1 error(s).\n  phase-06  is the final phase: it already stays open in review_open",
      ],
      [
        "a bare --hold on a plan with no phase before its final one",
        {},
        true,
        "Hold preflight failed: 1 error(s).\n  -  --hold selects no phase: the plan has no headless phase before its final phase",
      ],
      [
        "--hold oracle on a plan with no oracle phase",
        SIX_PHASES,
        "oracle",
        "Hold preflight failed: 1 error(s).\n  -  --hold oracle selects no phase: the plan declares no oracle phase",
      ],
    ];

    it.each(REFUSED)("%s", async (_label, fixture, hold, message) => {
      const r = enter(fixture);
      const out = recordingOutput();

      const code = await runRun({ plan: "plan.md", hold }, out.port);

      expect(code).toBe(11);
      expect(out.errors).toEqual([`phax run failed: ${message}`]);
      expectNothingNamed(r);
    });
  });

  describe("holds the phases of an oracle pair", () => {
    // The four-phase variant: phase-02 pins src/step-02.ts, which phase-03 discharges.
    const ORACLE_VARIANT: Fixture = {
      config: { oracles: { command: "./fake-oracles" } },
      plan: { phases: [{}, { headerLines: ORACLE_PAIR_LINES }, {}, {}] },
    };

    it.each([
      ["--hold oracle", "oracle", { selection: "oracle", phases: ["phase-02"] }],
      [
        "--hold phase-02,phase-03",
        "phase-02,phase-03",
        { selection: "listed", phases: ["phase-02", "phase-03"] },
      ],
      ["a bare --hold", true, { selection: "all", phases: ["phase-01", "phase-02", "phase-03"] }],
    ] as const)("%s", async (_label, hold, expected) => {
      const r = enter(ORACLE_VARIANT);
      const out = recordingOutput();

      await runRun({ plan: "plan.md", hold }, out.port);

      expect(out.errors.join("\n")).not.toContain("Hold preflight failed");
      expect(out.logs).toContain(`Run: ${r.namespace}.foo`);
      expect(recordedHold(r)).toEqual(expected);
    });
  });

  describe("--dry-run resolves the hold and names no run", () => {
    it("prints the resolved selection", async () => {
      const r = enter(SIX_PHASES);
      const out = recordingOutput();

      const code = await runRun(
        { plan: "plan.md", dryRun: true, hold: "phase-04,phase-02" },
        out.port,
      );

      expect(code).toBe(0);
      expect(out.logs.join("\n")).toContain("Hold: listed — phase-02, phase-04");
      expectNothingNamed(r);
    });

    it("prints the hold check's errors under the line and still exits 0", async () => {
      const r = enter(SIX_PHASES);
      const out = recordingOutput();

      const code = await runRun({ plan: "plan.md", dryRun: true, hold: "phase-09" }, out.port);

      expect(code).toBe(0);
      const lines = out.logs.join("\n").split("\n");
      const at = lines.indexOf("Hold: listed");
      expect(lines[at + 1]).toBe("  phase-09  is not a phase of this plan");
      expectNothingNamed(r);
    });

    it("prints Hold: none without --hold", async () => {
      enter(SIX_PHASES);
      const out = recordingOutput();

      expect(await runRun({ plan: "plan.md", dryRun: true }, out.port)).toBe(0);

      expect(out.logs.join("\n")).toContain("Hold: none");
    });
  });
});

describe("the hold is fixed for the run and comes only from the flag", () => {
  it("registers --hold on run, with its option text, and not on resume", () => {
    const program = buildProgram();
    const run = program.commands.find((c) => c.name() === "run")!;
    const resume = program.commands.find((c) => c.name() === "resume")!;

    const hold = run.options.find((o) => o.long === "--hold");
    expect(hold?.flags).toBe("--hold [selection]");
    expect(hold?.description).toBe(
      "Stop for review once these headless phases commit: no value for every phase but the final one, oracle, or phase ids such as phase-02,phase-04",
    );
    expect(resume.options.map((o) => o.long)).not.toContain("--hold");
  });

  it("refuses `phax resume <run> --hold` as an unknown option with exit 1", async () => {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    const runResume = vi.fn().mockResolvedValue(0);
    registerResumeCommand(
      program,
      runResume,
      { log: () => {}, warn: () => {}, error: () => {} },
      () => ({}),
    );

    const failure = await program
      .parseAsync(["node", "phax", "resume", "invoice-export", "--hold"])
      .then(
        () => undefined,
        (e: unknown) => e as { code: string; exitCode: number },
      );

    expect(failure).toMatchObject({ code: "commander.unknownOption", exitCode: 1 });
    expect(runResume).not.toHaveBeenCalled();
  });
});
