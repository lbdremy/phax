import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Either } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPhasePosture } from "../../src/app/interactiveFiles.js";
import { AwaitingReviewStopError } from "../../src/domain/errors.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
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

// The security record of a stop, on the made-up invoice-export run: phase-02
// held (built by codex in X0), phase-03 declared interactive (first turn in
// X1). The run loop is the real one; the fake backend plays every turn.

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

/** How each provider confines a first or closing turn: written out, not derived. */
const NARROWING: Readonly<Record<string, string>> = {
  "claude-code": "read-only-tools",
  "codex-cli": "read-only-sandbox",
  "mistral-vibe": "read-only-tools",
};

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

function stoppedAtReview(result: Either.Either<unknown, unknown>): void {
  if (Either.isRight(result)) throw new Error("the run did not stop");
  expect(result.left).toBeInstanceOf(AwaitingReviewStopError);
}

const securityPath = (run: HeldRun, phaseId: string): string =>
  join(run.runPath, phaseId, "security.json");
const securityText = (run: HeldRun, phaseId: string): string =>
  readFileSync(securityPath(run, phaseId), "utf8");
const securityOf = (run: HeldRun, phaseId: string): Record<string, unknown> =>
  readJson(securityPath(run, phaseId));

/** The first and closing turn streams in a phase folder, first turns first. */
function turnStreamNames(run: HeldRun, phaseId: string): string[] {
  const names = readdirSync(join(run.runPath, phaseId)).filter((n) =>
    /^(first|closing)-turn-\d{2}\.jsonl$/.test(n),
  );
  return [
    ...names.filter((n) => n.startsWith("first-")).toSorted(),
    ...names.filter((n) => n.startsWith("closing-")).toSorted(),
  ];
}

/** Everything of a security.json but its `stop`. */
const withoutStop = (doc: Record<string, unknown>): Record<string, unknown> => {
  const { stop: _stop, ...rest } = doc;
  return rest;
};

const postureOn = (run: HeldRun, phaseId: string) =>
  Effect.runPromise(
    readPhasePosture(join(run.runPath, phaseId)).pipe(Effect.provide(NodeFileSystemLayer)),
  );

