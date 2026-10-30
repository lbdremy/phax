import { Effect, Layer } from "effect";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ClaudeSessionId } from "../../domain/branded.js";
import {
  AgentInvocationError,
  type AgentSessionFailedError,
  type RateLimitError,
  type UsageLimitError,
} from "../../domain/errors.js";
import type { ProviderId } from "../../domain/routing/types.js";
import {
  sessionFailureError,
  type SessionFailureFiles,
} from "../../domain/session/failureError.js";
import type { SessionFailure } from "../../domain/session/outcome.js";
import {
  Backend,
  type BackendOps,
  type AgentRunOptions,
  type AgentRunResult,
  type CompletionOptions,
  type CompletionResult,
  type ProbeOptions,
  type ProbeResult,
  type TranscriptRead,
  type TranscriptRequest,
} from "../../ports/backend.js";

interface RateLimitKnob {
  readonly kind: "rate_limit" | "usage_limit";
  readonly resetAt?: string | undefined;
}

/** A queued session failure: what the reader would have read, and the files the session left. */
interface FailureKnob {
  readonly failure: SessionFailure;
  readonly files: SessionFailureFiles;
}

/** A queued result as a test writes it: the structured value may be left out. */
type WithOptionalStructured<T extends { readonly structured: unknown }> = Omit<T, "structured"> &
  Partial<Pick<T, "structured">>;

type SessionError = AgentSessionFailedError | RateLimitError | UsageLimitError;

const NO_FILES: SessionFailureFiles = { agentErrorLog: null, transcript: null };

function failureKnob(failure: SessionFailure, files?: Partial<SessionFailureFiles>): FailureKnob {
  return { failure, files: { ...NO_FILES, ...files } };
}

export class FakeBackendImpl implements BackendOps {
  readonly runCalls: Array<{ prompt: string; options: AgentRunOptions }> = [];
  readonly resumeCalls: Array<{
    sessionId: string;
    prompt: string;
    options: AgentRunOptions;
  }> = [];
  readonly completeCalls: Array<{ prompt: string; options: CompletionOptions }> = [];
  readonly probeCalls: Array<{ prompt: string; options: ProbeOptions }> = [];

  /** Queued probe answers: a result, or a spawn failure's message. */
  private readonly probeResponses: Array<
    { kind: "result"; result: ProbeResult } | { kind: "fail"; message: string }
  > = [];

  readonly runResponses: AgentRunResult[] = [];
  readonly resumeResponses: AgentRunResult[] = [];
  readonly completeResponses: CompletionResult[] = [];
  runIdx = 0;
  resumeIdx = 0;
  completeIdx = 0;

  /** When set, the `runAgent` call at this 0-based index fails with a limit error. */
  private rateLimitAtRunIndex: number | undefined;
  private rateLimitKnob: RateLimitKnob | undefined;

  /** When set, the next `resumeAgentSession` call fails with a limit error. */
  private resumeRateLimitKnob: RateLimitKnob | undefined;

  /** When set, the `resumeAgentSession` call at this 0-based index fails with a limit error. */
  private rateLimitAtResumeIndex: number | undefined;
  private resumeAtIndexKnob: RateLimitKnob | undefined;

  /** When set, the `complete` call at this 0-based index fails with a limit error. */
  private rateLimitAtCompleteIndex: number | undefined;
  private completeRateLimitKnob: RateLimitKnob | undefined;

  /**
   * When set, each `resumeAgentSession` call writes this content to
   * `<options.cwd>/.phax-context/phase-handoff.md` before returning.
   * Useful in tests that need the handoff file without pre-creating worktrees.
   */
  private autoHandoffContent: string | undefined;

  /**
   * When set, called synchronously at the start of every `runAgent` call,
   * before any response is returned — lets a test observe the world (other
   * fakes' call logs, the phase folder) at the exact moment the agent launches.
   */
  private onRunAgent: ((prompt: string, options: AgentRunOptions) => void) | undefined;

  /**
   * When set, called synchronously at the start of every `resumeAgentSession`
   * call, before any limit or response — lets a test play the provider writing
   * the resume's transcript, or observe the world at the moment of the resume.
   */
  private onResumeAgent:
    | ((sessionId: string, prompt: string, options: AgentRunOptions) => void)
    | undefined;

  setAutoHandoffContent(content: string): void {
    this.autoHandoffContent = content;
  }

  setOnRunAgent(callback: (prompt: string, options: AgentRunOptions) => void): void {
    this.onRunAgent = callback;
  }

  setOnResumeAgent(
    callback: (sessionId: string, prompt: string, options: AgentRunOptions) => void,
  ): void {
    this.onResumeAgent = callback;
  }

  /** Queue a run result; a result without `structured` carries none (null). */
  addRunResponse(result: WithOptionalStructured<AgentRunResult>): void {
    this.runResponses.push({ structured: null, ...result });
  }

