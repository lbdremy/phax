import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import type { FileSystem } from "../../ports/fs.js";
import type { Git } from "../../ports/git.js";
import type { Lock } from "../../ports/lock.js";
import type { Prompt } from "../../ports/prompt.js";
import { loadConfig } from "../../app/loadConfig.js";
import { prune, type PruneResult } from "../../app/prune.js";
import { LockConflictError, PruneRefusedError } from "../../domain/errors.js";
import {
  confirmationMode,
  describePruneRefusal,
  formatBytes,
  parsePruneSelection,
  pruneExitCode,
  type PruneKept,
  type PrunePlan,
  type PruneRunReport,
  type PruneTotals,
  type UnpreservedBranch,
} from "../../domain/prune.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { makeClackPromptLayer } from "../../infra/prompt.js";
import type { ResolvedConfig } from "../../schemas/phaxConfig.js";
import { reportConfigError } from "./reportConfigError.js";
import { exitCodeForError, makeRepoRootedFileSystemLayer } from "./runLayers.js";

export interface PruneCommandOptions {
  all?: boolean;
  force?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
}

function buildLayer(config: ResolvedConfig): Layer.Layer<FileSystem | Git | Lock | Prompt> {
  return Layer.mergeAll(
    makeRepoRootedFileSystemLayer(config),
    makeNodeGitLayer(),
    makeNodeLockLayer(config.stateRoot),
    makeClackPromptLayer(),
  );
}

function firstLine(message: string): string {
  return message.split("\n", 1)[0] ?? "";
}

// ── Human rendering ──────────────────────────────────────────────────────────

function describeUnpreserved(branches: readonly UnpreservedBranch[]): string {
  return branches
    .map((b) => `${b.branch} holds ${b.unpreservedCommits} unpreserved commit(s)`)
    .join(", ");
}

function describeKept(kept: PruneKept): string {
  switch (kept.reason) {
    case "unpreserved-commits":
      return describeUnpreserved(kept.branches);
    case "branch-checked-out":
      return kept.worktrees
        .map((w) => `${w.branch} is checked out in ${w.worktreePath}`)
        .join(", ");
    case "removal-failed":
      return `could not remove ${kept.part}: ${kept.message}`;
  }
}

function renderPreview(plan: PrunePlan, out: OutputPort): void {
  out.log(`Prune from namespace "${plan.namespace}":`);
  const width = Math.max(...plan.runs.map((run) => run.qualifiedName.length));
  for (const run of plan.runs) {
    const head = `  ${run.qualifiedName.padEnd(width)}  ${run.outcome === "would-prune" ? "prune" : "keep "}  ${formatBytes(run.archiveBytes)}`;
    if (run.kept === null) {
      const branches = run.branches.length > 0 ? run.branches.join(", ") : "none";
      out.log(`${head}  branches: ${branches} (${run.branches.length})`);
    } else if (run.kept.reason === "unpreserved-commits") {
      out.log(`${head}  ${describeKept(run.kept)} (--force discards them)`);
    } else {
      out.log(`${head}  ${describeKept(run.kept)}`);
    }
  }
}

function renderRunReport(run: PruneRunReport, out: OutputPort): void {
  if (run.kept !== null) {
    out.log(`○ ${run.qualifiedName} kept — ${describeKept(run.kept)}`);
    return;
  }
  out.log(
    `✓ ${run.qualifiedName} pruned — ${formatBytes(run.bytesFreed)} freed, ${run.branchesDeleted.length} local branches deleted`,
  );
  if (run.branchesDiscarded.length > 0) {
    out.log(`  discarded: ${describeUnpreserved(run.branchesDiscarded)}`);
  }
  if (run.alreadyAbsent.length > 0) {
    out.log(`  already absent: ${run.alreadyAbsent.join(", ")}`);
  }
  if (run.remoteBranchesKept.length > 0) {
    out.log(
      `  ! remote branches kept: ${run.remoteBranchesKept.join(", ")} — a future run named ${run.shortName} will meet them at publish-pr`,
    );
  }
}

function confirmationMissingLine(json: boolean): string {
  return json
    ? "✗ prune refused: --json never prompts; pass --yes to proceed or --dry-run to preview only"
    : "✗ prune refused: no TTY to confirm; pass --yes to proceed or --dry-run to preview only";
}

