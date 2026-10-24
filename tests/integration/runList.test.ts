import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Either } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRunList } from "../../packages/schemas/src/index.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import { decodeRunListFile } from "../../src/schemas/runList.js";
import {
  NAMESPACE,
  SHORT,
  createHeldWorld,
  readJson,
  startHeldRun,
  type HeldRun,
  type HeldWorld,
} from "../helpers/heldRunFixture.js";
import { patchJson, stopRun, type StoppedRun } from "../helpers/stoppedRunFixture.js";

// `phax ls --json` on the made-up world: invoice-export held at phase-02,
// credit-notes stopped at its declared phase-03 and payments-fix failed, in one
// state root. HOME is stubbed; no test reads ~/.phax or a real provider store.

vi.mock("../../src/app/loadConfig.js", () => ({ loadConfig: vi.fn() }));
vi.mock("../../src/app/loadRouting.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/app/loadRouting.js")>();
  const { Effect: E } = await import("effect");
  const { DEFAULT_MODEL_ROUTING: routing, DEFAULT_PROVIDER_CONFIG: defaults } =
    await import("../../src/domain/routing/defaults.js");
  return {
    ...original,
    loadModelRouting: () => E.succeed(routing),
    loadProviderConfig: () => E.succeed(defaults),
  };
});
vi.mock("../../src/cli/commands/runLayers.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/cli/commands/runLayers.js")>();
  const { NoopSystemTelemetryLayer: noop } = await import("../../src/ports/systemTelemetry.js");
  return { ...original, makeGlobalTelemetryJournalLayerOrNoop: () => noop };
});

const HOLD_PHASE_02 = { selection: "listed", phases: ["phase-02"] } as const;
const FORMAT_URL = /^https:\/\/.+\/run-list\/\d+\.\d+\.\d+\.json$/;

let world: HeldWorld;
let held: HeldRun;
let declared: StoppedRun;
let failed: StoppedRun;

beforeEach(async () => {
  world = createHeldWorld();
  vi.stubEnv("HOME", world.home);
  const started = await startHeldRun(world, HOLD_PHASE_02);
  held = started.run;
  const shared = {
    root: world.root,
    repoRoot: world.repoRoot,
    stateRoot: world.stateRoot,
    cleanup: () => undefined,
  };
  declared = await stopRun(shared, { shortName: "credit-notes" });
  failed = await stopRun(shared, { shortName: "payments-fix" });
  patchJson(join(failed.runPath, "run-status.json"), { state: "failed", lastError: "gate" });
  writeFileSync(
    join(world.stateRoot, "registry.json"),
    JSON.stringify({
      $schema: currentSchemaUrl("registry"),
      runs: [
        { shortName: SHORT, runId: held.runId },
        { shortName: declared.shortName, runId: declared.runId },
        { shortName: failed.shortName, runId: failed.runId },
      ].map((r) => ({
        namespace: NAMESPACE,
        shortName: r.shortName,
        runId: r.runId,
        state: "awaiting_review",
        branch: `phax/${r.shortName}`,
        projectName: NAMESPACE,
        phasesCount: 6,
        createdAt: "2026-10-22T09:00:00.000Z",
        updatedAt: "2026-10-22T09:00:00.000Z",
      })),
    }),
  );
  const { loadConfig } = await import("../../src/app/loadConfig.js");
  vi.mocked(loadConfig).mockReturnValue(Either.right(held.config));
}, 30_000);

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  world.cleanup();
});

function makeOutput() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    out: {
      log: (m: string) => logs.push(m),
      warn: (m: string) => logs.push(`WARN: ${m}`),
      error: (m: string) => errors.push(m),
    },
    logs,
    errors,
  };
}

async function lsJson(options: { awaitingReview?: boolean } = {}) {
  const { runLs } = await import("../../src/cli/commands/ls.js");
  const { out, logs } = makeOutput();
  const code = await runLs({ json: true, ...options }, out);
  expect(code).toBe(0);
  const document = JSON.parse(logs.join("\n")) as Record<string, unknown>;
  return document as { $schema: string; runs: Record<string, unknown>[] };
}

const row = (runs: Record<string, unknown>[], shortName: string) =>
  runs.find((r) => r["shortName"] === shortName)!;

describe("phax ls --json is a versioned run list", () => {
  it("prints one run-list document whose waiting runs embed their review-stop.json", async () => {
    const document = await lsJson();

    expect(document.$schema).toMatch(FORMAT_URL);
    expect(document.$schema).toBe(currentSchemaUrl("run-list"));
    expect(Either.isRight(decodeRunListFile(document))).toBe(true);
    expect(parseRunList(document).ok).toBe(true);
    expect(document.runs).toHaveLength(3);

    const heldRow = row(document.runs, SHORT);
    expect(heldRow).toMatchObject({ state: "awaiting_review", currentPhase: "2/6" });
    expect(heldRow["stop"]).toEqual(readJson(join(held.runPath, "review-stop.json")));

    const declaredRow = row(document.runs, "credit-notes");
    expect(declaredRow["state"]).toBe("awaiting_review");
    expect(declaredRow["stop"]).toEqual(readJson(join(declared.runPath, "review-stop.json")));

    expect(row(document.runs, "payments-fix")).toMatchObject({ state: "failed", stop: null });
  });

  it("lists only the waiting runs with --awaiting-review", async () => {
    const document = await lsJson({ awaitingReview: true });

    expect(document.runs.map((r) => r["shortName"]).toSorted()).toEqual(["credit-notes", SHORT]);
    expect(document.runs.every((r) => r["state"] === "awaiting_review")).toBe(true);
    expect(document.runs.every((r) => r["stop"] !== null)).toBe(true);
  });

  it("writes every row key", async () => {
    const document = await lsJson();

    for (const r of document.runs) {
      expect(Object.keys(r).toSorted()).toEqual(
        [
          "archivePath",
          "branch",
          "currentPhase",
          "gateProfile",
          "lockState",
          "namespace",
          "qualifiedName",
          "recordsPending",
          "shortName",
          "state",
          "stop",
          "updatedAt",
        ].toSorted(),
      );
    }
  });
});

describe("phax ls on a waiting run whose review-stop document is defective", () => {
  it("writes stop null in JSON and keeps the plain state in the table, exiting 0", async () => {
    writeFileSync(join(declared.runPath, "review-stop.json"), "{ not json");
    const { runLs } = await import("../../src/cli/commands/ls.js");

    const json = await lsJson();
    expect(row(json.runs, "credit-notes")).toMatchObject({ state: "awaiting_review", stop: null });
    // The other waiting run is unaffected.
    expect(row(json.runs, SHORT)["stop"]).not.toBeNull();

    const { out, logs } = makeOutput();
    expect(await runLs({}, out)).toBe(0);
    const line = logs
      .join("\n")
      .split("\n")
      .find((l) => l.includes("credit-notes"))!;
    expect(line).toContain("awaiting_review");
    expect(line).not.toContain("awaiting_review (");
  });

  it("embeds the parked copy when a close died before restoring the document", async () => {
    const live = join(declared.runPath, "review-stop.json");
    const parked = join(declared.phaseFolder, "review-stop.closing.json");
    const expected = readJson(live);
    renameSync(live, parked);

    const json = await lsJson();

    expect(row(json.runs, "credit-notes")["stop"]).toEqual(expected);
  });
});