async function declaredAtPhase03(): Promise<HeldRun> {
  const { run, result } = await startHeldRun(world, NO_HOLD, {
    prepare: (prepared) => {
      prepared.backend.firstTurnSession = "X1";
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
  "the security record of a declared stop (§8 Records and the security record name the review honestly)",
  { timeout: 60_000 },
  () => {
    it("is null before the close and, after it, says the person's work ran outside phax's enforcement and names each turn phax ran", async () => {
      const run = await declaredAtPhase03();
      expect(securityOf(run, "phase-03")["stop"]).toBeNull();
      expect(securityOf(run, "phase-03")["version"]).toBe(3);
      const provider = securityOf(run, "phase-03")["provider"] as string;
      correctPhase03(run);

      expect(Either.isRight(await resumeHeldRun(run))).toBe(true);

      const turns = turnStreamNames(run, "phase-03");
      expect(turns.length).toBeGreaterThan(0);
      expect(turns[0]).toBe("first-turn-01.jsonl");
      expect(securityOf(run, "phase-03")["stop"]).toEqual({
        cause: "declared",
        personWork: "outside-phax-enforcement",
        turns: turns.map((stream) => ({
          turn: stream.replace(".jsonl", ""),
          kind: stream.startsWith("first-") ? "first-turn" : "closing-turn",
          narrowing: NARROWING[provider],
          agentCommands: [],
        })),
      });
    });

    it("changes no other field: the bytes before `stop` are kept, and the posture a continue reads is the same", async () => {
      const run = await declaredAtPhase03();
      const before = securityText(run, "phase-03");
      const postureBefore = await postureOn(run, "phase-03");
      correctPhase03(run);

      expect(Either.isRight(await resumeHeldRun(run))).toBe(true);

      const after = securityText(run, "phase-03");
      const cut = before.lastIndexOf('"stop": null');
      expect(cut).toBeGreaterThan(0);
      expect(after.startsWith(before.slice(0, cut))).toBe(true);
      expect(withoutStop(JSON.parse(after) as Record<string, unknown>)).toEqual(
        withoutStop(JSON.parse(before) as Record<string, unknown>),
      );
      expect(await postureOn(run, "phase-03")).toEqual(postureBefore);
    });

    it("keeps the phase's own agent commands as the builder ran under them, while each turn lists none", async () => {
      const run = await declaredAtPhase03();
      const granted = securityOf(run, "phase-03")["agentCommands"];
      correctPhase03(run);

      expect(Either.isRight(await resumeHeldRun(run))).toBe(true);

      const doc = securityOf(run, "phase-03");
      expect(doc["agentCommands"]).toEqual(granted);
      const stop = doc["stop"] as { turns: { agentCommands: unknown[] }[] };
      expect(stop.turns.length).toBeGreaterThan(0);
      for (const turn of stop.turns) expect(turn.agentCommands).toEqual([]);
    });

    it("lifts a version-1 file at the close, which becomes version 3 with the stop and nothing else changed", async () => {
      const run = await declaredAtPhase03();
      const current = securityOf(run, "phase-03");
      const { stop: _stop, protectedPaths: _protectedPaths, ...v1 } = current;
      writeFileSync(securityPath(run, "phase-03"), JSON.stringify({ ...v1, version: 1 }, null, 2));
      correctPhase03(run);

      expect(Either.isRight(await resumeHeldRun(run))).toBe(true);

      const after = securityOf(run, "phase-03");
      expect(after["version"]).toBe(3);
      expect(after["stop"]).toMatchObject({ cause: "declared" });
      expect(withoutStop({ ...after, version: 1 })).toEqual(
        withoutStop({ ...current, version: 1 }),
      );
    });

    it("names exactly the turn streams the phase folder holds, so writing the step again gives the same stop", async () => {
      const run = await declaredAtPhase03();
      correctPhase03(run);
      expect(Either.isRight(await resumeHeldRun(run))).toBe(true);

      // The step computes the stop from the folder as it stands: nothing in
      // the folder has moved since, so a repeat would write these same bytes.
      const doc = JSON.parse(securityText(run, "phase-03")) as Record<string, unknown>;
      expect(doc["stop"]).not.toBeNull();
      expect(turnStreamNames(run, "phase-03")).toEqual(
        (doc["stop"] as { turns: { turn: string }[] }).turns.map((t) => `${t.turn}.jsonl`),
      );
    });
  },
);

describe(
  "the security record of a held stop and of a phase that never stopped",
  { timeout: 60_000 },
  () => {
    it("names the held phase's cause and its provider's narrowing, and leaves the phases before it at null", async () => {
      const { run, result } = await startHeldRun(world, HOLD_PHASE_02);
      stoppedAtReview(result);
      expect(securityOf(run, "phase-02")["stop"]).toBeNull();
      const provider = securityOf(run, "phase-02")["provider"] as string;
      expect(provider).toBe("codex-cli");
      const c2 = gitIn(worktreeOf(run, "phase-02"), "rev-parse", "HEAD");
      writeFileSync(
        join(worktreeOf(run, "phase-02"), "src", "invoiceRow.ts"),
        "export const header = 'Invoice number';\n",
      );

      stoppedAtReview(await resumeHeldRun(run));

      expect(gitIn(worktreeOf(run, "phase-02"), "rev-parse", "HEAD")).not.toBe(c2);
      const stop = securityOf(run, "phase-02")["stop"] as {
        cause: string;
        personWork: string;
        turns: { turn: string; narrowing: string; agentCommands: unknown[] }[];
      };
      expect(stop).toMatchObject({ cause: "held", personWork: "outside-phax-enforcement" });
      expect(stop.turns.length).toBeGreaterThan(0);
      expect(stop.turns.map((t) => `${t.turn}.jsonl`)).toEqual(turnStreamNames(run, "phase-02"));
      for (const turn of stop.turns) {
        expect(turn.narrowing).toBe("read-only-sandbox");
        expect(turn.agentCommands).toEqual([]);
      }
      // A headless phase that never stopped says so.
      expect(securityOf(run, "phase-01")["stop"]).toBeNull();
      expect(existsSync(securityPath(run, "phase-01"))).toBe(true);
    });
  },
);
