import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { explainRecord } from "../../src/app/recordsExplain.js";
import { listRecords } from "../../src/app/recordsList.js";
import { resolveRun } from "../../src/app/resolveRunInfo.js";
import { generateReviewHandoff } from "../../src/app/reviewHandoff.js";
import { loadReviewedPhases } from "../../src/app/loadReviewHandoffInputs.js";
import { decodeShortName } from "../../src/domain/branded.js";
import { interactiveFindings } from "../../src/domain/plan/interactiveCheck.js";
import { structureFindings, sequenceGapFindings } from "../../src/domain/plan/lint.js";
import { readPhaseHeaders } from "../../src/domain/plan/phaseHeader.js";
import { buildCompliancePrompt } from "../../src/domain/review/compliancePrompt.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { PhaxPlan, PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import {
  NAMESPACE,
  SHORT,
  createHeldWorld,
  readPhaseStatus,
  readRunStatus,
  startHeldRun,
  type HeldWorld,
} from "../helpers/heldRunFixture.js";

// A made-up invoice-export plan with no Mode line, run without --hold and
// with records on: every surface keeps what it was before stops existed. The
// expected values are stated literally.

vi.mock("../../src/app/loadConfig.js", () => ({ loadConfig: vi.fn() }));
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

let world: HeldWorld;

beforeEach(() => {
  world = createHeldWorld();
  vi.stubEnv("HOME", world.home);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  world.cleanup();
});

const TITLES = ["Export port", "Invoice CSV record"] as const;
const idOf = (index: number): string => `phase-${String(index + 1).padStart(2, "0")}`;

function headlessPlan(): { plan: PhaxPlan; planMd: string } {
  const plan = {
    run: {
      shortName: SHORT,
      title: "Invoice export",
      branch: `phax/${SHORT}`,
      requiredCommands: [],
    },
    phases: TITLES.map(
      (title, i): PhaxPlanPhase => ({
        id: idOf(i),
        title,
        model: "claude-sonnet-5-5",
        effort: "medium",
        planMarkdownAnchor: `#${idOf(i)}`,
        plannedFilesToCreate: [`src/${idOf(i)}.ts`],
        plannedFilesToEdit: [],
        optionalFilesToEdit: [],
        mode: "headless",
        oracle: null,
        commit: { subject: `feat(export): ${title.toLowerCase()}`, body: "Made-up body." },
      }),
    ) as unknown as PhaxPlan["phases"],
  } satisfies PhaxPlan;
  const planMd = [
    "# Invoice export",
    "",
    "## Required commands",
    "",
    "- (none)",
    "",
    ...plan.phases.flatMap((phase) => [
      `## ${phase.id} — ${phase.title} {#${phase.id}}`,
      "",
      `**Recommended model:** ${phase.model}`,
      `**Recommended effort:** ${phase.effort}`,
      "",
      "### Detailed instructions",
      "",
      `Write src/${phase.id}.ts.`,
      "",
      "### Planned files to create",
      "",
      `- \`src/${phase.id}.ts\``,
      "",
      "### Planned files to edit",
      "",
      "- (none)",
      "",
      "### Optional files that may be edited",
      "",
      "- (none)",
      "",
      "### Commit subject",
      "",
      `\`${phase.commit.subject}\``,
      "",
      "### Commit body",
      "",
      phase.commit.body,
      "",
    ]),
  ].join("\n");
  return { plan, planMd };
}

