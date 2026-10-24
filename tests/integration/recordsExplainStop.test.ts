import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { explainRecord } from "../../src/app/recordsExplain.js";
import { loadConfig } from "../../src/app/loadConfig.js";
import { registerRecordsCommand } from "../../src/cli/commands/records.js";
import { decodeBranchName, type BranchName } from "../../src/domain/branded.js";
import { AwaitingReviewStopError } from "../../src/domain/errors.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { Git } from "../../src/ports/git.js";
import { encodeRunRecordManifest, type RunRecordManifest } from "../../src/schemas/runRecord.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import type { RunHold } from "../../src/schemas/status.js";
import {
  createHeldWorld,
  gitIn,
  readJson,
  resumeHeldRun,
  startHeldRun,
  worktreeOf,
  type HeldRun,
  type HeldWorld,
} from "../helpers/heldRunFixture.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// `phax records explain` on the commits of a stopped phase, on the made-up
// invoice-export run: phase-02 held (built by codex in X0), phase-03 declared
// interactive (first turn in X1), and on commits built by hand for the
// trailer precedence.

const sessionLayer = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("../../src/app/loadConfig.js", () => ({ loadConfig: vi.fn() }));
vi.mock("../../src/infra/session.js", () => ({
  makeNodeSessionLayer: () => sessionLayer.current,
}));
// No test reads ~/.phax: the routing and providers.json are the built-in catalog.
vi.mock("../../src/app/loadRouting.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/app/loadRouting.js")>()),
  loadModelRouting: () => Effect.succeed(DEFAULT_MODEL_ROUTING),
  loadProviderConfig: () => Effect.succeed(DEFAULT_PROVIDER_CONFIG),
}));
// The journal would write under ~/.phax: telemetry is off in these tests.
vi.mock("../../src/cli/commands/runLayers.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/cli/commands/runLayers.js")>();
  const { NoopSystemTelemetryLayer: noop } = await import("../../src/ports/systemTelemetry.js");
  return { ...original, makeGlobalTelemetryJournalLayerOrNoop: () => noop };
});

const HOLD_PHASE_02: RunHold = { selection: "listed", phases: ["phase-02"] };
const NO_HOLD: RunHold = { selection: "none" };

const X0_TRANSCRIPT = '{"type":"assistant","text":"built the invoice CSV record"}\n';
const X1_TRANSCRIPT = '{"type":"assistant","text":"the InvoiceRow header reads invoice_no"}\n';
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const short = (sha: string): string => sha.slice(0, 7);

let world: HeldWorld;
let others: HeldWorld[];

beforeEach(() => {
  world = createHeldWorld();
  others = [];
  vi.stubEnv("HOME", world.home);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  world.cleanup();
  for (const other of others) other.cleanup();
});

function stoppedAtReview(result: Either.Either<unknown, unknown>): void {
  if (Either.isRight(result)) throw new Error("the run did not stop");
  expect(result.left).toBeInstanceOf(AwaitingReviewStopError);
}

/** Runs `phax records explain <sha>` in-process on `run`'s repository. */
async function explain(run: HeldRun, sha: string, ...flags: string[]) {
  vi.mocked(loadConfig).mockReturnValue(Either.right(run.config));
  const logs: string[] = [];
  const errors: string[] = [];
  const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  const program = new Command().exitOverride();
  registerRecordsCommand(program, {
    log: (m) => logs.push(m),
    warn: (m) => errors.push(m),
    error: (m) => errors.push(m),
  });
  await program.parseAsync(["records", "explain", sha, ...flags], { from: "user" });
  const code = exit.mock.calls.at(-1)?.[0];
  exit.mockRestore();
  return { code, logs, errors, text: logs.join("\n") };
}

const explainOutcome = (run: HeldRun, sha: string) =>
  Effect.runPromise(
    explainRecord({
      sha,
      repoRoot: run.world.repoRoot,
      records: run.config.records,
      publishRemote: "origin",
    }).pipe(Effect.provide(Layer.mergeAll(NodeGitLayer, NodeShellLayer))),
  );

async function declaredAtPhase03(
  opts: { readonly firstTurnFails?: boolean; readonly in?: HeldWorld } = {},
): Promise<HeldRun> {
  const { run, result } = await startHeldRun(opts.in ?? world, NO_HOLD, {
    records: true,
    prepare: (prepared) => {
      prepared.backend.firstTurnSession = "X1";
      prepared.backend.firstTurnFails = opts.firstTurnFails ?? false;
    },
  });
  stoppedAtReview(result);
  return run;
}

