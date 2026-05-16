import { Context, Effect } from "effect";
import type { ClaudeSessionId } from "../domain/branded.js";
import type {
  ClaudeInvocationError,
  ClaudeSessionIdMissingError,
  RateLimitError,
  UsageLimitError,
} from "../domain/errors.js";
import type { FsError } from "./fs.js";

export interface AgentRunOptions {
  readonly model: string;
  readonly effort: string;
  readonly cwd: string;
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
    ClaudeInvocationError | RateLimitError | UsageLimitError | FsError
  >;

  resumeAgentSession(
    sessionId: ClaudeSessionId,
    prompt: string,
    options: AgentRunOptions,
  ): Effect.Effect<
    AgentRunResult,
    ClaudeInvocationError | ClaudeSessionIdMissingError | RateLimitError | UsageLimitError | FsError
  >;
}

export class Backend extends Context.Tag("phax/Backend")<Backend, BackendOps>() {}