  /** Queue a resume result; a result without `structured` carries none (null). */
  addResumeResponse(result: WithOptionalStructured<AgentRunResult>): void {
    this.resumeResponses.push({ structured: null, ...result });
  }

  /** Queue a completion result; a result without `structured` carries none (null). */
  addCompletionResponse(result: WithOptionalStructured<CompletionResult>): void {
    this.completeResponses.push({ structured: null, ...result });
  }

  /** Queue a probe that ended; stderr defaults to empty. */
  addProbeResponse(ended: {
    readonly lines: readonly string[];
    readonly exitCode: number;
    readonly stderr?: string;
  }): void {
    this.probeResponses.push({ kind: "result", result: { kind: "ended", stderr: "", ...ended } });
  }

  /** Make the next queued `probe` call end as one stopped at its timeout would. */
  timeOutNextProbe(): void {
    this.probeResponses.push({ kind: "result", result: { kind: "timed-out" } });
  }

  /** Make the next queued `probe` call fail as a spawn failure would. */
  failNextProbe(message: string): void {
    this.probeResponses.push({ kind: "fail", message });
  }

  /** Simulate a rate/usage-limit failure on the `runAgent` call for a chosen phase. */
  failRunWithRateLimit(runIndex: number, knob: RateLimitKnob): void {
    this.rateLimitAtRunIndex = runIndex;
    this.rateLimitKnob = knob;
  }

  /** Simulate a rate/usage-limit failure on the next `resumeAgentSession` call. */
  failNextResumeWithRateLimit(knob: RateLimitKnob): void {
    this.resumeRateLimitKnob = knob;
  }

  /** When set, the next `resumeAgentSession` call fails with an invocation error carrying it. */
  private resumeFailure: string | undefined;

  /** Simulate a provider failure (a session not found, say) on the next `resumeAgentSession` call. */
  failNextResume(message: string): void {
    this.resumeFailure = message;
  }

  /** Simulate a rate/usage-limit failure on the `resumeAgentSession` call at a chosen index. */
  failResumeWithRateLimit(resumeIndex: number, knob: RateLimitKnob): void {
    this.rateLimitAtResumeIndex = resumeIndex;
    this.resumeAtIndexKnob = knob;
  }

  /** Simulate a rate/usage-limit failure on the `complete` call at a chosen index. */
  failCompleteWithRateLimit(completeIndex: number, knob: RateLimitKnob): void {
    this.rateLimitAtCompleteIndex = completeIndex;
    this.completeRateLimitKnob = knob;
  }

  private readonly runFailures = new Map<number, FailureKnob>();
  private readonly resumeFailures = new Map<number, FailureKnob>();
  private readonly completeFailures = new Map<number, FailureKnob>();
  private nextResumeFailure: FailureKnob | undefined;

  /** Fail the `runAgent` call at this 0-based index as a session ending in `failure` would. */
  failRunWith(
    runIndex: number,
    failure: SessionFailure,
    files?: Partial<SessionFailureFiles>,
  ): void {
    this.runFailures.set(runIndex, failureKnob(failure, files));
  }

  /** Fail the next `resumeAgentSession` call as a session ending in `failure` would. */
  failNextResumeWith(failure: SessionFailure, files?: Partial<SessionFailureFiles>): void {
    this.nextResumeFailure = failureKnob(failure, files);
  }

  /** Fail the `resumeAgentSession` call at this 0-based index as a session ending in `failure` would. */
  failResumeWith(
    resumeIndex: number,
    failure: SessionFailure,
    files?: Partial<SessionFailureFiles>,
  ): void {
    this.resumeFailures.set(resumeIndex, failureKnob(failure, files));
  }

  /** Fail the `complete` call at this 0-based index as a session ending in `failure` would. */
  failCompleteWith(
    completeIndex: number,
    failure: SessionFailure,
    files?: Partial<SessionFailureFiles>,
  ): void {
    this.completeFailures.set(completeIndex, failureKnob(failure, files));
  }

  private knobError(knob: FailureKnob): SessionError {
    return sessionFailureError(knob.failure, knob.files);
  }

  /** A limit knob's error, built as the adapters build one from the reader's failure. */
  private limitError(provider: ProviderId, knob?: RateLimitKnob): SessionError {
    const k = knob ?? this.rateLimitKnob;
    const usage = k?.kind === "usage_limit";
    return sessionFailureError(
      {
        provider,
        kind: usage ? "usage-limit" : "rate-limit",
        message: usage ? "usage limit reached" : "rate limit exceeded",
        sessionId: null,
        resetAt: k?.resetAt ?? null,
      },
      NO_FILES,
    );
  }

