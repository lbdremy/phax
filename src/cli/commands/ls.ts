import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { readRegistry } from "../../app/registry.js";
import { resolveRun, findCurrentPhase } from "../../app/resolveRunInfo.js";
import { computeRecordsPending, pendingCountsByRunId } from "../../app/recordsStatus.js";
import { recordsClonePath } from "../../app/recordsSync.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { NodeGitLayer } from "../../infra/git.js";
import { makeRepoRootedFileSystemLayer } from "./runLayers.js";
import { Lock } from "../../ports/lock.js";
import type { RegistryEntry } from "../../schemas/registry.js";
import { decodeShortName } from "../../domain/branded.js";
import { runKey } from "../../domain/runRef.js";

export interface LsOptions {
  active?: boolean;
  failed?: boolean;
  reviewOpen?: boolean;
  archived?: boolean;
  json?: boolean;
  complete?: boolean;
}

type LockState = "none" | "active" | "stale";

interface LsRow {
  namespace: string;
  shortName: string;
  state: string;
  branch: string;
  currentPhase: string;
  gateProfile: string;
  updatedAt: string;
  lockState: LockState;
  /** Pending (unpushed) record count. `undefined` — rendered "-" — when
   * records are off, or the row belongs to a different project's namespace
   * than the one whose records this invocation can read (see `runLs`). */
  recordsPending: number | undefined;
}

/**
 * A registry entry reconciled against its authoritative `run-status.json`.
 *
 * The global registry is only an index of which runs exist; it is written at
 * creation and refreshed at just two transitions (`review_open`, `archived`).
 * The per-run `run-status.json` is the source of truth for state, gate profile,
 * and phase progress — so we read it here rather than trusting the stale index.
 * When the run folder is gone (archived runs are moved out of `runs/`) we fall
 * back to the registry values, where the recorded state is already correct.
 */
function reconcileEntry(entry: RegistryEntry, stateRoot: string): LsRow {
  const fallback: LsRow = {
    namespace: entry.namespace,
    shortName: entry.shortName,
    state: entry.state,
    branch: entry.branch,
    currentPhase: "-",
    gateProfile: "-",
    updatedAt: formatTimestamp(entry.updatedAt),
    lockState: "none",
    recordsPending: undefined,
  };

  const shortNameResult = decodeShortName(entry.shortName);
  if (Either.isLeft(shortNameResult)) return fallback;

  const infoResult = resolveRun(entry.namespace, shortNameResult.right, stateRoot);
  if (Either.isLeft(infoResult)) return fallback;

  const info = infoResult.right;
  const total = info.planPhases.length || entry.phasesCount;
  const current = findCurrentPhase(info.phaseStatuses);
  const reached = current ?? info.phaseStatuses.toSorted((a, b) => b.phaseIndex - a.phaseIndex)[0];

  return {
    namespace: entry.namespace,
    shortName: entry.shortName,
    state: info.runState,
    branch: info.branch !== "(unknown)" ? info.branch : entry.branch,
    currentPhase: reached ? `${reached.phaseIndex + 1}/${total}` : "-",
    gateProfile: info.gateProfileId ?? "-",
    updatedAt: formatTimestamp(info.updatedAt),
    lockState: "none",
    recordsPending: undefined,
  };
}

function matchesFilter(state: string, opts: LsOptions): boolean {
  const hasFilter = opts.active || opts.failed || opts.reviewOpen || opts.archived;
  if (!hasFilter) return true;

  if (opts.active && (state === "created" || state === "running")) return true;
  if (opts.failed && state === "failed") return true;
  if (opts.reviewOpen && state === "review_open") return true;
  if (opts.archived && state === "archived") return true;
  return false;
}

