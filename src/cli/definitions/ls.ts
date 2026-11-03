// `phax ls` as the runner reads it: the run-list document, and today's table as its text,
// rendered from the document alone. `--complete` answers `short-name:state` lines through the
// `document` hook, a text document with no format, so completion never reaches the render.
import { Effect, Either, Layer, Schema as EffectSchema } from "effect";
import * as Schema from "effect/Schema";
import { computeRecordsPending, pendingCountsByRunId } from "../../app/recordsStatus.js";
import { recordsClonePath } from "../../app/recordsSync.js";
import { readRegistry } from "../../app/registry.js";
import {
  findCurrentPhase,
  readArchivedPullRequestUrl,
  readPullRequestUrl,
  resolveRun,
  type RunReviewInfo,
} from "../../app/resolveRunInfo.js";
import { readStopInfo } from "../../app/stopInfo.js";
import { decodeShortName } from "../../domain/branded.js";
import { buildRunList, type LsRunRow } from "../../domain/runList.js";
import { runKey } from "../../domain/runRef.js";
import { NodeGitLayer } from "../../infra/git.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { Lock } from "../../ports/lock.js";
import { withSchemaUrl } from "../../schemas/persisted.js";
import type { RegistryEntry } from "../../schemas/registry.js";
import { type RunListFile, RunListFileSchema, type RunListRow } from "../../schemas/runList.js";
import { RunStateSchema } from "../../schemas/status.js";
import { defineCommand, document, reject } from "../commandLibrary/contract/index.js";
import { makeRepoRootedFileSystemLayer } from "../commands/runLayers.js";
import { configured, exposeMessage, MessageFields, publishedFormat } from "./shared.js";

const isRunState = EffectSchema.is(RunStateSchema);

const flag = (description: string) =>
  Schema.optionalWith(Schema.Boolean.annotations({ description }), { exact: true });

const LsFlags = Schema.Struct({
  active: flag("Show only active runs (created or running)"),
  failed: flag("Show only failed runs"),
  reviewOpen: flag("Show only review_open runs"),
  awaitingReview: flag("Show only runs awaiting_review at an interactive phase"),
  archived: flag("Show only archived runs"),
  complete: flag("Print run short-names for shell completion"),
});

/** The options of `phax ls`, as run receives them. */
export type LsFlags = typeof LsFlags.Type;

type Reconciled = Omit<LsRunRow, "qualifiedName" | "archivePath" | "stop" | "pullRequest">;

const UNKNOWN = "-";

