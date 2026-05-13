import { Effect, Layer } from "effect";
import type { ClaudeSessionId } from "../../domain/branded.js";
import { ClaudeInvocationError } from "../../domain/errors.js";
import {
  Backend,
  type BackendOps,
  type AgentRunOptions,
  type AgentRunResult,
} from "../../ports/backend.js";

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

  addRunResponse(result: AgentRunResult): void {
    this.runResponses.push(result);
  }

  addResumeResponse(result: AgentRunResult): void {
    this.resumeResponses.push(result);
  }

  runAgent(
    prompt: string,
    options: AgentRunOptions,
  ): Effect.Effect<AgentRunResult, ClaudeInvocationError> {
    this.runCalls.push({ prompt, options });
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
  ): Effect.Effect<AgentRunResult, ClaudeInvocationError> {
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
