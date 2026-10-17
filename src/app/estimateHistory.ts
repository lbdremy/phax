// The history `phax plans estimate` learns from: every cost ledger this
// machine can reach, and this repository's kept runs sized from their plans.
// Registered runs of every namespace give their `cost-ledger.json`; pruned
// runs give the copies prune kept under `cost-ledgers/`. A run of this
// repository's namespace is also sized: its `phax-plan.json` names each
// phase's planned files, measured as git blob sizes at the last commit before
// the run was created. Anything unreadable is skipped with its reason, never
// fatal, and a skip names a path, never a file's content.
import { Effect, Either } from "effect";
import { join } from "node:path";
import type { RegistryCorruptionError } from "../domain/errors.js";
import type { HistoricalPhasePlan, LedgerSource, SizedRun } from "../domain/cost/history.js";
import { runKey } from "../domain/runRef.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git } from "../ports/git.js";
import type { CostLedger } from "../schemas/costLedger.js";
import { readCostLedgerFile, readPhaxPlanFile } from "../schemas/persisted.js";
import type { PhaxPlan } from "../schemas/phaxPlan.js";
import type { RegistryEntry } from "../schemas/registry.js";
import { runFolderOf } from "./costBackfill.js";
import { COST_LEDGER_FILE } from "./costLedger.js";
import { COST_LEDGERS_DIR } from "./prune.js";
import { readRegistry } from "./registry.js";

export interface SkippedHistory {
  readonly path: string;
  readonly reason: string;
}

export interface EstimateHistory {
  readonly ledgers: readonly LedgerSource[];
  readonly sizedRuns: readonly SizedRun[];
  /** Registered runs whose folder holds no cost ledger. */
  readonly unledgeredRuns: number;
  readonly skipped: readonly SkippedHistory[];
}

const PHAX_PLAN_FILE = "phax-plan.json";
const JSON_SUFFIX = ".json";

type Read<T> = { readonly kind: "read"; readonly value: T } | { readonly kind: "skipped" };

/** Reads and decodes one JSON file; an unparseable or undecodable file is skipped with `reason`. */
function readJsonFile<T>(
  path: string,
  decode: (file: string, input: unknown) => Either.Either<T, unknown>,
  reason: string,
  skipped: SkippedHistory[],
): Effect.Effect<Read<T>, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const text = yield* fs.readText(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      skipped.push({ path, reason });
      return { kind: "skipped" } as const;
    }
    const decoded = decode(path, parsed);
    if (Either.isLeft(decoded)) {
      skipped.push({ path, reason });
      return { kind: "skipped" } as const;
    }
    return { kind: "read", value: decoded.right } as const;
  });
}

function sumOf(paths: readonly string[], sizes: Readonly<Record<string, number>>): number {
  return paths.reduce((sum, path) => sum + (sizes[path] ?? 0), 0);
}

/**
 * The run's phases sized at the last commit before `entry.createdAt`, or null
 * when they cannot be: no plan, an undecodable plan, no such commit, or a git
 * failure. Each reason goes to `skipped`.
 */
function sizeRun(
  entry: RegistryEntry,
  runFolder: string,
  repoRoot: string,
  key: string,
  skipped: SkippedHistory[],
): Effect.Effect<SizedRun | null, FsError, FileSystem | Git> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;
    const planPath = join(runFolder, PHAX_PLAN_FILE);
    if (!(yield* fs.exists(planPath))) {
      skipped.push({ path: planPath, reason: "no phax-plan.json: the run is not sized" });
      return null;
    }
    const plan = yield* readJsonFile<PhaxPlan>(
      planPath,
      readPhaxPlanFile,
      "phax-plan.json could not be decoded: the run is not sized",
      skipped,
    );
    if (plan.kind === "skipped") return null;

    const sized = yield* Effect.gen(function* () {
      const base = yield* git.commitBefore(repoRoot, entry.createdAt);
      if (base === null) {
        skipped.push({
          path: planPath,
          reason: `no commit before ${entry.createdAt}: the run is not sized`,
        });
        return null;
      }
      const paths = [
        ...new Set(
          plan.value.phases.flatMap((phase) => [
            ...phase.plannedFilesToEdit,
            ...phase.optionalFilesToEdit,
          ]),
        ),
      ];
      const sizes = yield* git.blobSizes(repoRoot, base, paths);
      const phases: HistoricalPhasePlan[] = plan.value.phases.map((phase) => ({
        id: phase.id,
        model: phase.model,
        effort: phase.effort,
        editBytes: sumOf(phase.plannedFilesToEdit, sizes),
        optionalBytes: sumOf(phase.optionalFilesToEdit, sizes),
        createCount: phase.plannedFilesToCreate.length,
      }));
      return { runKey: key, startedAt: entry.createdAt, phases };
    }).pipe(
      Effect.catchTag("GitError", () => {
        skipped.push({ path: planPath, reason: "git could not size the planned files" });
        return Effect.succeed(null);
      }),
    );
    return sized;
  });
}

/**
 * Every reachable cost ledger, and this repository's kept runs sized. A
 * ledger is read once: a pruned copy whose run key a registered run already
 * gave is ignored.
 */
export function readEstimateHistory(input: {
  readonly stateRoot: string;
  readonly repoRoot: string;
  readonly namespace: string;
}): Effect.Effect<EstimateHistory, FsError | RegistryCorruptionError, FileSystem | Git> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const registry = yield* readRegistry(input.stateRoot);
    const ledgers: LedgerSource[] = [];
    const sizedRuns: SizedRun[] = [];
    const skipped: SkippedHistory[] = [];
    const seen = new Set<string>();
    let unledgeredRuns = 0;

    for (const entry of registry.runs) {
      const key = `${runKey(entry.namespace, entry.shortName)}.${entry.runId}`;
      if (seen.has(key)) continue;
      const runFolder = runFolderOf(input.stateRoot, entry);
      if (!(yield* fs.exists(runFolder))) continue;
      seen.add(key);
      const ledgerPath = join(runFolder, COST_LEDGER_FILE);
      if (!(yield* fs.exists(ledgerPath))) {
        unledgeredRuns += 1;
        continue;
      }
      const ledger = yield* readJsonFile<CostLedger>(
        ledgerPath,
        readCostLedgerFile,
        "the cost ledger could not be decoded",
        skipped,
      );
      if (ledger.kind === "skipped") continue;
      ledgers.push({ runKey: key, ledger: ledger.value });
      if (entry.namespace !== input.namespace) continue;
      const sized = yield* sizeRun(entry, runFolder, input.repoRoot, key, skipped);
      if (sized !== null) sizedRuns.push(sized);
    }

    const prunedDir = join(input.stateRoot, COST_LEDGERS_DIR);
    if (yield* fs.exists(prunedDir)) {
      const names = (yield* fs.list(prunedDir)).filter((name) => name.endsWith(JSON_SUFFIX));
      for (const name of names) {
        const key = name.slice(0, -JSON_SUFFIX.length);
        if (seen.has(key)) continue;
        seen.add(key);
        const path = join(prunedDir, name);
        const ledger = yield* readJsonFile<CostLedger>(
          path,
          readCostLedgerFile,
          "the pruned cost ledger could not be decoded",
          skipped,
        );
        if (ledger.kind === "read") ledgers.push({ runKey: key, ledger: ledger.value });
      }
    }

    return { ledgers, sizedRuns, unledgeredRuns, skipped };
  });
}
