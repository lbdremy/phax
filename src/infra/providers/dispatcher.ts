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
import { runCodexAgent } from "./codexCli.js";
import { runVibeAgent } from "./mistralVibe.js";

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
      if (options.provider === "mistral-vibe") {
        const entry = providerConfig.providers["mistral-vibe"];
        if (!entry) {
          return Effect.fail(
            new ClaudeInvocationError({ message: "mistral-vibe not found in provider config" }),
          );
        }
        return runVibeAgent(prompt, options, entry).pipe(
          Effect.mapError(
            (e): RunAgentError =>
              e instanceof ClaudeSessionIdMissingError
                ? new ClaudeInvocationError({ message: e.message })
                : e,
          ),
        );
      }
      if (options.provider === "codex-cli") {
        const entry = providerConfig.providers["codex-cli"];
        if (!entry) {
          return Effect.fail(
            new ClaudeInvocationError({ message: "codex-cli not found in provider config" }),
          );
        }
        return runCodexAgent(prompt, options, entry).pipe(
          Effect.mapError(
            (e): RunAgentError =>
              e instanceof ClaudeSessionIdMissingError
                ? new ClaudeInvocationError({ message: e.message })
                : e,
          ),
        );
      }
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
      if (options.provider === "mistral-vibe") {
        const entry = providerConfig.providers["mistral-vibe"];
        if (!entry) {
          return Effect.fail(
            new ClaudeInvocationError({ message: "mistral-vibe not found in provider config" }),
          );
        }
        return runVibeAgent(prompt, options, entry, sessionId);
      }
      if (options.provider === "codex-cli") {
        const entry = providerConfig.providers["codex-cli"];
        if (!entry) {
          return Effect.fail(
            new ClaudeInvocationError({ message: "codex-cli not found in provider config" }),
          );
        }
        return runCodexAgent(prompt, options, entry, sessionId);
      }
      return Effect.fail(
        new ClaudeInvocationError({
          message: `Provider "${options.provider}" is not yet wired in the dispatcher (config: ${JSON.stringify(Object.keys(providerConfig.providers))})`,
        }),
      );
    },
  });
}
