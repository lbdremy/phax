// `phax review-handoff`, `review-compliance` and `review-code` as the runner reads them. Each takes
// a run's short name and answers one object; its text is today's, with the `Target:` line of
// another project's run first. A refusal or a failure after the run is resolved is a declared
// error whose text form puts that `Target:` line on stdout before the sentence on stderr, as it was
// printed before the work began. review-handoff and the two review commands list the files they
// wrote on this call. review-code opens an interactive session unless `--headless`: it prompts, so
// `--json` refuses it before anything is read, and the session's exit is the command's exit.
import { join } from "node:path";
import { Data, Effect, Result, Layer } from "effect";
import * as Schema from "effect/Schema";
import { loadModelRouting, loadProviderConfig } from "../../app/loadRouting.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { prepareCodeReviewSession, reviewCodeAndRecord } from "../../app/reviewCode.js";
import { reviewComplianceAndRecord } from "../../app/reviewCompliance.js";
import {
  reviewEntryNotice,
  reviewEntryWarnings,
  reviewRecordTargetFor,
} from "../../app/reviewEntry.js";
import { generateReviewHandoff } from "../../app/reviewHandoff.js";
import { ReviewHandoffArtifactMissingError } from "../../domain/errors.js";
import {
  COMPLIANCE_EARLIER_REVIEW_KEPT,
  complianceFailureReason,
} from "../../domain/review/complianceRetry.js";
import {
  codeReviewFixHint,
  describeFindingCounts,
} from "../../domain/review/codeReviewFindings.js";
import { resolveModel } from "../../domain/routing/resolve.js";
import { runKey } from "../../domain/runRef.js";
import type { RunReviewInfo } from "../../domain/runReviewInfo.js";
import { sessionFailureError } from "../../domain/session/failureError.js";
import { PHAX_REVIEW_SKILL } from "../../domain/skills/catalog.js";
import { NodeGitLayer } from "../../infra/git.js";
import { NodeGitHubLayer } from "../../infra/github.js";
import { makeNodeSessionLayer } from "../../infra/session.js";
import type { Backend } from "../../ports/backend.js";
import { FileSystem } from "../../ports/fs.js";
import type { Git } from "../../ports/git.js";
import type { GitHub } from "../../ports/github.js";
import { Session } from "../../ports/session.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import type { ResolvedCodeReviewConfig, ResolvedConfig } from "../../schemas/phaxConfig.js";
import { defineCommand, reject, Written } from "../commandLibrary/contract/index.js";
import {
  makeGlobalTelemetryJournalLayerOrNoop,
  makeProviderBackendLayer,
  makeRepoRootedFileSystemLayer,
} from "../commands/runLayers.js";
import { isSessionFailureError, renderSessionFailure } from "../commands/sessionFailureOutput.js";
import { defaultBundleRoot } from "./skills.js";
import {
  configured,
  exposeMessage,
  MessageFields,
  ShortNameArg,
  writtenRecords,
} from "./shared.js";

// ── What the review and publication commands share ──────────────────────────────

/** The configuration did not load. */
export class ReviewConfigError extends Data.TaggedError("ReviewConfigError")<{
  readonly message: string;
}> {}

/** The run reference was refused: the resolver's sentence. */
export class ReviewRunRefError extends Data.TaggedError("ReviewRunRefError")<{
  readonly message: string;
}> {}

/** The run is not in review_open. */
export class ReviewNotOpenError extends Data.TaggedError("ReviewNotOpenError")<{
  readonly message: string;
  readonly qualifiedName: string;
  readonly crossProject: boolean;
}> {}

/** The command failed after the run was resolved: its sentence. */
export class ReviewFailedError extends Data.TaggedError("ReviewFailedError")<{
  readonly message: string;
  readonly qualifiedName: string;
  readonly crossProject: boolean;
}> {}

/** The fields of an error raised after the run was resolved. */
const TargetedFields = Schema.Struct({
  message: Schema.String,
  qualifiedName: Schema.String,
  crossProject: Schema.Boolean,
});

/** An error's text: its sentence, after the `Target:` line of another project's run. */
function targeted(
  error: { readonly qualifiedName: string; readonly crossProject: boolean },
  sentence: string,
) {
  return error.crossProject ? { out: `Target: ${error.qualifiedName}`, err: sentence } : sentence;
}