function correctPhase03(run: HeldRun): void {
  writeFileSync(
    join(worktreeOf(run, "phase-03"), "src", "invoiceRow.ts"),
    "export const header = 'Invoice number';\n",
  );
}

describe(
  "explain on a held phase's two commits (§8 A held phase's record is written once, at closing)",
  { timeout: 60_000 },
  () => {
    it("names the same phase-02 record from C2 and from R2, the second found from the review commit", async () => {
      const { run, result } = await startHeldRun(world, HOLD_PHASE_02, { records: true });
      stoppedAtReview(result);
      const c2 = gitIn(worktreeOf(run, "phase-02"), "rev-parse", "HEAD");
      run.backend.transcripts.set("X0", X0_TRANSCRIPT);
      writeFileSync(
        join(worktreeOf(run, "phase-02"), "src", "invoiceRow.ts"),
        "export const header = 'Invoice number';\n",
      );
      stoppedAtReview(await resumeHeldRun(run));
      const r2 = gitIn(run.world.repoRoot, "rev-parse", `phax/invoice-export--phase-02`);
      expect(r2).not.toBe(c2);
      const binding = readJson(join(run.runPath, "phase-02", "agent-binding.json"));

      const fromC2 = await explain(run, c2);
      const fromR2 = await explain(run, r2);

      for (const output of [fromC2, fromR2]) {
        expect(output.code).toBe(0);
        expect(output.logs[0]).toMatch(/^phase-02 · codex-cli /);
        expect(output.text).toContain(
          `  held: corrected by Ada Example — phase commit ${short(c2)}, review commit ${short(r2)}`,
        );
        expect(output.text).toContain(
          `  sessions: codex-cli ${binding["model"] as string} X0 (builder; transcript sha256 ${sha256(X0_TRANSCRIPT).slice(0, 4)}…)`,
        );
      }
      expect(fromC2.logs[0]).not.toContain("found from review commit");
      expect(fromR2.logs[0]).toContain(`found from review commit ${short(r2)}`);
      const [a, b] = [await explainOutcome(run, c2), await explainOutcome(run, r2)];
      if (a.kind !== "found" || b.kind !== "found") throw new Error("expected both found");
      expect(b.record.recordCommitSha).toBe(a.record.recordCommitSha);
      expect([a.record.addressedBy, b.record.addressedBy]).toEqual([
        "phase-commit",
        "review-commit",
      ]);
      expect(b.record.phaseId).toBe("phase-02");
    });

    it("prints no stop line for a phase that never stopped", async () => {
      const { run, result } = await startHeldRun(world, HOLD_PHASE_02, { records: true });
      stoppedAtReview(result);
      const phase01 = gitIn(worktreeOf(run, "phase-01"), "rev-parse", "HEAD");

      const output = await explain(run, phase01);

      expect(output.code).toBe(0);
      expect(output.logs[0]).toMatch(/^phase-01 · /);
      expect(output.text).not.toMatch(/ held: | interactive: | sessions: /);
    });
  },
);

describe(
  "explain on a declared phase's commit (§8 Records and the security record name the review honestly)",
  { timeout: 60_000 },
  () => {
    it("names phase-03 interactive with its outcome and Ada Example, then X1 and its digest on one run and no session on the other", async () => {
      const withX1 = await declaredAtPhase03();
      withX1.backend.transcripts.set("X1", X1_TRANSCRIPT);
      const second = createHeldWorld();
      others.push(second);
      const failedTurn = await declaredAtPhase03({ firstTurnFails: true, in: second });
      correctPhase03(withX1);

      expect(Either.isRight(await resumeHeldRun(withX1))).toBe(true);
      expect(Either.isRight(await resumeHeldRun(failedTurn))).toBe(true);

      const first = await explain(
        withX1,
        gitIn(worktreeOf(withX1, "phase-03"), "rev-parse", "HEAD"),
      );
      const none = await explain(
        failedTurn,
        gitIn(worktreeOf(failedTurn, "phase-03"), "rev-parse", "HEAD"),
      );

      expect(first.logs[0]).toMatch(/^phase-03 · /);
      expect(first.text).toContain("  interactive: corrected by Ada Example");
      expect(first.text).toMatch(
        new RegExp(
          `  sessions: \\S+ \\S+ X1 \\(first-turn; transcript sha256 ${sha256(X1_TRANSCRIPT).slice(0, 4)}…\\)`,
        ),
      );
      expect(none.logs[0]).toMatch(/^phase-03 · /);
      expect(none.text).toContain("  interactive: reviewed without change by Ada Example");
      expect(none.text).toContain("  sessions: none");
    });
  },
);

