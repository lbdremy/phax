import { Effect, Layer } from "effect";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ClaudeSessionId } from "../../domain/branded.js";
import { AgentInvocationError, RateLimitError, UsageLimitError } from "../../domain/errors.js";
import {
  Backend,
  type BackendOps,
  type AgentRunOptions,
  type AgentRunResult,
  type CompletionOptions,
  type CompletionResult,
  type ProbeOptions,
  type ProbeResult,
} from "../../ports/backend.js";

interface RateLimitKnob {
  readonly kind: "rate_limit" | "usage_limit";
  readonly resetAt?: string | undefined;
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

  addRunResponse(result: AgentRunResult): void {
    this.runResponses.push(result);
  }

  addResumeResponse(result: AgentRunResult): void {
    this.resumeResponses.push(result);
  }

  addCompletionResponse(result: CompletionResult): void {
    this.completeResponses.push(result);
  }

  addProbeResponse(result: ProbeResult): void {
    this.probeResponses.push({ kind: "result", result });
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

  private limitError(knob?: RateLimitKnob): RateLimitError | UsageLimitError {
    const k = knob ?? this.rateLimitKnob;
    const fields = {
      rawMessage: k?.kind === "usage_limit" ? "usage limit reached" : "rate limit exceeded",
      resetAt: k?.resetAt,
    };
    return k?.kind === "usage_limit"
      ? new UsageLimitError({ message: "FakeBackend: usage limit reached.", ...fields })
      : new RateLimitError({ message: "FakeBackend: rate limit hit.", ...fields });
  }

  complete(
    prompt: string,
    options: CompletionOptions,
  ): Effect.Effect<CompletionResult, AgentInvocationError | RateLimitError | UsageLimitError> {
    const callIndex = this.completeIdx;
    this.completeCalls.push({ prompt, options });
    if (this.rateLimitAtCompleteIndex === callIndex) {
      this.completeIdx++;
      return Effect.fail(this.limitError(this.completeRateLimitKnob));
    }
    const result = this.completeResponses[this.completeIdx++];
    if (result === undefined) {
      return Effect.fail(
        new AgentInvocationError({ message: "FakeBackend: no more complete responses queued" }),
      );
    }
    return Effect.succeed(result);
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
  ): Effect.Effect<AgentRunResult, AgentInvocationError | RateLimitError | UsageLimitError> {
    const callIndex = this.runIdx;
    this.runCalls.push({ prompt, options });
    this.onRunAgent?.(prompt, options);
    if (this.rateLimitAtRunIndex === callIndex) {
      this.runIdx++;
      return Effect.fail(this.limitError());
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
  ): Effect.Effect<AgentRunResult, AgentInvocationError | RateLimitError | UsageLimitError> {
    const callIndex = this.resumeCalls.length;
    this.resumeCalls.push({ sessionId, prompt, options });
    this.onResumeAgent?.(sessionId, prompt, options);
    if (this.rateLimitAtResumeIndex === callIndex) {
      return Effect.fail(this.limitError(this.resumeAtIndexKnob));
    }
    if (this.resumeRateLimitKnob !== undefined) {
      const knob = this.resumeRateLimitKnob;
      this.resumeRateLimitKnob = undefined;
      return Effect.fail(this.limitError(knob));
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
