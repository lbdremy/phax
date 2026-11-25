import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Layer, Predicate, Result } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serializeBriefRecord, stampBriefRequest } from "../../src/app/briefProvider.js";
import { executePlan } from "../../src/app/executePlan.js";
import { withRunLock } from "../../src/app/lock.js";
import { closePulledBriefs } from "../../src/app/pullBrief.js";
import { writePhaseBriefRequest } from "../../src/app/pushedBrief.js";
import { resetPhase } from "../../src/app/resetPhase.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { createPhaseWorktree, writePhasePlanFile } from "../../src/app/worktree.js";
import {
  decodeBranchName,
  decodeClaudeSessionId,
  decodePhaseId,
  decodeShortName,
  decodeWorktreePath,
} from "../../src/domain/branded.js";
import { outsideBriefRequest } from "../../src/domain/brief/request.js";
import { PhaxContextRefusedError } from "../../src/domain/errors.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeLock } from "../../src/infra/fakes/lock.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { makeNodeGitLayer } from "../../src/infra/git.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { liftFixturePhaxPlanToCurrent } from "../helpers/liftFixturePhaxPlan.js";
import { planMdFor } from "../helpers/planMarkdown.js";
import { processOutput } from "../helpers/processOutput.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// A `.phax-context` that is a symbolic link, on a real filesystem and with
// real git: committed on the phase base, it is refused at phase preparation
// and fails the run's phase, with nothing created, written or removed in the
// link's target. Pulled brief records are copied only from a real `briefs`
// directory, never through a link, and only once they decode.

const NAMESPACE = "example";
const SHORT = "invoice-export";
const BRANCH = `phax/${SHORT}`;

let root: string;
let repoRoot: string;
let stateRoot: string;
let outside: string;
let restoreGit: () => void;

const gitIn = (cwd: string, ...args: string[]): string =>
  boundedOutput("git", args, { boundMs: GIT_BOUND_MS, cwd });

const writeIn = (dir: string, path: string, content: string): void => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
};

/** Every entry under `dir`, recursively, with each file's content. */
function listing(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    out[path.slice(dir.length + 1)] = entry.isFile() ? readFileSync(path, "utf8") : "<dir>";
  }
  return out;
}

const worktreeOf = (phaseId = "phase-01"): string =>
  join(stateRoot, "worktrees", `${NAMESPACE}.${SHORT}`, phaseId);

beforeEach(() => {
  restoreGit = isolateGit();
  root = realpathSync(mkdtempSync(join(tmpdir(), "phax-context-symlink-")));
  repoRoot = join(root, "repo");
  stateRoot = join(root, "state");
  outside = join(root, "outside");
  for (const dir of [repoRoot, stateRoot, outside]) mkdirSync(dir);
  writeIn(outside, "keep.txt", "outside bytes\n");
  gitIn(repoRoot, "init", "--initial-branch=main");
  disableGitAutoMaintenance(repoRoot);
  gitIn(repoRoot, "config", "--local", "user.email", "ada@example.test");
  gitIn(repoRoot, "config", "--local", "user.name", "Ada Example");
  gitIn(repoRoot, "config", "--local", "commit.gpgsign", "false");
  writeIn(repoRoot, "src/keep.ts", "export const keep = 1;\n");
  // The phase base commits `.phax-context` as a link to a directory outside.
  symlinkSync(outside, join(repoRoot, ".phax-context"));
  gitIn(repoRoot, "add", "-A");
  gitIn(repoRoot, "commit", "-m", "chore: start");
});

afterEach(() => {
  removeTempDir(root);
  restoreGit();
});

const REFUSAL = () =>
  [
    `.phax-context is a symbolic link (→ ${outside}), not a directory`,
    "phax writes and reads .phax-context only as a real directory; remove the link from the branch it came from, then run phax reset-phase and phax resume.",
  ].join("\n");

const realLayers = () => Layer.mergeAll(NodeFileSystemLayer, makeNodeGitLayer({ repoRoot }));