/** The configuration of the invocation directory, or `ReviewConfigError`. */
export function reviewConfigured() {
  return configured().pipe(
    Effect.mapError(
      (error) => new ReviewConfigError({ message: `Config error: ${error.message}` }),
    ),
  );
}

/** A run reference resolved, or `ReviewRunRefError` with the resolver's sentence. */
export function reviewResolved(ref: string, config: ResolvedConfig, stateRoot: string) {
  const resolved = resolveRunRef(ref, config, stateRoot);
  return Result.isFailure(resolved)
    ? Effect.fail(new ReviewRunRefError({ message: resolved.left.message }))
    : Effect.succeed(resolved.right);
}

/** The refusal of a run that is not in review_open, naming the command. */
export function notOpenSentence(
  name: string,
  command: string,
  info: { readonly runState: string },
): string {
  return (
    `Run "${name}" is in state "${info.runState}", not "review_open". ` +
    `The ${command} command only operates on runs in review_open state.`
  );
}

/** The fields and sentences of the errors every one of these commands declares. */
export const reviewBaseExits = {
  ReviewConfigError: 1,
  ReviewRunRefError: 1,
  ReviewNotOpenError: 1,
  ReviewFailedError: 1,
} as const;

export const reviewBaseErrors = {
  ReviewConfigError: MessageFields,
  ReviewRunRefError: MessageFields,
  ReviewNotOpenError: TargetedFields,
  ReviewFailedError: TargetedFields,
} as const;

export const reviewBaseTexts = {
  ReviewConfigError: (error: ReviewConfigError) => error.message,
  ReviewRunRefError: (error: ReviewRunRefError) => error.message,
  ReviewNotOpenError: (error: ReviewNotOpenError) => targeted(error, error.message),
  ReviewFailedError: (error: ReviewFailedError) => targeted(error, error.message),
} as const;

/** A review session that failed: the lines a person reads on stderr (the failure, the session, the
 *  files to read, the retry), and the run it concerns. */
const SessionFailureFields = Schema.Struct({
  message: Schema.String,
  lines: Schema.Array(Schema.String),
  qualifiedName: Schema.String,
  crossProject: Schema.Boolean,
});

/** Exit 1: the review's agent session failed. */
class ReviewSessionFailedError extends Data.TaggedError("ReviewSessionFailedError")<{
  readonly message: string;
  readonly lines: ReadonlyArray<string>;
  readonly qualifiedName: string;
  readonly crossProject: boolean;
}> {}

/** Exit 14: the provider was unreachable (a network failure). */
class ReviewProviderUnreachableError extends Data.TaggedError("ReviewProviderUnreachableError")<{
  readonly message: string;
  readonly lines: ReadonlyArray<string>;
  readonly qualifiedName: string;
  readonly crossProject: boolean;
}> {}

const sessionLinesText = (error: { readonly lines: ReadonlyArray<string> }): string =>
  error.lines.join("\n");

/** The error of a review whose session failed: 14 for a network failure, else 1. */
function sessionFailed(
  network: boolean,
  call: {
    readonly lines: ReadonlyArray<string>;
    readonly qualifiedName: string;
    readonly crossProject: boolean;
  },
): ReviewSessionFailedError | ReviewProviderUnreachableError {
  const fields = { ...call, message: call.lines[0] ?? "" };
  return network
    ? new ReviewProviderUnreachableError(fields)
    : new ReviewSessionFailedError(fields);
}

const sessionExits = { ReviewSessionFailedError: 1, ReviewProviderUnreachableError: 14 } as const;

const sessionErrors = {
  ReviewSessionFailedError: SessionFailureFields,
  ReviewProviderUnreachableError: SessionFailureFields,
} as const;

const sessionTexts = {
  ReviewSessionFailedError: (error: ReviewSessionFailedError) =>
    targeted(error, sessionLinesText(error)),
  ReviewProviderUnreachableError: (error: ReviewProviderUnreachableError) =>
    targeted(error, sessionLinesText(error)),
} as const;

