import { Effect, Either } from "effect";
import { AgentSessionFailedError } from "../domain/errors.js";
import type { SessionFailureFiles } from "../domain/session/failureError.js";
import type { SessionFailure } from "../domain/session/outcome.js";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { RunReviewInfo } from "../domain/runReviewInfo.js";
import type { ResolvedCodeReviewConfig } from "../schemas/phaxConfig.js";
import type { RoutingResolution } from "../domain/routing/types.js";
import type { SecurityMode } from "../domain/security/types.js";
import type { ResolvedSecurityConfig } from "../schemas/securityConfig.js";
import { resolveReviewSecurityPolicy } from "../domain/security/resolveReviewPolicy.js";
import { CODE_REVIEW_AGENT_COMMANDS } from "../domain/security/agentCommands.js";
import { extractJsonDocumentText } from "../domain/authoring/jsonText.js";
import {
  buildCodeReviewPrompt,
  buildCodeReviewPositionalPrompt,
  buildHeadlessCodeReviewPrompt,
  CODE_REVIEW_PROMPT_FILENAME,
  type BuildCodeReviewPromptInput,
  type CodeReviewDoctrine,
} from "../domain/review/codeReviewPrompt.js";
import {
  CODE_REVIEW_JSON_FILENAME,
  codeReviewFileText,
  readCodeReviewAnswer,
  type CodeReview,
} from "../schemas/codeReview.js";
import { Backend } from "../ports/backend.js";
import { Git, type GitError } from "../ports/git.js";
import type { GitHub } from "../ports/github.js";
import { withInvocationCost } from "./costLedger.js";
import {
  NO_REVIEW_ENTRY,
  recordReviewEntry,
  type ReviewEntryOutcome,
  type ReviewRecordTarget,
  type ReviewRecordUnresolved,
} from "./reviewEntry.js";
import { PHAX_REVIEW_SKILL } from "../domain/skills/catalog.js";
import {
  decodeCodeReviewSession,
  encodeCodeReviewSession,
  type CodeReviewSession,
} from "../schemas/codeReviewSession.js";
import { readComplianceReviewFile } from "../schemas/persisted.js";
import { decodeGlobalFileReconciliation } from "../schemas/globalReconciliation.js";
import { toCodeReviewAttentionPoints } from "../domain/review/codeReviewWorklist.js";
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