function formatTimestamp(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
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
function reconcileEntry(
  entry: RegistryEntry,
  stateRoot: string,
): { readonly row: Reconciled; readonly info: RunReviewInfo | undefined } {
  const fallback: Reconciled = {
    namespace: entry.namespace,
    shortName: entry.shortName,
    state: entry.state,
    branch: entry.branch,
    currentPhase: UNKNOWN,
    gateProfile: UNKNOWN,
    updatedAt: formatTimestamp(entry.updatedAt),
    lockState: "none",
    recordsPending: undefined,
  };

  const shortNameResult = decodeShortName(entry.shortName);
  if (Either.isLeft(shortNameResult)) return { row: fallback, info: undefined };

  const infoResult = resolveRun(entry.namespace, shortNameResult.right, stateRoot);
  if (Either.isLeft(infoResult)) return { row: fallback, info: undefined };

  const info = infoResult.right;
  const total = info.planPhases.length || entry.phasesCount;
  const current = findCurrentPhase(info.phaseStatuses);
  const reached = current ?? info.phaseStatuses.toSorted((a, b) => b.phaseIndex - a.phaseIndex)[0];

  return {
    row: {
      namespace: entry.namespace,
      shortName: entry.shortName,
      state: isRunState(info.runState) ? info.runState : entry.state,
      branch: info.branch !== "(unknown)" ? info.branch : entry.branch,
      currentPhase: reached ? `${reached.phaseIndex + 1}/${total}` : UNKNOWN,
      gateProfile: info.gateProfileId ?? UNKNOWN,
      updatedAt: formatTimestamp(info.updatedAt),
      lockState: "none",
      recordsPending: undefined,
    },
    info,
  };
}

function matchesFilter(state: string, flags: LsFlags): boolean {
  const hasFilter =
    flags.active || flags.failed || flags.reviewOpen || flags.awaitingReview || flags.archived;
  if (!hasFilter) return true;

  if (flags.active && (state === "created" || state === "running")) return true;
  if (flags.failed && state === "failed") return true;
  if (flags.reviewOpen && state === "review_open") return true;
  if (flags.awaitingReview && state === "awaiting_review") return true;
  if (flags.archived && state === "archived") return true;
  return false;
}

/** The run lists `--complete` answered: the `document` hook writes each as completion lines. */
const completions = new WeakSet<RunListFile>();

/** The lock state of a run: none when it cannot be read. */
function lockStateOf(
  entry: RegistryEntry,
  lockLayer: Layer.Layer<Lock>,
): Effect.Effect<RunListRow["lockState"]> {
  const shortName = decodeShortName(entry.shortName);
  if (Either.isLeft(shortName)) return Effect.succeed("none");
  return Effect.gen(function* () {
    const lock = yield* Lock;
    return yield* lock.status(runKey(entry.namespace, shortName.right));
  }).pipe(
    Effect.provide(lockLayer),
    Effect.map((status) =>
      status.kind === "active" ? "active" : status.kind === "stale" ? "stale" : "none",
    ),
    Effect.orElseSucceed(() => "none" as const),
  );
}

/** The run list `phax ls` answers for `flags`. */
function listRuns(flags: LsFlags) {
  return Effect.gen(function* () {
    const config = yield* configured();
    const { stateRoot } = config;
    const fsLayer = makeRepoRootedFileSystemLayer(config);
    const registry = yield* readRegistry(stateRoot).pipe(Effect.provide(fsLayer));

    // Reconcile every entry against its run-status.json first, then filter on the
    // authoritative state so `--review-open` and friends see the real states.
    const reconciled = registry.runs
      .map((entry) => ({ entry, ...reconcileEntry(entry, stateRoot) }))
      .filter(({ row }) => matchesFilter(row.state, flags));

    if (flags.complete === true) {
      // Fast path for shell completion: no lock, records or stop reads.
      const list = withSchemaUrl(
        "run-list",
        buildRunList(
          reconciled.map(({ entry, row }) => ({
            ...row,
            qualifiedName: runKey(entry.namespace, entry.shortName),
            archivePath: entry.archivePath,
            stop: null,
            pullRequest: undefined,
          })),
        ),
      );
      completions.add(list);
      return list;
    }

    const lockLayer = Layer.merge(fsLayer, makeNodeLockLayer(stateRoot));

    // Records live in this project's own repo (the shared registry can list
    // runs from other namespaces/repos, whose records this invocation has no
    // access to) — so pending counts are only computed, and only shown, for
    // rows in the current project's namespace. Skipped entirely when records
    // are off.
    let pendingCounts: ReadonlyMap<string, number> = new Map();
    if (config.records.enabled) {
      const clonePath =
        config.records.destination.kind === "repo"
          ? recordsClonePath(config.stateRoot, config.namespace)
          : undefined;
      const pending = yield* Effect.either(
        computeRecordsPending({
          records: config.records,
          repoRoot: config.repoRoot,
          publishRemote: config.publish.remote,
          ...(clonePath !== undefined ? { recordsClonePath: clonePath } : {}),
        }).pipe(Effect.provide(NodeGitLayer)),
      );
      if (Either.isRight(pending)) pendingCounts = pendingCountsByRunId(pending.right);
    }

    const rows: LsRunRow[] = [];
    for (const { entry, row, info } of reconciled) {
      const lockState = yield* lockStateOf(entry, lockLayer);
      const recordsPending =
        config.records.enabled && entry.namespace === config.namespace
          ? (pendingCounts.get(entry.runId) ?? 0)
          : undefined;
      // The stop of a waiting run, read through `readStopInfo`. A run whose
      // document cannot be read has no stop: the table keeps its plain state.
      const stop =
        info === undefined || info.runState !== "awaiting_review"
          ? null
          : yield* readStopInfo(info).pipe(
              Effect.provide(fsLayer),
              Effect.orElseSucceed(() => null),
            );
      rows.push({
        ...row,
        lockState,
        recordsPending,
        qualifiedName: runKey(entry.namespace, entry.shortName),
        archivePath: entry.archivePath,
        stop: stop === null ? null : withSchemaUrl("review-stop", stop.reviewStop),
        // The run's pull request: its publication record's URL, read from the run
        // folder, or from the archive once `phax archive` moved it there.
        pullRequest:
          info !== undefined
            ? readPullRequestUrl(info.runPath)
            : entry.archivePath !== undefined
              ? readArchivedPullRequestUrl(entry.archivePath)
              : undefined,
      });
    }
    return withSchemaUrl("run-list", buildRunList(rows));
  });
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

type Column = Exclude<
  keyof RunListRow,
  "namespace" | "qualifiedName" | "archivePath" | "stop" | "pullRequest"
>;

const LABELS: Readonly<Record<Column, string>> = {
  shortName: "NAME",
  state: "STATE",
  branch: "BRANCH",
  currentPhase: "PHASE",
  gateProfile: "PROFILE",
  updatedAt: "UPDATED",
  lockState: "LOCK",
  recordsPending: "RECORDS",
};

function cell(row: RunListRow, column: Column): string {
  if (column === "shortName") return row.qualifiedName;
  if (column === "recordsPending") {
    return row.recordsPending === null ? UNKNOWN : String(row.recordsPending);
  }
  if (column === "state" && row.stop !== null) return `${row.state} (${row.stop.cause})`;
  if (column === "currentPhase") {
    const phase = row.currentPhase ?? UNKNOWN;
    return row.stop === null ? phase : `${phase} ${row.stop.phase.id}`;
  }
  if (column === "gateProfile") return row.gateProfile ?? UNKNOWN;
  return row[column];
}

/** Today's `phax ls` table, from the run list alone. The RECORDS column appears when a row
 *  carries a pending count: only this project's rows do, and only when its records are on. */
export function renderRunList(list: RunListFile): string {
  const rows = list.runs;
  if (rows.length === 0) return "(no runs)";
  const columns: Column[] = [
    "shortName",
    "state",
    "branch",
    "currentPhase",
    "gateProfile",
    "updatedAt",
    "lockState",
    ...(rows.some((row) => row.recordsPending !== null) ? (["recordsPending"] as const) : []),
  ];
  const widths = columns.map((column) =>
    Math.max(LABELS[column].length, ...rows.map((row) => cell(row, column).length)),
  );
  const header = columns.map((column, i) => pad(LABELS[column], widths[i] ?? 0)).join("  ");
  const separator = widths.map((width) => "-".repeat(width)).join("  ");
  const lines = rows.map((row) =>
    columns.map((column, i) => pad(cell(row, column), widths[i] ?? 0)).join("  "),
  );
  return [header, separator, ...lines].join("\n");
}

/** One `short-name:state` line per run: the `usage` CLI splits on `:` when its completer says
 *  `descriptions=#true`, the right-hand part a description. */
function completionLines(list: RunListFile): string {
  return list.runs.map((row) => `${row.shortName}:${row.state}\n`).join("");
}

export const lsCommand = defineCommand({
  name: "ls",
  summary: "List runs from the registry",
  help: "Lists runs from the local registry (~/.phax/runs/). With no filter flags, shows all runs. Use status filters to narrow output: --active (created or running), --failed, --review-open (finished, open for human review), --awaiting-review (stopped at an interactive phase), or --archived. A run waiting at a stop reads awaiting_review (declared) or awaiting_review (held), and its PHASE column names the stopped phase. Use --json for the versioned run list: one run-list document (a $schema and a runs array) whose runs carry qualifiedName, namespace, shortName, state, branch, currentPhase, gateProfile, updatedAt, lockState, recordsPending, archivePath, stop and pullRequest. A value that is unknown is null, stop is the run's review-stop document, or null when the run is not waiting at a stop, and pullRequest is the URL of the pull request phax opened for the run, or null when it opened none.",
  examples: [
    "phax ls",
    "phax ls --review-open",
    "phax ls --awaiting-review",
    "phax ls --failed --json",
  ],
  input: { flags: reject(LsFlags) },
  output: reject(RunListFileSchema.annotations(publishedFormat("run-list"))),
  run: ({ input }) => listRuns(input.flags).pipe(Effect.mapError(exposeMessage)),
  exits: { ConfigValidationError: 1, FsError: 1, RegistryCorruptionError: 1 },
  errors: {
    ConfigValidationError: MessageFields,
    FsError: MessageFields,
    RegistryCorruptionError: MessageFields,
  },
  texts: {
    ConfigValidationError: (error) => `Config error: ${error.message}`,
    FsError: (error) => `Registry error: ${error.message}`,
    RegistryCorruptionError: (error) => `Registry error: ${error.message}`,
  },
  document: (list) =>
    completions.has(list) ? document(completionLines(list), { format: null }) : undefined,
  render: (list) => renderRunList(list),
});
