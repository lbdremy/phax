import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorArtifact, type AuthorArtifactInput } from "../../src/app/authorArtifact.js";
import { closeStop } from "../../src/app/closeStop.js";
import { dispatch } from "../../src/app/dispatcher.js";
import { exitCodeForAuthoringError, exitCodeForError } from "../../src/cli/commands/runLayers.js";
import { renderSessionFailure } from "../../src/cli/commands/sessionFailureOutput.js";
import type { PhaseId, RunId } from "../../src/domain/branded.js";
import { AgentSessionFailedError, StopCloseRefusedError } from "../../src/domain/errors.js";
import type { RoutingResolution } from "../../src/domain/routing/types.js";
import type { SessionFailure } from "../../src/domain/session/outcome.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NodeFileSystemLayer, makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { makeNodeBackendLayer } from "../../src/infra/providers/dispatcher.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { Backend } from "../../src/ports/backend.js";
import { Git } from "../../src/ports/git.js";
import { Shell } from "../../src/ports/shell.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { GateStep } from "../../src/schemas/phaxConfig.js";
import type { PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";
import { serializeSidecar } from "../../src/domain/artifact/sidecar.js";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import type { SpecDocument } from "../../src/schemas/specDocument.js";
import {
  KEPT_SESSION,
  RECORDS_BRANCH,
  SPEC_FRONTMATTER,
  RECORDS_ON,
  expectFailure,
  useDecideRepo,
} from "../helpers/decideVerdictsHarness.js";
import { makeFakeProviderCli, type FakeProviderCli } from "../helpers/fakeProviderCli.js";
import {
  createWorld,
  readJson,
  resolvedConfig,
  stopRun,
  type StoppedRun,
  type World,
} from "../helpers/stoppedRunFixture.js";
import { removeTempDir } from "../helpers/tempGit.js";
import { FILE_VALID, SPEC, SPEC_PATH } from "../unit/decide/verdictsFixtures.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

const sessionLayer = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("../../src/app/loadConfig.js", () => ({ loadConfig: vi.fn() }));
vi.mock("../../src/infra/session.js", () => ({
  makeNodeSessionLayer: () => sessionLayer.current,
}));
// No test reads ~/.phax: providers.json is the built-in catalog.
vi.mock("../../src/app/loadRouting.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/app/loadRouting.js")>();
  const { Effect: E } = await import("effect");
  const { DEFAULT_PROVIDER_CONFIG: defaults } =
    await import("../../src/domain/routing/defaults.js");
  return { ...original, loadProviderConfig: () => E.succeed(defaults) };
});

// Claude Code ends a session with `error_max_structured_output_retries` when
// the model could not meet the handed schema. The reader makes it a
// provider-error naming the subtype, and no structured call resumes it, runs a
// corrective turn after it or starts a new session for it.

const SUBTYPE = "error_max_structured_output_retries";
const DETAIL = "Failed to provide valid structured output after 5 attempts";
const EXHAUSTED_MESSAGE = `${SUBTYPE}: ${DETAIL}`;

const exhausted = (sessionId: string | null): SessionFailure => ({
  provider: "claude-code",
  kind: "provider-error",
  message: EXHAUSTED_MESSAGE,
  sessionId,
  resetAt: null,
  providerSubtype: SUBTYPE,
});

// ── Authoring, through the real Claude adapter ─────────────────────────────

