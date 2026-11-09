import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Result, Layer } from "effect";
import { createRunFolder } from "../../../src/app/runFolder.js";
import { loadConfig } from "../../../src/app/loadConfig.js";
import { setRunStatus } from "../../../src/app/registry.js";
import { type Command, defineProgram } from "../../../src/cli/commandLibrary/contract/index.js";
import { decodeShortName } from "../../../src/domain/branded.js";
import { finalizeExtractedPlan } from "../../../src/domain/plan/finalize.js";
import { extractPlanDeterministic } from "../../../src/domain/plan/parsePlanMarkdown.js";
import { makeFakeBackend } from "../../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../../src/infra/fakes/github.js";
import { makeFakeShell } from "../../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../../src/ports/systemTelemetry.js";
import type { PlanExtractionAnswer } from "../../../src/schemas/planExtraction.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import { isolateGit } from "../../helpers/isolateGit.js";
import { isolatePhaxHome } from "../../helpers/isolatePhaxHome.js";
import { disableGitAutoMaintenance, removeTempDir } from "../../helpers/tempGit.js";

// The world of tests/integration/runCommandsAnswers.test.ts: a git repository in a temporary
// directory with its own identity, a phax.json with one gate profile and a state root of its
// own, a loose plan.md at the repository root (Approved) that extraction reads through the fake
// backend once and from its cache after, a resumable run of another plan under the state root
// whose lock is held by this very process, and a runner program holding the commands under test.
// It reads nothing outside its temporary directories.
//
// A test file that builds it hoists the `node:os` mock of tests/helpers/isolatePhaxHome.ts, so
// that the PHAX home paths phax computes at import follow the temporary home.

const OPERATOR = "Ada Lovelace";
const NAMESPACE = "made-up";

// A plan.md that deterministic extraction refuses (no "## Required commands"), so extraction
// asks the backend the first time and reads its cache after. The heading keeps its anchor so the
// phase title derives from it.
const LOOSE_PLAN = `---
status: Approved
source-spec: null
---
# Dry Run Plan

## phase-01 — First Phase {#phase-01-first}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Planned files to create

- (none)

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Commit subject

feat(test): do thing

### Commit body

Does the thing.
`;

/** What the fake backend answers the loose plan's extraction with. */
const LOOSE_PLAN_EXTRACTION: PlanExtractionAnswer = {
  $schema: schemaUrl("phax-plan-extraction", CURRENT_STAMPS["phax-plan-extraction"]),
  plan: {
    run: { shortName: "Dry Run Plan", title: "Dry Run Plan", requiredCommands: [] },
    phases: [
      {
        id: "phase-01",
        model: "claude-sonnet-4-6",
        effort: "medium",
        planMarkdownAnchor: "#phase-01-first",
        plannedFilesToCreate: [],
        plannedFilesToEdit: [],
        optionalFilesToEdit: [],
        testLines: [],
        commit: { subject: "feat(test): do thing", body: "Does the thing." },
      },
    ],
  },
  incomplete: null,
};

// The plan of the resumable run: it conforms, so extraction needs no model.
const RESUMABLE_PLAN = `# Resumable Run

## Required commands

- (none)

## phase-01 — First Phase {#phase-01-first}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Planned files to create

- (none)

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Commit subject

feat(test): do thing

### Commit body

Does the thing.

---
`;

/** The fake layers and the fakes behind them, for the factories' deps. */
interface RunCommandsFakes {
  /** The backend: one completion response, the loose plan's extraction. */
  readonly backend: ReturnType<typeof makeFakeBackend>["impl"];
  readonly deps: {
    readonly backendLayer: ReturnType<typeof makeFakeBackend>["layer"];
    readonly githubLayer: ReturnType<typeof makeFakeGitHub>["layer"];
    readonly shellLayer: ReturnType<typeof makeFakeShell>["layer"];
  };
}

export interface RunCommandsRepo {
  readonly repoDir: string;
  /** The state root phax.json names. */
  readonly stateRoot: string;
  /** The loose plan, repo-relative: pass it to `--plan`. */
  readonly planPath: string;
  /** The resumable run's short name (the argument of `resume`), and its qualified name. */
  readonly runShortName: string;
  readonly runQualifiedName: string;
  /** The first phase of the resumable run: what `resume` would restart at. */
  readonly nextPhaseId: string;
  /** The pid that holds the run's lock: this process's. */
  readonly pid: number;
  /** The lock file of the resumable run, in the format of src/infra/lock.ts. */
  readonly lockPath: string;
  readonly readLock: () => string;
  /** Fakes for one call. */
  readonly fakes: () => RunCommandsFakes;
  /** A runner program holding `commands`, with phax's exit codes and refusal hint. */
  readonly program: (
    commands: ReadonlyArray<Command<any>>, // oxlint-disable-line typescript/no-explicit-any
  ) => ReturnType<typeof defineProgram>;
  readonly dispose: () => void;
}

