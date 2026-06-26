import { Effect, Either } from "effect";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { RunReviewInfo } from "../domain/runReviewInfo.js";
import type { ResolvedCodeReviewConfig } from "../schemas/phaxConfig.js";
import {
  buildCodeReviewPrompt,
  buildCodeReviewPositionalPrompt,
  CODE_REVIEW_PROMPT_FILENAME,
} from "../domain/review/codeReviewPrompt.js";
import {
  decodeCodeReviewSession,
  encodeCodeReviewSession,
  type CodeReviewSession,
} from "../schemas/codeReviewSession.js";
import { decodeComplianceReview } from "../schemas/complianceReview.js";
import { decodePhaseAgentBinding } from "../schemas/phaseAgentBinding.js";
import { getSessionAdapter } from "../domain/session/index.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import type { RunId } from "../domain/branded.js";
import {
  makeStepStartedTelemetryEvent,
  makeStepCompletedTelemetryEvent,
  makeArtifactGeneratedTelemetryEvent,
} from "../domain/telemetry/events.js";

const GLOBAL_RECONCILIATION_FILENAME = "global-file-reconciliation.md";
const COMPLIANCE_REVIEW_JSON_FILENAME = "compliance-review.json";
const CODE_REVIEW_SESSION_FILENAME = "code-review-session.json";
const PHAX_CONTEXT_DIR = ".phax-context";

export interface PrepareCodeReviewResultReady {
  readonly kind: "ready";
  readonly invocation: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly cwd: string;
  };
  readonly mode: "new" | "resume";
}

export interface PrepareCodeReviewResultUnsupported {
  readonly kind: "unsupported";
  readonly message: string;
}

export interface PrepareCodeReviewResultRefused {
  readonly kind: "refused";
  readonly message: string;
}

export type PrepareCodeReviewResult =
  | PrepareCodeReviewResultReady
  | PrepareCodeReviewResultUnsupported
  | PrepareCodeReviewResultRefused;