describe("a headless authoring session that ends with exhausted structured-output retries", () => {
  const NOW = "2026-10-30T14:12:00.000Z";
  const SESSION = "3f9a0c1d-6e2b-4c7a-8d15-b0e4f7a29c68";
  const resolution: RoutingResolution = {
    requested: { model: "claude-opus-5-5", family: "claude-opus", effort: "high" },
    selected: {
      provider: "claude-code",
      family: "claude-opus",
      concreteModel: "claude-opus-5-5",
      thinking: "high",
    },
    relationship: "exact",
    reason: "exact match",
  };
  const security: ResolvedSecurityConfig = {
    profile: "secure",
    filesystem: { allowRead: [], allowWrite: [] },
    network: { profile: "provider-only" },
    mcp: { mode: "disabled", allow: [] },
    agentCommands: [],
  };
  const records: ResolvedRecordsConfig = {
    enabled: false,
    transcript: false,
    destination: { kind: "in-repo" },
    autoPush: false,
  };

  let root: string;
  let cli: FakeProviderCli;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "phax-structured-exhausted-")));
    mkdirSync(join(root, "repo", "docs", "specs"), { recursive: true });
    mkdirSync(join(root, "state"), { recursive: true });
    cli = makeFakeProviderCli(join(root, "cli"));
    for (const [name, value] of Object.entries(cli.env)) vi.stubEnv(name, value);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    removeTempDir(root);
  });

  const providerConfig: ProviderConfig = {
    providers: { "claude-code": { enabled: true, executable: "claude" } },
  };

  function author() {
    const git = makeFakeGit();
    git.impl.setHeadCommit("3e9a1c4d".repeat(5));
    const repoRoot = join(root, "repo");
    const input: AuthorArtifactInput = {
      kind: "spec",
      slug: "widget-export",
      brief: { text: "Export widgets.\n", path: "brief.md" },
      sourceSpec: null,
      completion: { last: false, notLast: false },
      model: "claude-opus-5-5",
      effort: "high",
      resolution,
      skillText: "# phax-spec skill\n",
      security,
      repoRoot,
      stateRoot: join(root, "state"),
      extractPlanModel: "claude-sonnet-5",
      extractPlanEffort: "medium",
      nowIso: NOW,
      records,
      publishRemote: "origin",
      architectureProvider: false,
      assignmentBounds: false,
      oraclesProvider: false,
      output: { warn: () => undefined },
    };
    return Effect.runPromise(
      Effect.either(
        authorArtifact(input).pipe(
          Effect.provide(
            Layer.mergeAll(
              makeRootedNodeFileSystemLayer(repoRoot),
              git.layer,
              makeFakeGitHub().layer,
              makeNodeBackendLayer(providerConfig),
            ),
          ),
        ),
      ),
    );
  }

  it("fails with the provider-error line naming the subtype, exits 5 and runs no corrective resume", async () => {
    cli.setScript({
      sessionId: SESSION,
      finalText: "",
      errorResult: { subtype: SUBTYPE, errors: [DETAIL] },
    });

    const result = await author();

    if (Either.isRight(result)) throw new Error("authoring did not fail");
    const error = result.left;
    expect(error).toBeInstanceOf(AgentSessionFailedError);
    expect(exitCodeForAuthoringError(error)).toBe(5);
    const [line] = renderSessionFailure(error as AgentSessionFailedError, null);
    expect(line).toMatch(/^✗ claude-code session failed \(provider-error\): /);
    expect(line).toContain(SUBTYPE);
    // One spawn, no `--resume`.
    expect(cli.invocations()).toHaveLength(1);
    expect(cli.invocations()[0]?.argv).not.toContain("--resume");
  });
});

// ── decide --verdicts ──────────────────────────────────────────────────────

