// `phax publish-pr <short-name>` as the runner reads it: push the final branch of a review_open run
// and create (or reuse) its pull request. The answer names the run and the pull request's URL, null
// when the branch was pushed without opening one. It reports no written file: publication.json is
// phax's own state. Its failures are declared errors with exit 1, the `Target:` line of another
// project's run first on stdout, as it was printed before the publication began.
import { Effect, Result, Layer } from "effect";
import * as Schema from "effect/Schema";
import { publishRun } from "../../app/publishRun.js";
import { recordsClonePath } from "../../app/recordsSync.js";
import { runKey } from "../../domain/runRef.js";
import { NodeGitLayer } from "../../infra/git.js";
import { NodeGitHubLayer } from "../../infra/github.js";
import type { Git } from "../../ports/git.js";
import type { GitHub } from "../../ports/github.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import { defineCommand, reject } from "../commandLibrary/contract/index.js";
import { makeRepoRootedFileSystemLayer } from "../commands/runLayers.js";
import { readPackageVersion } from "../commands/usage.js";
import {
  notOpenSentence,
  ReviewFailedError,
  ReviewNotOpenError,
  reviewBaseErrors,
  reviewBaseExits,
  reviewBaseTexts,
  reviewConfigured,
  reviewResolved,
} from "./review.js";
import { outputPortOf } from "./runOutcome.js";
import { exposeMessage, ShortNameArg } from "./shared.js";

/** Layers a test swaps for fakes; each defaults to the real adapter. */
export interface PublishPrDeps {
  readonly gitLayer?: Layer.Layer<Git>;
  readonly githubLayer?: Layer.Layer<GitHub>;
}

const PublishPrOutput = Schema.Struct({
  qualifiedName: Schema.String,
  crossProject: Schema.Boolean,
  pullRequest: Schema.NullOr(Schema.String),
});

const PUBLISH_PR_HELP =
  "Pushes the final worktree branch to the GitHub remote and creates a pull request, or reuses an existing PR for the same branch. Requires a GitHub remote and gh CLI authentication.\n\nSide effects: git push to remote, GitHub API call to create or update a pull request.";

export function makePublishPrCommand(deps: PublishPrDeps = {}) {
  return defineCommand({
    name: "publish-pr",
    summary: "Push the final branch and create (or reuse) a GitHub PR for a review_open run",
    help: PUBLISH_PR_HELP,
    examples: ["phax publish-pr usage-cli"],
    input: { args: reject(Schema.Tuple([ShortNameArg])) },
    output: reject(PublishPrOutput),
    run: ({ input, program, say, progress }) =>
      Effect.gen(function* () {
        const config = yield* reviewConfigured();
        const { namespace, shortName, info, crossProject } = yield* reviewResolved(
          input.args[0],
          config,
          config.stateRoot,
        );
        const qualifiedName = runKey(namespace, shortName);
        if (info.runState !== "review_open") {
          return yield* Effect.fail(
            new ReviewNotOpenError({
              message: notOpenSentence(qualifiedName, "publish-pr", info),
              qualifiedName,
              crossProject,
            }),
          );
        }
        const verbose = program["verbose"];
        const published = yield* Effect.result(
          publishRun(info, config.publish, {
            repoRoot: config.repoRoot,
            phaxVersion: readPackageVersion(),
            output: outputPortOf({ say, progress }),
            records: config.records,
            ...(config.records.destination.kind === "repo"
              ? { recordsClonePath: recordsClonePath(config.stateRoot, namespace) }
              : {}),
            ...(typeof verbose === "boolean" ? { verbose } : {}),
          }).pipe(
            Effect.provide(
              Layer.mergeAll(
                makeRepoRootedFileSystemLayer(config),
                deps.gitLayer ?? NodeGitLayer,
                deps.githubLayer ?? NodeGitHubLayer,
                NoopSystemTelemetryLayer,
              ),
            ),
          ),
        );
        if (Result.isFailure(published)) {
          return yield* Effect.fail(
            new ReviewFailedError({
              message: `Unexpected error during publication: ${published.failure.message}`,
              qualifiedName,
              crossProject,
            }),
          );
        }
        const publication = published.success;
        if (publication.kind === "failed") {
          return yield* Effect.fail(
            new ReviewFailedError({
              message:
                `Publication failed: ${publication.failureReason ?? "unknown error"}. ` +
                `To retry, run: phax publish-pr ${qualifiedName}`,
              qualifiedName,
              crossProject,
            }),
          );
        }
        return { qualifiedName, crossProject, pullRequest: publication.prUrl ?? null };
      }).pipe(Effect.mapError(exposeMessage)),
    exits: reviewBaseExits,
    errors: reviewBaseErrors,
    texts: reviewBaseTexts,
    render: (value) =>
      [
        ...(value.crossProject ? [`Target: ${value.qualifiedName}`] : []),
        value.pullRequest === null
          ? `Run "${value.qualifiedName}" published (branch pushed, no PR created).`
          : `Pull request: ${value.pullRequest}`,
      ].join("\n"),
  });
}

/** The command as the program declares it: real adapters. */
export const publishPrCommand = makePublishPrCommand();
