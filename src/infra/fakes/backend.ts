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

  readonly runResponses: AgentRunResult[] = [];
  readonly resumeResponses: AgentRunResult[] = [];
  runIdx = 0;
  resumeIdx = 0;

  /** When set, the `runAgent` call at this 0-based index fails with a limit error. */
  private rateLimitAtRunIndex: number | undefined;
  private rateLimitKnob: RateLimitKnob | undefined;

  /** When set, the next `resumeAgentSession` call fails with a limit error. */
  private resumeRateLimitKnob: RateLimitKnob | undefined;

  /**
   * When set, each `resumeAgentSession` call writes this content to
   * `<options.cwd>/.phax-context/phase-handoff.md` before returning.
   * Useful in tests that need the handoff file without pre-creating worktrees.
   */
  private autoHandoffContent: string | undefined;

  setAutoHandoffContent(content: string): void {
    this.autoHandoffContent = content;
  }

  addRunResponse(result: AgentRunResult): void {
    this.runResponses.push(result);
  }

  addResumeResponse(result: AgentRunResult): void {
    this.resumeResponses.push(result);
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

  runAgent(
    prompt: string,
    options: AgentRunOptions,
  ): Effect.Effect<AgentRunResult, AgentInvocationError | RateLimitError | UsageLimitError> {
    const callIndex = this.runIdx;
    this.runCalls.push({ prompt, options });
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
    this.resumeCalls.push({ sessionId, prompt, options });
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
