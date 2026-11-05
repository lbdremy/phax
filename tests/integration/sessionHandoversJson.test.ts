import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeAdjustPlanCommand } from "../../src/cli/definitions/adjustPlan.js";
import {
  makeEnterCommand,
  makeEnterPhaseCommand,
  makeOpenCommand,
  makeShellCommand,
} from "../../src/cli/definitions/sessions.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeEditor } from "../../src/infra/fakes/editor.js";
import { makeFakeSession } from "../../src/infra/fakes/session.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { isolatePhaxHome } from "../helpers/isolatePhaxHome.js";
import { phaseStatusFile } from "../helpers/phaseStatusFixture.js";
import { runnerCall } from "../helpers/runnerCall.js";
import { removeTempDir } from "../helpers/tempGit.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// enter, enter-phase, shell, open and adjust-plan through the command runner, over their
// definition factories with the fake session, editor and backend, in a temporary repository with
// its own identity and a temporary PHAX home. No real agent, shell or editor starts.
//   ac-no-person, ac-text-unchanged and ac-error-sentence.

const SHORT_NAME = "hand-run";
const NOW = "2024-01-01T00:00:00.000Z";

function fakes(exitCode = 0) {
  return {
    session: makeFakeSession(exitCode),
    editor: makeFakeEditor(),
    backend: makeFakeBackend(),
  };
}

