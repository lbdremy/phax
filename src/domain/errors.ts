import { Data } from "effect";
import type { PlanStalenessVerdict } from "./artifact/lineage.js";

export class PlanValidationError extends Data.TaggedError("PlanValidationError")<{
  message: string;
  path?: string | undefined;
}> {}

export class ConfigValidationError extends Data.TaggedError("ConfigValidationError")<{
  message: string;
  path?: string | undefined;
}> {}

export class UnsafeGitStateError extends Data.TaggedError("UnsafeGitStateError")<{
  message: string;
  repoPath: string;
}> {}

export class WorktreeCreationError extends Data.TaggedError("WorktreeCreationError")<{
  message: string;
  branch: string;
  path: string;
}> {}

export class SetupCommandFailedError extends Data.TaggedError("SetupCommandFailedError")<{
  message: string;
  command: string;
  exitCode: number;
  stderr: string;
}> {}

export class AgentInvocationError extends Data.TaggedError("AgentInvocationError")<{
  message: string;
  exitCode?: number | undefined;
  stderr?: string | undefined;
  argv?: readonly string[];
  stderrExcerpt?: string;
  expected?: string;
  phaseFolderPath?: string | undefined;
}> {}

export class AgentSessionIdMissingError extends Data.TaggedError("AgentSessionIdMissingError")<{
  message: string;
  outputPath: string;
}> {}

export class RateLimitError extends Data.TaggedError("RateLimitError")<{
  message: string;
  rawMessage: string;
  resetAt?: string | undefined;
  phaseId?: string | undefined;
}> {}

export class UsageLimitError extends Data.TaggedError("UsageLimitError")<{
  message: string;
  rawMessage: string;
  resetAt?: string | undefined;
  phaseId?: string | undefined;
}> {}

export class GateFailedError extends Data.TaggedError("GateFailedError")<{
  message: string;
  command: string;
  exitCode: number;
  logPath: string;
  stderrExcerpt?: string;
}> {}

export class GateAttemptsExhaustedError extends Data.TaggedError("GateAttemptsExhaustedError")<{
  message: string;
  command: string;
  exitCode: number;
  logPath: string;
  attempt: number;
  phaseId: string;
}> {}

export class FixAttemptFailedError extends Data.TaggedError("FixAttemptFailedError")<{
  message: string;
  attempt: number;
  sessionId: string;
}> {}

export class ArchiveBlockedByDirtyWorktreeError extends Data.TaggedError(
  "ArchiveBlockedByDirtyWorktreeError",
)<{
  message: string;
  worktreePath: string;
}> {}

export class PhaseHadNoChangesError extends Data.TaggedError("PhaseHadNoChangesError")<{
  message: string;
  phaseId: string;
  worktreePath: string;
  runPath: string;
}> {}

export class HandoffPausedError extends Data.TaggedError("HandoffPausedError")<{
  message: string;
  phaseId: string;
  cause: unknown;
}> {}

/**
 * A phase reached its committed outcome but its records destination refused
 * the write (spec §5.4) — transcripts enabled with an in-repo destination on
 * a repo detected public, or an unacknowledged unknown visibility. This is a
 * deliberate policy refusal, not a transient write failure, so it fails the
 * run loudly rather than degrading to a warning.
 */
export class RecordsDestinationRefusedError extends Data.TaggedError(
  "RecordsDestinationRefusedError",
)<{
  message: string;
  phaseId: string;
  reason: string;
  remedy: string;
}> {}

export class CommitPausedError extends Data.TaggedError("CommitPausedError")<{
  message: string;
  phaseId: string;
  cause: unknown;
}> {}

export class CleanupPausedError extends Data.TaggedError("CleanupPausedError")<{
  message: string;
  phaseId: string;
  cause: unknown;
}> {}

export class ArtifactCompletionPausedError extends Data.TaggedError(
  "ArtifactCompletionPausedError",
)<{
  message: string;
  phaseId: string;
  cause: unknown;
}> {}

export class RegistryCorruptionError extends Data.TaggedError("RegistryCorruptionError")<{
  message: string;
  registryPath: string;
}> {}

export class LockConflictError extends Data.TaggedError("LockConflictError")<{
  message: string;
  shortName: string;
  lockPath: string;
  lockingPid: number;
}> {}

export class SecurityEnforcementError extends Data.TaggedError("SecurityEnforcementError")<{
  message: string;
  provider: string;
  mode: string;
}> {}

