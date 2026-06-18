import { Context, Effect } from "effect";
import type { ClaudeSessionId } from "../domain/branded.js";
import type {
  AgentInvocationError,
  AgentSessionIdMissingError,
  RateLimitError,
  SecurityEnforcementError,
  UsageLimitError,
} from "../domain/errors.js";
import type { ProviderId } from "../domain/routing/types.js";
import type { SecurityPolicy } from "../domain/security/types.js";
import type { FsError } from "./fs.js";

export interface CompletionOptions {
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  readonly cwd: string;
}

export interface CompletionResult {
  readonly finalText: string;
}

export interface AgentRunOptions {
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  readonly cwd: string;
  readonly security: SecurityPolicy;
  /**
   * The frozen effective agent commands for this phase (config ∪ gate commands,
   * computed before the agent spawns). In secure mode the claude provider
   * allowlists these as sandboxed Bash so the agent can run the commands it
   * needs. Absent/empty means no Bash is granted (claude) or sandbox-only
   * (codex/vibe). Recorded in security.json regardless of provider.
   */
  readonly agentCommands?: readonly string[] | undefined;
  readonly outputJsonlPath?: string | undefined;
  readonly phaseFolderPath?: string | undefined;
}

export interface AgentRunResult {
  readonly sessionId: ClaudeSessionId;
  readonly outputPath: string;
  readonly finalText: string;
}

export interface BackendOps {
  runAgent(
    prompt: string,
    options: AgentRunOptions,
  ): Effect.Effect<
    AgentRunResult,
    AgentInvocationError | RateLimitError | UsageLimitError | SecurityEnforcementError | FsError
  >;

  resumeAgentSession(
    sessionId: ClaudeSessionId,
    prompt: string,
    options: AgentRunOptions,
  ): Effect.Effect<
    AgentRunResult,
    | AgentInvocationError
    | AgentSessionIdMissingError
    | RateLimitError
    | UsageLimitError
    | SecurityEnforcementError
    | FsError
  >;

  complete(
    prompt: string,
    options: CompletionOptions,
  ): Effect.Effect<
    CompletionResult,
    AgentInvocationError | RateLimitError | UsageLimitError | FsError
  >;
}

export class Backend extends Context.Tag("phax/Backend")<Backend, BackendOps>() {}
