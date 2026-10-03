import { Either } from "effect";
import type { NonEmptyReadonlyArray } from "effect/Array";
import { isAbsolute, join, relative, sep } from "node:path";
import { decodeBranchName, type BranchName } from "./branded.js";
import { parseRunRef, runKey } from "./runRef.js";
import type { RegistryEntry } from "../schemas/registry.js";

// ── Selection ────────────────────────────────────────────────────────────────

/** The runs `phax prune` was asked for: named runs, or every archived run. */
export type PruneSelection =
  | { readonly kind: "names"; readonly refs: readonly string[] }
  | { readonly kind: "all" };

/**
 * Exactly one selection form: run names, or `--all`. Neither or both is a
 * Left naming the two accepted forms. Names are deduplicated.
 */
export function parsePruneSelection(
  names: readonly string[],
  all: boolean,
): Either.Either<PruneSelection, string> {
  const forms = "use `phax prune <short-name>...` or `phax prune --all`";
  if (names.length > 0 && all) {
    return Either.left(`give run names or --all, not both — ${forms}`);
  }
  if (names.length === 0 && !all) {
    return Either.left(`no run selected — ${forms}`);
  }
  if (all) return Either.right({ kind: "all" });
  return Either.right({ kind: "names", refs: Array.from(new Set(names)) });
}

/** Why one named run cannot be pruned. One refusal refuses the whole selection. */
export type PruneRefusal =
  | { readonly kind: "invalid"; readonly ref: string; readonly message: string }
  | {
      readonly kind: "other-namespace";
      readonly ref: string;
      readonly qualifiedName: string;
      readonly namespace: string;
    }
  | { readonly kind: "not-found"; readonly ref: string; readonly qualifiedName: string }
  | {
      readonly kind: "not-archived";
      readonly ref: string;
      readonly qualifiedName: string;
      readonly shortName: string;
      readonly state: RegistryEntry["state"];
    };

/** One line naming the offending run and its reason. */
export function describePruneRefusal(refusal: PruneRefusal): string {
  switch (refusal.kind) {
    case "invalid":
      return refusal.message;
    case "other-namespace":
      return `run "${refusal.qualifiedName}" belongs to namespace "${refusal.namespace}"; run phax prune from that repository`;
    case "not-found":
      return `run "${refusal.qualifiedName}" not found`;
    case "not-archived":
      return `run "${refusal.qualifiedName}" is ${refusal.state}, not archived — archive it first: phax archive ${refusal.shortName}`;
  }
}

/**
 * Resolve the selection against the registry, in the current namespace only.
 * Every refusal is collected; any refusal refuses the whole selection. `all`
 * selects the namespace's archived entries in registry order.
 */
export function selectPruneRuns(
  entries: readonly RegistryEntry[],
  namespace: string,
  selection: PruneSelection,
): Either.Either<readonly RegistryEntry[], NonEmptyReadonlyArray<PruneRefusal>> {
  if (selection.kind === "all") {
    return Either.right(
      entries.filter((entry) => entry.namespace === namespace && entry.state === "archived"),
    );
  }
  const refusals: PruneRefusal[] = [];
  const selected: RegistryEntry[] = [];
  for (const ref of selection.refs) {
    const parsed = parseRunRef(ref);
    if (Either.isLeft(parsed)) {
      refusals.push({ kind: "invalid", ref, message: parsed.left });
      continue;
    }
    const { shortName } = parsed.right;
    const refNamespace = parsed.right.namespace ?? namespace;
    const qualifiedName = runKey(refNamespace, shortName);
    if (refNamespace !== namespace) {
      refusals.push({ kind: "other-namespace", ref, qualifiedName, namespace: refNamespace });
      continue;
    }
    const entry = entries.find((e) => e.namespace === namespace && e.shortName === shortName);
    if (entry === undefined) {
      refusals.push({ kind: "not-found", ref, qualifiedName });
      continue;
    }
    if (entry.state !== "archived") {
      refusals.push({ kind: "not-archived", ref, qualifiedName, shortName, state: entry.state });
      continue;
    }
    if (!selected.includes(entry)) selected.push(entry);
  }
  const [first, ...rest] = refusals;
  if (first !== undefined) return Either.left([first, ...rest]);
  return Either.right(selected);
}

