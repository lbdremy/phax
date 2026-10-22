import type { PhaseAgentBinding } from "../../schemas/phaseAgentBinding.js";
import type { SecurityPolicy } from "../security/types.js";

export type ResumeInvocation =
  | { readonly executable: string; readonly args: readonly string[]; readonly cwd: string }
  | { readonly unsupported: string };

export interface PrePromptedInvocationOpts {
  readonly cwd: string;
  readonly sessionId: string;
  readonly initialPrompt: string | null; // null => resume; string => start new
  readonly model?: string;
  readonly effort?: string;
}

/** Whether phax has verified a provider's interactive resume of a session. */
export type InteractiveResumeSupport = "verified" | "unverified";

/**
 * A command a person runs in the stopped phase's worktree: the continue
 * command of a session, or the fresh start of a new one. `env` holds the
 * variables the command needs beyond the person's own.
 */
export interface StopCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

export type StopCommandResult = StopCommand | { readonly unsupported: string };

/**
 * The posture a stop command carries: the phase's policy, rebuilt from its
 * `security.json`, with its frozen agent commands; or `none` for a session
 * that carries no phase flags.
 */
export type StopPosture =
  | { readonly policy: SecurityPolicy; readonly agentCommands: readonly string[] }
  | "none";

interface StopCommandOpts {
  readonly cwd: string;
  /** The resolved concrete model (for codex, through `codexModelId`). */
  readonly model: string;
  readonly effort: string;
  readonly posture: StopPosture;
}

export interface ContinueCommandOpts extends StopCommandOpts {
  readonly sessionId: string;
}

export interface FreshStartCommandOpts extends StopCommandOpts {
  /** The first message of the new session. */
  readonly prompt: string;
  /** The environment variable a provider reads its model from; vibe only. */
  readonly modelEnvVar?: string;
}

export interface SessionAdapter {
  /** `verified` only where phax has run the provider's interactive resume. */
  readonly interactiveResume: InteractiveResumeSupport;
  buildResumeInvocation(binding: PhaseAgentBinding): ResumeInvocation;
  buildPrePromptedInvocation(opts: PrePromptedInvocationOpts): ResumeInvocation;
  /** The interactive resume of `sessionId` in the worktree, or `unsupported`. */
  buildContinueCommand(opts: ContinueCommandOpts): StopCommandResult;
  /** A new interactive session started by hand in the worktree. */
  buildFreshStartCommand(opts: FreshStartCommandOpts): StopCommandResult;
  describe(binding: PhaseAgentBinding): string;
}