/** The lines of text a render writes: the `Target:` line of another project's run, then these. */
const withTarget = (
  value: { readonly qualifiedName: string; readonly crossProject: boolean },
  lines: ReadonlyArray<string>,
): string => (value.crossProject ? [`Target: ${value.qualifiedName}`, ...lines] : lines).join("\n");

const nullable = <S extends Schema.Schema.Any>(schema: S) => Schema.NullOr(schema);

// ── review-handoff ──────────────────────────────────────────────────────────────

const ReviewHandoffOutput = Schema.Struct({
  qualifiedName: Schema.String,
  crossProject: Schema.Boolean,
  reviewHandoff: Schema.String,
  written: Schema.Array(Written),
});

export function makeReviewHandoffCommand() {
  return defineCommand({
    name: "review-handoff",
    summary: "Regenerate review-handoff.md and global file reconciliation for a review_open run",
    input: {
      args: reject(Schema.Tuple(ShortNameArg)),
      flags: reject(
        Schema.Struct({
          allowPartial: Schema.optionalKey(
            Schema.Boolean.annotations({
              description: "Generate a partial document when some phase artifacts are missing",
            }),
          ),
        }),
      ),
    },
    output: reject(ReviewHandoffOutput),
    run: ({ input }) =>
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
              message: notOpenSentence(qualifiedName, "review-handoff", info),
              qualifiedName,
              crossProject,
            }),
          );
        }
        const layer = Layer.mergeAll(
          makeRepoRootedFileSystemLayer(config),
          makeGlobalTelemetryJournalLayerOrNoop(),
        );
        const generated = yield* generateReviewHandoff(info, {
          allowPartial: input.flags.allowPartial ?? false,
        }).pipe(
          Effect.provide(layer),
          Effect.mapError(
            (error) =>
              new ReviewFailedError({
                message:
                  error instanceof ReviewHandoffArtifactMissingError
                    ? `Missing artifacts for phases: ${error.missingPhases.join(", ")}. ` +
                      `Use --allow-partial to generate a partial document.`
                    : `Review handoff generation failed: ${error.message}`,
                qualifiedName,
                crossProject,
              }),
          ),
        );
        return {
          qualifiedName,
          crossProject,
          reviewHandoff: `${info.runPath}/review-handoff.md`,
          written: yield* writtenRecords(generated.written, config.repoRoot),
        };
      }).pipe(Effect.mapError(exposeMessage)),
    exits: reviewBaseExits,
    errors: reviewBaseErrors,
    texts: reviewBaseTexts,
    render: (value) =>
      withTarget(value, [
        `Review handoff regenerated for run "${value.qualifiedName}". See ${value.reviewHandoff}`,
      ]),
  });
}

// ── review-compliance ───────────────────────────────────────────────────────────

/** Layers a test swaps for fakes; each defaults to the real adapter. */
export interface ReviewDeps {
  readonly backendLayer?: Layer.Layer<Backend>;
  readonly sessionLayer?: Layer.Layer<Session>;
  readonly gitLayer?: Layer.Layer<Git>;
  readonly githubLayer?: Layer.Layer<GitHub>;
}

/** The compliance review is off in phax.json. */
class ReviewDisabledError extends Data.TaggedError("ReviewDisabledError")<{
  readonly message: string;
}> {}

const COMPLIANCE_DISABLED =
  `review.compliance is not enabled in phax.json. ` +
  `Add a "review": { "compliance": { "enabled": true } } block to phax.json to use this command.`;

const ReviewComplianceOutput = Schema.Struct({
  qualifiedName: Schema.String,
  crossProject: Schema.Boolean,
  verdict: Schema.String,
  review: Schema.String,
  notice: nullable(Schema.String),
  warnings: Schema.Array(Schema.String),
  written: Schema.Array(Written),
});

/** The output port a review's use case writes through: its lines on stdout (said), its warnings
 *  on stderr (progress), as they happen. */
function outputOf(call: {
  readonly say: (text: string) => Effect.Effect<void>;
  readonly progress: (text: string) => Effect.Effect<void>;
}) {
  return {
    log: (text: string): void => Effect.runSync(call.say(text)),
    warn: (text: string): void => Effect.runSync(call.progress(text)),
    error: (text: string): void => Effect.runSync(call.progress(text)),
  };
}