describe("a .phax-context committed on the phase base as a symbolic link", () => {
  it("is refused at phase preparation, with nothing created, written or removed in its target", async () => {
    const before = listing(outside);
    const branch = Result.getOrThrow(decodeBranchName(`${BRANCH}--phase-01`));
    gitIn(repoRoot, "branch", branch, "main");

    const created = await Effect.runPromise(
      Effect.result(
        createPhaseWorktree(
          NAMESPACE,
          Result.getOrThrow(decodeShortName(SHORT)),
          Result.getOrThrow(decodePhaseId("phase-01")),
          branch,
          stateRoot,
          repoRoot,
        ).pipe(Effect.provide(realLayers())),
      ),
    );
    expect(Result.isFailure(created)).toBe(true);
    if (Result.isFailure(created)) {
      expect(created.failure).toBeInstanceOf(PhaxContextRefusedError);
      expect(created.failure.message).toBe(REFUSAL());
      expect(created.failure).toMatchObject({
        path: join(worktreeOf(), ".phax-context"),
        kind: "symlink",
        linkTarget: outside,
      });
    }

    // The plan and the brief request are refused the same way.
    const worktree = Result.getOrThrow(decodeWorktreePath(worktreeOf()));
    const plan = await Effect.runPromise(
      Effect.result(writePhasePlanFile(worktree, "# plan\n").pipe(Effect.provide(realLayers()))),
    );
    const request = await Effect.runPromise(
      Effect.result(
        writePhaseBriefRequest(
          worktree,
          stampBriefRequest(outsideBriefRequest(["src/keep.ts"])),
        ).pipe(Effect.provide(realLayers())),
      ),
    );
    for (const result of [plan, request]) {
      expect(Result.isFailure(result) ? result.failure.message : undefined).toBe(REFUSAL());
    }
    expect(listing(outside)).toEqual(before);
  });

  it("fails the run's phase with the refusal as its error", async () => {
    const before = listing(outside);
    const shortName = Result.getOrThrow(decodeShortName(SHORT));
    const { plan } = Result.getOrThrow(
      liftFixturePhaxPlanToCurrent(
        "phax-plan.json",
        {
          version: 1,
          run: { shortName: SHORT, title: "Invoice export", branch: BRANCH, requiredCommands: [] },
          phases: [
            {
              id: "phase-01",
              title: "Export step",
              model: "claude-sonnet-5-5",
              effort: "medium",
              planMarkdownAnchor: "#phase-01",
              plannedFilesToCreate: ["src/phase-01.ts"],
              plannedFilesToEdit: [],
              optionalFilesToEdit: [],
              commit: { subject: "feat(export): step one", body: "Made-up body." },
            },
          ],
        },
        "standard",
      ),
    );
    const planMd = planMdFor(plan);
    const config = configOf();
    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, planMd, plan, config).pipe(Effect.provide(NodeFileSystemLayer)),
    );
    const backend = makeFakeBackend();
    backend.impl.addRunResponse({
      sessionId: Result.getOrThrow(decodeClaudeSessionId("session-phase-01")),
      outputPath: "",
      finalText: "done",
    });
    const shell = makeFakeShell();
    shell.impl.setDefaultResponse({ exitCode: 0, stdout: "ok", stderr: "" });

    const result = await Effect.runPromise(
      Effect.result(
        withRunLock(
          `${NAMESPACE}.${SHORT}`,
          executePlan({
            phaxVersion: "0.0.0-test",
            output: processOutput,
            shortName,
            namespace: NAMESPACE,
            plan,
            planMd,
            config,
            gateProfileId: "standard",
            allowDirty: false,
            runPath,
            runId,
            startIndex: 0,
            routing: DEFAULT_MODEL_ROUTING,
            providerConfig: DEFAULT_PROVIDER_CONFIG,
          }),
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              backend.layer,
              realLayers(),
              shell.layer,
              NoopSystemTelemetryLayer,
              makeFakeGitHub().layer,
              makeFakeLock().layer,
            ),
          ),
        ),
      ),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(PhaxContextRefusedError);
    // No agent ran: the phase failed while it was being prepared.
    expect(backend.impl.runCalls).toEqual([]);
    expect(fieldOf(join(runPath, "run-status.json"), "state")).toBe("failed");
    expect(fieldOf(join(runPath, "run-status.json"), "lastError")).toEqual(
      expect.stringContaining(REFUSAL()),
    );
    // As on a WorktreeCreationError, the run fails and the phase keeps the
    // state it failed in; reset-phase recovers it.
    expect(fieldOf(join(runPath, "phase-01", "status.json"), "state")).toBe("setting_up_worktree");
    expect(listing(outside)).toEqual(before);

    const reset = await Effect.runPromise(
      Effect.result(
        resetPhase({
          namespace: NAMESPACE,
          shortName,
          phaseId: "phase-01",
          stateRoot,
          repoRoot,
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              realLayers(),
              makeFakeShell().layer,
              NoopSystemTelemetryLayer,
              makeFakeLock().layer,
            ),
          ),
        ),
      ),
    );
    expect(Result.isSuccess(reset)).toBe(true);
    expect(listing(outside)).toEqual(before);
  });
});