export class InvalidTransitionError extends Data.TaggedError("InvalidTransitionError")<{
  from: string;
  to: string;
  entity: "run" | "phase";
}> {
  override get message(): string {
    return `Invalid ${this.entity} state transition: ${this.from} → ${this.to}`;
  }
}

export class SecurityPreflightError extends Data.TaggedError("SecurityPreflightError")<{
  message: string;
  missing: readonly string[];
}> {}

export class ModelPreflightError extends Data.TaggedError("ModelPreflightError")<{
  message: string;
  failures: readonly {
    readonly phaseId: string;
    readonly model: string;
    readonly effort: string;
    readonly reasons: readonly string[];
    readonly alternatives: readonly {
      readonly id: string;
      readonly family: string;
      readonly efforts: readonly string[];
    }[];
  }[];
}> {}

export class ReviewHandoffArtifactMissingError extends Data.TaggedError(
  "ReviewHandoffArtifactMissingError",
)<{
  message: string;
  missingPhases: readonly string[];
  missingPaths: readonly string[];
}> {}

export class SkillInstallError extends Data.TaggedError("SkillInstallError")<{
  message: string;
}> {}

export class OrientProviderError extends Data.TaggedError("OrientProviderError")<{
  message: string;
  exitCode?: number;
  stderrExcerpt?: string;
}> {}

export class InvalidArtifactTransitionError extends Data.TaggedError(
  "InvalidArtifactTransitionError",
)<{
  kind: "spec" | "plan";
  from: string;
  to: string;
  legalTargets: readonly string[];
}> {
  override get message(): string {
    const targets =
      this.legalTargets.length > 0 ? this.legalTargets.join(", ") : "(none — terminal)";
    return `Invalid ${this.kind} status transition: ${this.from} → ${this.to}. Legal transitions from ${this.from}: ${targets}`;
  }
}

export class ArtifactValidationError extends Data.TaggedError("ArtifactValidationError")<{
  path: string;
  message: string;
}> {}

export class PlanNotApprovedError extends Data.TaggedError("PlanNotApprovedError")<{
  path: string;
  status: string;
  message: string;
}> {}

export class SpecNotApprovedError extends Data.TaggedError("SpecNotApprovedError")<{
  planPath: string;
  specPath: string;
  specStatus: string;
}> {
  override get message(): string {
    return `${this.planPath} declares Source-Spec: ${this.specPath}, but ${this.specPath} has status "${this.specStatus}" (not Approved) — approve the spec first`;
  }
}

export class SpecRetirementBlockedError extends Data.TaggedError("SpecRetirementBlockedError")<{
  specPath: string;
  dependents: readonly { readonly path: string; readonly status: string }[];
}> {
  override get message(): string {
    const names = this.dependents.map((d) => `${d.path} (${d.status})`).join(", ");
    return `${this.specPath} cannot be retired: it is still declared as Source-Spec by ${names} — abandon or complete them first`;
  }
}

export class ArtifactDirtyWriteSetError extends Data.TaggedError("ArtifactDirtyWriteSetError")<{
  paths: readonly string[];
}> {
  override get message(): string {
    const verb = this.paths.length === 1 ? "has" : "have";
    return `Transition refused: ${this.paths.join(", ")} ${verb} uncommitted changes — commit or stash them first`;
  }
}

export class ArtifactCommitFailedError extends Data.TaggedError("ArtifactCommitFailedError")<{
  paths: readonly string[];
  cause: string;
}> {
  override get message(): string {
    return `Transition wrote ${this.paths.join(", ")} but the commit failed: ${this.cause} — commit them manually`;
  }
}

export class PlanStaleError extends Data.TaggedError("PlanStaleError")<{
  path: string;
  verdict: PlanStalenessVerdict;
}> {
  override get message(): string {
    const remedy = `re-approve with "phax artifact approve ${this.path}"`;
    if (this.verdict.kind === "missing-record") {
      return `${this.path} is stale: ${this.verdict.detail} — ${remedy}`;
    }
    if (this.verdict.kind === "fresh") {
      return `${this.path} is fresh`;
    }
    const lines = this.verdict.evidence.map((e) => {
      if (e.reason === "spec-changed") return `spec-changed: ${e.specPath} changed since approval`;
      if (e.reason === "ground-changed") {
        return `ground-changed: ${e.files.join(", ")} changed since baseline ${e.baseline}`;
      }
      return "self-changed: the plan itself changed since approval";
    });
    return `${this.path} is stale (${lines.join("; ")}) — ${remedy}`;
  }
}