// ── Branches, remote refs and worktree roots ─────────────────────────────────

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phaseBranch(branch: string, index: number): string {
  return `${branch}--phase-${String(index).padStart(2, "0")}`;
}

/**
 * The run's local branches as prune expects them: the entry's `branch`, then
 * `<branch>--phase-01..NN` up to `phasesCount`, plus any other present branch
 * that is exactly `<branch>--phase-` and two digits. Run branch first, phase
 * branches sorted after it. `localBranches` are short names.
 */
export function expectedRunBranches(
  entry: Pick<RegistryEntry, "branch" | "phasesCount">,
  localBranches: readonly string[],
): readonly BranchName[] {
  const phasePattern = new RegExp(`^${escapeRegExp(entry.branch)}--phase-\\d{2}$`);
  const phases = new Set<string>();
  for (let index = 1; index <= entry.phasesCount; index++) {
    phases.add(phaseBranch(entry.branch, index));
  }
  for (const local of localBranches) {
    if (phasePattern.test(local)) phases.add(local);
  }
  const names = [entry.branch, ...Array.from(phases).toSorted()];
  return names.flatMap((name) => {
    const decoded = decodeBranchName(name);
    return Either.isRight(decoded) ? [decoded.right] : [];
  });
}

/**
 * The short `<remote>/<branch>` form of every remote-tracking ref (full
 * `refs/remotes/<remote>/<rest>` names) whose `<rest>` is one of `branches`.
 * `<remote>/HEAD` is skipped.
 */
export function remoteTrackingRefsFor(
  branches: readonly string[],
  remoteRefs: readonly string[],
): readonly string[] {
  const prefix = "refs/remotes/";
  const wanted = new Set(branches);
  const kept: string[] = [];
  for (const ref of remoteRefs) {
    if (!ref.startsWith(prefix)) continue;
    const short = ref.slice(prefix.length);
    const slash = short.indexOf("/");
    if (slash <= 0) continue;
    const rest = short.slice(slash + 1);
    if (rest === "HEAD") continue;
    if (wanted.has(rest)) kept.push(short);
  }
  return kept;
}

/**
 * The folders whose worktrees belong to the run: its live worktrees folder
 * `<stateRoot>/worktrees/<ns>.<name>` and its archive folder.
 */
export function runOwnedWorktreeRoots(
  stateRoot: string,
  namespace: string,
  shortName: string,
  archivePath: string,
): readonly string[] {
  return [join(stateRoot, "worktrees", runKey(namespace, shortName)), archivePath];
}

