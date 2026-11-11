import { Effect, Result } from "effect";
import { AgentSessionFailedError } from "../domain/errors.js";
import type { SessionFailureFiles } from "../domain/session/failureError.js";
import type { SessionFailure } from "../domain/session/outcome.js";
import { join } from "node:path";
import type { RunReviewInfo } from "../domain/runReviewInfo.js";
import type { ResolvedComplianceReviewConfig } from "../schemas/phaxConfig.js";
import type { RoutingResolution } from "../domain/routing/types.js";
import type { SecurityMode } from "../domain/security/types.js";
import type { ResolvedSecurityConfig } from "../schemas/securityConfig.js";
import {
  buildCompliancePrompt,
  COMPLIANCE_REVIEW_MD_FILENAME,
  COMPLIANCE_REVIEW_JSON_FILENAME,
} from "../domain/review/compliancePrompt.js";
import {
  COMPLIANCE_REVIEW_RETRY_STREAM_FILENAME,
  COMPLIANCE_REVIEW_STREAM_FILENAME,
  complianceRefusedTwiceMessage,
  complianceRetryPrompt,
  complianceRetryWarning,
} from "../domain/review/complianceRetry.js";
import { renderComplianceReviewMarkdown } from "../domain/review/complianceMarkdown.js";
import { resolveReviewSecurityPolicy } from "../domain/security/resolveReviewPolicy.js";
import { CODE_REVIEW_AGENT_COMMANDS } from "../domain/security/agentCommands.js";
import { phaseCoverageRefusal } from "../domain/review/compliancePhaseCoverage.js";
import { answerJson } from "../domain/session/structuredAnswer.js";
import { answerJsonSchema } from "../schemas/answerSchemas.js";
import {
  complianceReviewFileText,
  readComplianceReviewAnswer,
  type ComplianceReview,
} from "../schemas/complianceReview.js";
import { Backend, type AgentRunResult } from "../ports/backend.js";
import { FileSystem, FsError } from "../ports/fs.js";
import type { Git } from "../ports/git.js";
import type { GitHub } from "../ports/github.js";
import type { OutputPort } from "../ports/output.js";
import {
  NO_REVIEW_ENTRY,
  recordReviewEntry,
  type ReviewEntryOutcome,
  type ReviewRecordTarget,
  type ReviewRecordUnresolved,
} from "./reviewEntry.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import type { RunId } from "../domain/branded.js";
import { withInvocationCost } from "./costLedger.js";
import { loadReviewedPhases } from "./loadReviewHandoffInputs.js";
import {
  makeStepStartedTelemetryEvent,
  makeStepCompletedTelemetryEvent,
  makeArtifactGeneratedTelemetryEvent,
} from "../domain/telemetry/events.js";

const GLOBAL_RECONCILIATION_FILENAME = "global-file-reconciliation.md";
const PLAN_FILENAME = "plan.md";

export type ComplianceReviewResult =
  | { readonly kind: "disabled" }
  | {
      readonly kind: "generated";
      readonly review: ComplianceReview;
      readonly mdArtifactPath: string;
      readonly jsonArtifactPath: string;
    }
  | {
      readonly kind: "failed";
      readonly failureReason: string;
      /**
       * An earlier review's compliance-review.json is still in place, untouched:
       * the run folder and the PR body still show it.
       */
      readonly earlierReviewKept: boolean;
      /** In memory only, never persisted: the failed session, when the agent's session failed. */
      readonly sessionFailure?: SessionFailure | null;
      /** In memory only: the agent-error.log and transcript the failed session left. */
      readonly sessionFailureFiles?: SessionFailureFiles | null;
    };

export interface ReviewComplianceOpts {
  readonly verbose?: boolean;
  /** Where the refusal of a first answer is printed before the session is resumed. */
  readonly output: OutputPort;
}

/** Why the pair could not be kept, and whether the files are as they were before the writes. */
interface KeepFailure {
  readonly reason: string;
  readonly pairIntact: boolean;
}

/** A session's final answer, decoded: the review, or why phax refuses it. */
function decodeComplianceAnswer(
  result: AgentRunResult,
  runPhaseIds: readonly string[],
): Result.Result<ComplianceReview, string> {
  const parsed = answerJson(result);
  if (Result.isFailure(parsed)) return Result.fail(parsed.failure);
  return Result.flatMap(readComplianceReviewAnswer(parsed.success), (answered) => {
    const refusal = phaseCoverageRefusal(
      answered.perPhase.map((p) => p.phaseId),
      runPhaseIds,
    );
    return refusal === null ? Result.succeed(answered) : Result.fail(refusal);
  });
}

