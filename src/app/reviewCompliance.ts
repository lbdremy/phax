import { Effect, Either } from "effect";
import { join } from "node:path";
import type { RunReviewInfo } from "../domain/runReviewInfo.js";
import type { ResolvedComplianceReviewConfig, ResolvedConfig } from "../schemas/phaxConfig.js";
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
  encodeComplianceReviewFile,
  type ComplianceReview,
  type Verdict,
} from "../schemas/complianceReview.js";
import { withSchemaUrl } from "../schemas/persisted.js";
import { Backend } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { Git } from "../ports/git.js";
import type { GitHub } from "../ports/github.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import { pushRecordsBranch, recordsClonePath } from "./recordsSync.js";
import { loadConfig, locateWorkingTree } from "./loadConfig.js";
import {
  reviewRecordPushWarning,
  reviewRecordWarning,
  writeReviewRecord,
  type ReviewRecordPush,
  type ReviewRecordStatus,
} from "./writeReviewRecord.js";
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
  _opts: ReviewComplianceOpts,
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

    const phaxContextPath = join(info.worktreePath, ".phax-context");
    yield* fs.mkdirp(phaxContextPath);

    const agentMdPath = join(phaxContextPath, COMPLIANCE_REVIEW_MD_FILENAME);
    const agentJsonPath = join(phaxContextPath, COMPLIANCE_REVIEW_JSON_FILENAME);
    // A previous review's files in the worktree would be read back as this
    // one's when its session writes none: only what this invocation writes
    // counts (and becomes a records entry).
    for (const stale of [agentMdPath, agentJsonPath]) {
      if (yield* fs.exists(stale)) yield* fs.remove(stale);
    }

    const prompt = buildCompliancePrompt({
      planMd: planReadResult.right,
      reconciliationMd: reconciliationReadResult.right,
      phases: info.planPhases,
      phaseHandoffs,
      reviewedPhases,
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
      withInvocationCost(
        backend.runAgent(prompt, {
          provider: resolution.selected.provider,
          model: resolution.selected.concreteModel,
          effort: resolution.selected.thinking ?? config.effort,
          cwd: info.worktreePath,
          security: policy,
          outputJsonlPath,
        }),
        {
          role: "compliance",
          phase: null,
          runId,
          runPath: info.runPath,
          provider: resolution.selected.provider,
          streamPath: outputJsonlPath,
        },
      ),
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

    // The agent's verdict carries the contract's `version`; the persisted
    // review carries `$schema` instead.
    const { version: _version, ...review } = decodeResult.right;
    const durableJsonPath = join(info.runPath, COMPLIANCE_REVIEW_JSON_FILENAME);
    yield* fs.writeAtomic(
      durableJsonPath,
      JSON.stringify(
        encodeComplianceReviewFile(withSchemaUrl("compliance-review", review)),
        null,
        2,
      ),
    );

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

export interface ComplianceRecordTarget {
  readonly kind: "project";
  readonly records: ResolvedRecordsConfig;
  readonly repoRoot: string;
  /** The local records clone, required for a dedicated `repo` destination. */
  readonly recordsClonePath?: string | undefined;
  /** Push the entry now (by hand), or `null` to leave it to publish's records push. */
  readonly push: { readonly publishRemote: string } | null;
}

/** The run's own project could not be read: no entry is written anywhere. */
export interface ComplianceRecordUnresolved {
  readonly kind: "unresolved";
  readonly reason: string;
}

export interface ComplianceReviewRecordOutcome {
  readonly review: ComplianceReviewResult;
  readonly record:
    | ReviewRecordStatus
    | { readonly kind: "no-entry" }
    | { readonly kind: "unresolved"; readonly reason: string };
  readonly push: ReviewRecordPush;
}

/**
 * Run the compliance review, then keep the compliance-review.json it wrote
 * as a `compliance-review` entry on the records branch of the run's own
 * project. A records concern never fails the review: the outcome reports it
 * for the caller to warn about.
 */
export function reviewComplianceAndRecord(
  info: RunReviewInfo,
  config: ResolvedComplianceReviewConfig,
  resolution: RoutingResolution,
  security: { mode: SecurityMode; config: ResolvedSecurityConfig },
  target: ComplianceRecordTarget | ComplianceRecordUnresolved,
  opts: ReviewComplianceOpts,
): Effect.Effect<
  ComplianceReviewRecordOutcome,
  FsError,
  Backend | FileSystem | SystemTelemetry | Git | GitHub
> {
  return Effect.gen(function* () {
    const review = yield* reviewCompliance(info, config, resolution, security, opts);
    // Only a compliance-review.json written by this invocation is an entry.
    if (review.kind !== "generated" || review.review === undefined) {
      const none: ComplianceReviewRecordOutcome = {
        review,
        record: { kind: "no-entry" },
        push: { kind: "no-record" },
      };
      return none;
    }
    if (target.kind === "unresolved") {
      const unresolved: ComplianceReviewRecordOutcome = {
        review,
        record: { kind: "unresolved", reason: target.reason },
        push: { kind: "no-record" },
      };
      return unresolved;
    }
    const record = yield* writeReviewRecord({
      repoRoot: target.repoRoot,
      recordsClonePath: target.recordsClonePath,
      records: target.records,
      runId: info.runId,
      runPath: info.runPath,
      review: "compliance-review",
    });
    let push: ReviewRecordPush = { kind: "no-record" };
    if (record.kind === "written") {
      push =
        target.push === null
          ? { kind: "left-to-publish" }
          : yield* pushRecordsBranch({
              records: target.records,
              repoRoot: target.repoRoot,
              publishRemote: target.push.publishRemote,
              recordsClonePath: target.recordsClonePath,
            });
    }
    return { review, record, push };
  });
}

/**
 * The warnings an entry's outcome deserves, in the order an operator reads
 * them. `retryCommand` is the command that records a new review of this run.
 */
export function complianceRecordWarnings(
  outcome: ComplianceReviewRecordOutcome,
  retryCommand: string,
): readonly string[] {
  const warnings: string[] = [];
  if (outcome.record.kind === "unresolved") {
    warnings.push(
      `compliance-review entry not written: ${outcome.record.reason} — compliance-review.json stays in the run folder; fix that, then rerun \`${retryCommand}\` to record a new review`,
    );
  } else if (outcome.record.kind !== "no-entry") {
    const warning = reviewRecordWarning(outcome.record, "compliance-review", retryCommand);
    if (warning !== undefined) warnings.push(warning);
  }
  const pushWarning = reviewRecordPushWarning(outcome.push);
  if (pushWarning !== undefined) warnings.push(pushWarning);
  return warnings;
}

/** The line a written entry deserves (`Recorded: <key> (<sha8>)[, pushed to <remote>]`), or undefined. */
export function complianceRecordNotice(outcome: ComplianceReviewRecordOutcome): string | undefined {
  if (outcome.record.kind !== "written") return undefined;
  const pushed = outcome.push.kind === "pushed" ? `, pushed to ${outcome.push.remote}` : "";
  return `Recorded: ${outcome.record.key} (${outcome.record.commitSha.slice(0, 8)})${pushed}`;
}

/**
 * Where a by-hand review of a run is recorded: the records of the run's own
 * project, never the project the command runs from. A run of the current
 * project uses the current config; a run of another project (`crossProject`)
 * reads that project's config from the main checkout of the run's final
 * worktree. When that project cannot be read, no entry is written anywhere.
 */
export function complianceRecordTargetFor(input: {
  readonly config: ResolvedConfig;
  readonly namespace: string;
  readonly info: RunReviewInfo;
  readonly crossProject: boolean;
}): ComplianceRecordTarget | ComplianceRecordUnresolved {
  let project = input.config;
  if (input.crossProject) {
    const tree = locateWorkingTree(input.info.worktreePath);
    if (tree === undefined) {
      return {
        kind: "unresolved",
        reason: `the run's project could not be found: its worktree ${input.info.worktreePath} is not a git working tree`,
      };
    }
    const loaded = loadConfig(tree.mainRoot);
    if (Either.isLeft(loaded)) {
      return {
        kind: "unresolved",
        reason: `the run's project config at ${tree.mainRoot} could not be loaded (${loaded.left.message})`,
      };
    }
    if (loaded.right.namespace !== input.namespace) {
      return {
        kind: "unresolved",
        reason: `the project at ${tree.mainRoot} is "${loaded.right.namespace}", not the run's "${input.namespace}"`,
      };
    }
    project = loaded.right;
  }
  return {
    kind: "project",
    records: project.records,
    repoRoot: project.repoRoot,
    ...(project.records.destination.kind === "repo"
      ? { recordsClonePath: recordsClonePath(project.stateRoot, input.namespace) }
      : {}),
    push: { publishRemote: project.publish.remote },
  };
}
