// `phax archive <short-name>` as the runner reads it: archive a run that is not running, with
// `--force` for an unfinished one. The answer names the run and whether it is another project's;
// its text is the `Target:` line of another project's run, then the success sentence. A refusal
// or a failure of the use case is a declared error with exit 1, its text preceded on stdout by the
// `Target:` line when the run is another project's, as it was printed before the archive began.
import { Data, Effect, Either, Layer } from "effect";
import * as Schema from "effect/Schema";
import { archive } from "../../app/archive.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { decodeShortName } from "../../domain/branded.js";
import { ArchiveRefusedError } from "../../domain/errors.js";
import { runKey } from "../../domain/runRef.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { NodeShellLayer } from "../../infra/shell.js";
import { defineCommand, reject } from "../commandLibrary/contract/index.js";
import {
  makeGlobalTelemetryJournalLayerOrNoop,
  makeRepoRootedFileSystemLayer,
} from "../commands/runLayers.js";
import { configured, exposeMessage, MessageFields, ShortNameArg } from "./shared.js";

/** The configuration did not load. */
class ArchiveConfigError extends Data.TaggedError("ArchiveConfigError")<{
  readonly message: string;
}> {}

/** The run reference was refused: the resolver's sentence. */
class ArchiveRunRefError extends Data.TaggedError("ArchiveRunRefError")<{
  readonly message: string;
}> {}

/** The run may not be archived now: the use case's refusal. */
class ArchiveRefused extends Data.TaggedError("ArchiveRefused")<{
  readonly message: string;
  readonly qualifiedName: string;
  readonly crossProject: boolean;
}> {}

/** The archive failed: the use case's error. */
class ArchiveFailed extends Data.TaggedError("ArchiveFailed")<{
  readonly message: string;
  readonly qualifiedName: string;
  readonly crossProject: boolean;
}> {}

const ArchiveOutput = Schema.Struct({
  qualifiedName: Schema.String,
  crossProject: Schema.Boolean,
});

const TargetedFields = Schema.Struct({
  message: Schema.String,
  qualifiedName: Schema.String,
  crossProject: Schema.Boolean,
});

/** An error's text: its sentence, after the `Target:` line of another project's run. */
function targeted(error: ArchiveRefused | ArchiveFailed, sentence: string) {
  return error.crossProject ? { out: `Target: ${error.qualifiedName}`, err: sentence } : sentence;
}

export const archiveCommand = defineCommand({
  name: "archive",
  summary: "Archive a run that is not running; --force is required for an unfinished run",
  help: "Archives a run by moving its worktrees under ~/.phax/archive/<namespace>.<short-name>/ and marking it archived in the registry. Nothing is destructively deleted — every phase's working state is preserved.\n\nFinished runs (review_open, completed) archive by default. Unfinished runs (created, failed, interrupted, rate_limited, stopped, awaiting_review) are refused unless --force is set; the refusal message names the run's current state and the flag. Archiving a run in awaiting_review with --force removes its review-stop.json and moves its worktrees, uncommitted corrections included, to the archive. Running, locked, and already-archived runs are never archivable regardless of --force.\n\nThe run's stoppedReason and lastError survive archival intact.\n\nWithout --force on a finished run, the final worktree must be clean. With --force, no cleanliness check runs.\n\nSide effects: moves worktrees on the filesystem, updates ~/.phax/runs/.",
  examples: [
    "phax archive usage-cli",
    "phax archive usage-cli --force",
    "phax archive plan-27 --force  # give up an interrupted run",
  ],
  input: {
    args: reject(Schema.Tuple(ShortNameArg)),
    flags: reject(
      Schema.Struct({
        force: Schema.optionalWith(
          Schema.Boolean.annotations({
            description:
              "Archive even if the run is unfinished or a worktree has uncommitted changes",
          }),
          { exact: true },
        ),
      }),
    ),
  },
  output: reject(ArchiveOutput),
  run: ({ input }) =>
    Effect.gen(function* () {
      const config = yield* configured().pipe(
        Effect.mapError(
          (error) => new ArchiveConfigError({ message: `Config error: ${error.message}` }),
        ),
      );
      const resolved = resolveRunRef(input.args[0], config, config.stateRoot);
      if (Either.isLeft(resolved)) {
        return yield* Effect.fail(new ArchiveRunRefError({ message: resolved.left.message }));
      }
      const { namespace, shortName, crossProject } = resolved.right;
      const qualifiedName = runKey(namespace, shortName);
      const decoded = decodeShortName(shortName);
      if (Either.isLeft(decoded)) {
        return yield* Effect.die(`Internal error: resolved shortName "${shortName}" is invalid.`);
      }
      const options = input.flags.force === true ? { force: true } : {};
      yield* archive(namespace, decoded.right, config.stateRoot, config.repoRoot, options).pipe(
        Effect.provide(
          Layer.mergeAll(
            makeRepoRootedFileSystemLayer(config),
            makeNodeGitLayer(),
            makeNodeLockLayer(config.stateRoot),
            NodeShellLayer,
            makeGlobalTelemetryJournalLayerOrNoop(),
          ),
        ),
        Effect.mapError((error) =>
          error instanceof ArchiveRefusedError
            ? new ArchiveRefused({
                message: `Archive refused: ${error.message}`,
                qualifiedName,
                crossProject,
              })
            : new ArchiveFailed({
                message: `Archive failed: ${error.message}`,
                qualifiedName,
                crossProject,
              }),
        ),
      );
      return { qualifiedName, crossProject };
    }).pipe(Effect.mapError(exposeMessage)),
  exits: { ArchiveConfigError: 1, ArchiveRunRefError: 1, ArchiveRefused: 1, ArchiveFailed: 1 },
  errors: {
    ArchiveConfigError: MessageFields,
    ArchiveRunRefError: MessageFields,
    ArchiveRefused: TargetedFields,
    ArchiveFailed: TargetedFields,
  },
  texts: {
    ArchiveConfigError: (error) => error.message,
    ArchiveRunRefError: (error) => error.message,
    ArchiveRefused: (error) => targeted(error, error.message),
    ArchiveFailed: (error) => targeted(error, error.message),
  },
  render: (value) =>
    value.crossProject
      ? `Target: ${value.qualifiedName}\nRun "${value.qualifiedName}" archived successfully.`
      : `Run "${value.qualifiedName}" archived successfully.`,
});