export function prepareCodeReviewSession(
  info: RunReviewInfo,
  config: ResolvedCodeReviewConfig,
  opts: {
    readonly newSession: boolean;
    readonly nowIso: string;
    readonly modelOverride?: string;
    readonly effortOverride?: string;
  },
): Effect.Effect<PrepareCodeReviewResult, FsError, FileSystem | SystemTelemetry> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const telemetry = yield* SystemTelemetry;
    const runId = info.runId as RunId;

    yield* telemetry.recordEvent(
      makeStepStartedTelemetryEvent({
        runId,
        operationId: info.shortName,
        step: "code.review.prepare",
      }),
    );

    const finalPhaseFolder = join(info.runPath, info.finalPhaseId);
    const bindingPath = join(finalPhaseFolder, "agent-binding.json");
    const bindingReadResult = yield* Effect.either(fs.readText(bindingPath));

    if (Either.isLeft(bindingReadResult)) {
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: info.shortName,
          step: "code.review.prepare",
          result: "failure",
        }),
      );
      return {
        kind: "refused",
        message: `No agent binding found for run "${info.shortName}": ${bindingReadResult.left.message}`,
      } satisfies PrepareCodeReviewResult;
    }

    let bindingJson: unknown;
    try {
      bindingJson = JSON.parse(bindingReadResult.right);
    } catch {
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: info.shortName,
          step: "code.review.prepare",
          result: "failure",
        }),
      );
      return {
        kind: "refused",
        message: `Could not parse agent-binding.json for run "${info.shortName}"`,
      } satisfies PrepareCodeReviewResult;
    }

    const bindingDecodeResult = decodePhaseAgentBinding(bindingJson);
    if (Either.isLeft(bindingDecodeResult)) {
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: info.shortName,
          step: "code.review.prepare",
          result: "failure",
        }),
      );
      return {
        kind: "refused",
        message: `Could not decode agent-binding.json for run "${info.shortName}": ${String(bindingDecodeResult.left)}`,
      } satisfies PrepareCodeReviewResult;
    }

    const provider = bindingDecodeResult.right.provider;
    const worktreePath = info.worktreePath;
    const sessionRecordPath = join(info.runPath, CODE_REVIEW_SESSION_FILENAME);

    // Try to read and decode an existing session record (resume path)
    let existingSession: CodeReviewSession | undefined;
    if (!opts.newSession) {
      const sessionReadResult = yield* Effect.either(fs.readText(sessionRecordPath));
      if (Either.isRight(sessionReadResult)) {
        try {
          const sessionJson = JSON.parse(sessionReadResult.right);
          const sessionDecodeResult = decodeCodeReviewSession(sessionJson);
          if (Either.isRight(sessionDecodeResult)) {
            existingSession = sessionDecodeResult.right;
          }
        } catch {
          // Malformed JSON — treat as no record, fall through to new session
        }
      }
    }

    if (existingSession !== undefined) {
      // Resume branch
      const adapter = getSessionAdapter(provider);
      const invocation = adapter.buildReviewInvocation({
        worktreePath,
        sessionId: existingSession.sessionId,
        initialPrompt: null,
        ...(opts.modelOverride !== undefined ? { model: opts.modelOverride } : {}),
        ...(opts.effortOverride !== undefined ? { effort: opts.effortOverride } : {}),
      });

      if ("unsupported" in invocation) {
        yield* telemetry.recordEvent(
          makeStepCompletedTelemetryEvent({
            runId,
            operationId: info.shortName,
            step: "code.review.prepare",
            result: "failure",
          }),
        );
        return {
          kind: "unsupported",
          message: invocation.unsupported,
        } satisfies PrepareCodeReviewResult;
      }

      const updated: CodeReviewSession = { ...existingSession, updatedAt: opts.nowIso };
      yield* fs.writeAtomic(
        sessionRecordPath,
        JSON.stringify(encodeCodeReviewSession(updated), null, 2),
      );

      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: info.shortName,
          step: "code.review.prepare",
          result: "success",
        }),
      );

      return {
        kind: "ready",
        invocation,
        mode: "resume",
      } satisfies PrepareCodeReviewResult;
    }

    // New session branch
    const sessionId = randomUUID();

    const reconciliationPath = join(info.runPath, GLOBAL_RECONCILIATION_FILENAME);
    const reconciliationReadResult = yield* Effect.either(fs.readText(reconciliationPath));
    const reconciliationMd = Either.isRight(reconciliationReadResult)
      ? reconciliationReadResult.right
      : "";

    const complianceJsonPath = join(info.runPath, COMPLIANCE_REVIEW_JSON_FILENAME);
    const complianceReadResult = yield* Effect.either(fs.readText(complianceJsonPath));

    type ComplianceBlock = Exclude<
      Parameters<typeof buildCodeReviewPrompt>[0]["compliance"],
      undefined
    >;
    let complianceBlock: ComplianceBlock | undefined;
    let complianceMissing = true;

    if (Either.isRight(complianceReadResult)) {
      try {
        const complianceJson = JSON.parse(complianceReadResult.right);
        const complianceDecodeResult = decodeComplianceReview(complianceJson);
        if (Either.isRight(complianceDecodeResult)) {
          const review = complianceDecodeResult.right;
          complianceBlock = {
            attentionPoints: review.attentionPoints,
            pointers: review.pointers,
            deviationFindings: review.perPhase.flatMap((pv) =>
              pv.findings.map((f) => ({
                phaseId: pv.phaseId,
                dimension: f.dimension,
                severity: f.severity,
                message: f.message,
              })),
            ),
          };
          complianceMissing = false;
        }
      } catch {
        // Malformed JSON — treat as missing
      }
    }

    const promptContent = buildCodeReviewPrompt({
      worktreePath,
      reconciliationMd,
      attentionPoints: [],
      ...(complianceBlock !== undefined ? { compliance: complianceBlock } : {}),
      complianceMissing,
    });

    const phaxContextPath = join(worktreePath, PHAX_CONTEXT_DIR);
    yield* fs.mkdirp(phaxContextPath);

    const promptFilePath = join(phaxContextPath, CODE_REVIEW_PROMPT_FILENAME);
    yield* fs.writeAtomic(promptFilePath, promptContent);

    yield* telemetry.recordEvent(
      makeArtifactGeneratedTelemetryEvent({
        runId,
        operationId: info.shortName,
        artifact: CODE_REVIEW_PROMPT_FILENAME,
        path: promptFilePath,
      }),
    );

    const positionalPrompt = buildCodeReviewPositionalPrompt(promptFilePath);

    const adapter = getSessionAdapter(provider);
    const invocation = adapter.buildReviewInvocation({
      worktreePath,
      sessionId,
      initialPrompt: positionalPrompt,
      model: config.model,
      effort: config.effort,
    });

    if ("unsupported" in invocation) {
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: info.shortName,
          step: "code.review.prepare",
          result: "failure",
        }),
      );
      return {
        kind: "unsupported",
        message: invocation.unsupported,
      } satisfies PrepareCodeReviewResult;
    }

    const sessionRecord: CodeReviewSession = {
      version: 1,
      shortName: info.shortName,
      runId: info.runId,
      provider,
      sessionId,
      worktreePath,
      createdAt: opts.nowIso,
      updatedAt: opts.nowIso,
    };
    yield* fs.writeAtomic(
      sessionRecordPath,
      JSON.stringify(encodeCodeReviewSession(sessionRecord), null, 2),
    );

    yield* telemetry.recordEvent(
      makeStepCompletedTelemetryEvent({
        runId,
        operationId: info.shortName,
        step: "code.review.prepare",
        result: "success",
      }),
    );

    return {
      kind: "ready",
      invocation,
      mode: "new",
    } satisfies PrepareCodeReviewResult;
  });
}