const GLOBAL_RECONCILIATION_FILENAME = "global-file-reconciliation.json";
const COMPLIANCE_REVIEW_JSON_FILENAME = "compliance-review.json";
const CODE_REVIEW_SESSION_FILENAME = "code-review-session.json";
const CODE_REVIEW_STREAM_FILENAME = "code-review.session.jsonl";
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
    /** The bundled `phax-review` SKILL.md, read by the caller. */
    readonly bundledReviewSkill: string;
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

    const worktreePath = info.worktreePath;
    const sessionRecordPath = join(info.runPath, CODE_REVIEW_SESSION_FILENAME);

    // Try to read and decode an existing session record (resume path). It
    // names the provider that ran the session — a headless review's record
    // may name another provider than the final phase's binding — so a
    // recorded session never needs the binding.
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
      const adapter = getSessionAdapter(existingSession.provider);
      const invocation = adapter.buildPrePromptedInvocation({
        cwd: worktreePath,
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

    // New session branch: the final phase's binding says which provider starts it.
    const bindingPath = join(info.runPath, info.finalPhaseId, "agent-binding.json");
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
    const sessionId = randomUUID();

    const worklist = yield* loadCodeReviewWorklist(info, opts.bundledReviewSkill);
    const promptContent = buildCodeReviewPrompt({ worktreePath, ...worklist });

    const phaxContextPath = join(worktreePath, PHAX_CONTEXT_DIR);
    const promptFilePath = join(phaxContextPath, CODE_REVIEW_PROMPT_FILENAME);
    const positionalPrompt = buildCodeReviewPositionalPrompt(promptFilePath);

    // Resolve the invocation before writing anything: an unsupported provider
    // must not leave a leaked prompt file on disk.
    const adapter = getSessionAdapter(provider);
    const invocation = adapter.buildPrePromptedInvocation({
      cwd: worktreePath,
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

    yield* fs.mkdirp(phaxContextPath);
    yield* fs.writeAtomic(promptFilePath, promptContent);

    yield* telemetry.recordEvent(
      makeArtifactGeneratedTelemetryEvent({
        runId,
        operationId: info.shortName,
        artifact: CODE_REVIEW_PROMPT_FILENAME,
        path: promptFilePath,
      }),
    );

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

/** What both review paths read before they build a prompt. */
export interface CodeReviewWorklist {
  readonly attentionPoints: BuildCodeReviewPromptInput["attentionPoints"];
  readonly compliance?: NonNullable<BuildCodeReviewPromptInput["compliance"]>;
  readonly complianceMissing: boolean;
  readonly doctrine: CodeReviewDoctrine;
}

/**
 * The worklist of a run's review: the files the reconciliation flagged, the
 * compliance findings and the doctrine (the project's copy of the review skill
 * on the run's branch, else the bundled one). A missing, unparsable or
 * undecodable reconciliation or compliance file degrades to an empty worklist
 * or missing findings — never a refusal — so a review stays usable on
 * interrupted or older runs.
 */
export function loadCodeReviewWorklist(
  info: RunReviewInfo,
  bundledReviewSkill: string,
): Effect.Effect<CodeReviewWorklist, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;

    const reconciliationPath = join(info.runPath, GLOBAL_RECONCILIATION_FILENAME);
    const reconciliationReadResult = yield* Effect.either(fs.readText(reconciliationPath));
    let attentionPoints: BuildCodeReviewPromptInput["attentionPoints"] = [];

    if (Either.isRight(reconciliationReadResult)) {
      try {
        const reconciliationJson = JSON.parse(reconciliationReadResult.right);
        const reconciliationDecodeResult = decodeGlobalFileReconciliation(reconciliationJson);
        if (Either.isRight(reconciliationDecodeResult)) {
          attentionPoints = toCodeReviewAttentionPoints(reconciliationDecodeResult.right);
        }
      } catch {
        // Malformed JSON — treat as an empty worklist
      }
    }

    const complianceJsonPath = join(info.runPath, COMPLIANCE_REVIEW_JSON_FILENAME);
    const complianceReadResult = yield* Effect.either(fs.readText(complianceJsonPath));

    let complianceBlock: BuildCodeReviewPromptInput["compliance"];
    let complianceMissing = true;

    if (Either.isRight(complianceReadResult)) {
      try {
        const complianceJson = JSON.parse(complianceReadResult.right);
        const complianceDecodeResult = readComplianceReviewFile(complianceJsonPath, complianceJson);
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

    // The project's copy of the review skill, on the run's branch, replaces the bundled one.
    const projectSkillPath = join(
      info.worktreePath,
      ".claude",
      "skills",
      PHAX_REVIEW_SKILL,
      "SKILL.md",
    );
    const doctrine: CodeReviewDoctrine = (yield* fs.exists(projectSkillPath))
      ? { source: "project", text: yield* fs.readText(projectSkillPath) }
      : { source: "bundled", text: bundledReviewSkill };

    return {
      attentionPoints,
      ...(complianceBlock !== undefined ? { compliance: complianceBlock } : {}),
      complianceMissing,
      doctrine,
    };
  });
}

export type HeadlessCodeReviewResult =
  | {
      readonly kind: "accepted";
      readonly review: CodeReview;
      readonly reviewPath: string;
      readonly session: CodeReviewSession;
    }
  | {
      readonly kind: "failed";
      readonly reason: string;
      /** In memory only, never persisted: the failed session, when the agent's session failed. */
      readonly sessionFailure?: SessionFailure | null;
      /** In memory only: the agent-error.log and transcript the failed session left. */
      readonly sessionFailureFiles?: SessionFailureFiles | null;
    };

/**
 * Review a run's change in one headless, read-only session, and keep its
 * answer (the session's final message). An accepted answer becomes
 * `code-review.json` and the run's review session (`code-review-session.json`),
 * replaced together or left as they were; a refused answer, an empty one, a
 * failed session and a session that changed the worktree write neither, and
 * say why. A session that changed the worktree has those paths put back.
 */
export function reviewCodeHeadless(
  info: RunReviewInfo,
  config: ResolvedCodeReviewConfig,
  resolution: RoutingResolution,
  security: { mode: SecurityMode; config: ResolvedSecurityConfig },
  opts: { readonly bundledReviewSkill: string; readonly nowIso: string },
): Effect.Effect<
  HeadlessCodeReviewResult,
  FsError | GitError,
  Backend | FileSystem | Git | SystemTelemetry
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;
    const backend = yield* Backend;
    const telemetry = yield* SystemTelemetry;
    const runId = info.runId as RunId;

    yield* telemetry.recordEvent(
      makeStepStartedTelemetryEvent({
        runId,
        operationId: info.shortName,
        step: "code.review.headless",
      }),
    );

    const worklist = yield* loadCodeReviewWorklist(info, opts.bundledReviewSkill);
    const firstPhase = info.phaseStatuses.toSorted((a, b) => a.phaseIndex - b.phaseIndex)[0];

    const prompt = buildHeadlessCodeReviewPrompt({
      worktreePath: info.worktreePath,
      ...worklist,
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
    const outputJsonlPath = join(info.runPath, CODE_REVIEW_STREAM_FILENAME);

    const before = yield* git.snapshotWorktree(info.worktreePath);
    const agentResult = yield* Effect.either(
      withInvocationCost(
        backend.runAgent(prompt, {
          provider,
          model: resolution.selected.concreteModel,
          effort: resolution.selected.thinking ?? config.effort,
          cwd: info.worktreePath,
          security: { ...policy, agentCommands: [...CODE_REVIEW_AGENT_COMMANDS] },
          agentCommands: CODE_REVIEW_AGENT_COMMANDS,
          // The review answers and never writes: its reading tools and the
          // read-only git above, whatever the policy allows.
          readOnly: true,
          outputJsonlPath,
        }),
        {
          role: "code-review",
          phase: null,
          runId,
          runPath: info.runPath,
          provider,
          streamPath: outputJsonlPath,
        },
      ),
    );

    const fail = (reason: string) =>
      ({ kind: "failed", reason }) satisfies HeadlessCodeReviewResult;

    // A provider that ignores read-only could still have written: whatever the
    // session changed is put back, and the review is refused.
    const after = yield* git.snapshotWorktree(info.worktreePath);
    if (after !== before) {
      const changed = yield* git.changedPathsBetween(info.worktreePath, before, after);
      const paths = changed.map((c) => c.path).toSorted();
      if (paths.length > 0) {
        yield* git.restorePaths(info.worktreePath, before, paths);
        return fail(`the session changed the worktree (put back): ${paths.join(", ")}`);
      }
    }

    if (Either.isLeft(agentResult)) {
      const sessionError =
        agentResult.left instanceof AgentSessionFailedError ? agentResult.left : null;
      return {
        ...fail(`the session failed: ${agentResult.left.message}`),
        sessionFailure: sessionError?.failure ?? null,
        sessionFailureFiles:
          sessionError === null
            ? null
            : { agentErrorLog: sessionError.agentErrorLog, transcript: sessionError.transcript },
      } satisfies HeadlessCodeReviewResult;
    }

    const finalText = agentResult.right.finalText.trim();
    if (finalText === "") return fail("the session gave no answer");

    const answer = readCodeReviewAnswer(extractJsonDocumentText(finalText));
    if (Either.isLeft(answer)) return fail(`answer refused: ${answer.left}`);

    const review = answer.right;
    const reviewPath = join(info.runPath, CODE_REVIEW_JSON_FILENAME);
    const sessionPath = join(info.runPath, CODE_REVIEW_SESSION_FILENAME);
    const session: CodeReviewSession = {
      version: 1,
      shortName: info.shortName,
      runId: info.runId,
      provider,
      sessionId: agentResult.right.sessionId,
      worktreePath: info.worktreePath,
      createdAt: opts.nowIso,
      updatedAt: opts.nowIso,
    };

    // The pair is replaced together or left as it was: a failed second write
    // puts the first file back.
    const previousReview = (yield* fs.exists(reviewPath))
      ? yield* fs.readText(reviewPath)
      : undefined;
    yield* fs.writeAtomic(reviewPath, codeReviewFileText(review));
    const sessionWrite = yield* Effect.either(
      fs.writeAtomic(sessionPath, JSON.stringify(encodeCodeReviewSession(session), null, 2)),
    );
    if (Either.isLeft(sessionWrite)) {
      yield* previousReview === undefined
        ? fs.remove(reviewPath)
        : fs.writeAtomic(reviewPath, previousReview);
      return fail(`the review could not be kept: ${sessionWrite.left.message}`);
    }

    yield* telemetry.recordEvent(
      makeArtifactGeneratedTelemetryEvent({
        runId,
        operationId: info.shortName,
        artifact: CODE_REVIEW_JSON_FILENAME,
        path: reviewPath,
      }),
    );

    return { kind: "accepted", review, reviewPath, session } satisfies HeadlessCodeReviewResult;
  }).pipe(
    Effect.tap((result) =>
      Effect.flatMap(SystemTelemetry, (telemetry) =>
        telemetry.recordEvent(
          makeStepCompletedTelemetryEvent({
            runId: info.runId as RunId,
            operationId: info.shortName,
            step: "code.review.headless",
            result: result.kind === "accepted" ? "success" : "failure",
          }),
        ),
      ),
    ),
    Effect.tapError(() =>
      Effect.flatMap(SystemTelemetry, (telemetry) =>
        telemetry.recordEvent(
          makeStepCompletedTelemetryEvent({
            runId: info.runId as RunId,
            operationId: info.shortName,
            step: "code.review.headless",
            result: "failure",
          }),
        ),
      ),
    ),
  );
}

export type CodeReviewRecordOutcome = {
  readonly review: HeadlessCodeReviewResult;
} & ReviewEntryOutcome;

/**
 * Run the headless code review, then keep the code-review.json it wrote as a
 * `code-review` entry on the records branch of the run's own project. Neither
 * the session, the answer nor the records fail the caller: each is reported in
 * the outcome. Never touches a pull request.
 */
export function reviewCodeAndRecord(
  info: RunReviewInfo,
  config: ResolvedCodeReviewConfig,
  resolution: RoutingResolution,
  security: { mode: SecurityMode; config: ResolvedSecurityConfig },
  target: ReviewRecordTarget | ReviewRecordUnresolved,
  opts: { readonly bundledReviewSkill: string; readonly nowIso: string },
): Effect.Effect<
  CodeReviewRecordOutcome,
  never,
  Backend | FileSystem | SystemTelemetry | Git | GitHub
> {
  return Effect.gen(function* () {
    const review = yield* reviewCodeHeadless(info, config, resolution, security, opts).pipe(
      Effect.catchAll((error) =>
        Effect.succeed({
          kind: "failed",
          reason: `the review could not be kept: ${error.message}`,
        } satisfies HeadlessCodeReviewResult),
      ),
    );
    if (review.kind !== "accepted") return { review, ...NO_REVIEW_ENTRY };
    const entry = yield* recordReviewEntry({
      target,
      runId: info.runId,
      runPath: info.runPath,
      review: "code-review",
    });
    return { review, ...entry };
  });
}
