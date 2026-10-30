import { Effect, Either } from "effect";
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
import { FileSystem, type FsError } from "../ports/fs.js";
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

/** A session's final answer, decoded: the review, or why phax refuses it. */
function decodeComplianceAnswer(
  result: AgentRunResult,
  runPhaseIds: readonly string[],
): Either.Either<ComplianceReview, string> {
  const parsed = answerJson(result);
  if (Either.isLeft(parsed)) return Either.left(parsed.left);
  return Either.flatMap(readComplianceReviewAnswer(parsed.right), (answered) => {
    const refusal = phaseCoverageRefusal(
      answered.perPhase.map((p) => p.phaseId),
      runPhaseIds,
    );
    return refusal === null ? Either.right(answered) : Either.left(refusal);
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

    const fail = (reason: string) =>
      ({ kind: "failed", failureReason: reason }) satisfies ComplianceReviewResult;

    const reconciliationPath = join(info.runPath, GLOBAL_RECONCILIATION_FILENAME);
    const reconciliationExistsResult = yield* Effect.either(fs.exists(reconciliationPath));
    if (Either.isLeft(reconciliationExistsResult) || !reconciliationExistsResult.right) {
      return fail(
        Either.isLeft(reconciliationExistsResult)
          ? `Could not check for global reconciliation: ${reconciliationExistsResult.left.message}`
          : `Missing global file reconciliation at "${reconciliationPath}" — cannot run compliance review`,
      );
    }

    const reconciliationReadResult = yield* Effect.either(fs.readText(reconciliationPath));
    if (Either.isLeft(reconciliationReadResult)) {
      return fail(`Could not read global reconciliation: ${reconciliationReadResult.left.message}`);
    }

    const planPath = join(info.runPath, PLAN_FILENAME);
    const planExistsResult = yield* Effect.either(fs.exists(planPath));
    if (Either.isLeft(planExistsResult) || !planExistsResult.right) {
      return fail(
        Either.isLeft(planExistsResult)
          ? `Could not check for plan.md: ${planExistsResult.left.message}`
          : `Missing plan.md at "${planPath}" — cannot run compliance review`,
      );
    }

    const planReadResult = yield* Effect.either(fs.readText(planPath));
    if (Either.isLeft(planReadResult)) {
      return fail(`Could not read plan.md: ${planReadResult.left.message}`);
    }

    const phaseHandoffs: Array<{ phaseId: string; handoffMd: string }> = [];
    for (const phase of info.planPhases) {
      const handoffPath = join(info.runPath, phase.id, "phase-handoff.md");
      const handoffResult = yield* Effect.either(fs.readText(handoffPath));
      phaseHandoffs.push({
        phaseId: phase.id,
        handoffMd: Either.isRight(handoffResult)
          ? handoffResult.right
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
      planMd: planReadResult.right,
      reconciliationMd: reconciliationReadResult.right,
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
      Effect.map(Effect.either(run), (outcome) => {
        if (Either.isRight(outcome)) return outcome.right;
        const sessionError = outcome.left instanceof AgentSessionFailedError ? outcome.left : null;
        return {
          ...fail(`Agent invocation failed: ${outcome.left.message}`),
          sessionFailure: sessionError?.failure ?? null,
          sessionFailureFiles:
            sessionError === null
              ? null
              : { agentErrorLog: sessionError.agentErrorLog, transcript: sessionError.transcript },
        } satisfies ComplianceReviewResult;
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
    if (Either.isLeft(answer)) {
      const firstRefusal = answer.left;
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
      if (Either.isLeft(answer)) {
        return fail(complianceRefusedTwiceMessage(firstRefusal, answer.left));
      }
    }

    const review = answer.right;
    const jsonArtifactPath = join(info.runPath, COMPLIANCE_REVIEW_JSON_FILENAME);
    const mdArtifactPath = join(info.runPath, COMPLIANCE_REVIEW_MD_FILENAME);

    // The pair is replaced together or left as it was: a failed second write
    // puts the first file back (or removes it when there was none). When that
    // undo fails too, the reason names both failures.
    const keepPair: Effect.Effect<void, string> = Effect.gen(function* () {
      const previousJson = (yield* fs.exists(jsonArtifactPath))
        ? yield* fs.readText(jsonArtifactPath)
        : undefined;
      yield* fs.writeAtomic(jsonArtifactPath, complianceReviewFileText(review));
      const mdWrite = yield* Effect.either(
        fs.writeAtomic(mdArtifactPath, renderComplianceReviewMarkdown(info.runId, review)),
      );
      if (Either.isLeft(mdWrite)) {
        const undo = yield* Effect.either(
          previousJson === undefined
            ? fs.remove(jsonArtifactPath)
            : fs.writeAtomic(jsonArtifactPath, previousJson),
        );
        if (Either.isLeft(undo)) {
          const undoing =
            previousJson === undefined
              ? `removing the new ${COMPLIANCE_REVIEW_JSON_FILENAME}`
              : `restoring the earlier ${COMPLIANCE_REVIEW_JSON_FILENAME}`;
          return yield* Effect.fail(
            `${mdWrite.left.message}; ${undoing} also failed: ${undo.left.message}`,
          );
        }
        return yield* Effect.fail(mdWrite.left.message);
      }
    }).pipe(Effect.mapError((error) => (typeof error === "string" ? error : error.message)));
    const kept = yield* Effect.either(keepPair);
    if (Either.isLeft(kept)) {
      return fail(`the review could not be kept: ${kept.left}`);
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