function formatTimestamp(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function getDisplayValue(row: LsRow, header: keyof LsRow): string {
  if (header === "shortName") return runKey(row.namespace, row.shortName);
  if (header === "recordsPending")
    return row.recordsPending === undefined ? "-" : String(row.recordsPending);
  return String(row[header]);
}

// The RECORDS column only appears when this project's records are configured
// (`showRecords`) — an unconfigured project's `ls` output is byte-for-byte
// unchanged from before records existed.
function formatTable(rows: LsRow[], showRecords: boolean): string {
  if (rows.length === 0) return "(no runs)";

  const headers: (keyof LsRow)[] = [
    "shortName",
    "state",
    "branch",
    "currentPhase",
    "gateProfile",
    "updatedAt",
    "lockState",
    ...(showRecords ? (["recordsPending"] as const) : []),
  ];
  const labels: Record<keyof LsRow, string> = {
    namespace: "NAMESPACE",
    shortName: "NAME",
    state: "STATE",
    branch: "BRANCH",
    currentPhase: "PHASE",
    gateProfile: "PROFILE",
    updatedAt: "UPDATED",
    lockState: "LOCK",
    recordsPending: "RECORDS",
  };

  const widths = headers.map((h) =>
    Math.max(labels[h].length, ...rows.map((r) => getDisplayValue(r, h).length)),
  );

  const header = headers.map((h, i) => pad(labels[h], widths[i]!)).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  const rowLines = rows.map((r) =>
    headers.map((h, i) => pad(getDisplayValue(r, h), widths[i]!)).join("  "),
  );

  return [header, separator, ...rowLines].join("\n");
}

export async function runLs(opts: LsOptions, out: OutputPort): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const config = configResult.right;
  const { stateRoot } = config;
  const fsLayer = makeRepoRootedFileSystemLayer(config);

  const registryEffect = readRegistry(stateRoot).pipe(Effect.provide(fsLayer));
  const registryResult = await Effect.runPromise(Effect.either(registryEffect));
  if (Either.isLeft(registryResult)) {
    out.error(`Registry error: ${registryResult.left.message}`);
    return 1;
  }

  // Reconcile every entry against its run-status.json first, then filter on the
  // authoritative state so `--review-open` and friends see the real states.
  const reconciled = registryResult.right.runs
    .map((entry) => ({ entry, row: reconcileEntry(entry, stateRoot) }))
    .filter(({ row }) => matchesFilter(row.state, opts));

  if (opts.complete) {
    // Fast path for shell completion: one `short-name:state` line per run,
    // no lock-status computation. The `usage` CLI splits on `:` when
    // `descriptions=#true` is set, using the right-hand part as a description.
    for (const { row } of reconciled) {
      out.log(`${row.shortName}:${row.state}`);
    }
    return 0;
  }

  const lockLayer = Layer.merge(fsLayer, makeNodeLockLayer(stateRoot));

  // Records live in this project's own repo (the shared registry can list
  // runs from other namespaces/repos, whose records this invocation has no
  // access to) — so pending counts are only computed, and only shown, for
  // rows in the current project's namespace. Skipped entirely when records
  // are off, so an unconfigured project's `ls` output never changes.
  let recordsPendingCounts: ReadonlyMap<string, number> = new Map();
  if (config.records.enabled) {
    const recordsClonePathValue =
      config.records.destination.kind === "repo"
        ? recordsClonePath(config.stateRoot, config.namespace)
        : undefined;
    const pendingResult = await Effect.runPromise(
      Effect.either(
        computeRecordsPending({
          records: config.records,
          repoRoot: config.repoRoot,
          publishRemote: config.publish.remote,
          ...(recordsClonePathValue !== undefined
            ? { recordsClonePath: recordsClonePathValue }
            : {}),
        }).pipe(Effect.provide(NodeGitLayer)),
      ),
    );
    if (Either.isRight(pendingResult)) {
      recordsPendingCounts = pendingCountsByRunId(pendingResult.right);
    }
  }

  const rows: LsRow[] = await Promise.all(
    reconciled.map(async ({ entry, row }) => {
      const shortNameResult = decodeShortName(row.shortName);
      let lockState: LockState = "none";

      if (Either.isRight(shortNameResult)) {
        const qualifiedKey = runKey(entry.namespace, shortNameResult.right);
        const lockEffect = Effect.gen(function* () {
          const lock = yield* Lock;
          return yield* lock.status(qualifiedKey);
        }).pipe(Effect.provide(lockLayer));

        const lockResult = await Effect.runPromise(Effect.either(lockEffect));
        if (Either.isRight(lockResult)) {
          const status = lockResult.right;
          if (status.kind === "active") lockState = "active";
          else if (status.kind === "stale") lockState = "stale";
        }
      }

      const recordsPending =
        config.records.enabled && entry.namespace === config.namespace
          ? (recordsPendingCounts.get(entry.runId) ?? 0)
          : undefined;

      return { ...row, lockState, recordsPending };
    }),
  );

  if (opts.json) {
    out.log(
      JSON.stringify(
        rows.map((r, i) => ({
          ...r,
          archivePath: reconciled[i]?.entry.archivePath,
          qualifiedName: runKey(r.namespace, r.shortName),
        })),
        null,
        2,
      ),
    );
  } else {
    out.log(formatTable(rows, config.records.enabled));
  }

  return 0;
}
