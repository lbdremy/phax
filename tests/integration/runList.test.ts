import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Either } from "effect";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { isolateGit } from "../helpers/isolateGit.js";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { phaxCall } from "../helpers/runnerCall.js";
import { patchJson, stopRun, type StoppedRun } from "../helpers/stoppedRunFixture.js";
import { removeTempDir } from "../helpers/tempGit.js";
import { LS_JSON_BEFORE, LS_REGISTRY } from "../fixtures/commandAnswers/before.js";

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

async function lsJson(options: { awaitingReview?: boolean; archived?: boolean } = {}) {
  const flags = [
    ...(options.awaitingReview === true ? ["--awaiting-review"] : []),
    ...(options.archived === true ? ["--archived"] : []),
  ];
  const { code, out } = await phaxCall(["ls", "--json", ...flags]);
  expect(code).toBe(0);
  const document = JSON.parse(out) as Record<string, unknown>;
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
          "pullRequest",
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

    const json = await lsJson();
    expect(row(json.runs, "credit-notes")).toMatchObject({ state: "awaiting_review", stop: null });
    // The other waiting run is unaffected.
    expect(row(json.runs, SHORT)["stop"]).not.toBeNull();

    const table = await phaxCall(["ls"]);
    expect(table.code).toBe(0);
    const line = table.outLines.find((l) => l.includes("credit-notes"))!;
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

const PULL_REQUEST = "https://github.com/example/invoices/pull/12";
const ARCHIVED_PULL_REQUEST = "https://github.com/example/invoices/pull/9";

function publication(extra: Record<string, unknown>): string {
  return JSON.stringify({
    version: 1,
    enabled: true,
    provider: "github",
    remote: "origin",
    branch: "phax/invoice-export",
    pushStatus: "pushed",
    prStatus: "created",
    createdAt: "2026-10-22T09:30:00.000Z",
    ...extra,
  });
}

// ac-run-pr: a row's pullRequest is the URL in the run's publication record.
describe("phax ls --json carries the pull request phax opened", () => {
  it("gives the URL of a run phax published, and null for one it did not", async () => {
    writeFileSync(
      join(held.runPath, "publication.json"),
      publication({ pullRequestUrl: PULL_REQUEST }),
    );

    const document = await lsJson();

    expect(row(document.runs, SHORT)["pullRequest"]).toBe(PULL_REQUEST);
    expect(row(document.runs, "credit-notes")["pullRequest"]).toBeNull();
    expect(row(document.runs, "payments-fix")["pullRequest"]).toBeNull();
    expect(Either.isRight(decodeRunListFile(document))).toBe(true);
  });

  it("gives null for a publication that opened no pull request or cannot be read", async () => {
    writeFileSync(
      join(held.runPath, "publication.json"),
      publication({ prStatus: "failed", failureReason: "gh is not installed" }),
    );
    writeFileSync(join(declared.runPath, "publication.json"), "{ not json");

    const document = await lsJson();

    expect(row(document.runs, SHORT)["pullRequest"]).toBeNull();
    expect(row(document.runs, "credit-notes")["pullRequest"]).toBeNull();
  });

  it("reads an archived run's pull request from its archive folder", async () => {
    // As `phax archive` leaves it: the run folder moved under <archivePath>/runs, and the
    // registry entry archived with its archivePath.
    writeFileSync(
      join(failed.runPath, "publication.json"),
      publication({ pullRequestUrl: ARCHIVED_PULL_REQUEST }),
    );
    const archivePath = join(world.stateRoot, "archive", `${NAMESPACE}.payments-fix`);
    mkdirSync(archivePath, { recursive: true });
    renameSync(failed.runPath, join(archivePath, "runs"));
    const registryPath = join(world.stateRoot, "registry.json");
    const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
      runs: Record<string, unknown>[];
    };
    registry.runs = registry.runs.map((entry) =>
      entry["shortName"] === "payments-fix" ? { ...entry, state: "archived", archivePath } : entry,
    );
    writeFileSync(registryPath, JSON.stringify(registry));

    const document = await lsJson({ archived: true });

    expect(row(document.runs, "payments-fix")["pullRequest"]).toBe(ARCHIVED_PULL_REQUEST);
  });
});

// ac-versioned-stable: the 0.33.0 bytes of `ls --json`, from before.ts, are the
// new output once pullRequest and the $schema stamp are set aside.
describe("phax ls --json is today's output apart from pullRequest and the stamp", () => {
  const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");
  let restoreGit: () => void;
  let base: string;

  beforeAll(() => {
    restoreGit = isolateGit();
    base = realpathSync(mkdtempSync(join(tmpdir(), "phax-ls-bytes-")));
    const repo = join(base, "repo");
    const state = join(base, "state");
    mkdirSync(repo);
    mkdirSync(state);
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    writeFileSync(
      join(repo, "phax.json"),
      JSON.stringify({
        version: 1,
        name: "made-up",
        state: { root: state },
        gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
      }),
    );
    writeFileSync(join(state, "registry.json"), JSON.stringify(LS_REGISTRY));
  });

  afterAll(() => {
    restoreGit();
    removeTempDir(base);
  });

  it("matches the output captured before the change", () => {
    const result = spawnSync("tsx", [mainTs, "ls", "--json"], {
      cwd: join(base, "repo"),
      encoding: "utf8",
      env: phaxHomeEnv(),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const after = JSON.parse(result.stdout) as { $schema: string };
    expect(after.$schema).toBe(currentSchemaUrl("run-list"));
    // The same bytes once the stamp line and the new key are removed from the text.
    const stamp = /^ {2}"\$schema": .*\n/m;
    const stripped = result.stdout.replace(stamp, "").replace(/,\n {6}"pullRequest": null/g, "");
    expect(stripped).toBe(LS_JSON_BEFORE.replace(stamp, ""));
    expect(result.stdout.match(/"pullRequest": null/g)).toHaveLength(2);
  });
});
