// `phax reset-phase <short-name> [phase-id]` as the runner reads it. Without --yes it previews
// what the reset would discard and takes no lock; with --yes (or -y) it archives the phase folder
// and removes its worktree and branch under the run lock. It never waits on a person, so it
// declares no `prompts`: under --json without --yes it answers its preview. The answer names the
// run, whether it is another project's, and the preview or the reset; its text is the `Target:`
// line of another project's run, then today's lines. A failure is a declared error with today's
// sentence: 7 for a held lock (its fields the run's short name and the holder's pid), 1 otherwise,
// its `Target:` line first on stdout when the run is another project's.
import { Data, Effect, Result, Layer } from "effect";
import * as Schema from "effect/Schema";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { previewResetPhase, resetPhase } from "../../app/resetPhase.js";
import { decodeShortName } from "../../domain/branded.js";
import { LockConflictError as DomainLockConflictError } from "../../domain/errors.js";
import { runKey } from "../../domain/runRef.js";
import { NodeGitLayer } from "../../infra/git.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { NodeShellLayer } from "../../infra/shell.js";
import type { FileSystem } from "../../ports/fs.js";
import type { Git } from "../../ports/git.js";
import type { Lock } from "../../ports/lock.js";
import type { Shell } from "../../ports/shell.js";
import type { SystemTelemetry } from "../../ports/systemTelemetry.js";
import type { ResolvedConfig } from "../../schemas/phaxConfig.js";
import { AliasAnnotationId, defineCommand, reject } from "../commandLibrary/contract/index.js";
import { configErrorText } from "../commands/reportConfigError.js";
import {
  makeGlobalTelemetryJournalLayerOrNoop,
  makeRepoRootedFileSystemLayer,
} from "../commands/runLayers.js";
import { configured, exposeMessage, MessageFields, ShortNameArg } from "./shared.js";

/** The layers a test swaps: the program instance gets the real ones. */
export interface ResetPhaseLayers {
  /** The services the preview and the reset read and write, for the repository's configuration. */
  readonly build?: (
    config: ResolvedConfig,
  ) => Layer.Layer<FileSystem | Git | Shell | SystemTelemetry>;
  /** The run lock the reset takes. */
  readonly lock?: (config: ResolvedConfig) => Layer.Layer<Lock>;
}

function realLayer(
  config: ResolvedConfig,
): Layer.Layer<FileSystem | Git | Shell | SystemTelemetry> {
  return Layer.mergeAll(
    makeRepoRootedFileSystemLayer(config),
    NodeGitLayer,
    NodeShellLayer,
    makeGlobalTelemetryJournalLayerOrNoop(),
  );
}

/** The configuration did not load: its lines. */
class ResetPhaseConfigError extends Data.TaggedError("ResetPhaseConfigError")<{
  readonly message: string;
}> {}

/** The run reference was refused: the resolver's sentence. */
class ResetPhaseRunRefError extends Data.TaggedError("ResetPhaseRunRefError")<{
  readonly message: string;
}> {}

/** The preview or the reset failed: `phax reset-phase failed: …`. */
class ResetPhaseFailedError extends Data.TaggedError("ResetPhaseFailedError")<{
  readonly message: string;
  readonly qualifiedName: string;
  readonly crossProject: boolean;
}> {}

/** Another process holds the run's lock: its short name and the holder's pid. */
class LockConflictError extends Data.TaggedError("LockConflictError")<{
  readonly message: string;
  readonly run: string;
  readonly pid: number;
  readonly qualifiedName: string;
  readonly crossProject: boolean;
}> {}

const ChangedPath = Schema.Struct({
  status: Schema.Literals(["A", "M", "D", "T"]),
  path: Schema.String,
});

const ResetPhaseOutcome = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("preview"),
    /** The phase id the call named, or null for the stuck phase. */
    requestedPhaseId: Schema.NullOr(Schema.String),
    phaseId: Schema.String,
    atStop: Schema.Boolean,
    phaseCommit: Schema.NullOr(Schema.String),
    corrections: Schema.Array(ChangedPath),
    personHandoff: Schema.NullOr(Schema.String),
    worktree: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("reset"),
    phaseId: Schema.String,
    archivedPath: Schema.NullOr(Schema.String),
    worktreeRemoved: Schema.Boolean,
    branchDeleted: Schema.Boolean,
    wasStopped: Schema.Boolean,
  }),
]);

const ResetPhaseOutput = Schema.Struct({
  qualifiedName: Schema.String,
  crossProject: Schema.Boolean,
  outcome: ResetPhaseOutcome,
});

type ResetPhaseOutput = typeof ResetPhaseOutput.Type;

const TargetedFields = Schema.Struct({
  message: Schema.String,
  qualifiedName: Schema.String,
  crossProject: Schema.Boolean,
});

