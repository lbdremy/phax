import { Effect, Either } from "effect";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RunReviewInfo } from "../domain/runReviewInfo.js";
import { runKey } from "../domain/runRef.js";
import { isPhaseTerminal } from "../domain/state.js";
import { COMPLIANCE_REVIEW_JSON_FILENAME } from "../domain/review/compliancePrompt.js";
import type { ResolvedPublishConfig } from "../schemas/phaxConfig.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import { CODE_REVIEW_JSON_FILENAME } from "../schemas/codeReview.js";
import {
  readCodeReviewFile,
  readComplianceReviewFile,
  readRunStatusFile,
} from "../schemas/persisted.js";
import { selectPrTitle } from "../domain/publish/title.js";
import { buildShortPrBody, type ShortPrBodyInput } from "../domain/publish/prBody.js";
import {
  groupAgents,
  locateAtHead,
  permalink,
  type PrAgentGroup,
  type PrPlanRef,
  type PrSpecRef,
} from "../domain/publish/prFooter.js";
import { archivePathFor, classifyArtifactPath } from "../domain/artifact/document.js";
import { readSourceSpec } from "../domain/artifact/lineage.js";
import { decodePhaseAgentBinding } from "../schemas/phaseAgentBinding.js";
import type { PublicationRecord, PrStatus, PushStatus } from "../domain/publish/types.js";
import { encodePublication } from "../schemas/publication.js";
import type { RunId } from "../domain/branded.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { GitHub, type GitHubError } from "../ports/github.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import { pushRecordsBranch } from "./recordsSync.js";
import {
  makeAdapterCallStartedTelemetryEvent,
  makeAdapterCallSucceededTelemetryEvent,
  makeAdapterCallFailedTelemetryEvent,
  makeStepStartedTelemetryEvent,
  makeStepCompletedTelemetryEvent,
  makeArtifactGeneratedTelemetryEvent,
} from "../domain/telemetry/events.js";
import { writeFinalReport } from "./finalReport.js";
import { aggregateVerifiedSurfaces } from "./gateAttribution.js";
import { loadReviewedPhases, loadReviewHandoffInputs } from "./loadReviewHandoffInputs.js";

export type PublicationResultKind = "published" | "failed";

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
  /** Absent means records are not in play for this call — no push is attempted. */
  readonly records?: ResolvedRecordsConfig | undefined;
  /** The local records clone's path; required only when `records.destination.kind === "repo"`. */
  readonly recordsClonePath?: string | undefined;
  /** The home directory the PR body writes as `~`; defaults to `homedir()`, so tests can pin the rewrite. */
  readonly homeDir?: string;
  /** The phax version the pull request footer names; the CLI reads it from package.json. */
  readonly phaxVersion: string;
}

const REVIEW_HANDOFF_FILENAME = "review-handoff.md";
const RUN_STATUS_FILENAME = "run-status.json";
const PUBLICATION_FILENAME = "publication.json";
const PR_BODY_FILENAME = "pr-body.md";
const PLAN_COPY_FILENAME = "plan.md";
const AGENT_BINDING_FILENAME = "agent-binding.json";

// The plan path run-status.json records, or null for a loose plan.
function loadRecordedPlanPath(
  runPath: string,
): Effect.Effect<string | null, { readonly message: string }, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = join(runPath, RUN_STATUS_FILENAME);
    const raw = yield* fs.readText(path);
    const parsed = yield* Effect.try(() => JSON.parse(raw) as unknown);
    const status = yield* readRunStatusFile(path, parsed);
    return status.planRepoRelPath ?? null;
  });
}

// What the footer links against: the final phase branch's head commit, the
// paths of its tree and the repository's web URL. Each is null when its
// lookup fails, so a footer lookup never fails a publish. The web URL is also
// null when this publish did not push the branch (`publish.pushBranch: false`):
// the host may not hold that commit, so a permalink to it could be dead.
interface HeadFacts {
  readonly sha: string | null;
  readonly headPaths: ReadonlySet<string> | null;
  readonly webUrl: string | null;
}