export function makeReviewComplianceCommand(deps: ReviewDeps = {}) {
  return defineCommand({
    name: "review-compliance",
    summary: "Run a plan-compliance review for a review_open run and record its result",
    help: REVIEW_COMPLIANCE_HELP,
    examples: ["phax review-compliance usage-cli"],
    input: { args: reject(Schema.Tuple(ShortNameArg)) },
    output: reject(ReviewComplianceOutput),
    run: ({ input, program, say, progress }) =>
      Effect.gen(function* () {
        const config = yield* reviewConfigured();
        if (!config.complianceReview.enabled) {
          return yield* Effect.fail(new ReviewDisabledError({ message: COMPLIANCE_DISABLED }));
        }
        const { namespace, shortName, info, crossProject } = yield* reviewResolved(
          input.args[0],
          config,
          effectiveStateRoot(config),
        );
        const qualifiedName = runKey(namespace, shortName);
        const fail = (message: string) =>
          Effect.fail(new ReviewFailedError({ message, qualifiedName, crossProject }));
        if (info.runState !== "review_open") {
          return yield* Effect.fail(
            new ReviewNotOpenError({
              message: notOpenSentence(shortName, "review-compliance", info),
              qualifiedName,
              crossProject,
            }),
          );
        }

        const routingResult = yield* Effect.result(
          Effect.all({ routing: loadModelRouting(), providerConfig: loadProviderConfig() }).pipe(
            Effect.provide(makeRepoRootedFileSystemLayer(config)),
          ),
        );
        if (Result.isFailure(routingResult)) {
          return yield* fail(`Failed to load routing config: ${routingResult.left.message}`);
        }
        const { routing, providerConfig } = routingResult.right;
        const resolution = resolveModel(
          { model: config.complianceReview.model, effort: config.complianceReview.effort },
          routing,
          providerConfig,
          () => ({ allowed: true }),
        );

        const layer = Layer.mergeAll(
          deps.backendLayer ?? makeProviderBackendLayer(providerConfig),
          makeRepoRootedFileSystemLayer(config),
          NoopSystemTelemetryLayer,
          deps.gitLayer ?? NodeGitLayer,
          deps.githubLayer ?? NodeGitHubLayer,
        );
        const verbose = program["verbose"];
        const result = yield* Effect.result(
          reviewComplianceAndRecord(
            info,
            config.complianceReview,
            resolution,
            { mode: config.security.profile, config: config.security },
            reviewRecordTargetFor({ config, namespace, info, crossProject }),
            {
              ...(typeof verbose === "boolean" ? { verbose } : {}),
              output: outputOf({ say, progress }),
            },
          ).pipe(Effect.provide(layer)),
        );
        if (Result.isFailure(result)) {
          return yield* fail(`Unexpected error during compliance review: ${result.left.message}`);
        }

        const outcome = result.right;
        const review = outcome.review;
        // The command as the operator typed the run: the run key when it belongs to another
        // project. The failure line and the records warnings both name it.
        const retryCommand = `phax review-compliance ${crossProject ? qualifiedName : shortName}`;

        if (review.kind === "disabled") {
          return yield* Effect.fail(new ReviewDisabledError({ message: COMPLIANCE_DISABLED }));
        }
        if (review.kind === "failed") {
          if (review.sessionFailure != null) {
            const err = sessionFailureError(
              review.sessionFailure,
              review.sessionFailureFiles ?? { agentErrorLog: null, transcript: null },
            );
            if (isSessionFailureError(err)) {
              return yield* Effect.fail(
                sessionFailed(review.sessionFailure.kind === "network", {
                  lines: [
                    ...renderSessionFailure(err, retryCommand),
                    ...(review.earlierReviewKept ? [`  ${COMPLIANCE_EARLIER_REVIEW_KEPT}`] : []),
                  ],
                  qualifiedName,
                  crossProject,
                }),
              );
            }
          }
          return yield* fail(
            `Compliance review failed: ${complianceFailureReason(review.failureReason, review.earlierReviewKept)}. ` +
              `To retry, run: ${retryCommand}`,
          );
        }

        return {
          qualifiedName,
          crossProject,
          verdict: String(review.review.verdict),
          review: review.mdArtifactPath,
          notice: reviewEntryNotice(outcome) ?? null,
          warnings: [...reviewEntryWarnings(outcome, "compliance-review", retryCommand)],
          written: yield* writtenRecords(
            [review.mdArtifactPath, review.jsonArtifactPath],
            config.repoRoot,
          ),
        };
      }).pipe(Effect.mapError(exposeMessage)),
    exits: { ...reviewBaseExits, ReviewDisabledError: 1, ...sessionExits },
    errors: { ...reviewBaseErrors, ReviewDisabledError: MessageFields, ...sessionErrors },
    texts: {
      ...reviewBaseTexts,
      ReviewDisabledError: (error: ReviewDisabledError) => error.message,
      ...sessionTexts,
    },
    render: (value) =>
      withTarget(value, [
        `Verdict: ${value.verdict}`,
        `Compliance review: ${value.review}`,
        ...(value.notice === null ? [] : [value.notice]),
      ]),
    notes: (value) => value.warnings.join("\n"),
  });
}

