import { Context, Effect } from "effect";
import type { ClaudeSessionId } from "../domain/branded.js";
import type {
  AgentInvocationError,
  AgentSessionFailedError,
  RateLimitError,
  SecurityEnforcementError,
  UsageLimitError,
} from "../domain/errors.js";
import type { ProviderId } from "../domain/routing/types.js";
import type { ProtectedList } from "../domain/security/protectedPaths.js";
import type { SecurityPolicy } from "../domain/security/types.js";
import type { StructuredValue } from "../domain/session/outcome.js";
import type { FsError } from "./fs.js";

export interface CompletionOptions {
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  readonly cwd: string;
}

export interface CompletionResult {
  readonly finalText: string;
  /** The provider's native structured answer (Claude Code's `structured_output`), else null. */
  readonly structured: StructuredValue | null;
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
   * The protected list: phax.json's `protectedPaths` plus the loaded phax.json.
   * In secure mode the claude and Vibe providers derive native deny rules from
   * it; codex ignores it. Absent means nothing is declared.
   */
  readonly protectedPaths?: ProtectedList | undefined;
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
  /** The provider's native structured answer (Claude Code's `structured_output`), else null. */
  readonly structured: StructuredValue | null;
}

/** One recorded session whose transcript is asked for, in its provider's own store. */
export interface TranscriptRequest {
  readonly provider: ProviderId;
  readonly sessionId: string;
  /** When the session started (ISO-8601): codex files its sessions by date. */
  readonly startedAt: string;
  /** The stop's worktree, where the session ran: Claude Code files its sessions by it. */
  readonly cwd: string;
  /**
   * The stop's phase folder: vibe keeps no session store phax reads, so its
   * transcript is the turn streams kept directly in this folder.
   */
  readonly phaseFolder: string;
}

/** A transcript's bytes exactly as the provider stored them, or why they could not be read. */
export type TranscriptRead =
  | { readonly status: "found"; readonly bytes: Uint8Array }
  | {
      readonly status: "missing";
      readonly reason: "not-found" | "unreadable";
      readonly detail: string;
    };

/**
 * The agent operations below read every ended session through its provider's
 * outcome reader (src/domain/session/outcome.ts). A session that ended without
 * an answer fails with `AgentSessionFailedError`, or with `RateLimitError` /
 * `UsageLimitError` for the limit kinds, each carrying the paths of its
 * agent-error.log and transcript when they exist. `AgentInvocationError` and
 * `SecurityEnforcementError` are phax's own refusals, or a spawn that failed.
 */
export interface BackendOps {
  runAgent(
    prompt: string,
    options: AgentRunOptions,
  ): Effect.Effect<
    AgentRunResult,
    | AgentInvocationError
    | AgentSessionFailedError
    | RateLimitError
    | UsageLimitError
    | SecurityEnforcementError
    | FsError
  >;

  resumeAgentSession(
    sessionId: ClaudeSessionId,
    prompt: string,
    options: AgentRunOptions,
  ): Effect.Effect<
    AgentRunResult,
    | AgentInvocationError
    | AgentSessionFailedError
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
    AgentInvocationError | AgentSessionFailedError | RateLimitError | UsageLimitError | FsError
  >;

  /**
   * A one-message Claude Code invocation with no tools. It returns the raw
   * stream-json lines, the exit code whatever that code is, and stderr, or
   * `timed-out` once it has been stopped at `timeoutMs`; it never classifies
   * rate limits and keeps no session. Claude Code only, so it takes no
   * provider option. A spawn failure is an `AgentInvocationError`.
   */
  probe(prompt: string, options: ProbeOptions): Effect.Effect<ProbeResult, AgentInvocationError>;

  /**
   * Find one session's transcript and read its bytes: Claude Code and codex
   * from their own session store, under the `ProviderStoreRoots` the backend
   * was built with; vibe from the turn streams kept in `request.phaseFolder`
   * (it has no store phax reads). It writes nothing and never fails: an
   * unsafe session id, an absent file or any I/O error is a `missing` read.
   * It reads only that session's transcript, never a credential or
   * configuration file.
   */
  captureTranscript(request: TranscriptRequest): Effect.Effect<TranscriptRead, never>;
}

export class Backend extends Context.Tag("phax/Backend")<Backend, BackendOps>() {}
