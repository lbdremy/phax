import { Effect, Layer } from "effect";
import type { ClaudeSessionId } from "../../domain/branded.js";
import { ClaudeInvocationError, RateLimitError, UsageLimitError } from "../../domain/errors.js";
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

  private limitError(): RateLimitError | UsageLimitError {
    const knob = this.rateLimitKnob;
    const fields = {
      rawMessage: knob?.kind === "usage_limit" ? "usage limit reached" : "rate limit exceeded",
      resetAt: knob?.resetAt,
    };
    return knob?.kind === "usage_limit"
      ? new UsageLimitError({ message: "FakeBackend: usage limit reached.", ...fields })
      : new RateLimitError({ message: "FakeBackend: rate limit hit.", ...fields });
  }

  runAgent(
    prompt: string,
    options: AgentRunOptions,
  ): Effect.Effect<AgentRunResult, ClaudeInvocationError | RateLimitError | UsageLimitError> {
    const callIndex = this.runIdx;
    this.runCalls.push({ prompt, options });
    if (this.rateLimitAtRunIndex === callIndex) {
      this.runIdx++;
      return Effect.fail(this.limitError());
    }
    const result = this.runResponses[this.runIdx++];
    if (result === undefined) {
      return Effect.fail(
        new ClaudeInvocationError({ message: "FakeBackend: no more runAgent responses queued" }),
      );
    }
    return Effect.succeed(result);
  }

  resumeAgentSession(
    sessionId: ClaudeSessionId,
    prompt: string,
    options: AgentRunOptions,
  ): Effect.Effect<AgentRunResult, ClaudeInvocationError | RateLimitError | UsageLimitError> {
    this.resumeCalls.push({ sessionId, prompt, options });
    const result = this.resumeResponses[this.resumeIdx++];
    if (result === undefined) {
      return Effect.fail(
        new ClaudeInvocationError({
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
