// `phax prune [short-name...]` as the runner reads it: delete archived runs of the current
// namespace for real. Under `--json` it answers today's prune document (namespace, dryRun, runs,
// totals), its keys in today's order, for nothing to prune, a preview (`--dry-run`) and an applied
// prune; the text is a view of that document. The preview is said before the confirmation, line
// by line, as it was printed. Without `--yes` or `--dry-run` the call may ask a person, so `--json`
// is refused for it; without `--json` a declined confirmation and a missing terminal are declared
// errors with today's sentences. Exit 3 when an applied prune kept a run; 7 for a locked run.
import { Data, Effect, Result, Layer } from "effect";
import * as Schema from "effect/Schema";
import { prune } from "../../app/prune.js";
import {
  LockConflictError,
  PruneRefusedError,
  RegistryCorruptionError,
} from "../../domain/errors.js";
import {
  confirmationMode,
  describePruneRefusal,
  formatBytes,
  parsePruneSelection,
  type PruneKept,
  type PrunePlan,
} from "../../domain/prune.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { makeClackPromptLayer } from "../../infra/prompt.js";
import type { FileSystem } from "../../ports/fs.js";
import type { Git } from "../../ports/git.js";
import type { Lock } from "../../ports/lock.js";
import type { Prompt } from "../../ports/prompt.js";
import type { ResolvedConfig } from "../../schemas/phaxConfig.js";
import { configErrorText } from "../commands/reportConfigError.js";
import { makeRepoRootedFileSystemLayer } from "../commands/runLayers.js";
import { AliasAnnotationId, defineCommand, reject } from "../commandLibrary/contract/index.js";
import { configured, exposeMessage, MessageFields } from "./shared.js";

/** The layers a test swaps: the program instance gets the real ones. */
export interface PruneLayers {
  /** The layers of the services prune needs, for the repository's configuration. */
  readonly build: (config: ResolvedConfig) => Layer.Layer<FileSystem | Git | Lock | Prompt>;
}

/** The real adapters, built when the command runs (a test mocks the prompt module). */
/** What lifts prune's confirmation, as the `--json` refusal names it: today's remedy. */
const PRUNE_UNPROMPTED = "pass --yes to proceed or --dry-run to preview only";

const REAL_PRUNE_LAYERS: PruneLayers = {
  build: (config) =>
    Layer.mergeAll(
      makeRepoRootedFileSystemLayer(config),
      makeNodeGitLayer(),
      makeNodeLockLayer(config.stateRoot),
      makeClackPromptLayer(),
    ),
};

function firstLine(message: string): string {
  return message.split("\n", 1)[0] ?? "";
}

// ── Errors ───────────────────────────────────────────────────────────────────────

/** The configuration did not load: the report's lines. */
class PruneConfigError extends Data.TaggedError("PruneConfigError")<{
  readonly message: string;
}> {}

/** The selection (names or `--all`) was refused. */
class PruneSelectionError extends Data.TaggedError("PruneSelectionError")<{
  readonly message: string;
}> {}

/** A selected run cannot be pruned: one refusal line each. */
class PruneRefused extends Data.TaggedError("PruneRefused")<{
  readonly message: string;
  readonly lines: ReadonlyArray<string>;
}> {}

/** A selected run is locked (exit 7). */
class PruneLocked extends Data.TaggedError("PruneLocked")<{
  readonly message: string;
  readonly lines: ReadonlyArray<string>;
}> {}

/** The registry is corrupt (exit 10). */
class PruneRegistryError extends Data.TaggedError("PruneRegistryError")<{
  readonly message: string;
}> {}

/** Anything else: the first line of the error's message. */
class PruneFailed extends Data.TaggedError("PruneFailed")<{ readonly message: string }> {}

/** The confirmation was declined. */
class PruneDeclined extends Data.TaggedError("PruneDeclined")<{ readonly message: string }> {}

/** There is no terminal to confirm on. */
class PruneConfirmationMissing extends Data.TaggedError("PruneConfirmationMissing")<{
  readonly message: string;
}> {}

const LinesFields = Schema.Struct({
  message: Schema.String,
  lines: Schema.Array(Schema.String),
});

// ── The answer ───────────────────────────────────────────────────────────────────

const Branches = Schema.Array(
  Schema.Struct({ branch: Schema.String, unpreservedCommits: Schema.Number }),
);

const Kept = Schema.Union([
  Schema.Struct({ reason: Schema.Literal("unpreserved-commits"), branches: Branches }),
  Schema.Struct({
    reason: Schema.Literal("branch-checked-out"),
    worktrees: Schema.Array(Schema.Struct({ branch: Schema.String, worktreePath: Schema.String })),
  }),
  Schema.Struct({
    reason: Schema.Literal("removal-failed"),
    part: Schema.String,
    message: Schema.String,
  }),
]);