describe("decide --verdicts whose writer session ends with exhausted structured-output retries", () => {
  const AUTHORING_ID = "2610250900-log-rotation";
  const world = useDecideRepo();

  it("exits 5, records failure provider-error and resumes the kept session once", async () => {
    world.writeRepoFile(
      SPEC_PATH,
      SPEC_FRONTMATTER + renderSpecBody(SPEC.document as SpecDocument),
    );
    world.writeRepoFile(SPEC_PATH.replace(/\.md$/, ".json"), serializeSidecar(SPEC));
    world.writeRepoFile("verdicts.json", FILE_VALID);
    world.commitAll();
    world.keepAuthoringSession(AUTHORING_ID);
    const h = world.harness();
    h.backend.failNextResumeWith(exhausted(KEPT_SESSION));

    const { error } = expectFailure(
      world,
      await h.run({ records: RECORDS_ON }),
      5,
      world.headSha(),
    );

    expect(error.tag).toBe("AgentSessionFailedError");
    expect(h.backend.resumeCalls).toHaveLength(1);
    expect(h.backend.runCalls).toHaveLength(0);
    const manifest = JSON.parse(
      world.git(["show", `${RECORDS_BRANCH}:decision/${AUTHORING_ID}/01/record.json`]),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({ outcome: "failed", commit: null, failure: "provider-error" });
  });
});

function correct(run: StoppedRun): void {
  writeFileSync(
    join(run.worktree, "src/invoiceRow.ts"),
    "export const header = 'Invoice number';\n",
  );
  mkdirSync(join(run.worktree, "tests"), { recursive: true });
  writeFileSync(join(run.worktree, "tests/invoiceRow.test.ts"), "it('reads it', () => {});\n");
}

// ── A resumed closing turn ─────────────────────────────────────────────────

describe("a resumed closing turn", () => {
  const PHASE_03: PhaxPlanPhase = {
    id: "phase-03",
    title: "Review the export record",
    model: "claude-sonnet-5-5",
    effort: "medium",
    planMarkdownAnchor: "#phase-03",
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    mode: "interactive",
    oracle: null,
    testLines: [],
    commit: { subject: "feat(export): review the export record", body: "Made-up body." },
  };
  const GATE_STEPS: readonly GateStep[] = [
    { command: "pnpm typecheck", surface: "local", firing: "every-phase", output: "log" },
  ];
  const CLOSING_ANSWER = JSON.stringify({
    $schema: currentSchemaUrl("interactive-handoff"),
    corrections: [
      {
        what: "The invoice header reads `Invoice number`",
        guard: { kind: "test", ref: "tests/invoiceRow.test.ts" },
      },
    ],
    patternFromNowOn: ["Column headers are human-readable"],
    nextPhasesNeedToKnow: ["phase-04 copies the header wording"],
  });

  let world: World;

  beforeEach(async () => {
    world = createWorld();
    const { loadConfig } = await import("../../src/app/loadConfig.js");
    vi.mocked(loadConfig).mockReturnValue(Either.right(resolvedConfig(world)));
  });

  afterEach(() => {
    vi.clearAllMocks();
    world.cleanup();
  });

  const realGit = Effect.runSync(Effect.provide(Git, NodeGitLayer));
  const realShell = Effect.runSync(Effect.provide(Shell, NodeShellLayer));
  const passingShell = Layer.succeed(Shell, {
    run: (options) =>
      options.command.join(" ") === "pnpm typecheck"
        ? Effect.succeed({ exitCode: 0, stdout: "", stderr: "", stdoutEncoding: "utf8" as const })
        : realShell.run(options),
  });

  async function close(run: StoppedRun, backend: ReturnType<typeof makeFakeBackend>["impl"]) {
    const program = Effect.gen(function* () {
      yield* dispatch(
        {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          run: run.shortName as unknown as RunId,
          phase: "phase-03" as PhaseId,
          type: "RunResumeRequested",
        },
        {
          runPath: run.runPath,
          shortName: run.shortName,
          phaseFolderPath: run.phaseFolder,
          phaseId: "phase-03",
        },
      );
      return yield* Effect.either(
        closeStop({
          runId: run.runId as RunId,
          shortName: run.shortName,
          runPath: run.runPath,
          phase: PHASE_03,
          phaseFolder: run.phaseFolder,
          worktree: run.worktree,
          gateSteps: GATE_STEPS,
          gateRequest: Effect.succeed("{}"),
          fileReconciliationMode: "report_only" as const,
          phases: [PHASE_03],
          oracles: null,
          mainCheckout: run.world.repoRoot,
        }),
      );
    });
    return Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(Backend, backend),
            NodeFileSystemLayer,
            Layer.succeed(Git, realGit),
            passingShell,
            NoopSystemTelemetryLayer,
          ),
        ),
      ),
    );
  }

  it("ending with exhausted retries records close-error at closing-turn, exit 5, and starts no new session", async () => {
    const run = await stopRun(world);
    correct(run);
    const backend = makeFakeBackend().impl;
    backend.failNextResumeWith(exhausted("X1"));
    // A new session would answer; the test shows none is started.
    backend.addRunResponse({ sessionId: "N1" as never, outputPath: "", finalText: CLOSING_ANSWER });

    const result = await close(run, backend);

    if (Either.isRight(result)) throw new Error("the close was not refused");
    expect(result.left).toBeInstanceOf(StopCloseRefusedError);
    const error = result.left as StopCloseRefusedError;
    expect(exitCodeForError(error)).toBe(5);
    expect(error.lastClose).toMatchObject({
      result: "close-error",
      exitCode: 5,
      step: "closing-turn",
      detail: expect.stringContaining(SUBTYPE),
    });
    expect(backend.resumeCalls).toHaveLength(1);
    expect(backend.runCalls).toHaveLength(0);

    expect(readJson(join(run.runPath, "run-status.json"))["state"]).toBe("awaiting_review");
    const stop = readJson(join(run.runPath, "review-stop.json"));
    expect(stop["lastClose"]).toMatchObject({
      result: "close-error",
      exitCode: 5,
      step: "closing-turn",
    });
  });

  it("ending with any other provider-error still starts a new closing session", async () => {
    const run = await stopRun(world);
    correct(run);
    const backend = makeFakeBackend().impl;
    backend.failNextResumeWith({
      provider: "claude-code",
      kind: "provider-error",
      message: "error_during_execution: the session is gone",
      sessionId: "X1",
      resetAt: null,
    });
    backend.addRunResponse({ sessionId: "N1" as never, outputPath: "", finalText: CLOSING_ANSWER });

    const result = await close(run, backend);

    expect(backend.resumeCalls).toHaveLength(1);
    expect(backend.runCalls).toHaveLength(1);
    expect(backend.runCalls[0]?.options.outputJsonlPath).toBe(
      join(run.phaseFolder, "closing-turn-02.jsonl"),
    );
    expect(Either.isRight(result)).toBe(true);
  });
});
