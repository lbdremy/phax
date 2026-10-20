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

export interface ProbeOptions {
  readonly model: string;
  readonly effort: string;
  /** The probe is stopped, and reported timed out, past this. */
  readonly timeoutMs: number;
}

/** How a probe that started went: it ended with an exit code, or was stopped at its timeout. */
export type ProbeResult =
  | {
      readonly kind: "ended";
      readonly lines: readonly string[];
      readonly exitCode: number;
      readonly stderr: string;
    }
  | { readonly kind: "timed-out" };

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
  /**
   * The repo-relative `.claude/skills/**` files this phase may edit, granted by
   * `--allow-skill-edits`. In secure mode the claude provider lets exactly
   * these files through its protected-path check. Recorded in security.json
   * regardless of provider. Absent/empty means nothing is granted; review and
   * headless authoring never set it.
   */
  readonly skillEditGrants?: readonly string[] | undefined;
  /**
   * A session that answers and never writes (decide's handback, headless
   * authoring). The claude provider keeps only its reading tools, plus the
   * shell for exactly `agentCommands`, whatever `security` allows. Absent
   * means the policy alone governs.
   */
  readonly readOnly?: boolean | undefined;
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

  /**
   * A one-message Claude Code invocation with no tools. It returns the raw
   * stream-json lines, the exit code whatever that code is, and stderr, or
   * `timed-out` once it has been stopped at `timeoutMs`; it never classifies
   * rate limits and keeps no session. Claude Code only, so it takes no
   * provider option. A spawn failure is an `AgentInvocationError`.
   */
  probe(prompt: string, options: ProbeOptions): Effect.Effect<ProbeResult, AgentInvocationError>;
}

export class Backend extends Context.Tag("phax/Backend")<Backend, BackendOps>() {}