/** An error's text: its sentence, after the `Target:` line of another project's run. */
function targeted(error: {
  readonly qualifiedName: string;
  readonly crossProject: boolean;
  readonly message: string;
}) {
  return error.crossProject
    ? { out: `Target: ${error.qualifiedName}`, err: error.message }
    : error.message;
}

/** Today's lines: the `Target:` line of another project's run, then the preview's or the reset's. */
function renderResetPhase(value: ResetPhaseOutput): string {
  const q = value.qualifiedName;
  const lines: string[] = value.crossProject ? [`Target: ${q}`] : [];
  const outcome = value.outcome;
  if (outcome.kind === "preview") {
    const phaseHint = outcome.requestedPhaseId !== null ? ` "${outcome.requestedPhaseId}"` : "";
    lines.push(
      `Would reset phase${phaseHint} of run "${q}". ` +
        `This archives the phase folder and removes its worktree and branch. ` +
        `Pass --yes to proceed.`,
    );
    if (outcome.atStop && outcome.phaseCommit !== null) {
      lines.push(
        `This discards ${outcome.phaseId}'s commit ${outcome.phaseCommit.slice(0, 7)} and ${outcome.corrections.length} uncommitted review corrections in ${outcome.worktree ?? "its worktree"}:`,
      );
      for (const change of outcome.corrections) lines.push(`  ${change.status} ${change.path}`);
      if (outcome.personHandoff !== null) {
        lines.push(`The reset also discards your handoff file: ${outcome.personHandoff}`);
      }
      lines.push(
        `phax resume ${q} will run ${outcome.phaseId} again from its start and hold it again.`,
      );
    } else if (outcome.atStop) {
      lines.push(
        outcome.corrections.length === 0
          ? `"${outcome.phaseId}" is the stopped phase; its worktree holds no uncommitted correction.`
          : `"${outcome.phaseId}" is the stopped phase; its worktree holds ${outcome.corrections.length} uncommitted correction(s) that the reset discards:`,
      );
      for (const change of outcome.corrections) lines.push(`  ${change.status} ${change.path}`);
      if (outcome.personHandoff !== null) {
        lines.push(`The reset also discards your handoff file: ${outcome.personHandoff}`);
      }
      lines.push(`phax resume ${q} will set the phase up again and stop there.`);
    }
    return lines.join("\n");
  }
  lines.push(`Phase "${outcome.phaseId}" of run "${q}" has been reset.`);
  if (outcome.archivedPath !== null) lines.push(`  Artifacts archived to: ${outcome.archivedPath}`);
  if (outcome.worktreeRemoved) lines.push(`  Worktree removed.`);
  if (outcome.branchDeleted) lines.push(`  Branch deleted.`);
  lines.push(
    outcome.wasStopped
      ? `Run is now resumable. \`phax resume ${q} --yes\` sets the phase up again and stops there.`
      : `Run is now resumable. Use \`phax resume ${q} --yes\` to re-run the phase.`,
  );
  return lines.join("\n");
}

const RESET_PHASE_HELP =
  "Resets a stuck or failed phase: its folder is archived, its worktree and branch are removed, and the run becomes resumable so phax resume starts the phase over. Without --yes it first previews what the reset would discard.\n\nA run in awaiting_review (stopped at a declared interactive phase or a held one) can reset only the stopped phase: the preview lists the uncommitted corrections in its worktree and the person's .phax-context/correction-handoff.md when it exists, the reset discards review-stop.json, and phax resume then runs the phase again from the start, first turn included. At a held stop the preview names the phase commit it discards, and the phase is held again when it commits. A phase of an acceptance pair whose closed stop ran the authored step is not reset once the pair's passing phase has started, like the acceptance phase itself: the passing phase judges the pair's latest authored commit. An earlier phase is committed work the stop sits on, and a later one has not started, so both are refused.\n\nThe reset takes the run lock: while a run, a resume or an enter-phase --new-session turn holds it, the reset is refused with exit 7 and nothing changes.";

