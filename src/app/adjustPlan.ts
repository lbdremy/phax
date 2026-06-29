import { Effect, Either } from "effect";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AdjustPlanSession } from "../schemas/adjustPlanSession.js";
import { decodeAdjustPlanSession, encodeAdjustPlanSession } from "../schemas/adjustPlanSession.js";
import {
  buildAdjustPlanPrompt,
  buildAdjustPlanPositionalPrompt,
  ADJUST_PLAN_PROMPT_FILENAME,
} from "../domain/planOverlap/adjustPrompt.js";
import {
  buildFootprint,
  buildLandedFootprint,
  computeReadjustmentImpact,
} from "../domain/planOverlap/compute.js";
import type { LandedInput } from "../domain/planOverlap/types.js";
import { decodeGlobalFileReconciliation } from "../schemas/globalReconciliation.js";
import { getSessionAdapter } from "../domain/session/index.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import { Backend } from "../ports/backend.js";
import {
  makeStepStartedTelemetryEvent,
  makeStepCompletedTelemetryEvent,
  makeArtifactGeneratedTelemetryEvent,
} from "../domain/telemetry/events.js";
import type { RunId } from "../domain/branded.js";
import { loadOrExtractPlan } from "./loadOrExtractPlan.js";
import type { ProviderId } from "../schemas/providerId.js";

const GLOBAL_RECONCILIATION_FILENAME = "global-file-reconciliation.json";
const ADJUST_PLAN_SESSION_FILENAME = "session.json";
const ADJUST_PLAN_SESSIONS_DIR = "adjust-plan-sessions";

function slugify(path: string): string {
  return path
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export interface PrepareAdjustResultReady {
  readonly kind: "ready";
  readonly invocation: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly cwd: string;
  };
  readonly mode: "new" | "resume";
}

export interface PrepareAdjustResultUnsupported {
  readonly kind: "unsupported";
  readonly message: string;
}

export interface PrepareAdjustResultRefused {
  readonly kind: "refused";
  readonly message: string;
}

export type PrepareAdjustResult =
  | PrepareAdjustResultReady
  | PrepareAdjustResultUnsupported
  | PrepareAdjustResultRefused;

export interface PrepareAdjustPlanSessionOpts {
  readonly planPath: string;
  readonly planMarkdown: string;
  readonly runPath: string;
  readonly runKey: string;
  readonly provider: ProviderId;
  readonly cwd: string;
  readonly extract: {
    readonly model: string;
    readonly effort: string;
    readonly stateRoot: string;
  };
  readonly newSession: boolean;
  readonly nowIso: string;
  readonly modelOverride?: string;
  readonly effortOverride?: string;
  readonly model: string;
  readonly effort: string;
}

