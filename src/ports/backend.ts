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

export interface AgentRunOptions {
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  readonly cwd: string;
  readonly security: SecurityPolicy;
  /**
   * Gate commands for this phase (resolved gate profile). In secure mode the
   * provider allowlists these as sandboxed Bash so the agent can run — and fix —
   * the gates it is instructed to verify. Absent/empty means no Bash is granted.
   */
  readonly gateCommands?: readonly string[] | undefined;
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
}

export class Backend extends Context.Tag("phax/Backend")<Backend, BackendOps>() {}
