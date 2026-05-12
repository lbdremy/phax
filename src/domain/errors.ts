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

export class ClaudeInvocationError extends Data.TaggedError("ClaudeInvocationError")<{
  message: string;
  exitCode?: number | undefined;
  stderr?: string | undefined;
}> {}

export class ClaudeSessionIdMissingError extends Data.TaggedError("ClaudeSessionIdMissingError")<{
  message: string;
  outputPath: string;
}> {}

export class GateFailedError extends Data.TaggedError("GateFailedError")<{
  message: string;
  command: string;
  exitCode: number;
  logPath: string;
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

export class InvalidTransitionError extends Data.TaggedError("InvalidTransitionError")<{
  from: string;
  to: string;
  entity: "run" | "phase";
}> {
  override get message(): string {
    return `Invalid ${this.entity} state transition: ${this.from} → ${this.to}`;
  }
}
