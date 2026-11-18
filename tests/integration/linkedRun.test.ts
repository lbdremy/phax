/**
 * The linked run (code-repository spec, §5.13 and §5.14): `phax run --plan
 * ../docs/plans/<plan>.md`, started in the code repository, gates the plan as the process
 * repository's artifact. A stale, Draft or unrecorded plan is refused before anything is named,
 * as a plan living with its code is; a fresh one reaches review, leaves the plan, its spec and
 * the process repository's history alone, and prints the `phax artifact complete` command.
 *
 * Both repositories are temporary git repositories (`createLinkedProject`), HOME is a temporary
 * directory and git is isolated, so no real ~/.phax or global git config is read. Only the
 * HOME-derived loaders and the provider backend are replaced, as in holdCli.test.ts.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { removeTempDir } from "../helpers/tempGit.js";
import {
  createControlRepo,
  exportPlanMd,
  PLAN_REL,
  runInCode,
  runInRepo,
  runState,
  type ControlRepo,
} from "../fixtures/codeLink/linkedRun.js";
import { createLinkedProject, type LinkedProject } from "../fixtures/codeLink/linkedProject.js";

vi.mock("../../src/app/loadTelemetryConfig.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/app/loadTelemetryConfig.js")>();
  const effect = await import("effect");
  return { ...actual, loadTelemetryConfig: vi.fn(() => effect.Result.succeed({ enabled: false })) };
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
// No test may reach a real provider CLI: the phase turn is scripted.
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

describe(
  "a run from the code repository on a plan of the process repository",
  {
    timeout: 120_000,
  },
  () => {
    let world: LinkedProject | undefined;
    let control: ControlRepo | undefined;

    afterEach(() => {
      world?.dispose();
      world = undefined;
      if (control !== undefined) removeTempDir(control.root);
      control = undefined;
    });

    /** A linked project whose code repository ignores `.phax-context/`, so a phase worktree stays
     *  clean when the scripted provider writes its handoff. */
    function linked(): LinkedProject {
      world = createLinkedProject();
      world.commitInCode(".gitignore", ".phax-context/\n");
      return world;
    }

    const text = (r: { stdout: string; stderr: string }): string => `${r.stderr}${r.stdout}`;

    // ac-run-refuses-stale
    it("refuses a plan whose footprint changed in the code, and names nothing", async () => {
      const w = linked();
      w.commitInProcess(PLAN_REL, exportPlanMd());
      await w.approve(PLAN_REL);
      w.commitInCode("src/export/csv.ts", "export const csv = 'changed';\n");

      const answer = await runInCode(w, PLAN_REL);

      expect(answer.code).not.toBe(0);
      expect(text(answer)).toContain("ground-changed");
      expect(text(answer)).toContain("src/export/csv.ts");
      expect(runState(w)).toEqual({ runs: [], registry: null, branches: "" });
    });

    // ac-run-refuses-unrecorded, a Draft plan
    it("refuses a Draft plan exactly as a plan living with its code", async () => {
      const w = linked();
      w.commitInProcess(PLAN_REL, exportPlanMd());
      control = createControlRepo();
      control.writePlan(exportPlanMd());

      // createControlRepo changes nothing of the working directory; each call sets its own.
      const linkedAnswer = await runInCode(w, PLAN_REL);
      const controlAnswer = await runInRepo(control, PLAN_REL);

      expect(controlAnswer.code).not.toBe(0);
      expect(text(controlAnswer)).toContain(PLAN_REL);
      expect(linkedAnswer.code).toBe(controlAnswer.code);
      expect(text(linkedAnswer)).toBe(text(controlAnswer));
    });

    // ac-run-refuses-unrecorded, an Approved plan with no approval record
    it("refuses an Approved plan with no approval record exactly as a plan living with its code", async () => {
      const w = linked();
      const approvedByHand = exportPlanMd().replace("status: Draft", "status: Approved");
      w.commitInProcess(PLAN_REL, approvedByHand);
      control = createControlRepo();
      control.writePlan(approvedByHand);

      const linkedAnswer = await runInCode(w, PLAN_REL);
      const controlAnswer = await runInRepo(control, PLAN_REL);

      expect(controlAnswer.code).not.toBe(0);
      expect(text(controlAnswer)).toContain(PLAN_REL);
      expect(linkedAnswer.code).toBe(controlAnswer.code);
      expect(text(linkedAnswer)).toBe(text(controlAnswer));
    });

    // ac-run-review-no-complete
    it("reaches review, leaves the plan and spec alone and prints the complete command", async () => {
      const w = linked();
      const spec = w.writeSpec("csv-export");
      await w.approve(spec);
      w.commitInProcess(PLAN_REL, exportPlanMd({ completesSpec: spec }));
      await w.approve(PLAN_REL);
      const headBefore = git(w.processRepo, "rev-parse", "HEAD");
      const planBefore = readFileSync(join(w.processRepo, PLAN_REL), "utf8");
      const specBefore = readFileSync(join(w.processRepo, spec), "utf8");

      const answer = await runInCode(w, PLAN_REL);

      expect(answer.code).toBe(0);
      expect(git(w.processRepo, "rev-parse", "HEAD")).toBe(headBefore);
      const planAfter = readFileSync(join(w.processRepo, PLAN_REL), "utf8");
      const specAfter = readFileSync(join(w.processRepo, spec), "utf8");
      expect(planAfter).toBe(planBefore);
      expect(specAfter).toBe(specBefore);
      expect(planAfter).toContain("status: Approved");
      expect(specAfter).toContain("status: Approved");
      expect(answer.stdout).toContain(`phax artifact complete ${PLAN_REL}`);
    });
  },
);