// ── review-code ─────────────────────────────────────────────────────────────────

const VALID_EFFORT_VALUES = ["low", "medium", "high"] as const;
type ValidEffort = (typeof VALID_EFFORT_VALUES)[number];

function isValidEffort(value: string): value is ValidEffort {
  return (VALID_EFFORT_VALUES as readonly string[]).includes(value);
}

/** `--effort` is not one of the allowed values. */
class ReviewEffortError extends Data.TaggedError("ReviewEffortError")<{
  readonly message: string;
}> {}

/** The review session's process could not be started. */
class ReviewLaunchError extends Data.TaggedError("ReviewLaunchError")<{
  readonly message: string;
  readonly qualifiedName: string;
  readonly crossProject: boolean;
}> {}

const HeadlessOutput = Schema.Struct({
  kind: Schema.Literal("headless"),
  qualifiedName: Schema.String,
  crossProject: Schema.Boolean,
  findings: Schema.Struct({ count: Schema.Number, summary: Schema.String }),
  findingsPath: Schema.String,
  fixHint: nullable(Schema.String),
  notice: nullable(Schema.String),
  warnings: Schema.Array(Schema.String),
  written: Schema.Array(Written),
});

/** The process a handed-over session ran: what was started, where, and how it ended. */
const HandedOverOutput = Schema.Struct({
  qualifiedName: Schema.String,
  crossProject: Schema.Boolean,
  executable: Schema.String,
  cwd: Schema.String,
  exit: Schema.Number,
});

const ReviewCodeOutput = Schema.Union(HeadlessOutput, HandedOverOutput);
type ReviewCodeOutput = typeof ReviewCodeOutput.Type;

const optional = <S extends Schema.Schema.Any>(schema: S) => Schema.optionalKey(schema);

const ReviewCodeFlags = reject(
  Schema.Struct({
    newSession: optional(
      Schema.Boolean.annotations({
        description: "Start a fresh review session instead of resuming the existing one",
      }),
    ),
    model: optional(
      Schema.String.annotations({
        identifier: "model",
        description:
          "Override the model, including on resume (default: review.code.model, else claude-opus-5-5)",
      }),
    ),
    effort: optional(
      Schema.String.annotations({
        identifier: "effort",
        description:
          "Override the effort (low | medium | high), including on resume (default: review.code.effort, else high)",
      }),
    ),
    headless: optional(
      Schema.Boolean.annotations({
        description:
          "Run the code review without a person: write code-review.json and record the session for review-code to resume; runs whether or not review.code.enabled is set",
      }),
    ),
  }),
);

interface HeadlessCall {
  readonly config: ResolvedConfig;
  readonly effectiveConfig: ResolvedCodeReviewConfig;
  readonly namespace: string;
  readonly info: RunReviewInfo;
  readonly qualifiedName: string;
  readonly retryRef: string;
  readonly crossProject: boolean;
  readonly say: (text: string) => Effect.Effect<void>;
  readonly progress: (text: string) => Effect.Effect<void>;
}