describe("commands that hand over the terminal", () => {
  let repoRoot: string;
  let runPath: string;
  let worktreePath: string;
  let origCwd: string;
  let origShell: string | undefined;
  let home: ReturnType<typeof isolatePhaxHome>;
  let restoreGit: () => void;

  beforeEach(() => {
    home = isolatePhaxHome();
    restoreGit = isolateGit();
    repoRoot = mkdtempSync(join(tmpdir(), "phax-handover-json-"));
    const stateRoot = join(repoRoot, ".phax-state");
    runPath = join(stateRoot, "runs", `test.${SHORT_NAME}`);
    worktreePath = join(stateRoot, "worktrees", SHORT_NAME, "phase-01");
    execSync("git init -q", { cwd: repoRoot });
    execSync('git config user.name "Handover Test"', { cwd: repoRoot });
    execSync("git config user.email handover-test@example.com", { cwd: repoRoot });
    writeFileSync(
      join(repoRoot, "phax.json"),
      JSON.stringify({
        version: 1,
        name: "test",
        state: { root: stateRoot },
        gateProfiles: {
          fast: [{ command: "pnpm test", surface: "local", firing: "every-phase", output: "log" }],
        },
      }),
    );
    origCwd = process.cwd();
    origShell = process.env["SHELL"];
    process.chdir(repoRoot);
  });

  afterEach(() => {
    process.chdir(origCwd);
    if (origShell === undefined) delete process.env["SHELL"];
    else process.env["SHELL"] = origShell;
    removeTempDir(repoRoot);
    restoreGit();
    home.restore();
  });

  /** A run in review_open with one phase, its worktree recorded or not, and an agent binding. */
  function seedRun(options: { worktree: boolean } = { worktree: true }): void {
    const phaseDir = join(runPath, "phase-01");
    mkdirSync(phaseDir, { recursive: true });
    writeFileSync(
      join(runPath, "run-status.json"),
      JSON.stringify({
        version: 1,
        namespace: "test",
        shortName: SHORT_NAME,
        runId: "hand-run-1234",
        state: "review_open",
        createdAt: NOW,
        updatedAt: NOW,
        phasesCount: 1,
        gateProfileId: "fast",
      }),
    );
    writeFileSync(
      join(phaseDir, "status.json"),
      JSON.stringify(
        phaseStatusFile({
          phaseId: "phase-01",
          phaseIndex: 0,
          state: "committed",
          model: "claude-sonnet-4-6",
          effort: "low",
          branchName: `feature/${SHORT_NAME}--phase-01`,
          base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
          createdAt: NOW,
          updatedAt: NOW,
          ...(options.worktree ? { worktreePath } : {}),
          claudeSessionId: "sess-hand",
        }),
      ),
    );
    writeFileSync(
      join(phaseDir, "agent-binding.json"),
      JSON.stringify({
        version: 1,
        shortName: SHORT_NAME,
        runId: "hand-run-1234",
        phaseId: "phase-01",
        phaseIndex: 0,
        phaseName: "Test Phase",
        provider: "claude-code",
        adapter: "claude",
        model: "claude-sonnet-4-6",
        effort: "low",
        sessionId: "sess-hand",
        sessionHandle: null,
        worktreePath,
        cwd: worktreePath,
        launchedAt: NOW,
        status: "running",
      }),
    );
  }

  /** Every command, called with `--json`, and the remedy its refusal names. */
  function refusedCalls(t: ReturnType<typeof fakes>) {
    return [
      {
        name: "enter",
        command: makeEnterCommand({ sessionLayer: t.session.layer }),
        argv: ["enter", SHORT_NAME, "--json"],
        remedy: "phax session-info <run> --json",
      },
      {
        name: "enter-phase",
        command: makeEnterPhaseCommand({
          sessionLayer: t.session.layer,
          backendLayer: t.backend.layer,
        }),
        argv: ["enter-phase", SHORT_NAME, "phase-01", "--json"],
        remedy: "phax session-info <run> --json",
      },
      {
        name: "shell",
        command: makeShellCommand({ sessionLayer: t.session.layer }),
        argv: ["shell", SHORT_NAME, "--json"],
        remedy: "phax path <run> --json",
      },
      {
        name: "open",
        command: makeOpenCommand({ editorLayer: t.editor.layer }),
        argv: ["open", SHORT_NAME, "--json"],
        remedy: "phax path <run> --json",
      },
      {
        name: "adjust-plan",
        command: makeAdjustPlanCommand({
          sessionLayer: t.session.layer,
          backendLayer: t.backend.layer,
        }),
        argv: ["adjust-plan", "plan.md", "--landed", SHORT_NAME, "--json"],
        remedy: "without --json",
      },
    ] as const;
  }

  it.each(["enter", "enter-phase", "shell", "open", "adjust-plan"])(
    "%s --json is refused with 64 before any session, shell or editor starts",
    async (name) => {
      seedRun();
      const t = fakes();
      const call = refusedCalls(t).find((each) => each.name === name)!;

      const result = await runnerCall([call.command], call.argv);

      expect(result.code).toBe(64);
      expect(result.out).toBe("");
      expect(result.errLines).toHaveLength(1);
      const refused = JSON.parse(result.errLines[0]!) as { kind: string; text: string };
      expect(refused.kind).toBe("refused");
      expect(refused.text).toContain(name);
      expect(refused.text).toContain(call.remedy);
      expect(t.session.impl.invocations).toEqual([]);
      expect(t.editor.impl.openCalls).toEqual([]);
    },
  );

  describe("enter", () => {
    it("writes the announce on stdout and exits with the session's code", async () => {
      seedRun();
      const t = fakes(3);

      const result = await runnerCall(
        [makeEnterCommand({ sessionLayer: t.session.layer })],
        ["enter", SHORT_NAME],
      );

      expect(result.code).toBe(3);
      expect(result.outLines).toEqual([`Entering claude session in ${worktreePath}`]);
      expect(result.err).toBe("");
      expect(t.session.impl.invocations).toEqual([
        { executable: "claude", args: ["--resume", "sess-hand"], cwd: worktreePath, env: {} },
      ]);
    });

    it("keeps today's sentence and exit 1 for a run without an agent binding", async () => {
      seedRun();
      const t = fakes();
      const missing = join(runPath, "phase-01", "agent-binding.json");
      writeFileSync(missing, "not json");

      const result = await runnerCall(
        [makeEnterCommand({ sessionLayer: t.session.layer })],
        ["enter", SHORT_NAME],
      );

      expect(result.code).toBe(1);
      expect(result.out).toBe("");
      expect(result.err).toContain(`No agent binding found for run "test.${SHORT_NAME}"`);
      expect(t.session.impl.invocations).toEqual([]);
    });
  });

  describe("enter-phase", () => {
    it("keeps today's sentence and exit 1 for an unknown phase", async () => {
      seedRun();
      const t = fakes();

      const result = await runnerCall(
        [makeEnterPhaseCommand({ sessionLayer: t.session.layer, backendLayer: t.backend.layer })],
        ["enter-phase", SHORT_NAME, "phase-99"],
      );

      expect(result.code).toBe(1);
      expect(result.errLines).toEqual([`Phase "phase-99" not found in run "test.${SHORT_NAME}"`]);
      expect(t.session.impl.invocations).toEqual([]);
    });
  });

  describe("shell", () => {
    it("hands $SHELL to the session in the run's worktree with an empty env", async () => {
      seedRun();
      process.env["SHELL"] = "/bin/fake-sh";
      const t = fakes(2);

      const result = await runnerCall(
        [makeShellCommand({ sessionLayer: t.session.layer })],
        ["shell", SHORT_NAME],
      );

      expect(result.code).toBe(2);
      expect(result.outLines).toEqual([`Opening shell in ${worktreePath}`]);
      expect(t.session.impl.invocations).toEqual([
        { executable: "/bin/fake-sh", args: [], cwd: worktreePath, env: {} },
      ]);
    });

    it("keeps today's sentence and exit 1 for a run with no worktree", async () => {
      seedRun({ worktree: false });
      const t = fakes();

      const result = await runnerCall(
        [makeShellCommand({ sessionLayer: t.session.layer })],
        ["shell", SHORT_NAME],
      );

      expect(result.code).toBe(1);
      expect(result.errLines).toEqual([`No worktree path found for run "test.${SHORT_NAME}".`]);
      expect(t.session.impl.invocations).toEqual([]);
    });
  });

  describe("open", () => {
    it("opens the worktree in the editor, says so and exits 0", async () => {
      seedRun();
      const t = fakes();

      const result = await runnerCall(
        [makeOpenCommand({ editorLayer: t.editor.layer })],
        ["open", SHORT_NAME],
      );

      expect(result.code).toBe(0);
      expect(result.outLines).toEqual([`Opened ${worktreePath}`]);
      expect(t.editor.impl.openCalls).toEqual([worktreePath]);
    });

    it("keeps today's sentence and exit 1 for a run with no worktree", async () => {
      seedRun({ worktree: false });
      const t = fakes();

      const result = await runnerCall(
        [makeOpenCommand({ editorLayer: t.editor.layer })],
        ["open", SHORT_NAME],
      );

      expect(result.code).toBe(1);
      expect(result.errLines).toEqual([`No worktree path found for run "test.${SHORT_NAME}".`]);
      expect(t.editor.impl.openCalls).toEqual([]);
    });
  });

  describe("adjust-plan", () => {
    it("keeps today's sentence and exit 1 for a plan it cannot read", async () => {
      seedRun();
      const t = fakes();

      const result = await runnerCall(
        [makeAdjustPlanCommand({ sessionLayer: t.session.layer, backendLayer: t.backend.layer })],
        ["adjust-plan", "missing-plan.md", "--landed", SHORT_NAME],
      );

      expect(result.code).toBe(1);
      expect(result.errLines).toEqual([
        'Cannot read plan.md at "missing-plan.md": file not found or not readable.',
      ]);
      expect(t.session.impl.invocations).toEqual([]);
    });

    it("keeps today's sentence and exit 1 for an invalid --effort", async () => {
      seedRun();
      const t = fakes();

      const result = await runnerCall(
        [makeAdjustPlanCommand({ sessionLayer: t.session.layer, backendLayer: t.backend.layer })],
        ["adjust-plan", "plan.md", "--landed", SHORT_NAME, "--effort", "extreme"],
      );

      expect(result.code).toBe(1);
      expect(result.errLines).toEqual([
        'Invalid --effort value "extreme". Allowed values: low | medium | high',
      ]);
    });
  });
});
