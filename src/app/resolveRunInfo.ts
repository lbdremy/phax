import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Either } from "effect";
import type { ShortName } from "../domain/branded.js";
import { decodeBranchName } from "../domain/branded.js";
import type { RunReviewInfo } from "../domain/runReviewInfo.js";
import { decodeRunStatus, decodePhaseStatus, type PhaseStatus } from "../schemas/status.js";
import { decodePhaxPlan } from "../schemas/phaxPlan.js";

export type { RunReviewInfo };

export interface PhaseInfo {
  readonly shortName: string;
  readonly runId: string;
  readonly runState: string;
  readonly stateRoot: string;
  readonly runPath: string;
  readonly phaseStatus: PhaseStatus;
  readonly planPhases: ReadonlyArray<{ id: string; title: string }>;
  readonly stoppedReason: string | undefined;
  readonly lastError: string | undefined;
}

const TERMINAL_PHASE_STATES = new Set([
  "cleaned_up",
  "review_open",
  "failed",
  "skipped",
  "handoff_failed",
]);

export function findCurrentPhase(phaseStatuses: readonly PhaseStatus[]): PhaseStatus | undefined {
  return phaseStatuses
    .filter((p) => !TERMINAL_PHASE_STATES.has(p.state))
    .toSorted((a, b) => b.phaseIndex - a.phaseIndex)[0];
}

function tryReadJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function loadRunReviewInfo(
  runPath: string,
  stateRoot: string,
): Either.Either<RunReviewInfo, string> {
  const runStatusPath = join(runPath, "run-status.json");
  if (!existsSync(runStatusPath)) {
    return Either.left(`No run-status.json at "${runPath}"`);
  }

  const rawRunStatus = tryReadJson(runStatusPath);
  const runStatusResult = decodeRunStatus(rawRunStatus);
  if (Either.isLeft(runStatusResult)) {
    return Either.left(`Invalid run-status.json at "${runPath}"`);
  }
  const runStatus = runStatusResult.right;

  const rawPlan = tryReadJson(join(runPath, "phax-plan.json"));
  const planResult = decodePhaxPlan(rawPlan);
  const plan = Either.isRight(planResult) ? planResult.right : undefined;

  const branch = plan?.run.branch ?? "(unknown)";
  const runTitle = plan?.run.title;
  const planPhases = plan?.phases.map((p) => ({ id: p.id, title: p.title })) ?? [];

  const phaseStatuses: PhaseStatus[] = [];
  let entries: string[];
  try {
    entries = readdirSync(runPath);
  } catch {
    entries = [];
  }
  const phaseDirs = entries.filter((e) => /^phase-\d{2}$/.test(e)).toSorted();
  for (const dir of phaseDirs) {
    const raw = tryReadJson(join(runPath, dir, "status.json"));
    if (raw === undefined) continue;
    const decoded = decodePhaseStatus(raw);
    if (Either.isRight(decoded)) {
      phaseStatuses.push(decoded.right);
    }
  }

  const finalPhaseStatus = phaseStatuses.toSorted((a, b) => b.phaseIndex - a.phaseIndex)[0];

  if (!finalPhaseStatus) {
    return Either.left(`No phase statuses found at "${runPath}"`);
  }

  const finalPlanPhase = planPhases.find((p) => p.id === finalPhaseStatus.phaseId);

  const finalPhaseBranchResult = decodeBranchName(`${branch}--${finalPhaseStatus.phaseId}`);
  if (Either.isLeft(finalPhaseBranchResult)) {
    return Either.left(`Cannot compute final phase branch for run at "${runPath}"`);
  }
  const finalPhaseBranch = finalPhaseBranchResult.right;

  return Either.right({
    shortName: runStatus.shortName,
    runId: runStatus.runId,
    runState: runStatus.state,
    branch,
    runTitle,
    finalPhaseBranch,
    stateRoot,
    runPath,
    finalPhaseId: finalPhaseStatus.phaseId,
    finalPhaseTitle: finalPlanPhase?.title ?? finalPhaseStatus.phaseId,
    worktreePath: finalPhaseStatus.worktreePath ?? "",
    claudeSessionId: finalPhaseStatus.claudeSessionId,
    gateProfileId: runStatus.gateProfileId,
    phaseStatuses,
    planPhases,
    updatedAt: runStatus.updatedAt,
    stoppedReason: runStatus.stoppedReason,
    lastError: runStatus.lastError,
  });
}

export function resolveRunByShortName(
  shortName: ShortName,
  stateRoot: string,
): Either.Either<RunReviewInfo, string> {
  return loadRunReviewInfo(join(stateRoot, "runs", shortName), stateRoot);
}

export function resolvePhaseInfo(
  shortName: ShortName,
  phaseId: string,
  stateRoot: string,
): Either.Either<PhaseInfo, string> {
  const runPath = join(stateRoot, "runs", shortName);
  const infoResult = loadRunReviewInfo(runPath, stateRoot);
  if (Either.isLeft(infoResult)) return Either.left(infoResult.left);
  const info = infoResult.right;

  const phaseStatus = info.phaseStatuses.find((p) => p.phaseId === phaseId);
  if (!phaseStatus) {
    return Either.left(`Phase "${phaseId}" not found in run "${shortName}"`);
  }

  return Either.right({
    shortName: info.shortName,
    runId: info.runId,
    runState: info.runState,
    stateRoot,
    runPath,
    phaseStatus,
    planPhases: info.planPhases,
    stoppedReason: info.stoppedReason,
    lastError: info.lastError,
  });
}
