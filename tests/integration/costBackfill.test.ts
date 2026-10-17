// `phax cost backfill` end to end against a throwaway repository and state
// root: real config loading, filesystem, lock and registry. One archived run
// with made-up kept streams and no ledger gets one, per-invocation; a run
// with a ledger stays byte-identical; a locked run and a run whose folder is
// missing are skipped and named; a second pass has nothing to backfill.
// Every stream, session id and cost is made up; nothing reads ~/.phax.
import { mkdirSync, readFileSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backfillCostLedgers } from "../../src/app/costBackfill.js";
import { runCostBackfill } from "../../src/cli/commands/cost.js";
import { runKey } from "../../src/domain/runRef.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { makeNodeLockLayer } from "../../src/infra/lock.js";
import type { FileSystem } from "../../src/ports/fs.js";
import { Lock } from "../../src/ports/lock.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";
import { encodeRegistryFile, type RegistryEntry } from "../../src/schemas/registry.js";
import type { CostLedgerEntry } from "../../src/schemas/costLedger.js";
import {
  createPruneRepo,
  recordingOutput,
  registryPath,
  removePruneRepo,
  type PruneRepo,
} from "./helpers/pruneRepo.js";

let roots: PruneRepo;
let originalCwd: string;

beforeEach(() => {
  roots = createPruneRepo();
  originalCwd = process.cwd();
  process.chdir(roots.repo);
});

afterEach(() => {
  process.chdir(originalCwd);
  removePruneRepo(roots);
});