/**
 * Review a run against its plan in one read-only session that answers with
 * its final message. An accepted answer becomes compliance-review.json and,
 * rendered from the answer alone, compliance-review.md, replaced together or
 * left as they were. A refused-twice answer, a failed session and a failed
 * write fail the review, write nothing and leave an earlier review's files
 * untouched.
 */
export function reviewCompliance(
  info: RunReviewInfo,
  config: ResolvedComplianceReviewConfig,
  resolution: RoutingResolution,
  security: { mode: SecurityMode; config: ResolvedSecurityConfig },
  opts: ReviewComplianceOpts,
): Effect.Effect<ComplianceReviewResult, FsError, Backend | FileSystem | SystemTelemetry> {
  if (!config.enabled) {
    return Effect.succeed({ kind: "disabled" } satisfies ComplianceReviewResult);
  }
  const runId = info.runId as RunId;

  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const backend = yield* Backend;
    const telemetry = yield* SystemTelemetry;

    yield* telemetry.recordEvent(
      makeStepStartedTelemetryEvent({
        runId,
        operationId: info.shortName,
        step: "compliance.review",
      }),
    );

    const jsonArtifactPath = join(info.runPath, COMPLIANCE_REVIEW_JSON_FILENAME);
    const mdArtifactPath = join(info.runPath, COMPLIANCE_REVIEW_MD_FILENAME);

    /**
     * A failed review. An earlier review is kept when its json is there and
     * this review left the pair whole (`pairIntact`).
     */
    const fail = (reason: string, pairIntact = true) =>
      Effect.map(
        Effect.result(fs.exists(jsonArtifactPath)),
        (exists) =>
          ({
            kind: "failed",
            failureReason: reason,
            earlierReviewKept: pairIntact && Result.isSuccess(exists) && exists.success,
          }) satisfies ComplianceReviewResult,
      );

    const reconciliationPath = join(info.runPath, GLOBAL_RECONCILIATION_FILENAME);
    const reconciliationExistsResult = yield* Effect.result(fs.exists(reconciliationPath));
    if (Result.isFailure(reconciliationExistsResult) || !reconciliationExistsResult.success) {
      return yield* fail(
        Result.isFailure(reconciliationExistsResult)
          ? `Could not check for global reconciliation: ${reconciliationExistsResult.failure.message}`
          : `Missing global file reconciliation at "${reconciliationPath}" — cannot run compliance review`,
      );
    }

    const reconciliationReadResult = yield* Effect.result(fs.readText(reconciliationPath));
    if (Result.isFailure(reconciliationReadResult)) {
      return yield* fail(
        `Could not read global reconciliation: ${reconciliationReadResult.failure.message}`,
      );
    }

    const planPath = join(info.runPath, PLAN_FILENAME);
    const planExistsResult = yield* Effect.result(fs.exists(planPath));
    if (Result.isFailure(planExistsResult) || !planExistsResult.success) {
      return yield* fail(
        Result.isFailure(planExistsResult)
          ? `Could not check for plan.md: ${planExistsResult.failure.message}`
          : `Missing plan.md at "${planPath}" — cannot run compliance review`,
      );
    }

    const planReadResult = yield* Effect.result(fs.readText(planPath));
    if (Result.isFailure(planReadResult)) {
      return yield* fail(`Could not read plan.md: ${planReadResult.failure.message}`);
    }

    const phaseHandoffs: Array<{ phaseId: string; handoffMd: string }> = [];
    for (const phase of info.planPhases) {
      const handoffPath = join(info.runPath, phase.id, "phase-handoff.md");
      const handoffResult = yield* Effect.result(fs.readText(handoffPath));
      phaseHandoffs.push({
        phaseId: phase.id,
        handoffMd: Result.isSuccess(handoffResult)
          ? handoffResult.success
          : `> phase-handoff.md unavailable for ${phase.id}`,
      });
    }

    const reviewedPhases = (yield* loadReviewedPhases(info)).map((r) => ({
      phaseId: r.reviewed.phaseId,
      cause: r.reviewed.cause,
      handoffMd: r.handoffMd,
    }));

    const firstPhase = info.phaseStatuses.toSorted((a, b) => a.phaseIndex - b.phaseIndex)[0];

    // The session answers and writes nothing: no file is made under the
    // worktree, and what it reads of the change it reads with git.
    const prompt = buildCompliancePrompt({
      planMd: planReadResult.success,
      reconciliationMd: reconciliationReadResult.success,
      phases: info.planPhases,
      phaseHandoffs,
      reviewedPhases,
      worktreePath: info.worktreePath,
      baseRef: firstPhase?.base ?? null,
      runBranch: info.branch,
      gitCommands: CODE_REVIEW_AGENT_COMMANDS,
    });

    const policy = resolveReviewSecurityPolicy({
      mode: security.mode,
      worktreePath: info.worktreePath,
      config: security.config,
    });

    const provider = resolution.selected.provider;
    const outputJsonlPath = join(info.runPath, COMPLIANCE_REVIEW_STREAM_FILENAME);

    const sessionOptions = {
      provider,
      model: resolution.selected.concreteModel,
      effort: resolution.selected.thinking ?? config.effort,
      cwd: info.worktreePath,
      security: { ...policy, agentCommands: [...CODE_REVIEW_AGENT_COMMANDS] },
      agentCommands: CODE_REVIEW_AGENT_COMMANDS,
      // The review answers and never writes: its reading tools and the
      // read-only git above, whatever the policy allows.
      readOnly: true,
      answerSchema: { call: "compliance-review", schema: answerJsonSchema("compliance-review") },
    } as const;
    const costOf = (streamPath: string) =>
      ({
        role: "compliance",
        phase: null,
        runId,
        runPath: info.runPath,
        provider,
        streamPath,
      }) as const;

    /**
     * One session (the first, or the corrective resume). A failed session is
     * reported with its failure and files, never as a refusal; otherwise the
     * session's result is returned.
     */
    const session = <E extends Error, R>(
      run: Effect.Effect<AgentRunResult, E, R>,
    ): Effect.Effect<ComplianceReviewResult | AgentRunResult, never, R> =>
      Effect.flatMap(Effect.result(run), (outcome) => {
        if (Result.isSuccess(outcome)) {
          return Effect.succeed<ComplianceReviewResult | AgentRunResult>(outcome.success);
        }
        const sessionError =
          outcome.failure instanceof AgentSessionFailedError ? outcome.failure : null;
        return Effect.map(
          fail(`Agent invocation failed: ${outcome.failure.message}`),
          (failed) =>
            ({
              ...failed,
              sessionFailure: sessionError?.failure ?? null,
              sessionFailureFiles:
                sessionError === null
                  ? null
                  : {
                      agentErrorLog: sessionError.agentErrorLog,
                      transcript: sessionError.transcript,
                    },
            }) satisfies ComplianceReviewResult,
        );
      });

    const runPhaseIds = info.planPhases.map((p) => p.id);

    const firstRun = yield* session(
      withInvocationCost(
        backend.runAgent(prompt, { ...sessionOptions, outputJsonlPath }),
        costOf(outputJsonlPath),
      ),
    );
    if ("kind" in firstRun) return firstRun;

    let answer = decodeComplianceAnswer(firstRun, runPhaseIds);
    if (Result.isFailure(answer)) {
      const firstRefusal = answer.failure;
      opts.output.warn(complianceRetryWarning(firstRefusal));
      const retryPath = join(info.runPath, COMPLIANCE_REVIEW_RETRY_STREAM_FILENAME);
      const retryRun = yield* session(
        withInvocationCost(
          backend.resumeAgentSession(firstRun.sessionId, complianceRetryPrompt(firstRefusal), {
            ...sessionOptions,
            outputJsonlPath: retryPath,
          }),
          costOf(retryPath),
        ),
      );
      if ("kind" in retryRun) return retryRun;
      answer = decodeComplianceAnswer(retryRun, runPhaseIds);
      if (Result.isFailure(answer)) {
        return yield* fail(complianceRefusedTwiceMessage(firstRefusal, answer.failure));
      }
    }

    const review = answer.success;

    // The pair is replaced together or left as it was: a failed second write
    // puts the first file back (or removes it when there was none). When that
    // undo fails too, the reason names both failures and the pair is no
    // longer whole: an earlier review is not kept.
    const keepPair: Effect.Effect<void, KeepFailure> = Effect.gen(function* () {
      const previousJson = (yield* fs.exists(jsonArtifactPath))
        ? yield* fs.readText(jsonArtifactPath)
        : undefined;
      yield* fs.writeAtomic(jsonArtifactPath, complianceReviewFileText(review));
      const mdWrite = yield* Effect.result(
        fs.writeAtomic(mdArtifactPath, renderComplianceReviewMarkdown(info.runId, review)),
      );
      if (Result.isFailure(mdWrite)) {
        const undo = yield* Effect.result(
          previousJson === undefined
            ? fs.remove(jsonArtifactPath)
            : fs.writeAtomic(jsonArtifactPath, previousJson),
        );
        if (Result.isFailure(undo)) {
          const undoing =
            previousJson === undefined
              ? `removing the new ${COMPLIANCE_REVIEW_JSON_FILENAME}`
              : `restoring the earlier ${COMPLIANCE_REVIEW_JSON_FILENAME}`;
          return yield* Effect.fail<KeepFailure>({
            reason: `${mdWrite.failure.message}; ${undoing} also failed: ${undo.failure.message}`,
            pairIntact: false,
          });
        }
        return yield* Effect.fail<KeepFailure>({
          reason: mdWrite.failure.message,
          pairIntact: true,
        });
      }
    }).pipe(
      Effect.mapError((error) =>
        error instanceof FsError ? { reason: error.message, pairIntact: true } : error,
      ),
    );
    const kept = yield* Effect.result(keepPair);
    if (Result.isFailure(kept)) {
      return yield* fail(
        `the review could not be kept: ${kept.failure.reason}`,
        kept.failure.pairIntact,
      );
    }

    for (const [artifact, path] of [
      [COMPLIANCE_REVIEW_JSON_FILENAME, jsonArtifactPath],
      [COMPLIANCE_REVIEW_MD_FILENAME, mdArtifactPath],
    ] as const) {
      yield* telemetry.recordEvent(
        makeArtifactGeneratedTelemetryEvent({
          runId,
          operationId: info.shortName,
          artifact,
          path,
        }),
      );
    }

    return {
      kind: "generated",
      review,
      mdArtifactPath,
      jsonArtifactPath,
    } satisfies ComplianceReviewResult;
  }).pipe(
    Effect.tap((result) =>
      Effect.flatMap(SystemTelemetry, (telemetry) =>
        telemetry.recordEvent(
          makeStepCompletedTelemetryEvent({
            runId,
            operationId: info.shortName,
            step: "compliance.review",
            result: result.kind === "generated" ? "success" : "failure",
          }),
        ),
      ),
    ),
    Effect.tapError(() =>
      Effect.flatMap(SystemTelemetry, (telemetry) =>
        telemetry.recordEvent(
          makeStepCompletedTelemetryEvent({
            runId,
            operationId: info.shortName,
            step: "compliance.review",
            result: "failure",
          }),
        ),
      ),
    ),
  );
}