export function makeResetPhaseCommand(layers: ResetPhaseLayers = {}) {
  const build = layers.build ?? realLayer;
  const lock = layers.lock ?? ((config: ResolvedConfig) => makeNodeLockLayer(config.stateRoot));
  return defineCommand({
    name: "reset-phase",
    summary: "Reset a stuck or failed phase so phax resume re-runs it from scratch",
    help: RESET_PHASE_HELP,
    examples: ["phax reset-phase usage-cli", "phax reset-phase usage-cli phase-02 --yes"],
    input: {
      args: reject(
        Schema.Tuple([
          ShortNameArg,
          Schema.optionalKey(
            Schema.String.annotate({
              identifier: "phase-id",
              description: "Phase identifier to reset, e.g. phase-02; defaults to the stuck phase",
            }),
          ),
        ]),
      ),
      flags: reject(
        Schema.Struct({
          yes: Schema.optionalKey(Schema.Boolean).annotateKey({
            description: "Proceed without confirmation (removes the worktree and branch)",
            [AliasAnnotationId]: "y",
          }),
        }),
      ),
    },
    output: reject(ResetPhaseOutput),
    run: ({ input }) =>
      Effect.gen(function* () {
        const [shortNameArg, phaseIdArg] = input.args;
        const config = yield* configured().pipe(
          Effect.mapError(
            (error) => new ResetPhaseConfigError({ message: configErrorText(error) }),
          ),
        );
        const resolved = resolveRunRef(shortNameArg, config, config.stateRoot);
        if (Result.isFailure(resolved)) {
          return yield* Effect.fail(
            new ResetPhaseRunRefError({ message: resolved.failure.message }),
          );
        }
        const { namespace, shortName: shortNameStr, crossProject } = resolved.success;
        const qualifiedName = runKey(namespace, shortNameStr);
        // Safe: resolveRunRef already validated the shortName via parseRunRef.
        const decoded = decodeShortName(shortNameStr);
        if (Result.isFailure(decoded)) {
          return yield* Effect.fail(
            new ResetPhaseFailedError({
              message: `Internal error: resolved shortName "${shortNameStr}" is invalid.`,
              qualifiedName,
              crossProject,
            }),
          );
        }
        const shortName = decoded.success;
        const options = {
          namespace,
          shortName,
          phaseId: phaseIdArg,
          stateRoot: config.stateRoot,
          repoRoot: config.repoRoot,
        };
        const failed = (error: unknown) =>
          error instanceof DomainLockConflictError
            ? new LockConflictError({
                message: `phax reset-phase failed: ${error.message}`,
                run: shortNameStr,
                pid: error.lockingPid,
                qualifiedName,
                crossProject,
              })
            : new ResetPhaseFailedError({
                message: `phax reset-phase failed: ${error instanceof Error ? error.message : String(error)}`,
                qualifiedName,
                crossProject,
              });

        if (input.flags.yes !== true) {
          const preview = yield* previewResetPhase(options).pipe(
            Effect.provide(build(config)),
            Effect.mapError(
              (error) =>
                new ResetPhaseFailedError({
                  message: `phax reset-phase failed: ${error.message}`,
                  qualifiedName,
                  crossProject,
                }),
            ),
          );
          const answer: ResetPhaseOutput = {
            qualifiedName,
            crossProject,
            outcome: {
              kind: "preview",
              requestedPhaseId: phaseIdArg ?? null,
              phaseId: preview.phaseId,
              atStop: preview.atStop,
              phaseCommit: preview.phaseCommit,
              corrections: preview.corrections.map((change) => ({
                status: change.status,
                path: change.path,
              })),
              personHandoff: preview.personHandoff,
              worktree: preview.worktree,
            },
          };
          return answer;
        }

        const reset = yield* resetPhase(options).pipe(
          Effect.provide(Layer.merge(build(config), lock(config))),
          Effect.mapError(failed),
        );
        const answer: ResetPhaseOutput = {
          qualifiedName,
          crossProject,
          outcome: {
            kind: "reset",
            phaseId: reset.phaseId,
            archivedPath: reset.archivedPath ?? null,
            worktreeRemoved: reset.worktreeRemoved,
            branchDeleted: reset.branchDeleted,
            wasStopped: reset.wasStopped,
          },
        };
        return answer;
      }).pipe(
        // A held lock's fields are the run, the holder's pid and the target, never its sentence.
        Effect.mapError((error) =>
          error instanceof LockConflictError ? error : exposeMessage(error),
        ),
      ),
    exits: {
      ResetPhaseConfigError: 1,
      ResetPhaseRunRefError: 1,
      ResetPhaseFailedError: 1,
      LockConflictError: 7,
    },
    errors: {
      ResetPhaseConfigError: MessageFields,
      ResetPhaseRunRefError: MessageFields,
      ResetPhaseFailedError: TargetedFields,
      LockConflictError: Schema.Struct({
        run: Schema.String,
        pid: Schema.Number,
        qualifiedName: Schema.String,
        crossProject: Schema.Boolean,
      }),
    },
    texts: {
      ResetPhaseConfigError: (error) => error.message,
      ResetPhaseRunRefError: (error) => error.message,
      ResetPhaseFailedError: (error) => targeted(error),
      LockConflictError: (error) => targeted(error),
    },
    render: renderResetPhase,
  });
}

export const resetPhaseCommand = makeResetPhaseCommand();
