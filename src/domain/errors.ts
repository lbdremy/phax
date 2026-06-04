import { Data } from "effect";

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