export function prepareAdjustPlanSession(
  opts: PrepareAdjustPlanSessionOpts,
): Effect.Effect<PrepareAdjustResult, FsError, FileSystem | SystemTelemetry | Backend> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const telemetry = yield* SystemTelemetry;
    const runId = opts.runKey as RunId;
    const operationId = opts.runKey;
    const step = "plan.adjust.prepare";

    yield* telemetry.recordEvent(makeStepStartedTelemetryEvent({ runId, operationId, step }));

    const sessionDir = join(opts.runPath, ADJUST_PLAN_SESSIONS_DIR, slugify(opts.planPath));
    const sessionRecordPath = join(sessionDir, ADJUST_PLAN_SESSION_FILENAME);
    const promptPath = join(sessionDir, ADJUST_PLAN_PROMPT_FILENAME);

    // Attempt to resume if a valid session record exists and newSession is false
    let existingSession: AdjustPlanSession | undefined;
    if (!opts.newSession) {
      const sessionReadResult = yield* Effect.either(fs.readText(sessionRecordPath));
      if (Either.isRight(sessionReadResult)) {
        try {
          const sessionJson = JSON.parse(sessionReadResult.right) as unknown;
          const decoded = decodeAdjustPlanSession(sessionJson);
          if (Either.isRight(decoded)) {
            existingSession = decoded.right;
          }
        } catch {
          // Malformed JSON — treat as no record, fall through to new session
        }
      }
    }

    if (existingSession !== undefined) {
      // Resume branch
      const adapter = getSessionAdapter(opts.provider);
      const invocation = adapter.buildPrePromptedInvocation({
        cwd: opts.cwd,
        sessionId: existingSession.sessionId,
        initialPrompt: null,
        ...(opts.modelOverride !== undefined ? { model: opts.modelOverride } : {}),
        ...(opts.effortOverride !== undefined ? { effort: opts.effortOverride } : {}),
      });

      if ("unsupported" in invocation) {
        yield* telemetry.recordEvent(
          makeStepCompletedTelemetryEvent({ runId, operationId, step, result: "failure" }),
        );
        return {
          kind: "unsupported",
          message: invocation.unsupported,
        } satisfies PrepareAdjustResult;
      }

      const updated: AdjustPlanSession = { ...existingSession, updatedAt: opts.nowIso };
      yield* fs.writeAtomic(
        sessionRecordPath,
        JSON.stringify(encodeAdjustPlanSession(updated), null, 2),
      );

      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({ runId, operationId, step, result: "success" }),
      );

      return { kind: "ready", invocation, mode: "resume" } satisfies PrepareAdjustResult;
    }

    // New session branch
    const sessionId = randomUUID();

    // Read and decode global-file-reconciliation.json
    const reconciliationPath = join(opts.runPath, GLOBAL_RECONCILIATION_FILENAME);
    const reconciliationReadResult = yield* Effect.either(fs.readText(reconciliationPath));

    if (Either.isLeft(reconciliationReadResult)) {
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({ runId, operationId, step, result: "failure" }),
      );
      return {
        kind: "refused",
        message:
          `The run at "${opts.runPath}" has no global-file-reconciliation.json. ` +
          `The run must have reached the review stage before adjust-plan can be used.`,
      } satisfies PrepareAdjustResult;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(reconciliationReadResult.right) as unknown;
    } catch {
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({ runId, operationId, step, result: "failure" }),
      );
      return {
        kind: "refused",
        message: `Failed to parse global-file-reconciliation.json at "${reconciliationPath}".`,
      } satisfies PrepareAdjustResult;
    }

    const decodeResult = decodeGlobalFileReconciliation(parsed);
    if (Either.isLeft(decodeResult)) {
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({ runId, operationId, step, result: "failure" }),
      );
      return {
        kind: "refused",
        message: `Failed to decode global-file-reconciliation.json at "${reconciliationPath}": ${String(decodeResult.left)}`,
      } satisfies PrepareAdjustResult;
    }

    const reconciliation = decodeResult.right;
    const added: string[] = [];
    const modified: string[] = [];
    const deletedOrRenamed: string[] = [];
    for (const entry of reconciliation.files) {
      const actions = entry.actualActions;
      if (actions.includes("added")) added.push(entry.path);
      if (actions.includes("modified")) modified.push(entry.path);
      if (actions.includes("deleted") || actions.includes("renamed")) {
        deletedOrRenamed.push(entry.path);
      }
    }

    const landedInput: LandedInput = {
      id: opts.runPath,
      label: opts.runKey,
      added,
      modified,
      deletedOrRenamed,
    };
    const landedFootprint = buildLandedFootprint(landedInput);

    // Try to compute deterministic impact. If extraction fails, omit impact and continue.
    type ImpactBlock = NonNullable<Parameters<typeof buildAdjustPlanPrompt>[0]["impact"]>;
    let impact: ImpactBlock | undefined;

    const targetPlanResult = yield* Effect.either(
      loadOrExtractPlan({
        planMdPath: opts.planPath,
        model: opts.extract.model,
        effort: opts.extract.effort,
        stateRoot: opts.extract.stateRoot,
        nowIso: opts.nowIso,
        noExtract: false,
      }),
    );

    if (Either.isRight(targetPlanResult)) {
      const { plan } = targetPlanResult.right;
      const targetInput = {
        id: opts.planPath,
        label: opts.planPath,
        phases: plan.phases.map((p) => ({
          create: p.plannedFilesToCreate,
          edit: p.plannedFilesToEdit,
          optional: p.optionalFilesToEdit,
        })),
      };
      const targetFootprint = buildFootprint(targetInput);
      const impactResult = computeReadjustmentImpact(landedFootprint, [targetFootprint]);
      if (impactResult.impacted.length > 0) {
        const impactedPlan = impactResult.impacted[0]!;
        impact = { shared: impactedPlan.shared, severity: impactedPlan.severity };
      }
    }
    // If extraction fails, impact remains undefined — proceed without it

    const promptContent = buildAdjustPlanPrompt({
      planPath: opts.planPath,
      planMarkdown: opts.planMarkdown,
      landedLabel: opts.runKey,
      landedChanges: { added, modified, deletedOrRenamed },
      ...(impact !== undefined ? { impact } : {}),
    });

    // Resolve the invocation before writing any files so an unsupported provider
    // does not leave a leaked prompt file on disk.
    const adapter = getSessionAdapter(opts.provider);
    const positionalPrompt = buildAdjustPlanPositionalPrompt(promptPath);
    const invocation = adapter.buildPrePromptedInvocation({
      cwd: opts.cwd,
      sessionId,
      initialPrompt: positionalPrompt,
      model: opts.model,
      effort: opts.effort,
    });

    if ("unsupported" in invocation) {
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({ runId, operationId, step, result: "failure" }),
      );
      return {
        kind: "unsupported",
        message: invocation.unsupported,
      } satisfies PrepareAdjustResult;
    }

    yield* fs.mkdirp(sessionDir);
    yield* fs.writeAtomic(promptPath, promptContent);

    yield* telemetry.recordEvent(
      makeArtifactGeneratedTelemetryEvent({
        runId,
        operationId,
        artifact: ADJUST_PLAN_PROMPT_FILENAME,
        path: promptPath,
      }),
    );

    const sessionRecord: AdjustPlanSession = {
      version: 1,
      planPath: opts.planPath,
      landedRunKey: opts.runKey,
      provider: opts.provider,
      sessionId,
      cwd: opts.cwd,
      createdAt: opts.nowIso,
      updatedAt: opts.nowIso,
    };
    yield* fs.writeAtomic(
      sessionRecordPath,
      JSON.stringify(encodeAdjustPlanSession(sessionRecord), null, 2),
    );

    yield* telemetry.recordEvent(
      makeStepCompletedTelemetryEvent({ runId, operationId, step, result: "success" }),
    );

    return { kind: "ready", invocation, mode: "new" } satisfies PrepareAdjustResult;
  });
}
