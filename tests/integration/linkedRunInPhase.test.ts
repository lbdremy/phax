/**
 * In-phase tests of the linked run (code-repository spec, phase-07): a plan that no process
 * repository links as its artifact runs loose exactly as today (ac-loose-unchanged), the phase
 * commit of a linked run carries today's trailers and none names the process repository
 * (ac-trailers), and the review text of an unlinked run is unchanged. Built on the phase-06
 * fixtures, which it never edits.
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { phaxCall } from "../helpers/runnerCall.js";
import { removeTempDir } from "../helpers/tempGit.js";
import { createLinkedProject, type LinkedProject } from "../fixtures/codeLink/linkedProject.js";
import { exportPlanMd, PLAN_REL, runInCode } from "../fixtures/codeLink/linkedRun.js";
import { renderOutcome, type RunAnswer } from "../../src/cli/definitions/runOutcome.js";

vi.mock("../../src/app/loadTelemetryConfig.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/app/loadTelemetryConfig.js")>();
  const effect = await import("effect");
  return { ...actual, loadTelemetryConfig: vi.fn(() => effect.Result.succeed({ enabled: false })) };
});
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
vi.mock("../../src/infra/providers/dispatcher.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/infra/providers/dispatcher.js")>();
  const effect = await import("effect");
  const backend = await import("../../src/ports/backend.js");
  const linkedRun = await import("../fixtures/codeLink/linkedRun.js");
  return {
    ...actual,
    makeNodeBackendLayer: vi.fn(() =>
      effect.Layer.succeed(backend.Backend, linkedRun.scriptedBackend()),
    ),
  };
});

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** A plan that needs no approval record: frontmatter `Approved`, outside docs/plans/. */
const approvedByHand = (): string => exportPlanMd().replace("status: Draft", "status: Approved");

describe("a run of a plan of a process repository", { timeout: 120_000 }, () => {
  let world: LinkedProject | undefined;
  let extraRoot: string | undefined;

  afterEach(() => {
    world?.dispose();
    world = undefined;
    removeTempDir(extraRoot);
    extraRoot = undefined;
  });

  function linked(): LinkedProject {
    world = createLinkedProject();
    world.commitInCode(".gitignore", ".phax-context/\n");
    return world;
  }

  /** The `planRepoRelPath` the code repository's only run recorded. */
  function recordedPlanPath(w: LinkedProject): string | undefined {
    const runsDir = join(w.stateRoots.code, "runs");
    const [run] = readdirSync(runsDir);
    if (run === undefined) throw new Error("the run left no folder");
    const status = JSON.parse(readFileSync(join(runsDir, run, "run-status.json"), "utf8")) as {
      planRepoRelPath?: string;
    };
    return status.planRepoRelPath;
  }

  // ac-loose-unchanged
  describe("that is not the artifact of a linking process repository", () => {
    it("runs loose from a sibling directory of the code repository", async () => {
      const w = linked();
      w.commitInProcess("notes/export-plan.md", approvedByHand());
      process.chdir(w.codeRepo);

      const result = await phaxCall(["run", "--plan", "../notes/export-plan.md"]);

      expect(result.code).toBe(0);
      expect(result.err + result.out).toContain("reached review");
      expect(result.out).not.toContain("phax artifact complete");
      expect(recordedPlanPath(w)).toBe("../notes/export-plan.md");
    });

    it("runs loose from the docs/plans/ of a process repository whose link names another repository", async () => {
      const w = linked();
      extraRoot = realpathSync(mkdtempSync(join(tmpdir(), "phax-other-process-")));
      const otherProcess = join(extraRoot, "process");
      const elsewhere = join(otherProcess, "elsewhere");
      mkdirSync(elsewhere, { recursive: true });
      for (const repo of [otherProcess, elsewhere]) git(repo, "init", "-q", "-b", "main");
      writeFileSync(
        join(otherProcess, "phax.json"),
        JSON.stringify({
          version: 1,
          name: "other-process",
          gateProfiles: {
            standard: [{ command: "true", surface: "local", firing: "every-phase" }],
          },
          code: { root: "elsewhere" },
        }),
      );
      writeFileSync(join(otherProcess, ".gitignore"), "/elsewhere/\n");
      const planAbsolute = join(otherProcess, PLAN_REL);
      mkdirSync(dirname(planAbsolute), { recursive: true });
      writeFileSync(planAbsolute, approvedByHand());
      process.chdir(w.codeRepo);

      const result = await phaxCall(["run", "--plan", planAbsolute]);

      expect(result.code).toBe(0);
      expect(result.err + result.out).toContain("reached review");
      expect(result.out).not.toContain("phax artifact complete");
      expect(recordedPlanPath(w)).toBe(relative(w.codeRepo, planAbsolute));
    });
  });

  // ac-trailers
  it("commits a linked run's phase with today's trailers and none naming the process repository", async () => {
    const w = linked();
    w.commitInProcess(PLAN_REL, exportPlanMd());
    await w.approve(PLAN_REL);

    const answer = await runInCode(w, PLAN_REL);
    expect(answer.code).toBe(0);

    const message = git(w.codeRepo, "log", "-1", "--format=%B", "phax/csv-export--phase-01");
    const trailers = new Map<string, string>();
    for (const line of message.split("\n")) {
      const match = /^([A-Z][A-Za-z-]*): (.*)$/.exec(line);
      if (match !== null && match[1] !== undefined && match[2] !== undefined) {
        trailers.set(match[1], match[2]);
      }
    }
    for (const key of [
      "Run-Id",
      "Short-Name",
      "Phase-Id",
      "Phase-Title",
      "Model",
      "Effort",
      "Gate-Log",
    ]) {
      expect(trailers.has(key), `trailer ${key} in:\n${message}`).toBe(true);
    }
    for (const [key, value] of trailers) {
      expect(value, `trailer ${key}`).not.toContain("../");
      expect(value.startsWith("/"), `trailer ${key}`).toBe(false);
    }
  });
});

// A resume cannot be paused cheaply by the scripted provider, so the derivation of its review
// text is tested where it lives: the answer's render.
describe("the review text of a run", () => {
  const answer = (extra: { readonly processPlanPath?: string }): RunAnswer => ({
    qualifiedName: "proj.csv-export",
    crossProject: false,
    outcome: {
      kind: "review_open",
      phaseCount: 1,
      pullRequest: null,
      completions: null,
      finalReport: "/state/runs/proj.csv-export/final-report.md",
      ...extra,
    },
  });

  it("is today's lines for an unlinked run", () => {
    expect(renderOutcome(true)(answer({}))).toBe(
      [
        'Run "proj.csv-export" reached review — 1 phase(s) complete.',
        "See /state/runs/proj.csv-export/final-report.md for details.",
      ].join("\n"),
    );
    expect(renderOutcome(false)(answer({}))).toBe(
      "See /state/runs/proj.csv-export/final-report.md for details.",
    );
  });

  it("adds the complete command of the process repository for a linked run, on run and resume", () => {
    const lines = [
      "The plan lives in the process repository: once merged, run there",
      `  phax artifact complete ${PLAN_REL}`,
    ];
    for (const headline of [true, false]) {
      const rendered = renderOutcome(headline)(answer({ processPlanPath: PLAN_REL }));
      expect(rendered).toContain(lines.join("\n"));
      expect(rendered.endsWith("for details.")).toBe(true);
    }
  });
});