  complete(
    prompt: string,
    options: CompletionOptions,
  ): Effect.Effect<CompletionResult, AgentInvocationError | SessionError> {
    const callIndex = this.completeIdx;
    this.completeCalls.push({ prompt, options });
    const queued = this.completeFailures.get(callIndex);
    if (queued !== undefined) {
      this.completeIdx++;
      return Effect.fail(this.knobError(queued));
    }
    if (this.rateLimitAtCompleteIndex === callIndex) {
      this.completeIdx++;
      return Effect.fail(this.limitError(options.provider, this.completeRateLimitKnob));
    }
    const result = this.completeResponses[this.completeIdx++];
    if (result === undefined) {
      return Effect.fail(
        new AgentInvocationError({ message: "FakeBackend: no more complete responses queued" }),
      );
    }
    return Effect.succeed(result);
  }

  readonly captureCalls: TranscriptRequest[] = [];
  private readonly transcripts = new Map<string, Uint8Array>();

  /** Make `captureTranscript` find these bytes for `sessionId`, on any provider. */
  registerTranscript(sessionId: string, bytes: Uint8Array | string): void {
    this.transcripts.set(
      sessionId,
      typeof bytes === "string" ? new TextEncoder().encode(bytes) : Uint8Array.from(bytes),
    );
  }

  captureTranscript(request: TranscriptRequest): Effect.Effect<TranscriptRead, never> {
    this.captureCalls.push(request);
    const bytes = this.transcripts.get(request.sessionId);
    return Effect.succeed(
      bytes === undefined
        ? {
            status: "missing",
            reason: "not-found",
            detail: `FakeBackend: no transcript registered for ${request.sessionId}`,
          }
        : { status: "found", bytes: Uint8Array.from(bytes) },
    );
  }

  probe(prompt: string, options: ProbeOptions): Effect.Effect<ProbeResult, AgentInvocationError> {
    this.probeCalls.push({ prompt, options });
    const next = this.probeResponses.shift();
    if (next === undefined) {
      return Effect.fail(
        new AgentInvocationError({ message: "FakeBackend: no more probe responses queued" }),
      );
    }
    return next.kind === "result"
      ? Effect.succeed(next.result)
      : Effect.fail(new AgentInvocationError({ message: next.message }));
  }

  runAgent(
    prompt: string,
    options: AgentRunOptions,
  ): Effect.Effect<AgentRunResult, AgentInvocationError | SessionError> {
    const callIndex = this.runIdx;
    this.runCalls.push({ prompt, options });
    this.onRunAgent?.(prompt, options);
    const queued = this.runFailures.get(callIndex);
    if (queued !== undefined) {
      this.runIdx++;
      return Effect.fail(this.knobError(queued));
    }
    if (this.rateLimitAtRunIndex === callIndex) {
      this.runIdx++;
      return Effect.fail(this.limitError(options.provider));
    }
    const result = this.runResponses[this.runIdx++];
    if (result === undefined) {
      return Effect.fail(
        new AgentInvocationError({ message: "FakeBackend: no more runAgent responses queued" }),
      );
    }
    return Effect.succeed(result);
  }

  resumeAgentSession(
    sessionId: ClaudeSessionId,
    prompt: string,
    options: AgentRunOptions,
  ): Effect.Effect<AgentRunResult, AgentInvocationError | SessionError> {
    const callIndex = this.resumeCalls.length;
    this.resumeCalls.push({ sessionId, prompt, options });
    this.onResumeAgent?.(sessionId, prompt, options);
    const queued = this.resumeFailures.get(callIndex);
    if (queued !== undefined) {
      return Effect.fail(this.knobError(queued));
    }
    if (this.nextResumeFailure !== undefined) {
      const knob = this.nextResumeFailure;
      this.nextResumeFailure = undefined;
      return Effect.fail(this.knobError(knob));
    }
    if (this.rateLimitAtResumeIndex === callIndex) {
      return Effect.fail(this.limitError(options.provider, this.resumeAtIndexKnob));
    }
    if (this.resumeRateLimitKnob !== undefined) {
      const knob = this.resumeRateLimitKnob;
      this.resumeRateLimitKnob = undefined;
      return Effect.fail(this.limitError(options.provider, knob));
    }
    if (this.resumeFailure !== undefined) {
      const message = this.resumeFailure;
      this.resumeFailure = undefined;
      return Effect.fail(new AgentInvocationError({ message }));
    }
    // If configured, write the handoff file so generatePhaseHandoff can read it.
    // By the time resumeAgentSession is called, ensurePhaxContextIgnored has
    // already created <cwd>/.phax-context/, so the write is always safe.
    if (this.autoHandoffContent !== undefined) {
      writeFileSync(
        join(options.cwd, ".phax-context", "phase-handoff.md"),
        this.autoHandoffContent,
      );
    }
    const result = this.resumeResponses[this.resumeIdx++];
    if (result === undefined) {
      return Effect.fail(
        new AgentInvocationError({
          message: "FakeBackend: no more resumeAgentSession responses queued",
        }),
      );
    }
    return Effect.succeed(result);
  }
}

export const makeFakeBackend = () => {
  const impl = new FakeBackendImpl();
  const layer = Layer.succeed(Backend, impl);
  return { impl, layer } as const;
};
