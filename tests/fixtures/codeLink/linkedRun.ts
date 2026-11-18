/**
 * Helpers of the linked-run acceptance tests: a plan of the process repository run from the code
 * repository, a control repository holding its own code and plans, and a scripted provider whose
 * phase turn edits `src/export/csv.ts`, so a one-phase run reaches review. It builds on
 * `createLinkedProject` and never edits it.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import type { ClaudeSessionId } from "../../../src/domain/branded.js";
import { AgentInvocationError } from "../../../src/domain/errors.js";
import type { AgentRunOptions, BackendOps } from "../../../src/ports/backend.js";
import { phaxCall } from "../../helpers/runnerCall.js";
import { disableGitAutoMaintenance } from "../../helpers/tempGit.js";
import type { LinkedProject } from "./linkedProject.js";

const STAMP = "2611181000";
/** The plan's title: its run short name (`csv-export`) differs from the plan's slug. */
const PLAN_TITLE = "CSV export";
const PLAN_FILE = `${STAMP}-export-plan.md`;
export const PLAN_REL = `docs/plans/${PLAN_FILE}`;
const CSV_FILE = "src/export/csv.ts";

export interface RunAnswer {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The one-phase plan, in the shape deterministic extraction parses without a provider. */
export function exportPlanMd(opts: { readonly completesSpec?: string | null } = {}): string {
  const spec = opts.completesSpec ?? null;
  return `---
status: Draft
source-spec: ${spec ?? "null"}
${spec === null ? "" : "completes-spec: true\n"}---
# ${PLAN_TITLE}

## Required commands

- (none)

## phase-01 — Write the export {#phase-01-export}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

### Planned files to create

- (none)

### Planned files to edit

- \`${CSV_FILE}\`

### Optional files that may be edited

- (none)

### Commit subject

\`feat(export): write the csv export\`

### Commit body

Writes the csv export.
`;
}

/** `phax run --plan ../<planRel>` with the working directory at the code repository. */
export async function runInCode(world: LinkedProject, planRel: string): Promise<RunAnswer> {
  process.chdir(world.codeRepo);
  const result = await phaxCall(["run", "--plan", `../${planRel}`]);
  return { code: result.code, stdout: result.out, stderr: result.err };
}

/** `phax run --plan <planRel>` from `repo`, the control. */
export async function runInRepo(repo: ControlRepo, planRel: string): Promise<RunAnswer> {
  process.chdir(repo.repo);
  const result = await phaxCall(["run", "--plan", planRel]);
  return { code: result.code, stdout: result.out, stderr: result.err };
}

export interface ControlRepo {
  readonly root: string;
  readonly repo: string;
  readonly stateRoot: string;
  /** Writes and commits the plan under docs/plans/; answers its path. */
  readonly writePlan: (md: string) => string;
}

/** A single repository that holds its own code and plans: the plan living with its code. */
export function createControlRepo(): ControlRepo {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "phax-control-repo-")));
  const repo = join(root, "repo");
  const stateRoot = join(root, "state");
  mkdirSync(repo);
  mkdirSync(stateRoot);
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  sh("init", "-q", "-b", "main");
  disableGitAutoMaintenance(repo);
  sh("config", "--local", "user.name", "Ada Example");
  sh("config", "--local", "user.email", "ada@example.test");
  sh("config", "--local", "commit.gpgsign", "false");
  const put = (rel: string, text: string): void => {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), text);
  };
  const commit = (message: string): void => {
    sh("add", "-A");
    sh("commit", "-q", "-m", message);
  };
  put(
    "phax.json",
    JSON.stringify(
      {
        version: 1,
        name: "control-repo",
        state: { root: stateRoot },
        gateProfiles: { standard: [{ command: "true", surface: "local", firing: "every-phase" }] },
        publish: { auto: false },
        review: { compliance: { enabled: false } },
      },
      null,
      2,
    ) + "\n",
  );
  put(".gitignore", ".phax-context/\n");
  put(CSV_FILE, "export const csv = 1;\n");
  commit("seed");
  return {
    root,
    repo,
    stateRoot,
    writePlan: (md) => {
      put(PLAN_REL, md);
      commit("plan");
      return PLAN_REL;
    },
  };
}

const handoff = [
  "## What was delivered",
  "- The csv export.",
  "## Key decisions and why",
  "- None.",
  "## Exact locations (file paths and exported names)",
  `- ${CSV_FILE}`,
  "## What the next phase needs to know",
  "- Nothing.",
  "",
].join("\n");

const unused = () => Effect.fail(new AgentInvocationError({ message: "not played by this test" }));

function writePhaseFiles(options: AgentRunOptions): void {
  mkdirSync(join(options.cwd, "src", "export"), { recursive: true });
  writeFileSync(join(options.cwd, CSV_FILE), "export const csv = 2;\n");
  mkdirSync(join(options.cwd, ".phax-context"), { recursive: true });
  writeFileSync(join(options.cwd, ".phax-context", "phase-handoff.md"), handoff);
}

/** A backend whose phase turn writes `src/export/csv.ts` and a valid handoff in the phase
 *  worktree, so the one-phase plan commits and the run reaches review. */
export function scriptedBackend(): BackendOps {
  const turn = (options: AgentRunOptions, sessionId: string) =>
    Effect.sync(() => {
      if (options.outputJsonlPath !== undefined) writeFileSync(options.outputJsonlPath, "");
      if (options.readOnly !== true) writePhaseFiles(options);
      return {
        sessionId: sessionId as ClaudeSessionId,
        outputPath: "",
        finalText: "",
        structured: null,
      };
    });
  return {
    runAgent: (_prompt, options) => turn(options, "sess-phase-01"),
    resumeAgentSession: (sessionId, _prompt, options) => turn(options, sessionId),
    complete: unused,
    probe: unused,
    captureTranscript: () =>
      Effect.succeed({ status: "missing", reason: "not-found", detail: "not played by this test" }),
  };
}

export interface RunState {
  /** Entries under `<state root>/runs/`. */
  readonly runs: ReadonlyArray<string>;
  /** registry.json's bytes, or null when absent. */
  readonly registry: string | null;
  /** `git branch --list 'phax/*'` of the code repository. */
  readonly branches: string;
}

/** What a run leaves in the code repository's state root and branches. */
export function runState(world: LinkedProject): RunState {
  const runsDir = join(world.stateRoots.code, "runs");
  const registry = join(world.stateRoots.code, "registry.json");
  return {
    runs: existsSync(runsDir) ? readdirSync(runsDir).toSorted() : [],
    registry: existsSync(registry) ? readFileSync(registry, "utf8") : null,
    branches: execFileSync("git", ["branch", "--list", "phax/*"], {
      cwd: world.codeRepo,
      encoding: "utf8",
    }),
  };
}