describe("explain's address: which trailers name a record", () => {
  let repoDir: string;
  const RECORDS_BRANCH: BranchName = Either.getOrThrow(decodeBranchName("phax/records/v1"));
  const CONFIG: ResolvedRecordsConfig = {
    enabled: true,
    transcript: false,
    destination: { kind: "in-repo" },
    autoPush: false,
  };
  const RUN = "invoice-export-1786800000000";

  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: repoDir, encoding: "utf8" }).trim();

  function commitWith(trailers: readonly string[]): string {
    git(
      "commit",
      "--allow-empty",
      "-m",
      "feat: a commit",
      "-m",
      ["---", "", ...trailers].join("\n"),
    );
    return git("rev-parse", "HEAD");
  }

  function recordOf(phaseId: string): RunRecordManifest {
    return {
      runId: RUN,
      phaseId,
      shape: "skeleton",
      model: "claude-sonnet-5",
      effort: "high",
      provider: "claude-code",
      outcome: "committed",
      usage: { available: false },
      verifiedSurfaces: [],
      oracle: null,
      mode: "headless",
      stop: null,
    };
  }

  async function writeRecord(phaseId: string): Promise<void> {
    const manifest = recordOf(phaseId);
    await Effect.runPromise(
      Effect.flatMap(Git, (g) =>
        g.writeTreeCommit({
          repo: repoDir,
          branch: RECORDS_BRANCH,
          message: [
            `records(${phaseId}): committed`,
            "",
            `Run-Id: ${RUN}`,
            `Phase-Id: ${phaseId}`,
          ].join("\n"),
          files: [
            {
              path: `${RUN}/${phaseId}/record.json`,
              content: new TextEncoder().encode(
                `${JSON.stringify(encodeRunRecordManifest(withSchemaUrl("phase-record-manifest", manifest)), null, 2)}\n`,
              ),
            },
          ],
        }),
      ).pipe(Effect.provide(NodeGitLayer)),
    );
  }

  const outcomeOf = (sha: string) =>
    Effect.runPromise(
      explainRecord({ sha, repoRoot: repoDir, records: CONFIG, publishRemote: "origin" }).pipe(
        Effect.provide(Layer.mergeAll(NodeGitLayer, NodeShellLayer)),
      ),
    );

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "phax-explain-stop-repo-"));
    git("init", "--initial-branch=main");
    disableGitAutoMaintenance(repoDir);
    git("config", "--local", "user.email", "ada@example.test");
    git("config", "--local", "user.name", "Ada Example");
    git("commit", "--allow-empty", "-m", "chore: start");
    await writeRecord("phase-01");
    await writeRecord("phase-02");
  });

  afterEach(() => removeTempDir(repoDir));

  it.each([
    {
      label: "Run-Id with Phase-Id and Held-Phase resolves by the pair",
      trailers: (phase: string, held: string) => [
        `Run-Id: ${RUN}`,
        `Phase-Id: ${phase}`,
        `Held-Phase: ${held}`,
      ],
      expected: { kind: "found", phaseId: "phase-01", addressedBy: "phase-commit" },
    },
    {
      label: "Run-Id with Held-Phase alone resolves to the held phase's record",
      trailers: (_phase: string, held: string) => [`Run-Id: ${RUN}`, `Held-Phase: ${held}`],
      expected: { kind: "found", phaseId: "phase-02", addressedBy: "review-commit" },
    },
    {
      label: "Run-Id with Phase-Id alone is a phase commit",
      trailers: (phase: string) => [`Run-Id: ${RUN}`, `Phase-Id: ${phase}`],
      expected: { kind: "found", phaseId: "phase-01", addressedBy: "phase-commit" },
    },
    {
      label: "Held-Phase with no Run-Id is not a phax commit",
      trailers: (_phase: string, held: string) => [`Held-Phase: ${held}`],
      expected: { kind: "not-phax-commit" },
    },
  ])("$label", async ({ trailers, expected }) => {
    const sha = commitWith(trailers("phase-01", "phase-02"));

    const outcome = await outcomeOf(sha);

    expect(outcome.kind).toBe(expected.kind);
    if (outcome.kind === "found") {
      expect(outcome.record.phaseId).toBe(expected.phaseId);
      expect(outcome.record.addressedBy).toBe(expected.addressedBy);
    }
  });
});