/** Whether `path` is `root` or lies under it — separator-aware, so `/a/x-2` is not under `/a/x`. */
export function isUnderRoot(path: string, root: string): boolean {
  const rel = relative(root, path);
  if (rel === "") return true;
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

// ── Plan and report ──────────────────────────────────────────────────────────

/** A run's outcome: planned (`would-*`, the preview) or applied. */
export type PruneOutcome = "pruned" | "kept" | "would-prune" | "would-keep";

export type PruneKeptReason = "unpreserved-commits" | "branch-checked-out" | "removal-failed";

/** The part of a run that a removal step addresses (`local branches`: listing them failed). */
export type PrunePart =
  | "archive folder"
  | "worktree metadata"
  | `branch ${string}`
  | "local branches"
  | "registry entry";

export interface UnpreservedBranch {
  readonly branch: BranchName;
  readonly unpreservedCommits: number;
}

export interface CheckedOutBranch {
  readonly branch: BranchName;
  readonly worktreePath: string;
}

/** Why a selected run was (or will be) kept. */
export type PruneKept =
  | { readonly reason: "unpreserved-commits"; readonly branches: readonly UnpreservedBranch[] }
  | { readonly reason: "branch-checked-out"; readonly worktrees: readonly CheckedOutBranch[] }
  | { readonly reason: "removal-failed"; readonly part: PrunePart; readonly message: string };

/** A worktree as git lists it, as far as prune cares. */
export interface PruneWorktree {
  readonly path: string;
  readonly branch: string | null;
  readonly prunable: boolean;
}

/** The facts gathered for one selected run, before any deletion. */
export interface PruneRunFacts {
  readonly entry: RegistryEntry;
  readonly archivePath: string;
  readonly archiveBytes: number;
  readonly expectedBranches: readonly BranchName[];
  readonly presentBranches: readonly BranchName[];
  /** The unpreserved-commit count of each present branch. */
  readonly unpreserved: readonly UnpreservedBranch[];
  readonly worktrees: readonly PruneWorktree[];
  readonly ownedWorktreeRoots: readonly string[];
  readonly remoteBranchesKept: readonly string[];
}

/** One selected run as the preview shows it. */
export interface PrunePlannedRun {
  readonly qualifiedName: string;
  readonly shortName: string;
  readonly runId: string;
  readonly archivePath: string;
  readonly archiveBytes: number;
  /** Every branch prune addresses: the present ones are deleted, the absent ones reported. */
  readonly expectedBranches: readonly BranchName[];
  /** The run's local branches that exist now. */
  readonly branches: readonly BranchName[];
  readonly ownedWorktreeRoots: readonly string[];
  readonly remoteBranchesKept: readonly string[];
  readonly outcome: "would-prune" | "would-keep";
  /** Under --force: the branches whose unpreserved commits the prune discards. */
  readonly branchesDiscarded: readonly UnpreservedBranch[];
  /** Null exactly when the outcome is `would-prune`. */
  readonly kept: PruneKept | null;
}

export interface PruneTotals {
  readonly pruned: number;
  readonly kept: number;
  readonly bytesFreed: number;
}

export interface PrunePlan {
  readonly namespace: string;
  readonly runs: readonly PrunePlannedRun[];
  /** What the plan would do: `would-prune` count, `would-keep` count, their archive bytes. */
  readonly totals: PruneTotals;
}

/** One selected run after the apply step. */
export interface PruneRunReport {
  readonly qualifiedName: string;
  readonly shortName: string;
  readonly runId: string;
  readonly outcome: "pruned" | "kept";
  readonly archiveBytes: number;
  readonly bytesFreed: number;
  readonly branchesDeleted: readonly BranchName[];
  readonly branchesDiscarded: readonly UnpreservedBranch[];
  /** Part labels: `archive folder`, `worktree metadata`, `branch <name>`. */
  readonly alreadyAbsent: readonly PrunePart[];
  readonly remoteBranchesKept: readonly string[];
  /** Null exactly when the outcome is `pruned`. */
  readonly kept: PruneKept | null;
}

export interface PruneReport {
  readonly runs: readonly PruneRunReport[];
  readonly totals: PruneTotals;
}

/**
 * Plan one run. A branch checked out in a worktree that is neither prunable
 * nor owned by the run keeps it, even with force. Otherwise unpreserved
 * commits keep it unless force is on, in which case they are discarded.
 */
export function decideRun(facts: PruneRunFacts, force: boolean): PrunePlannedRun {
  const present = new Set<string>(facts.presentBranches);
  const base = {
    qualifiedName: runKey(facts.entry.namespace, facts.entry.shortName),
    shortName: facts.entry.shortName,
    runId: facts.entry.runId,
    archivePath: facts.archivePath,
    archiveBytes: facts.archiveBytes,
    expectedBranches: facts.expectedBranches,
    branches: facts.presentBranches,
    ownedWorktreeRoots: facts.ownedWorktreeRoots,
    remoteBranchesKept: facts.remoteBranchesKept,
  };

  const checkedOut: CheckedOutBranch[] = facts.worktrees.flatMap((worktree) => {
    if (worktree.prunable || worktree.branch === null || !present.has(worktree.branch)) return [];
    if (facts.ownedWorktreeRoots.some((root) => isUnderRoot(worktree.path, root))) return [];
    const branch = facts.presentBranches.find((b) => b === worktree.branch)!;
    return [{ branch, worktreePath: worktree.path }];
  });
  if (checkedOut.length > 0) {
    return {
      ...base,
      outcome: "would-keep",
      branchesDiscarded: [],
      kept: { reason: "branch-checked-out", worktrees: checkedOut },
    };
  }

  const unpreserved = facts.unpreserved.filter((b) => b.unpreservedCommits > 0);
  if (unpreserved.length > 0 && !force) {
    return {
      ...base,
      outcome: "would-keep",
      branchesDiscarded: [],
      kept: { reason: "unpreserved-commits", branches: unpreserved },
    };
  }
  return { ...base, outcome: "would-prune", branchesDiscarded: unpreserved, kept: null };
}

/** Assemble the plan and its would-be totals. */
export function makePrunePlan(namespace: string, runs: readonly PrunePlannedRun[]): PrunePlan {
  const pruning = runs.filter((run) => run.outcome === "would-prune");
  return {
    namespace,
    runs,
    totals: {
      pruned: pruning.length,
      kept: runs.length - pruning.length,
      bytesFreed: pruning.reduce((sum, run) => sum + run.archiveBytes, 0),
    },
  };
}

/** Sum the applied run reports. */
export function pruneTotals(runs: readonly PruneRunReport[]): PruneTotals {
  return {
    pruned: runs.filter((run) => run.outcome === "pruned").length,
    kept: runs.filter((run) => run.outcome === "kept").length,
    bytesFreed: runs.reduce((sum, run) => sum + run.bytesFreed, 0),
  };
}

// ── Confirmation, sizes and exit codes ───────────────────────────────────────

/**
 * How the deletion is confirmed: `dry-run` previews only, `yes` proceeds,
 * `prompt` asks on the TTY, `missing` refuses (no TTY, or --json, without --yes).
 */
export type PruneConfirmation = "dry-run" | "yes" | "prompt" | "missing";

export function confirmationMode(flags: {
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly json: boolean;
  readonly stdinIsTTY: boolean;
}): PruneConfirmation {
  if (flags.dryRun) return "dry-run";
  if (flags.yes) return "yes";
  // --json never prompts.
  if (flags.json) return "missing";
  return flags.stdinIsTTY ? "prompt" : "missing";
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Bytes in powers of 1024 with one decimal (`3.1 GB`); whole bytes below 1 KB (`512 B`). */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  if (unit === 0) return `${bytes} B`;
  return `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

/** What one prune invocation came to, short of a whole-command error. */
export type PruneResult =
  | { readonly kind: "nothing-to-prune" }
  | { readonly kind: "previewed"; readonly plan: PrunePlan }
  | { readonly kind: "declined"; readonly plan: PrunePlan }
  | { readonly kind: "confirmation-missing"; readonly plan: PrunePlan }
  | { readonly kind: "applied"; readonly plan: PrunePlan; readonly report: PruneReport };

/** Spec §5.20: 0 when nothing was kept, 1 when nothing was deleted, 3 when a run was kept. */
export function pruneExitCode(result: PruneResult): number {
  switch (result.kind) {
    case "nothing-to-prune":
    case "previewed":
      return 0;
    case "declined":
    case "confirmation-missing":
      return 1;
    case "applied":
      return result.report.runs.some((run) => run.outcome === "kept") ? 3 : 0;
  }
}
