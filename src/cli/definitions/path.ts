// `phax path <short-name>` as the runner reads it: the run's worktree, with the qualified name
// and whether the run is another project's. Its text is what scripts read (`cd "$(phax path …)"`):
// the path alone, preceded by a `Target:` line when the run is another project's.
import { Data, Effect, Result } from "effect";
import * as Schema from "effect/Schema";
import { loadConfig } from "../../app/loadConfig.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { runKey } from "../../domain/runRef.js";
import { defineCommand, reject } from "../commandLibrary/contract/index.js";
import { exposeMessage, MessageFields, ShortNameArg } from "./shared.js";

/** The run reference was refused: the resolver's sentence. */
class RunRefError extends Data.TaggedError("RunRefError")<{ readonly message: string }> {}

/** The run has no worktree path recorded. */
class NoWorktreeError extends Data.TaggedError("NoWorktreeError")<{
  readonly message: string;
  readonly qualifiedName: string;
  readonly crossProject: boolean;
}> {}

const PathOutput = Schema.Struct({
  qualifiedName: Schema.String,
  crossProject: Schema.Boolean,
  worktreePath: Schema.String,
});

export const pathCommand = defineCommand({
  name: "path",
  summary: "Print the final worktree path (script-friendly, one line)",
  help: "Prints the absolute path to the final worktree on a single line. Useful in scripts: cd $(phax path my-run) or for piping to other tools. For a run in awaiting_review it prints the stopped phase's worktree.",
  examples: ["phax path usage-cli", "cd $(phax path usage-cli)"],
  input: { args: reject(Schema.Tuple([ShortNameArg])) },
  output: reject(PathOutput),
  run: ({ input }) =>
    Effect.gen(function* () {
      const configResult = loadConfig(process.cwd());
      const config = Result.isSuccess(configResult) ? configResult.success : undefined;
      const resolved = resolveRunRef(input.args[0], config, effectiveStateRoot(config));
      if (Result.isFailure(resolved)) {
        return yield* Effect.fail(new RunRefError({ message: resolved.failure.message }));
      }
      const { namespace, shortName, info, crossProject } = resolved.success;
      const qualifiedName = runKey(namespace, shortName);
      if (!info.worktreePath) {
        return yield* Effect.fail(
          new NoWorktreeError({
            message: `No worktree path found for run "${qualifiedName}".`,
            qualifiedName,
            crossProject,
          }),
        );
      }
      return { qualifiedName, crossProject, worktreePath: info.worktreePath };
    }).pipe(Effect.mapError(exposeMessage)),
  exits: { RunRefError: 1, NoWorktreeError: 1 },
  errors: {
    RunRefError: MessageFields,
    NoWorktreeError: Schema.Struct({
      message: Schema.String,
      qualifiedName: Schema.String,
      crossProject: Schema.Boolean,
    }),
  },
  texts: {
    RunRefError: (error) => error.message,
    // Another project's run is named on stdout before the refusal, as the render names it.
    NoWorktreeError: (error) =>
      error.crossProject
        ? { out: `Target: ${error.qualifiedName}`, err: error.message }
        : error.message,
  },
  render: (value) =>
    value.crossProject
      ? `Target: ${value.qualifiedName}\n${value.worktreePath}`
      : value.worktreePath,
});
