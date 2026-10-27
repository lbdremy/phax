// Writes a cost ledger for every registered run that has none, derived from
// the run's kept streams in run order, with the same per-invocation
// correction and sampling as the run-time ledger. Each backfilled entry ends
// at its stream's modification time. A run that already has a ledger is never
// touched, a locked run is skipped, and the ledger is created exclusively, so
// a ledger that appears meanwhile wins and a second pass writes nothing.
import { Effect } from "effect";
import { join } from "node:path";
import {
  isPhaseFolderName,
  ledgerFromStreams,
  runStreamsInOrder,
  type KeptStream,
} from "../domain/cost/ledger.js";
import type { RegistryCorruptionError } from "../domain/errors.js";
import { runKey } from "../domain/runRef.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Lock } from "../ports/lock.js";
import { parseClaudeStream } from "../schemas/claudeStream.js";
import { withSchemaUrl } from "../schemas/persisted.js";
import type { RegistryEntry } from "../schemas/registry.js";
import { COST_LEDGER_FILE } from "./costLedger.js";
import { readRegistry } from "./registry.js";

export interface BackfilledLedger {
  readonly qualifiedName: string;
  /** The number of entries written. */
  readonly invocations: number;
  /** The ledger's API-list cost, USD. */
  readonly costUsd: number;
}

export interface CostBackfillResult {
  readonly written: readonly BackfilledLedger[];
  /** The qualified names of the runs skipped because their lock is active. */
  readonly locked: readonly string[];
  /** The qualified names of the runs whose folder is missing. */
  readonly missing: readonly string[];
}

/** A registered run's folder: the archived `runs/` folder, or the active run folder. */
export function runFolderOf(stateRoot: string, entry: RegistryEntry): string {
  const key = runKey(entry.namespace, entry.shortName);
  if (entry.state !== "archived") return join(stateRoot, "runs", key);
  return join(entry.archivePath ?? join(stateRoot, "archive", key), "runs");
}

/** The run folder's kept streams, in run order, each decoded with the instant it ended. */
function keptStreams(runFolder: string): Effect.Effect<KeptStream[], FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const entries = yield* fs.list(runFolder);
    const phaseEntries: Record<string, readonly string[]> = {};
    for (const name of entries.filter(isPhaseFolderName)) {
      phaseEntries[name] = yield* fs.list(join(runFolder, name));
    }
    const streams: KeptStream[] = [];
    for (const stream of runStreamsInOrder({ entries, phaseEntries })) {
      const path = join(runFolder, stream.relativePath);
      const facts = parseClaudeStream((yield* fs.readText(path)).split("\n"));
      const endedAt = yield* fs.modifiedAt(path);
      streams.push(
        stream.phase === null
          ? { role: stream.role, phase: null, facts, endedAt }
          : { role: stream.role, phase: stream.phase, facts, endedAt },
      );
    }
    return streams;
  });
}

/**
 * Gives every run of the registry, across namespaces, that has no
 * `cost-ledger.json` one derived from its kept streams; a run with no Claude
 * stream gets an empty ledger. Pruned runs have left the registry and are not
 * read. Never rewrites an existing ledger.
 */
export function backfillCostLedgers(input: {
  readonly stateRoot: string;
}): Effect.Effect<CostBackfillResult, FsError | RegistryCorruptionError, FileSystem | Lock> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const lock = yield* Lock;
    const registry = yield* readRegistry(input.stateRoot);
    const written: BackfilledLedger[] = [];
    const locked: string[] = [];
    const missing: string[] = [];
    for (const entry of registry.runs) {
      const qualifiedName = runKey(entry.namespace, entry.shortName);
      const runFolder = runFolderOf(input.stateRoot, entry);
      if (!(yield* fs.exists(runFolder))) {
        missing.push(qualifiedName);
        continue;
      }
      const ledgerPath = join(runFolder, COST_LEDGER_FILE);
      if (yield* fs.exists(ledgerPath)) continue;
      if ((yield* lock.status(qualifiedName)).kind === "active") {
        locked.push(qualifiedName);
        continue;
      }
      const ledger = ledgerFromStreams(yield* keptStreams(runFolder));
      const created = yield* fs.createExclusive(
        ledgerPath,
        JSON.stringify(withSchemaUrl("cost-ledger", ledger), null, 2),
      );
      if (!created) continue;
      written.push({
        qualifiedName,
        invocations: ledger.entries.length,
        costUsd: Math.round(ledger.entries.reduce((sum, e) => sum + e.costUsd, 0) * 1e6) / 1e6,
      });
    }
    return { written, locked, missing };
  });
}