function loadHeadFacts(
  info: RunReviewInfo,
  repoRoot: string,
  pushStatus: PushStatus,
): Effect.Effect<HeadFacts, never, Git | GitHub> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const github = yield* GitHub;
    // The full ref name, so a tag named like the branch is never picked.
    const sha = yield* git
      .resolveRef(repoRoot, `refs/heads/${info.finalPhaseBranch}`)
      .pipe(Effect.orElseSucceed(() => null));
    const headPaths =
      sha === null
        ? null
        : yield* git.readTree(repoRoot, sha).pipe(
            Effect.map((entries): ReadonlySet<string> => new Set(entries.map((e) => e.path))),
            Effect.orElseSucceed(() => null),
          );
    const webUrl =
      pushStatus === "pushed"
        ? yield* github.repoWebUrl(repoRoot).pipe(Effect.orElseSucceed(() => null))
        : null;
    return { sha, headPaths, webUrl };
  });
}

// A path located at the head commit, linked when the sha and web URL are known.
function locatedRef(
  path: string,
  head: HeadFacts,
):
  | { readonly kind: "permalink"; readonly path: string; readonly url: string }
  | { readonly kind: "path"; readonly path: string } {
  return head.sha !== null && head.webUrl !== null
    ? { kind: "permalink", path, url: permalink(head.webUrl, head.sha, path) }
    : { kind: "path", path };
}

// The plan where it lives at the head commit. Run completion moves a
// lifecycle plan to archive/ before review opens, so a plan found nowhere
// (or an unreadable head) is named at its archive counterpart.
function planRefAtHead(recorded: string | null, head: HeadFacts): PrPlanRef {
  if (recorded === null) return { kind: "unrecorded" };
  if (classifyArtifactPath(recorded) === null) return { kind: "path", path: recorded };
  const located = head.headPaths === null ? null : locateAtHead(recorded, head.headPaths);
  return located === null
    ? { kind: "path", path: archivePathFor(recorded) }
    : locatedRef(located, head);
}

// The source spec the run's plan.md copy declares, where it lives at the
// head commit; none when the copy is unreadable, declares none, or the spec
// is in neither place.
function loadSpecRef(
  runPath: string,
  head: HeadFacts,
): Effect.Effect<PrSpecRef, never, FileSystem> {
  const none: PrSpecRef = { kind: "none" };
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const md = yield* fs.readText(join(runPath, PLAN_COPY_FILENAME));
    const declared = readSourceSpec(md);
    if (declared === null || declared.kind === "none" || head.headPaths === null) return none;
    const located = locateAtHead(declared.path, head.headPaths);
    return located === null ? none : locatedRef(located, head);
  }).pipe(Effect.orElseSucceed(() => none));
}

// The agent each passed phase ran with, in plan order, grouped. A phase
// without a decodable agent-binding.json (an interactive one) is left out.
function loadAgentGroups(
  runPath: string,
  phaseIds: readonly string[],
): Effect.Effect<PrAgentGroup[], never, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const bindings: Array<{ provider: string; model: string; effort: string }> = [];
    for (const phaseId of phaseIds) {
      const binding = yield* fs.readText(join(runPath, phaseId, AGENT_BINDING_FILENAME)).pipe(
        Effect.flatMap((raw) => Effect.try(() => JSON.parse(raw) as unknown)),
        Effect.map((parsed) => Either.getOrNull(decodePhaseAgentBinding(parsed))),
        Effect.orElseSucceed(() => null),
      );
      if (binding !== null) {
        bindings.push({ provider: binding.provider, model: binding.model, effort: binding.effort });
      }
    }
    return groupAgents(bindings);
  });
}

// The run's compliance review; an absent or undecodable file reads as not
// reviewed, so a review artifact never fails a publish.
function loadCompliance(
  runPath: string,
): Effect.Effect<ShortPrBodyInput["compliance"], never, FileSystem> {
  const notReviewed: ShortPrBodyInput["compliance"] = { kind: "not-reviewed" };
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = join(runPath, COMPLIANCE_REVIEW_JSON_FILENAME);
    if (!(yield* fs.exists(path))) return notReviewed;
    const raw = yield* fs.readText(path);
    const parsed = yield* Effect.try(() => JSON.parse(raw) as unknown);
    // Only the fields every shape carries: the ledgers are not read here.
    const { review } = yield* readComplianceReviewFile(path, parsed);
    return { kind: "reviewed", review } as const;
  }).pipe(Effect.orElseSucceed(() => notReviewed));
}