function renderHuman(result: PruneResult, out: OutputPort): void {
  switch (result.kind) {
    case "nothing-to-prune":
      out.log("Nothing to prune: no archived run in this namespace.");
      return;
    case "previewed":
      out.log("Dry run: nothing deleted.");
      return;
    case "declined":
      out.error("✗ prune declined: nothing deleted.");
      return;
    case "confirmation-missing":
      out.error(confirmationMissingLine(false));
      return;
    case "applied": {
      for (const run of result.report.runs) renderRunReport(run, out);
      const { totals } = result.report;
      out.log(
        `Pruned ${totals.pruned} of ${result.report.runs.length} runs, ${formatBytes(totals.bytesFreed)} freed.`,
      );
      return;
    }
  }
}

// ── JSON rendering ───────────────────────────────────────────────────────────

interface PruneJsonRun {
  readonly name: string;
  readonly runId: string;
  readonly outcome: string;
  readonly archiveBytes: number;
  readonly branchesDeleted: readonly string[];
  readonly branchesDiscarded: readonly UnpreservedBranch[];
  readonly alreadyAbsent: readonly string[];
  readonly remoteBranchesKept: readonly string[];
  readonly kept: PruneKept | null;
}

interface PruneJsonDocument {
  readonly namespace: string;
  readonly dryRun: boolean;
  readonly runs: readonly PruneJsonRun[];
  readonly totals: PruneTotals;
}

function planDocument(plan: PrunePlan, dryRun: boolean): PruneJsonDocument {
  return {
    namespace: plan.namespace,
    dryRun,
    runs: plan.runs.map((run) => ({
      name: run.qualifiedName,
      runId: run.runId,
      outcome: run.outcome,
      archiveBytes: run.archiveBytes,
      branchesDeleted: run.outcome === "would-prune" ? run.branches : [],
      branchesDiscarded: run.branchesDiscarded,
      alreadyAbsent: [],
      remoteBranchesKept: run.remoteBranchesKept,
      kept: run.kept,
    })),
    totals: plan.totals,
  };
}

function jsonDocument(result: PruneResult, namespace: string): PruneJsonDocument {
  switch (result.kind) {
    case "nothing-to-prune":
      return { namespace, dryRun: false, runs: [], totals: { pruned: 0, kept: 0, bytesFreed: 0 } };
    case "previewed":
      return planDocument(result.plan, true);
    case "declined":
    case "confirmation-missing":
      return planDocument(result.plan, false);
    case "applied":
      return {
        namespace: result.plan.namespace,
        dryRun: false,
        runs: result.report.runs.map((run) => ({
          name: run.qualifiedName,
          runId: run.runId,
          outcome: run.outcome,
          archiveBytes: run.archiveBytes,
          branchesDeleted: run.branchesDeleted,
          branchesDiscarded: run.branchesDiscarded,
          alreadyAbsent: run.alreadyAbsent,
          remoteBranchesKept: run.remoteBranchesKept,
          kept: run.kept,
        })),
        totals: result.report.totals,
      };
  }
}

// ── Errors ───────────────────────────────────────────────────────────────────

function renderError(err: unknown, out: OutputPort): void {
  if (err instanceof PruneRefusedError) {
    for (const refusal of err.refusals) {
      out.error(`✗ prune refused: ${describePruneRefusal(refusal)}`);
    }
  } else if (err instanceof LockConflictError) {
    for (const line of err.message.split("\n")) out.error(`✗ prune refused: ${line}`);
  } else {
    out.error(`✗ prune failed: ${firstLine(err instanceof Error ? err.message : String(err))}`);
  }
}

export async function runPrune(
  names: string[],
  opts: PruneCommandOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    reportConfigError(configResult.left, out);
    return 1;
  }
  const config = configResult.right;

  const selection = parsePruneSelection(names, opts.all === true);
  if (Either.isLeft(selection)) {
    out.error(`✗ prune refused: ${selection.left}`);
    return 1;
  }

  const json = opts.json === true;
  const confirmation = confirmationMode({
    dryRun: opts.dryRun === true,
    yes: opts.yes === true,
    json,
    stdinIsTTY: Boolean(process.stdin.isTTY),
  });

  const effect = prune({
    namespace: config.namespace,
    stateRoot: config.stateRoot,
    repoRoot: config.repoRoot,
    selection: selection.right,
    force: opts.force === true,
    confirmation,
    onPreview: (plan) => (json ? Effect.void : Effect.sync(() => renderPreview(plan, out))),
  }).pipe(Effect.provide(buildLayer(config)));

  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    renderError(result.left, out);
    return exitCodeForError(result.left);
  }

  if (json) {
    out.log(JSON.stringify(jsonDocument(result.right, config.namespace), null, 2));
    if (result.right.kind === "confirmation-missing") out.error(confirmationMissingLine(true));
  } else {
    renderHuman(result.right, out);
  }
  return pruneExitCode(result.right);
}