/** Today's document, key for key. */
const PruneOutput = Schema.Struct({
  namespace: Schema.String,
  dryRun: Schema.Boolean,
  runs: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      runId: Schema.String,
      outcome: Schema.String,
      archiveBytes: Schema.Number,
      branchesDeleted: Schema.Array(Schema.String),
      branchesDiscarded: Branches,
      alreadyAbsent: Schema.Array(Schema.String),
      remoteBranchesKept: Schema.Array(Schema.String),
      kept: Schema.NullOr(Kept),
    }),
  ),
  totals: Schema.Struct({
    pruned: Schema.Number,
    kept: Schema.Number,
    bytesFreed: Schema.Number,
  }),
});

type PruneOutput = typeof PruneOutput.Type;

function planDocument(plan: PrunePlan, dryRun: boolean): PruneOutput {
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

// ── Today's text ─────────────────────────────────────────────────────────────────

function describeUnpreserved(
  branches: ReadonlyArray<{ readonly branch: string; readonly unpreservedCommits: number }>,
): string {
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

/** The lines of the preview, printed before the confirmation. */
function previewLines(plan: PrunePlan): string[] {
  const lines = [`Prune from namespace "${plan.namespace}":`];
  const width = Math.max(...plan.runs.map((run) => run.qualifiedName.length));
  for (const run of plan.runs) {
    const head = `  ${run.qualifiedName.padEnd(width)}  ${run.outcome === "would-prune" ? "prune" : "keep "}  ${formatBytes(run.archiveBytes)}`;
    if (run.kept === null) {
      const branches = run.branches.length > 0 ? run.branches.join(", ") : "none";
      lines.push(`${head}  branches: ${branches} (${run.branches.length})`);
    } else if (run.kept.reason === "unpreserved-commits") {
      lines.push(`${head}  ${describeKept(run.kept)} (--force discards them)`);
    } else {
      lines.push(`${head}  ${describeKept(run.kept)}`);
    }
  }
  return lines;
}

/** The lines of an applied prune, from the document alone: the short name of a run is its
 *  qualified name after the namespace, and the bytes it freed are its archive's unless the
 *  folder was already absent. */
function appliedLines(value: PruneOutput): string[] {
  const lines: string[] = [];
  for (const run of value.runs) {
    if (run.kept !== null) {
      lines.push(`○ ${run.name} kept — ${describeKept(run.kept as PruneKept)}`);
      continue;
    }
    const freed = run.alreadyAbsent.includes("archive folder") ? 0 : run.archiveBytes;
    lines.push(
      `✓ ${run.name} pruned — ${formatBytes(freed)} freed, ${run.branchesDeleted.length} local branches deleted`,
    );
    if (run.branchesDiscarded.length > 0) {
      lines.push(`  discarded: ${describeUnpreserved(run.branchesDiscarded)}`);
    }
    if (run.alreadyAbsent.length > 0) {
      lines.push(`  already absent: ${run.alreadyAbsent.join(", ")}`);
    }
    if (run.remoteBranchesKept.length > 0) {
      const shortName = run.name.slice(value.namespace.length + 1);
      lines.push(
        `  ! remote branches kept: ${run.remoteBranchesKept.join(", ")} — a future run named ${shortName} will meet them at publish-pr`,
      );
    }
  }
  lines.push(
    `Pruned ${value.totals.pruned} of ${value.runs.length} runs, ${formatBytes(value.totals.bytesFreed)} freed.`,
  );
  return lines;
}

function renderPrune(value: PruneOutput): string {
  if (value.dryRun) return "Dry run: nothing deleted.";
  if (value.runs.length === 0) return "Nothing to prune: no archived run in this namespace.";
  return appliedLines(value).join("\n");
}

function makePruneCommand(layers: PruneLayers) {
  return defineCommand({
    name: "prune",
    summary:
      "Delete archived runs of the current namespace for real, freeing their names and disk space",
    help: "Deletes each selected archived run of the current namespace for real: its archive folder under ~/.phax/archive/<namespace>.<short-name>/, its worktree metadata in the current repository, its local branches (<branch> and <branch>--phase-NN) and, last, its registry entry — so its name and disk space come back. Before deleting the archive folder, it keeps the run's cost ledger: runs/cost-ledger.json is copied byte for byte to ~/.phax/cost-ledgers/<namespace>.<short-name>.<run-id>.json, and a failed copy keeps the run. Select runs by name (short or <namespace>.<short-name>) or with --all; only archived runs of the current namespace can be pruned, and an unknown, non-archived or other-namespace name refuses the whole command. Never touches records on phax/records/v1, remote branches, remote-tracking refs or pull requests, and never contacts a remote.\n\nA run whose local branches hold commits that no other branch, tag or remote-tracking ref keeps is kept whole unless --force is set, which discards those commits. A branch checked out in a worktree keeps the run even with --force. A locked run refuses the whole command (exit 7).\n\nAlways prints a preview first, then asks for confirmation on a TTY; --yes proceeds without asking, --dry-run deletes nothing, and without a TTY the command refuses unless --yes or --dry-run is set. --json prints one JSON document and never prompts. Exits 0 when every selected run was pruned, 1 when nothing was deleted, 3 when at least one run was kept.\n\nSide effects: writes under ~/.phax/cost-ledgers/, deletes under ~/.phax/archive/, deletes local branches and stale worktree metadata, updates ~/.phax/registry.json.",
    examples: ["phax prune old-idea", "phax prune --all --dry-run", "phax prune --all --yes"],
    input: {
      args: reject(
        Schema.Array(
          Schema.String.annotate({
            identifier: "short-name",
            description: "Archived run short name, e.g. old-idea",
          }),
        ),
      ),
      flags: reject(
        Schema.Struct({
          all: Schema.optionalKey(
            Schema.Boolean.annotate({
              description: "Prune every archived run of the current namespace",
            }),
          ),
          force: Schema.optionalKey(
            Schema.Boolean.annotate({
              description:
                "Also prune runs whose branches hold unpreserved commits (discards those commits)",
            }),
          ),
          dryRun: Schema.optionalKey(
            Schema.Boolean.annotate({ description: "Print the preview and delete nothing" }),
          ),
          yes: Schema.optionalKey(Schema.Boolean).annotateKey({
            description: "Proceed without confirmation (required without a TTY)",
            [AliasAnnotationId]: "y",
          }),
        }),
      ),
    },
    output: reject(PruneOutput),
    // Without --yes or --dry-run a person may be asked to confirm: --json never waits on one.
    prompts: (input) => input.flags.yes !== true && input.flags.dryRun !== true,
    unprompted: PRUNE_UNPROMPTED,
    verdicts: {
      // An applied prune that kept a run.
      3: (value) => !value.dryRun && value.runs.some((run) => run.outcome === "kept"),
    },
    run: ({ input, say }) =>
      Effect.gen(function* () {
        const config = yield* configured().pipe(
          Effect.mapError((error) => new PruneConfigError({ message: configErrorText(error) })),
        );
        const selection = parsePruneSelection(input.args, input.flags.all === true);
        if (Result.isFailure(selection)) {
          return yield* Effect.fail(
            new PruneSelectionError({ message: `✗ prune refused: ${selection.failure}` }),
          );
        }
        const confirmation = confirmationMode({
          dryRun: input.flags.dryRun === true,
          yes: input.flags.yes === true,
          json: false,
          stdinIsTTY: Boolean(process.stdin.isTTY),
        });
        const result = yield* prune({
          namespace: config.namespace,
          stateRoot: config.stateRoot,
          repoRoot: config.repoRoot,
          selection: selection.success,
          force: input.flags.force === true,
          confirmation,
          onPreview: (plan) =>
            Effect.forEach(previewLines(plan), (line) => say(line), { discard: true }),
        }).pipe(
          Effect.provide(layers.build(config)),
          Effect.mapError((error) => {
            if (error instanceof PruneRefusedError) {
              const lines = error.refusals.map(
                (refusal) => `✗ prune refused: ${describePruneRefusal(refusal)}`,
              );
              return new PruneRefused({ message: lines.join("\n"), lines });
            }
            if (error instanceof LockConflictError) {
              const lines = error.message.split("\n").map((line) => `✗ prune refused: ${line}`);
              return new PruneLocked({ message: lines.join("\n"), lines });
            }
            const failed = `✗ prune failed: ${firstLine(error instanceof Error ? error.message : String(error))}`;
            return error instanceof RegistryCorruptionError
              ? new PruneRegistryError({ message: failed })
              : new PruneFailed({ message: failed });
          }),
        );
        switch (result.kind) {
          case "declined":
            return yield* Effect.fail(
              new PruneDeclined({ message: "✗ prune declined: nothing deleted." }),
            );
          case "confirmation-missing":
            return yield* Effect.fail(
              new PruneConfirmationMissing({
                message:
                  "✗ prune refused: no TTY to confirm; pass --yes to proceed or --dry-run to preview only",
              }),
            );
          case "nothing-to-prune":
            return {
              namespace: config.namespace,
              dryRun: false,
              runs: [],
              totals: { pruned: 0, kept: 0, bytesFreed: 0 },
            } satisfies PruneOutput;
          case "previewed":
            return planDocument(result.plan, true);
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
            } satisfies PruneOutput;
        }
      }).pipe(Effect.mapError(exposeMessage)),
    exits: {
      PruneConfigError: 1,
      PruneSelectionError: 1,
      PruneRefused: 1,
      PruneLocked: 7,
      PruneRegistryError: 10,
      PruneFailed: 1,
      PruneDeclined: 1,
      PruneConfirmationMissing: 1,
    },
    errors: {
      PruneConfigError: MessageFields,
      PruneSelectionError: MessageFields,
      PruneRefused: LinesFields,
      PruneLocked: LinesFields,
      PruneRegistryError: MessageFields,
      PruneFailed: MessageFields,
      PruneDeclined: MessageFields,
      PruneConfirmationMissing: MessageFields,
    },
    texts: {
      PruneConfigError: (error) => error.message,
      PruneSelectionError: (error) => error.message,
      PruneRefused: (error) => error.message,
      PruneLocked: (error) => error.message,
      PruneRegistryError: (error) => error.message,
      PruneFailed: (error) => error.message,
      PruneDeclined: (error) => error.message,
      PruneConfirmationMissing: (error) => error.message,
    },
    render: renderPrune,
  });
}

export const pruneCommand = makePruneCommand(REAL_PRUNE_LAYERS);
