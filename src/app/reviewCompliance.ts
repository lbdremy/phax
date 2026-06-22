import { Effect, Either } from "effect";
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
import { resolveReviewSecurityPolicy } from "../domain/security/resolveReviewPolicy.js";
import {
  decodeComplianceReview,
  type ComplianceReview,
  type Verdict,
} from "../schemas/complianceReview.js";
import { Backend } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import type { RunId } from "../domain/branded.js";
import {
  makeStepStartedTelemetryEvent,
  makeStepCompletedTelemetryEvent,
  makeArtifactGeneratedTelemetryEvent,
} from "../domain/telemetry/events.js";

const GLOBAL_RECONCILIATION_FILENAME = "global-file-reconciliation.md";
const PLAN_FILENAME = "plan.md";

export type ComplianceReviewResultKind = "disabled" | "generated" | "failed";

export interface ComplianceReviewResult {
  readonly kind: ComplianceReviewResultKind;
  readonly verdict?: Verdict | "unknown";
  readonly review?: ComplianceReview;
  readonly structuredVerdictMissing?: boolean;
  readonly mdArtifactPath?: string;
  readonly failureReason?: string;
}

export interface ReviewComplianceOpts {
  readonly verbose?: boolean;
}

export function reviewCompliance(
  info: RunReviewInfo,
  config: ResolvedComplianceReviewConfig,
  resolution: RoutingResolution,
  security: { mode: SecurityMode; config: ResolvedSecurityConfig },
  opts: ReviewComplianceOpts,
): Effect.Effect<ComplianceReviewResult, FsError, Backend | FileSystem | SystemTelemetry> {
  return Effect.gen(function* () {
    if (!config.enabled) {
      return { kind: "disabled" } satisfies ComplianceReviewResult;
    }

    const fs = yield* FileSystem;
    const backend = yield* Backend;
    const telemetry = yield* SystemTelemetry;

    const runId = info.runId as RunId;

    yield* telemetry.recordEvent(
      makeStepStartedTelemetryEvent({
        runId,
        operationId: info.shortName,
        step: "compliance.review",
      }),
    );

    const reconciliationPath = join(info.runPath, GLOBAL_RECONCILIATION_FILENAME);
    const reconciliationExistsResult = yield* Effect.either(fs.exists(reconciliationPath));
    if (Either.isLeft(reconciliationExistsResult) || !reconciliationExistsResult.right) {
      const reason = Either.isLeft(reconciliationExistsResult)
        ? `Could not check for global reconciliation: ${reconciliationExistsResult.left.message}`
        : `Missing global file reconciliation at "${reconciliationPath}" — cannot run compliance review`;
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: info.shortName,
          step: "compliance.review",
          result: "failure",
        }),
      );
      return { kind: "failed", failureReason: reason } satisfies ComplianceReviewResult;
    }

    const reconciliationReadResult = yield* Effect.either(fs.readText(reconciliationPath));
    if (Either.isLeft(reconciliationReadResult)) {
      const reason = `Could not read global reconciliation: ${reconciliationReadResult.left.message}`;
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: info.shortName,
          step: "compliance.review",
          result: "failure",
        }),
      );
      return { kind: "failed", failureReason: reason } satisfies ComplianceReviewResult;
    }

    const planPath = join(info.runPath, PLAN_FILENAME);
    const planExistsResult = yield* Effect.either(fs.exists(planPath));
    if (Either.isLeft(planExistsResult) || !planExistsResult.right) {
      const reason = Either.isLeft(planExistsResult)
        ? `Could not check for plan.md: ${planExistsResult.left.message}`
        : `Missing plan.md at "${planPath}" — cannot run compliance review`;
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: info.shortName,
          step: "compliance.review",
          result: "failure",
        }),
      );
      return { kind: "failed", failureReason: reason } satisfies ComplianceReviewResult;
    }

    const planReadResult = yield* Effect.either(fs.readText(planPath));
    if (Either.isLeft(planReadResult)) {
      const reason = `Could not read plan.md: ${planReadResult.left.message}`;
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: info.shortName,
          step: "compliance.review",
          result: "failure",
        }),
      );
      return { kind: "failed", failureReason: reason } satisfies ComplianceReviewResult;
    }

    const phaxContextPath = join(info.worktreePath, ".phax-context");
    yield* fs.mkdirp(phaxContextPath);

    const agentMdPath = join(phaxContextPath, COMPLIANCE_REVIEW_MD_FILENAME);
    const agentJsonPath = join(phaxContextPath, COMPLIANCE_REVIEW_JSON_FILENAME);

    const prompt = buildCompliancePrompt({
      planMd: planReadResult.right,
      reconciliationMd: reconciliationReadResult.right,
      phases: info.planPhases,
      worktreePath: info.worktreePath,
      mdArtifactPath: agentMdPath,
      jsonArtifactPath: agentJsonPath,
    });

    const policy = resolveReviewSecurityPolicy({
      mode: security.mode,
      worktreePath: info.worktreePath,
      config: security.config,
    });

    const outputJsonlPath = join(info.runPath, "compliance-review.session.jsonl");

    const agentResult = yield* Effect.either(
      backend.runAgent(prompt, {
        provider: resolution.selected.provider,
        model: resolution.selected.concreteModel,
        effort: resolution.selected.thinking ?? config.effort,
        cwd: info.worktreePath,
        security: policy,
        outputJsonlPath,
      }),
    );

    if (Either.isLeft(agentResult)) {
      const reason = `Agent invocation failed: ${agentResult.left.message}`;
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: info.shortName,
          step: "compliance.review",
          result: "failure",
        }),
      );
      return { kind: "failed", failureReason: reason } satisfies ComplianceReviewResult;
    }

    const mdExistsResult = yield* Effect.either(fs.exists(agentMdPath));
    const mdExists = Either.isRight(mdExistsResult) && mdExistsResult.right;

    if (!mdExists) {
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: info.shortName,
          step: "compliance.review",
          result: "failure",
        }),
      );
      return {
        kind: "failed",
        failureReason: `Agent did not write the compliance-review.md artifact at "${agentMdPath}"`,
      } satisfies ComplianceReviewResult;
    }

    const mdReadResult = yield* Effect.either(fs.readText(agentMdPath));
    if (Either.isLeft(mdReadResult)) {
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: info.shortName,
          step: "compliance.review",
          result: "failure",
        }),
      );
      return {
        kind: "failed",
        failureReason: `Could not read compliance-review.md: ${mdReadResult.left.message}`,
      } satisfies ComplianceReviewResult;
    }

    const durableMdPath = join(info.runPath, COMPLIANCE_REVIEW_MD_FILENAME);
    yield* fs.writeAtomic(durableMdPath, mdReadResult.right);

    yield* telemetry.recordEvent(
      makeArtifactGeneratedTelemetryEvent({
        runId,
        operationId: info.shortName,
        artifact: COMPLIANCE_REVIEW_MD_FILENAME,
        path: durableMdPath,
      }),
    );

    const jsonExistsResult = yield* Effect.either(fs.exists(agentJsonPath));
    const jsonExists = Either.isRight(jsonExistsResult) && jsonExistsResult.right;

    if (!jsonExists) {
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: info.shortName,
          step: "compliance.review",
          result: "success",
        }),
      );
      return {
        kind: "generated",
        verdict: "unknown",
        structuredVerdictMissing: true,
        mdArtifactPath: durableMdPath,
      } satisfies ComplianceReviewResult;
    }

    const jsonReadResult = yield* Effect.either(fs.readText(agentJsonPath));
    if (Either.isLeft(jsonReadResult)) {
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: info.shortName,
          step: "compliance.review",
          result: "success",
        }),
      );
      return {
        kind: "generated",
        verdict: "unknown",
        structuredVerdictMissing: true,
        mdArtifactPath: durableMdPath,
      } satisfies ComplianceReviewResult;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(jsonReadResult.right);
    } catch {
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: info.shortName,
          step: "compliance.review",
          result: "success",
        }),
      );
      return {
        kind: "generated",
        verdict: "unknown",
        structuredVerdictMissing: true,
        mdArtifactPath: durableMdPath,
      } satisfies ComplianceReviewResult;
    }

    const decodeResult = decodeComplianceReview(parsedJson);
    if (Either.isLeft(decodeResult)) {
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: info.shortName,
          step: "compliance.review",
          result: "success",
        }),
      );
      return {
        kind: "generated",
        verdict: "unknown",
        structuredVerdictMissing: true,
        mdArtifactPath: durableMdPath,
      } satisfies ComplianceReviewResult;
    }

    const review = decodeResult.right;
    const durableJsonPath = join(info.runPath, COMPLIANCE_REVIEW_JSON_FILENAME);
    yield* fs.writeAtomic(durableJsonPath, jsonReadResult.right);

    yield* telemetry.recordEvent(
      makeArtifactGeneratedTelemetryEvent({
        runId,
        operationId: info.shortName,
        artifact: COMPLIANCE_REVIEW_JSON_FILENAME,
        path: durableJsonPath,
      }),
    );

    yield* telemetry.recordEvent(
      makeStepCompletedTelemetryEvent({
        runId,
        operationId: info.shortName,
        step: "compliance.review",
        result: "success",
      }),
    );

    return {
      kind: "generated",
      verdict: review.verdict,
      review,
      mdArtifactPath: durableMdPath,
    } satisfies ComplianceReviewResult;
  });
}