export interface ComplianceReviewRecordOutcome extends ReviewEntryOutcome {
  readonly review: ComplianceReviewResult;
}

/**
 * Run the compliance review, then keep the compliance-review.json it wrote
 * as a `compliance-review` entry on the records branch of the run's own
 * project. A records concern never fails the review: the outcome reports it
 * for the caller to warn about. A review that failed records nothing.
 */
export function reviewComplianceAndRecord(
  info: RunReviewInfo,
  config: ResolvedComplianceReviewConfig,
  resolution: RoutingResolution,
  security: { mode: SecurityMode; config: ResolvedSecurityConfig },
  target: ReviewRecordTarget | ReviewRecordUnresolved,
  opts: ReviewComplianceOpts,
): Effect.Effect<
  ComplianceReviewRecordOutcome,
  FsError,
  Backend | FileSystem | SystemTelemetry | Git | GitHub
> {
  return Effect.gen(function* () {
    const review = yield* reviewCompliance(info, config, resolution, security, opts);
    // Only a compliance-review.json written by this invocation is an entry.
    if (review.kind !== "generated") {
      return { review, ...NO_REVIEW_ENTRY };
    }
    const entry = yield* recordReviewEntry({
      target,
      runId: info.runId,
      runPath: info.runPath,
      review: "compliance-review",
    });
    return { review, ...entry };
  });
}
