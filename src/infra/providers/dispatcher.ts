import { Effect, Layer } from "effect";
import { Backend } from "../../ports/backend.js";
import {
  ClaudeInvocationError,
  ClaudeSessionIdMissingError,
  RateLimitError,
  UsageLimitError,
} from "../../domain/errors.js";
import type { FsError } from "../../ports/fs.js";
import type { ProviderConfig } from "../../schemas/providerConfig.js";
import { runClaudeAgent } from "./claudeCode.js";

type RunAgentError = ClaudeInvocationError | RateLimitError | UsageLimitError | FsError;

export function makeNodeBackendLayer(providerConfig: ProviderConfig): Layer.Layer<Backend> {
  return Layer.succeed(Backend, {
    runAgent: (prompt, options) => {
      if (options.provider === "claude-code") {
        return runClaudeAgent(prompt, options).pipe(
          Effect.mapError(
            (e): RunAgentError =>
              e instanceof ClaudeSessionIdMissingError
                ? new ClaudeInvocationError({ message: e.message })
                : e,
          ),
        );
      }
      // mistral-vibe and codex-cli adapters land in phases 06/07.
      // providerConfig.providers[options.provider] will supply the entry then.
      return Effect.fail(
        new ClaudeInvocationError({
          message: `Provider "${options.provider}" is not yet wired in the dispatcher (config: ${JSON.stringify(Object.keys(providerConfig.providers))})`,
        }),
      );
    },

    resumeAgentSession: (sessionId, prompt, options) => {
      if (options.provider === "claude-code") {
        return runClaudeAgent(prompt, options, sessionId);
      }
      return Effect.fail(
        new ClaudeInvocationError({
          message: `Provider "${options.provider}" is not yet wired in the dispatcher (config: ${JSON.stringify(Object.keys(providerConfig.providers))})`,
        }),
      );
    },
  });
}