describe("closePulledBriefs", () => {
  let worktree: string;
  let phaseFolder: string;
  let warnings: string[];

  beforeEach(() => {
    worktree = join(root, "worktree");
    phaseFolder = join(root, "run", "phase-01");
    mkdirSync(worktree);
    mkdirSync(phaseFolder, { recursive: true });
    warnings = [];
  });

  const close = () =>
    Effect.runPromise(
      closePulledBriefs({
        worktreePath: worktree,
        phaseFolderPath: phaseFolder,
        phaseId: "phase-01",
        output: { warn: (line: string) => warnings.push(line) },
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

  const pulledRecord = (): string =>
    serializeBriefRecord("pulled", stampBriefRequest(outsideBriefRequest(["src/keep.ts"])), {
      kind: "answered",
      decoded: { rules: [], findings: [] },
      answer: {
        $schema: "https://example.test/brief-report.json",
        rules: [],
        findings: [],
        zeta: { b: 1, a: 2 },
      },
    });

  it("copies nothing and writes nothing through a linked briefs directory", async () => {
    mkdirSync(join(worktree, ".phax-context"));
    writeIn(outside, "brief-01.json", pulledRecord());
    symlinkSync(outside, join(worktree, ".phax-context", "briefs"));
    const before = listing(outside);

    await close();

    expect(readdirSync(phaseFolder)).toEqual([]);
    expect(listing(outside)).toEqual(before);
    expect(warnings).toEqual([
      `[phax] Warning: phase "phase-01" — .phax-context/briefs is a symbolic link (→ ${outside}), not a directory; pulled briefs not collected.`,
    ]);
  });

  it("does not read or copy a linked brief-01.json", async () => {
    writeIn(outside, "brief.json", pulledRecord());
    mkdirSync(join(worktree, ".phax-context", "briefs"), { recursive: true });
    symlinkSync(
      join(outside, "brief.json"),
      join(worktree, ".phax-context", "briefs", "brief-01.json"),
    );
    const before = listing(outside);

    await close();

    expect(readdirSync(phaseFolder)).toEqual([]);
    expect(listing(outside)).toEqual(before);
    expect(warnings).toEqual([
      '[phax] Warning: phase "phase-01" — .phax-context/briefs/brief-01.json is a symbolic link; not recorded.',
    ]);
  });

  it("does not copy a regular brief-01.json that is not a pulled brief record", async () => {
    writeIn(worktree, ".phax-context/briefs/brief-01.json", '{"anything":"the agent wrote"}');

    await close();

    expect(readdirSync(phaseFolder)).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^\[phax\] Warning: phase "phase-01" — \.phax-context\/briefs\/brief-01\.json is not a brief record \(.*\); not recorded\.$/,
    );
  });

  it("copies a correct pulled brief record byte-identical to what phax wrote", async () => {
    const record = pulledRecord();
    writeIn(worktree, ".phax-context/briefs/brief-01.json", record);

    await close();

    expect(readFileSync(join(phaseFolder, "brief-01.json"), "utf8")).toBe(record);
    expect(readFileSync(join(worktree, ".phax-context", "briefs", "closed"), "utf8")).toBe("");
    expect(warnings).toEqual([]);
  });
});

/** The field `key` of the JSON object in the file at `path`. */
function fieldOf(path: string, key: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return Predicate.hasProperty(parsed, key) ? parsed[key] : undefined;
}

function configOf(): ResolvedConfig {
  return {
    raw: {
      version: 1,
      name: NAMESPACE,
      state: { root: stateRoot },
      gateProfiles: {
        standard: [
          { command: "pnpm test", surface: "local", firing: "every-phase", output: "log" },
        ],
      },
    },
    stateRoot,
    namespace: NAMESPACE,
    repoRoot,
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low",
    fileReconciliationMode: "report_only",
    records: {
      enabled: false,
      transcript: false,
      destination: { kind: "in-repo" },
      autoPush: false,
    },
    security: {
      profile: "unsafe",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
    publish: resolvePublishConfig(undefined),
    complianceReview: resolveComplianceReviewConfig(undefined),
    codeReview: resolveCodeReviewConfig(undefined),
    authoring: resolveAuthoringConfig(undefined),
  };
}