function runHeadless(call: HeadlessCall, deps: ReviewDeps) {
  return Effect.gen(function* () {
    const { config, effectiveConfig, namespace, info, qualifiedName, retryRef, crossProject } =
      call;
    const retryCommand = `phax review-code ${retryRef} --headless`;
    const fail = (message: string) =>
      Effect.fail(new ReviewFailedError({ message, qualifiedName, crossProject }));

    const routingResult = yield* Effect.result(
      Effect.all({ routing: loadModelRouting(), providerConfig: loadProviderConfig() }).pipe(
        Effect.provide(makeRepoRootedFileSystemLayer(config)),
      ),
    );
    if (Result.isFailure(routingResult)) {
      return yield* fail(`Failed to load routing config: ${routingResult.left.message}`);
    }
    const { routing, providerConfig } = routingResult.right;
    const resolution = resolveModel(
      { model: effectiveConfig.model, effort: effectiveConfig.effort },
      routing,
      providerConfig,
      () => ({ allowed: true }),
    );

    const reviewed = yield* Effect.result(
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const bundledReviewSkill = yield* fs.readText(
          join(defaultBundleRoot(), PHAX_REVIEW_SKILL, "SKILL.md"),
        );
        return yield* reviewCodeAndRecord(
          info,
          effectiveConfig,
          resolution,
          { mode: config.security.profile, config: config.security },
          reviewRecordTargetFor({ config, namespace, info, crossProject }),
          { bundledReviewSkill, nowIso: new Date().toISOString(), output: outputOf(call) },
        );
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            deps.backendLayer ?? makeProviderBackendLayer(providerConfig),
            makeRepoRootedFileSystemLayer(config),
            NoopSystemTelemetryLayer,
            deps.gitLayer ?? NodeGitLayer,
            deps.githubLayer ?? NodeGitHubLayer,
          ),
        ),
      ),
    );
    if (Result.isFailure(reviewed)) {
      return yield* fail(`Unexpected error during code review: ${reviewed.left.message}`);
    }
    const outcome = reviewed.right;
    const review = outcome.review;
    if (review.kind === "failed") {
      if (review.sessionFailure != null) {
        const err = sessionFailureError(
          review.sessionFailure,
          review.sessionFailureFiles ?? { agentErrorLog: null, transcript: null },
        );
        return yield* Effect.fail(
          sessionFailed(review.sessionFailure.kind === "network", {
            lines: renderSessionFailure(err, retryCommand),
            qualifiedName,
            crossProject,
          }),
        );
      }
      return yield* fail(`Code review failed: ${review.reason}. To retry, run: ${retryCommand}`);
    }

    const findings = review.review.findings;
    const answer: ReviewCodeOutput = {
      kind: "headless",
      qualifiedName,
      crossProject,
      findings: { count: findings.length, summary: describeFindingCounts(findings) },
      findingsPath: review.reviewPath,
      fixHint: codeReviewFixHint(findings.length, review.session, retryRef) ?? null,
      notice: reviewEntryNotice(outcome) ?? null,
      warnings: [...reviewEntryWarnings(outcome, "code-review", retryCommand)],
      written: yield* writtenRecords([review.reviewPath, review.sessionPath], config.repoRoot),
    };
    return answer;
  });
}