/** Builds the world; call `dispose` to remove it and restore the environment. */
export async function makeRunCommandsRepo(): Promise<RunCommandsRepo> {
  const restoreGit = isolateGit();
  const home = isolatePhaxHome();
  const repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-run-commands-")));
  const stateRoot = realpathSync(mkdtempSync(join(tmpdir(), "phax-run-commands-state-")));
  const git = (...args: readonly string[]): string =>
    execFileSync("git", [...args], { cwd: repoDir, stdio: "pipe" }).toString();
  const write = (rel: string, text: string): void => {
    const abs = join(repoDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };

  git("init", "-q", "-b", "main");
  disableGitAutoMaintenance(repoDir);
  git("config", "--local", "user.name", OPERATOR);
  git("config", "--local", "user.email", "ada@example.test");
  write(
    "phax.json",
    JSON.stringify({
      version: 1,
      name: NAMESPACE,
      state: { root: stateRoot },
      gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
    }),
  );
  write("plan.md", LOOSE_PLAN);
  git("add", "-A");
  git("commit", "-q", "-m", "seed");

  // The resumable run, made as `phax run` makes a run folder, then left interrupted.
  const config = Result.getOrThrow(loadConfig(repoDir));
  const extracted = Result.getOrThrow(extractPlanDeterministic(RESUMABLE_PLAN));
  const { plan } = Result.getOrThrow(finalizeExtractedPlan(extracted, RESUMABLE_PLAN));
  const shortName = Result.getOrThrow(decodeShortName(plan.run.shortName));
  const setupLayers = Layer.mergeAll(
    makeFakeGit().layer,
    makeFakeShell().layer,
    makeFakeBackend().layer,
    NodeFileSystemLayer,
    NoopSystemTelemetryLayer,
  );
  const { runPath } = await Effect.runPromise(
    createRunFolder(shortName, RESUMABLE_PLAN, plan, config).pipe(Effect.provide(setupLayers)),
  );
  const runStatusPath = join(runPath, "run-status.json");
  const runStatus = JSON.parse(readFileSync(runStatusPath, "utf8")) as Record<string, unknown>;
  writeFileSync(runStatusPath, JSON.stringify({ ...runStatus, state: "interrupted" }, null, 2));
  await Effect.runPromise(
    setRunStatus(stateRoot, NAMESPACE, shortName, { state: "interrupted" }).pipe(
      Effect.provide(NodeFileSystemLayer),
    ),
  );

  const runQualifiedName = `${NAMESPACE}.${shortName}`;
  const lockPath = join(stateRoot, "locks", `${runQualifiedName}.lock`);
  mkdirSync(dirname(lockPath), { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    lockPath,
    JSON.stringify(
      {
        runKey: runQualifiedName,
        pid: process.pid,
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      null,
      2,
    ),
  );

  return {
    repoDir,
    stateRoot,
    planPath: "plan.md",
    runShortName: shortName,
    runQualifiedName,
    nextPhaseId: "phase-01",
    pid: process.pid,
    lockPath,
    readLock: () => (existsSync(lockPath) ? readFileSync(lockPath, "utf8") : "(no lock file)"),
    fakes: () => {
      const backend = makeFakeBackend();
      backend.impl.addCompletionResponse({ finalText: JSON.stringify(LOOSE_PLAN_EXTRACTION) });
      return {
        backend: backend.impl,
        deps: {
          backendLayer: backend.layer,
          githubLayer: makeFakeGitHub().layer,
          shellLayer: makeFakeShell().layer,
        },
      };
    },
    program: (commands) =>
      defineProgram({
        name: "phax",
        version: "1.0.0",
        exits: { refused: 64, defect: 70 },
        refusalHint: "Run `phax --help` for usage.",
        commands,
      }),
    dispose: () => {
      removeTempDir(repoDir);
      removeTempDir(stateRoot);
      home.restore();
      restoreGit();
    },
  };
}
