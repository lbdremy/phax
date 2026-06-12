import { Effect, Either } from "effect";
import { join } from "node:path";
import type { RunReviewInfo } from "../domain/runReviewInfo.js";
import type { ResolvedPublishConfig } from "../schemas/phaxConfig.js";
import { selectPrTitle } from "../domain/publish/title.js";
import { buildPrBody } from "../domain/publish/body.js";
import type { PublicationRecord, PrStatus, PushStatus } from "../domain/publish/types.js";
import { encodePublication } from "../schemas/publication.js";
import type { RunId } from "../domain/branded.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { GitHub, type GitHubError } from "../ports/github.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import {
  makeAdapterCallStartedTelemetryEvent,
  makeAdapterCallSucceededTelemetryEvent,
  makeAdapterCallFailedTelemetryEvent,
  makeStepStartedTelemetryEvent,
  makeStepCompletedTelemetryEvent,
  makeArtifactGeneratedTelemetryEvent,
} from "../domain/telemetry/events.js";
import { writeFinalReport } from "./finalReport.js";

export type PublicationResultKind = "disabled" | "published" | "failed";

export interface PublicationResult {
  readonly kind: PublicationResultKind;
  readonly record?: PublicationRecord;
  readonly prUrl?: string;
  readonly failureReason?: string;
}

export interface PublishRunOpts {
  readonly repoRoot: string;
  readonly verbose?: boolean;
  readonly now?: () => string;
}

const REVIEW_HANDOFF_FILENAME = "review-handoff.md";
const PUBLICATION_FILENAME = "publication.json";
const PR_BODY_FILENAME = "pr-body.md";

function logVerbose(verbose: boolean, line: string): Effect.Effect<void, never, never> {
  if (!verbose) return Effect.void;
  return Effect.sync(() => {
    // eslint-disable-next-line no-console
    console.log(line);
  });
}