function runInteractive(
  call: HeadlessCall,
  flags: { readonly newSession?: boolean; readonly model?: string; readonly effort?: string },
  deps: ReviewDeps,
) {
  return Effect.gen(function* () {
    const { config, effectiveConfig, info, qualifiedName, crossProject } = call;
    const fail = (message: string) =>
      Effect.fail(new ReviewFailedError({ message, qualifiedName, crossProject }));

    const prepared = yield* Effect.result(
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const bundledReviewSkill = yield* fs.readText(
          join(defaultBundleRoot(), PHAX_REVIEW_SKILL, "SKILL.md"),
        );
        return yield* prepareCodeReviewSession(info, effectiveConfig, {
          newSession: flags.newSession ?? false,
          nowIso: new Date().toISOString(),
          ...(flags.model !== undefined ? { modelOverride: flags.model } : {}),
          ...(flags.effort !== undefined ? { effortOverride: flags.effort } : {}),
          bundledReviewSkill,
        });
      }).pipe(
        Effect.provide(
          Layer.mergeAll(makeRepoRootedFileSystemLayer(config), NoopSystemTelemetryLayer),
        ),
      ),
    );
    if (Result.isFailure(prepared)) {
      return yield* fail(
        `Unexpected error during review-code preparation: ${prepared.left.message}`,
      );
    }
    const result = prepared.right;
    if (result.kind === "unsupported" || result.kind === "refused") {
      return yield* fail(result.message);
    }

    const { invocation, mode } = result;
    // The render is empty: the lines of the session's start are said as it begins.
    if (crossProject) yield* call.say(`Target: ${qualifiedName}`);
    yield* call.say(
      mode === "new"
        ? `Starting code review session in ${invocation.cwd}`
        : `Resuming code review session in ${invocation.cwd}`,
    );

    const exit = yield* Effect.result(
      Effect.gen(function* () {
        const session = yield* Session;
        return yield* session.resume({ ...invocation, env: {} });
      }).pipe(Effect.provide(deps.sessionLayer ?? makeNodeSessionLayer())),
    );
    if (Result.isFailure(exit)) {
      return yield* Effect.fail(
        new ReviewLaunchError({
          message: `Failed to launch ${invocation.executable}: ${exit.left.message}`,
          qualifiedName,
          crossProject,
        }),
      );
    }
    const answer: ReviewCodeOutput = {
      qualifiedName,
      crossProject,
      executable: invocation.executable,
      cwd: invocation.cwd,
      exit: exit.right,
    };
    return answer;
  });
}

export function makeReviewCodeCommand(deps: ReviewDeps = {}) {
  return defineCommand({
    name: "review-code",
    summary:
      "Open an interactive, pre-prompted code-review session for a review_open run, or run the review headless with --headless",
    help: REVIEW_CODE_HELP,
    examples: ["phax review-code usage-cli", "phax review-code usage-cli --headless"],
    input: { args: reject(Schema.Tuple(ShortNameArg)), flags: ReviewCodeFlags },
    output: reject(ReviewCodeOutput),
    // The interactive review hands the terminal to a session; the headless one never waits.
    prompts: (input) => input.flags.headless !== true,
    unprompted: "pass --headless",
    run: ({ input, say, progress }) =>
      Effect.gen(function* () {
        const config = yield* reviewConfigured();
        const flags = input.flags;
        if (flags.effort !== undefined && !isValidEffort(flags.effort)) {
          return yield* Effect.fail(
            new ReviewEffortError({
              message: `Invalid --effort value "${flags.effort}". Allowed values: ${VALID_EFFORT_VALUES.join(" | ")}`,
            }),
          );
        }
        const effectiveConfig: ResolvedCodeReviewConfig = {
          enabled: config.codeReview.enabled,
          model: flags.model ?? config.codeReview.model,
          effort:
            flags.effort !== undefined && isValidEffort(flags.effort)
              ? flags.effort
              : config.codeReview.effort,
        };
        const { namespace, shortName, info, crossProject } = yield* reviewResolved(
          input.args[0],
          config,
          effectiveStateRoot(config),
        );
        const qualifiedName = runKey(namespace, shortName);
        if (info.runState !== "review_open") {
          return yield* Effect.fail(
            new ReviewNotOpenError({
              message: notOpenSentence(shortName, "review-code", info),
              qualifiedName,
              crossProject,
            }),
          );
        }
        const call: HeadlessCall = {
          config,
          effectiveConfig,
          namespace,
          info,
          qualifiedName,
          retryRef: crossProject ? qualifiedName : shortName,
          crossProject,
          say,
          progress,
        };
        return flags.headless === true
          ? yield* runHeadless(call, deps)
          : yield* runInteractive(call, flags, deps);
      }).pipe(Effect.mapError(exposeMessage)),
    exits: {
      ...reviewBaseExits,
      ReviewEffortError: 1,
      ReviewLaunchError: 1,
      ...sessionExits,
    },
    errors: {
      ...reviewBaseErrors,
      ReviewEffortError: MessageFields,
      ReviewLaunchError: TargetedFields,
      ...sessionErrors,
    },
    texts: {
      ...reviewBaseTexts,
      ReviewEffortError: (error: ReviewEffortError) => error.message,
      ReviewLaunchError: (error: ReviewLaunchError) => targeted(error, error.message),
      ...sessionTexts,
    },
    render: (value) => {
      // The interactive review writes its lines as the session begins.
      if (!("kind" in value)) return "";
      return withTarget(value, [
        `Code review: ${value.findings.summary}`,
        `Findings: ${value.findingsPath}`,
        ...(value.fixHint === null ? [] : [value.fixHint]),
        ...(value.notice === null ? [] : [value.notice]),
      ]);
    },
    notes: (value) => ("kind" in value ? value.warnings.join("\n") : ""),
    // The session's exit is the command's; a headless review exits 0.
    handsOver: (value) => ("kind" in value ? 0 : value.exit),
  });
}