// The run's code review; an absent or undecodable file reads as not
// reviewed, so a review artifact never fails a publish.
function loadCodeReview(
  runPath: string,
): Effect.Effect<ShortPrBodyInput["codeReview"], never, FileSystem> {
  const notReviewed: ShortPrBodyInput["codeReview"] = { kind: "not-reviewed" };
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = join(runPath, CODE_REVIEW_JSON_FILENAME);
    if (!(yield* fs.exists(path))) return notReviewed;
    const raw = yield* fs.readText(path);
    const parsed = yield* Effect.try(() => JSON.parse(raw) as unknown);
    const review = yield* readCodeReviewFile(path, parsed);
    return { kind: "reviewed", review } as const;
  }).pipe(Effect.orElseSucceed(() => notReviewed));
}

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

    // Records mirror the work rather than lead it (spec §5.8): the record is
    // already committed locally when its phase commits, so publish adds
    // sharing only. A no-op when records opts weren't supplied, and never
    // fails — a rejected or unreachable push just leaves the records pending
    // (`phax records status`), it must never fail an otherwise-successful
    // publish.
    const pushRecordsIfConfigured = (): Effect.Effect<void, never, Git> =>
      Effect.gen(function* () {
        if (opts.records === undefined) return;
        const result = yield* pushRecordsBranch({
          records: opts.records,
          repoRoot: opts.repoRoot,
          publishRemote: publish.remote,
          ...(opts.recordsClonePath !== undefined
            ? { recordsClonePath: opts.recordsClonePath }
            : {}),
        });
        if (result.kind === "pushed") {
          yield* logVerbose(verbose, `Records pushed to ${result.remote}.`);
        } else if (result.kind === "failed") {
          yield* logVerbose(
            verbose,
            `Records push to ${result.remote} failed: ${result.message} — records remain pending (see \`phax records status\`).`,
          );
        }
      });

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
      yield* pushRecordsIfConfigured();
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
      yield* pushRecordsIfConfigured();
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

    const loadResult = yield* Effect.either(loadReviewHandoffInputs(info));
    if (Either.isLeft(loadResult)) {
      return yield* fail(
        `Could not load review handoff inputs: ${loadResult.left.message}`,
        pushStatus,
        "failed",
        { baseBranch },
      );
    }
    const { global, phaseContents, sourceSpecOutcomeMd, reviewNoteGroups } = loadResult.right;

    const planResult = yield* Effect.either(loadRecordedPlanPath(info.runPath));
    if (Either.isLeft(planResult)) {
      return yield* fail(
        `Could not load run status: ${planResult.left.message}`,
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

    const reviewedPhases = yield* loadReviewedPhases(info);
    const orderedPhases = info.phaseStatuses.toSorted((a, b) => a.phaseIndex - b.phaseIndex);
    const phases = orderedPhases.map((p) => ({
      phaseId: p.phaseId,
      title: info.planPhases.find((pp) => pp.id === p.phaseId)?.title ?? p.phaseId,
      status:
        p.state === "skipped"
          ? ("skipped" as const)
          : isPhaseTerminal(p.state)
            ? ("passed" as const)
            : ("unfinished" as const),
      stop: reviewedPhases.find((r) => r.reviewed.phaseId === p.phaseId)?.reviewed ?? null,
    }));
    const verifiedSurfaces = yield* aggregateVerifiedSurfaces(
      info.runPath,
      orderedPhases.map((p) => p.phaseId),
    );
    const compliance = yield* loadCompliance(info.runPath);
    const codeReview = yield* loadCodeReview(info.runPath);

    // The footer's facts, gathered only for a new pull request: a reused one
    // keeps its body, so it needs no lookup.
    const qualifiedName = runKey(info.namespace, info.shortName);
    const head = yield* loadHeadFacts(info, opts.repoRoot, pushStatus);
    const footer = {
      version: opts.phaxVersion,
      plan: planRefAtHead(planResult.right, head),
      spec: yield* loadSpecRef(info.runPath, head),
      agents: yield* loadAgentGroups(
        info.runPath,
        phases.filter((p) => p.status === "passed").map((p) => p.phaseId),
      ),
      qualifiedName,
    };

    const built = buildShortPrBody({
      qualifiedName,
      shortName: info.shortName,
      footer,
      sourceSpecOutcome: sourceSpecOutcomeMd,
      gateProfileId: info.gateProfileId,
      phases,
      verifiedSurfaces,
      compliance,
      codeReview,
      global,
      phaseHandoffs: phaseContents.map((p) => ({
        phaseId: p.phaseId,
        handoffMd: p.phaseHandoffMd,
      })),
      reviewNoteGroups,
      runFolder: { path: info.runPath, homeDir: opts.homeDir ?? homedir() },
      records: opts.records?.enabled === true ? "configured" : "not-configured",
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
    yield* pushRecordsIfConfigured();
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