export function publishRun(
  info: RunReviewInfo,
  publish: ResolvedPublishConfig,
  opts: PublishRunOpts,
): Effect.Effect<PublicationResult, FsError, FileSystem | Git | GitHub | SystemTelemetry> {
  return Effect.gen(function* () {
    const verbose = opts.verbose ?? false;
    const now = opts.now ?? (() => new Date().toISOString());

    if (!publish.enabled) {
      return { kind: "disabled" } satisfies PublicationResult;
    }

    const fs = yield* FileSystem;
    const git = yield* Git;
    const github = yield* GitHub;
    const telemetry = yield* SystemTelemetry;

    const runId = info.runId as RunId;

    yield* telemetry.recordEvent(
      makeStepStartedTelemetryEvent({ runId, operationId: info.shortName, step: "publish.run" }),
    );

    yield* logVerbose(verbose, `Publishing branch to ${publish.remote}…`);

    const branchString = info.finalPhaseBranch as unknown as string;

    const writeRecordAndReport = (
      record: PublicationRecord,
    ): Effect.Effect<void, FsError, FileSystem> =>
      Effect.gen(function* () {
        const encoded = encodePublication({ version: 1, ...record });
        yield* fs.writeAtomic(
          join(info.runPath, PUBLICATION_FILENAME),
          JSON.stringify(encoded, null, 2) + "\n",
        );
        yield* writeFinalReport(info, record);
        yield* telemetry.recordEvent(
          makeArtifactGeneratedTelemetryEvent({
            runId,
            operationId: info.shortName,
            artifact: "publication.json",
            path: join(info.runPath, PUBLICATION_FILENAME),
          }),
        );
      });

    const baseRecord = {
      enabled: true,
      provider: publish.provider,
      remote: publish.remote,
      branch: branchString,
      createdAt: now(),
    } as const;

    const fail = (
      reason: string,
      pushStatus: PushStatus,
      prStatus: PrStatus,
      extras: { baseBranch?: string; pullRequestUrl?: string } = {},
    ): Effect.Effect<PublicationResult, FsError, FileSystem> =>
      Effect.gen(function* () {
        const record: PublicationRecord = {
          ...baseRecord,
          pushStatus,
          prStatus,
          ...(extras.baseBranch !== undefined ? { baseBranch: extras.baseBranch } : {}),
          ...(extras.pullRequestUrl !== undefined ? { pullRequestUrl: extras.pullRequestUrl } : {}),
          failureReason: reason,
        };
        yield* writeRecordAndReport(record);
        yield* logVerbose(verbose, `Publication failed: ${reason}`);
        yield* telemetry.recordEvent(
          makeStepCompletedTelemetryEvent({
            runId,
            operationId: info.shortName,
            step: "publish.run",
            result: "failure",
          }),
        );
        return {
          kind: "failed",
          record,
          failureReason: reason,
          ...(extras.pullRequestUrl !== undefined ? { prUrl: extras.pullRequestUrl } : {}),
        } satisfies PublicationResult;
      });

    // Preconditions

    const handoffPath = join(info.runPath, REVIEW_HANDOFF_FILENAME);
    const handoffExists = yield* fs.exists(handoffPath);
    if (!handoffExists) {
      return yield* fail(
        `Missing review handoff at "${handoffPath}"`,
        "not_attempted",
        "not_attempted",
      );
    }

    const branchExistsResult = yield* Effect.either(
      git.branchExists(info.finalPhaseBranch, opts.repoRoot),
    );
    if (Either.isLeft(branchExistsResult)) {
      return yield* fail(
        `Cannot inspect branch ${branchString}: ${branchExistsResult.left.message}`,
        "not_attempted",
        "not_attempted",
      );
    }
    if (!branchExistsResult.right) {
      return yield* fail(
        `Final phase branch ${branchString} does not exist`,
        "not_attempted",
        "not_attempted",
      );
    }

    const remoteExistsResult = yield* Effect.either(
      git.remoteExists(publish.remote, opts.repoRoot),
    );
    if (Either.isLeft(remoteExistsResult)) {
      return yield* fail(
        `Cannot inspect remote ${publish.remote}: ${remoteExistsResult.left.message}`,
        "not_attempted",
        "not_attempted",
      );
    }
    if (!remoteExistsResult.right) {
      return yield* fail(
        `Remote "${publish.remote}" is not configured`,
        "not_attempted",
        "not_attempted",
      );
    }

    const ghAvailableResult = yield* Effect.either(github.isAvailable());
    if (Either.isLeft(ghAvailableResult)) {
      return yield* fail(
        `gh availability check failed: ${ghAvailableResult.left.message}`,
        "not_attempted",
        "not_attempted",
      );
    }
    if (!ghAvailableResult.right) {
      return yield* fail(
        "GitHub CLI (gh) is not available on PATH",
        "not_attempted",
        "not_attempted",
      );
    }

    const ghAuthedResult = yield* Effect.either(github.isAuthenticated(opts.repoRoot));
    if (Either.isLeft(ghAuthedResult)) {
      return yield* fail(
        `gh authentication check failed: ${ghAuthedResult.left.message}`,
        "not_attempted",
        "not_attempted",
      );
    }
    if (!ghAuthedResult.right) {
      return yield* fail(
        "GitHub CLI (gh) is not authenticated. Run `gh auth login`.",
        "not_attempted",
        "not_attempted",
      );
    }

    const ghRepoResult = yield* Effect.either(github.repoRecognized(opts.repoRoot));
    if (Either.isLeft(ghRepoResult)) {
      return yield* fail(
        `gh repo check failed: ${ghRepoResult.left.message}`,
        "not_attempted",
        "not_attempted",
      );
    }
    if (!ghRepoResult.right) {
      return yield* fail(
        `GitHub CLI does not recognize the repository at "${opts.repoRoot}"`,
        "not_attempted",
        "not_attempted",
      );
    }

    // Push

    let pushStatus: PushStatus = "not_attempted";
    if (publish.pushBranch) {
      yield* telemetry.recordEvent(
        makeAdapterCallStartedTelemetryEvent({
          runId,
          operationId: info.shortName,
          adapter: "git",
          operation: "pushBranch",
        }),
      );
      const pushResult = yield* Effect.either(
        git.pushBranch(info.finalPhaseBranch, publish.remote, opts.repoRoot),
      );
      if (Either.isLeft(pushResult)) {
        yield* telemetry.recordEvent(
          makeAdapterCallFailedTelemetryEvent({
            runId,
            operationId: info.shortName,
            adapter: "git",
            operation: "pushBranch",
            exitCode: pushResult.left.exitCode ?? -1,
            stderrExcerpt: pushResult.left.stderrExcerpt ?? pushResult.left.stderr ?? "",
          }),
        );
        return yield* fail(
          `git push failed: ${pushResult.left.stderr ?? pushResult.left.message}`,
          "failed",
          "not_attempted",
        );
      }
      pushStatus = "pushed";
      yield* telemetry.recordEvent(
        makeAdapterCallSucceededTelemetryEvent({
          runId,
          operationId: info.shortName,
          adapter: "git",
          operation: "pushBranch",
        }),
      );
      yield* logVerbose(verbose, `Branch pushed: ${publish.remote}/${branchString}`);
    }

    if (!publish.createPullRequest) {
      const record: PublicationRecord = {
        ...baseRecord,
        pushStatus,
        prStatus: "not_attempted",
      };
      yield* writeRecordAndReport(record);
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: info.shortName,
          step: "publish.run",
          result: "success",
        }),
      );
      return { kind: "published", record } satisfies PublicationResult;
    }

    // Resolve base branch

    let baseBranch = publish.baseBranch;
    if (baseBranch === undefined) {
      const baseResult = yield* Effect.either(github.defaultBaseBranch(opts.repoRoot));
      if (Either.isLeft(baseResult)) {
        return yield* fail(
          `Could not resolve default base branch: ${baseResult.left.message}`,
          pushStatus,
          "not_attempted",
        );
      }
      baseBranch = baseResult.right;
    }

    // Reuse-or-create PR

    yield* logVerbose(verbose, "Creating GitHub pull request…");

    const existingResult = yield* Effect.either(
      github.findPullRequestForBranch(info.finalPhaseBranch, opts.repoRoot),
    );
    if (Either.isLeft(existingResult)) {
      return yield* fail(
        `Could not query existing pull request: ${existingResult.left.message}`,
        pushStatus,
        "failed",
        { baseBranch },
      );
    }

    const existingUrl = existingResult.right;
    if (existingUrl !== null) {
      const record: PublicationRecord = {
        ...baseRecord,
        baseBranch,
        pushStatus,
        prStatus: "exists",
        pullRequestUrl: existingUrl,
      };
      yield* writeRecordAndReport(record);
      yield* logVerbose(verbose, `Pull request already exists: ${existingUrl}`);
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: info.shortName,
          step: "publish.run",
          result: "success",
        }),
      );
      return { kind: "published", record, prUrl: existingUrl } satisfies PublicationResult;
    }

    const handoffReadResult = yield* Effect.either(fs.readText(handoffPath));
    if (Either.isLeft(handoffReadResult)) {
      return yield* fail(
        `Could not read review handoff: ${handoffReadResult.left.message}`,
        pushStatus,
        "failed",
        { baseBranch },
      );
    }

    const title = selectPrTitle({
      ...(publish.title !== undefined ? { configuredTitle: publish.title } : {}),
      ...(info.runTitle !== undefined ? { runTitle: info.runTitle } : {}),
      phaseTitle: info.finalPhaseTitle,
      shortName: info.shortName,
    });

    const built = buildPrBody({
      reviewHandoffMd: handoffReadResult.right,
      branch: branchString,
    });

    const bodyFile = join(info.runPath, PR_BODY_FILENAME);
    yield* fs.writeAtomic(bodyFile, built.body);

    yield* telemetry.recordEvent(
      makeAdapterCallStartedTelemetryEvent({
        runId,
        operationId: info.shortName,
        adapter: "github",
        operation: "createPullRequest",
      }),
    );

    const createResult = yield* Effect.either(
      github.createPullRequest({
        branch: info.finalPhaseBranch,
        base: baseBranch,
        title,
        bodyFile,
        repo: opts.repoRoot,
      }),
    );

    if (Either.isLeft(createResult)) {
      yield* telemetry.recordEvent(
        makeAdapterCallFailedTelemetryEvent({
          runId,
          operationId: info.shortName,
          adapter: "github",
          operation: "createPullRequest",
          exitCode: createResult.left.exitCode ?? -1,
          stderrExcerpt: createResult.left.stderr ?? "",
        }),
      );
      return yield* fail(
        `gh pr create failed: ${createResult.left.stderr ?? createResult.left.message}`,
        pushStatus,
        "failed",
        { baseBranch },
      );
    }

    yield* telemetry.recordEvent(
      makeAdapterCallSucceededTelemetryEvent({
        runId,
        operationId: info.shortName,
        adapter: "github",
        operation: "createPullRequest",
      }),
    );

    const prUrl = createResult.right;
    const record: PublicationRecord = {
      ...baseRecord,
      baseBranch,
      pushStatus,
      prStatus: "created",
      pullRequestUrl: prUrl,
    };
    yield* writeRecordAndReport(record);
    yield* logVerbose(verbose, `Pull request created: ${prUrl}`);
    yield* telemetry.recordEvent(
      makeStepCompletedTelemetryEvent({
        runId,
        operationId: info.shortName,
        step: "publish.run",
        result: "success",
      }),
    );

    return { kind: "published", record, prUrl } satisfies PublicationResult;
  });
}

// Re-export the GitError/GitHubError types so importers can attribute root causes.
export type { GitError, GitHubError };