describe("a plan with no Mode line, run without --hold", { timeout: 60_000 }, () => {
  it("keeps its lint findings, prompts, states, records, review handoff and compliance prompt", async () => {
    const { plan, planMd } = headlessPlan();

    // `phax plans lint`: the deterministic findings are the same as before stops.
    const headers = readPhaseHeaders(planMd);
    expect(structureFindings(planMd)).toEqual([]);
    expect(sequenceGapFindings(planMd)).toEqual([]);
    expect(interactiveFindings({ headers, phases: plan.phases })).toEqual([]);

    const { run, result } = await startHeldRun(
      world,
      { selection: "none" },
      { records: true, plan: { plan, planMd } },
    );

    // The same exit: the run ends without stopping, and never failed.
    if (Either.isLeft(result)) throw new Error(`the run failed: ${String(result.left)}`);

    // No prompt carries corrections.
    for (const call of run.backend.calls) {
      expect(call.prompt).not.toContain("## Review corrections");
    }

    // States: every phase finished, headless, never stopped; the hold selects nothing.
    expect(readRunStatus(run)["hold"]).toEqual({ selection: "none" });
    for (const id of ["phase-01", "phase-02"]) {
      expect(readPhaseStatus(run, id)).toMatchObject({ mode: "headless", stop: null });
    }
    expect(readPhaseStatus(run, "phase-01")["state"]).toBe("cleaned_up");
    expect(readPhaseStatus(run, "phase-02")["state"]).toBe("review_open");
    expect(readRunStatus(run)["state"]).toBe("review_open");

    // Records: mode headless and stop null, found by explain, with no stop to show.
    const listed = await Effect.runPromise(
      listRecords({
        records: run.config.records,
        repoRoot: run.config.repoRoot,
        publishRemote: run.config.publish.remote,
        runId: run.runId as string,
      }).pipe(Effect.provide(Layer.mergeAll(NodeGitLayer, NodeShellLayer))),
    );
    if (listed.kind !== "listed") throw new Error("the records were not listed");
    const phaseRecords = listed.records.filter((r) => r.kind === "phase");
    expect(phaseRecords.map((r) => r.kind === "phase" && r.phaseId).toSorted()).toEqual([
      "phase-01",
      "phase-02",
    ]);
    for (const id of ["phase-01", "phase-02"]) {
      const sha = readPhaseStatus(run, id)["commitHash"] as string;
      const explained = await Effect.runPromise(
        explainRecord({
          sha,
          repoRoot: world.repoRoot,
          records: run.config.records,
          publishRemote: run.config.publish.remote,
        }).pipe(Effect.provide(Layer.mergeAll(NodeGitLayer, NodeShellLayer))),
      );
      if (explained.kind !== "found") throw new Error(`no record explained for ${id}`);
      expect(explained.record.manifest).toMatchObject({ mode: "headless", stop: null });
    }

    // The review handoff has no Reviewed phases, and the compliance prompt neither.
    const info = Either.getOrThrow(
      resolveRun(NAMESPACE, Either.getOrThrow(decodeShortName(SHORT)), world.stateRoot),
    );
    const layers = Layer.mergeAll(NodeFileSystemLayer, NoopSystemTelemetryLayer);
    await Effect.runPromise(
      generateReviewHandoff(info, { allowPartial: true }).pipe(Effect.provide(layers)),
    );
    const handoff = readFileSync(join(run.runPath, "review-handoff.md"), "utf8");
    expect(handoff).toContain("## Phase details");
    expect(handoff).not.toContain("## Reviewed phases");

    const reviewed = await Effect.runPromise(
      loadReviewedPhases(info).pipe(Effect.provide(NodeFileSystemLayer)),
    );
    expect(reviewed).toEqual([]);
    const prompt = buildCompliancePrompt({
      planMd,
      reconciliationMd: "## Reconciliation",
      phases: info.planPhases,
      phaseHandoffs: [],
      reviewedPhases: [],
      worktreePath: info.worktreePath,
      mdArtifactPath: "/example/compliance-review.md",
      jsonArtifactPath: "/example/compliance-review.json",
    });
    expect(prompt).not.toContain("## Reviewed phases");
    expect(prompt).not.toContain("A person corrected this phase");

    // Nothing in the run folder is a stop artifact.
    const names = readdirSync(join(run.runPath, "phase-01"));
    expect(names).not.toContain("review-stop.json");
    expect(names).not.toContain("interactive-session.json");
  });
});