const REVIEW_COMPLIANCE_HELP =
  "Runs a plan-compliance review by invoking the AI agent with the run's handoff artifacts and the original plan. The agent session is read-only and writes no file. On Claude Code its shell is limited to the read-only git prefixes (log, diff, show, status, ls-files, blame), which run with your user's rights, without an OS sandbox; on Mistral Vibe, bash is prefix-allowlisted to the same commands, without an OS sandbox; on Codex, the read-only OS sandbox blocks writes and the network but lets any reading command run. It answers a structured verdict with its final message, per phase, with two ledgers (unplanned changes and unmet promises). phax writes compliance-review.json (the answer as given) and compliance-review.md (rendered from it) in the run folder; when records are enabled, it also commits the review entry to the records of the run's own project, even when the run belongs to another project.\n\nA refused answer, one that does not match the schema or does not name every phase of the run exactly once, is asked once more in the same session (its transcript is compliance-review-retry.session.jsonl). A review refused twice, or whose session fails, writes neither file nor a records entry, leaves an earlier review as it was, and exits 1 (14 when the provider was unreachable: a network failure), naming the retry command.\n\nSide effects: spawns a short-lived, read-only AI agent session (network I/O); writes compliance-review.json and compliance-review.md in the run folder; when records are enabled, commits the review entry to phax/records/v1, and pushes it when records.autoPush is on.";

const REVIEW_CODE_HELP =
  "Opens an interactive, pre-prompted code-review session for a review_open run by launching the AI agent in the run's worktree with the code-review prompt. The prompt carries the phax-review skill: the project's copy at .claude/skills/phax-review/SKILL.md in the run's worktree when it has one, else the bundled skill. The session is resumable: re-running resumes the existing session, while --new-session starts fresh. The developer takes over the session to investigate, discuss, and apply fixes.\n\n--headless runs the review without a person, whether or not review.code.enabled is set, in a read-only session: its reading tools and read-only git (log, diff, show, status, ls-files, blame). The session answers with its final message; a session that changed the worktree has its changes put back and its answer refused. A refused answer, an empty one included, is asked once more in the same session (its transcript is code-review-retry.session.jsonl) before the review fails naming both refusals; a session that changed the worktree is never resumed. An accepted answer writes code-review.json and code-review-session.json in the run folder; when records are on, it commits the code-review entry, and pushes it when records.autoPush is on. It prints the finding count and how to resume the session to fix them (phax review-code <run> on Claude Code, the provider's own resume otherwise), and exits 1 naming the reason and the retry command when the review fails (14 when the provider was unreachable: a network failure), leaving code-review.json and code-review-session.json as they were. It never touches a pull request. A later `phax review-code <run>` resumes that session on the provider that ran it. --new-session after a headless review starts a new interactive session that becomes the recorded review session and detaches it from code-review.json, which is left as it is.\n\nSide effects: writes a code-review prompt file under the worktree's .phax-context/ and a session record under the run directory; spawns a long-lived interactive AI agent session (network I/O). With --headless: spawns a short-lived AI agent session (network I/O), writes code-review.json and code-review-session.json in the run folder, and may commit a code-review entry to phax/records/v1.";

/** The review commands as the program declares them: real adapters. */
export const reviewHandoffCommand = makeReviewHandoffCommand();
export const reviewComplianceCommand = makeReviewComplianceCommand();
export const reviewCodeCommand = makeReviewCodeCommand();