function entry(shortName: string, overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    namespace: roots.namespace,
    shortName,
    runId: `${shortName}-2026-10-01`,
    state: "completed",
    branch: `phax/${shortName}`,
    projectName: "phax",
    phasesCount: 1,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function writeRegistry(runs: RegistryEntry[]): void {
  writeFileSync(
    registryPath(roots),
    JSON.stringify(encodeRegistryFile(withSchemaUrl("registry", { runs })), null, 2),
  );
}

const SESSION = "session-spent-phase-01";

/** A made-up Claude stream; the result reports the resumed session's total so far. */
function writeStream(path: string, costUsd: number, outputTokens: number, mtime: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const events = [
    { type: "system", subtype: "init", session_id: SESSION, claude_code_version: "2.1.280" },
    {
      type: "result",
      subtype: "success",
      session_id: SESSION,
      duration_ms: 1500,
      modelUsage: {
        "example-model": {
          inputTokens: 10,
          outputTokens,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUSD: costUsd,
        },
      },
    },
  ];
  writeFileSync(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  utimesSync(path, new Date(mtime), new Date(mtime));
}

function seed() {
  const archivePath = join(roots.stateRoot, "archive", `${roots.namespace}.spent`);
  const spent = join(archivePath, "runs");
  writeStream(join(spent, "phase-01", "output.jsonl"), 1, 1000, "2026-10-15T10:00:00.000Z");
  writeStream(
    join(spent, "phase-01", "fix-attempt-01.jsonl"),
    1.5,
    1500,
    "2026-10-15T10:10:00.000Z",
  );
  writeStream(
    join(spent, "phase-01", "handoff-generation.jsonl"),
    1.75,
    1750,
    "2026-10-15T10:20:00.000Z",
  );
  writeFileSync(join(spent, "run-status.json"), "{}");

  const priced = join(roots.stateRoot, "runs", `${roots.namespace}.priced`);
  mkdirSync(priced, { recursive: true });
  const existing = '{"$schema":"made-up","entries":[]}';
  writeFileSync(join(priced, "cost-ledger.json"), existing);

  const busy = join(roots.stateRoot, "runs", `${roots.namespace}.busy`);
  writeStream(join(busy, "phase-01", "output.jsonl"), 1, 1000, "2026-10-15T11:00:00.000Z");

  writeRegistry([
    entry("spent", { state: "archived", archivePath }),
    entry("priced"),
    entry("busy", { state: "running" }),
    entry("gone"),
  ]);
  return { spent, priced, busy, existing };
}

const withLayers = <A, E>(effect: Effect.Effect<A, E, Lock | FileSystem>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(NodeFileSystemLayer),
      Effect.provide(makeNodeLockLayer(roots.stateRoot)),
    ),
  );

describe("phax cost backfill", () => {
  it("writes one per-invocation ledger, leaves a ledger and a locked run alone, and has nothing left on a second pass", async () => {
    const { spent, priced, busy, existing } = seed();
    const busyKey = runKey(roots.namespace, "busy");
    await withLayers(Effect.flatMap(Lock, (lock) => lock.acquire(busyKey)));

    const result = await withLayers(backfillCostLedgers({ stateRoot: roots.stateRoot }));

    const spentKey = runKey(roots.namespace, "spent");
    expect(result).toEqual({
      written: [{ qualifiedName: spentKey, invocations: 3, costUsd: 1.75 }],
      locked: [busyKey],
      missing: [runKey(roots.namespace, "gone")],
    });
    const ledger = JSON.parse(readFileSync(join(spent, "cost-ledger.json"), "utf8")) as {
      $schema: string;
      entries: CostLedgerEntry[];
    };
    expect(ledger.$schema).toContain("cost-ledger");
    expect(ledger.entries.map((e) => [e.role, e.phase, e.costUsd, e.endedAt])).toEqual([
      ["phase", "phase-01", 1, "2026-10-15T10:00:00.000Z"],
      ["fix", "phase-01", 0.5, "2026-10-15T10:10:00.000Z"],
      ["handoff", "phase-01", 0.25, "2026-10-15T10:20:00.000Z"],
    ]);
    expect(ledger.entries[2]!.models["example-model"]!.outputTokens).toBe(250);
    expect(readFileSync(join(priced, "cost-ledger.json"), "utf8")).toBe(existing);
    expect(existsSync(join(busy, "cost-ledger.json"))).toBe(false);

    await withLayers(Effect.flatMap(Lock, (lock) => lock.release(busyKey)));
    const spentLedger = readFileSync(join(spent, "cost-ledger.json"), "utf8");

    // The busy run is unlocked now: the command backfills it, then has nothing left.
    const first = recordingOutput();
    expect(await runCostBackfill(first.port)).toBe(0);
    expect(first.logs).toEqual([
      "wrote 1 cost ledgers (1 invocations, $1.00 API-list)",
      `skipped 1 run(s) with no run folder: ${runKey(roots.namespace, "gone")}`,
    ]);

    const second = recordingOutput();
    expect(await runCostBackfill(second.port)).toBe(0);
    expect(second.logs[0]).toBe("nothing to backfill");
    expect(readFileSync(join(spent, "cost-ledger.json"), "utf8")).toBe(spentLedger);
  });

  it("names a locked run in the command output", async () => {
    seed();
    const busyKey = runKey(roots.namespace, "busy");
    await withLayers(Effect.flatMap(Lock, (lock) => lock.acquire(busyKey)));
    try {
      const out = recordingOutput();
      expect(await runCostBackfill(out.port)).toBe(0);
      expect(out.logs).toContain(`skipped 1 locked run(s): ${busyKey}`);
    } finally {
      await withLayers(Effect.flatMap(Lock, (lock) => lock.release(busyKey)));
    }
  });

  it("gives a run with no Claude stream an empty ledger", async () => {
    const lone = join(roots.stateRoot, "runs", `${roots.namespace}.lone`);
    mkdirSync(join(lone, "phase-01"), { recursive: true });
    writeFileSync(join(lone, "run-status.json"), "{}");
    writeRegistry([entry("lone")]);

    const out = recordingOutput();
    expect(await runCostBackfill(out.port)).toBe(0);
    expect(out.logs).toEqual(["wrote 1 cost ledgers (0 invocations, $0.00 API-list)"]);
    const ledger = JSON.parse(readFileSync(join(lone, "cost-ledger.json"), "utf8")) as {
      entries: unknown[];
    };
    expect(ledger.entries).toEqual([]);
  });

  it("exits 1 on an unreadable registry", async () => {
    writeFileSync(registryPath(roots), "not json");
    const out = recordingOutput();
    expect(await runCostBackfill(out.port)).toBe(1);
    expect(out.errors[0]).toMatch(/^phax cost backfill failed: /);
  });
});
