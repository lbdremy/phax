import { Effect, Layer } from "effect";
import { Backend } from "../../ports/backend.js";
import {
  AgentInvocationError,
  AgentSessionIdMissingError,
  RateLimitError,
  SecurityEnforcementError,
  UsageLimitError,
} from "../../domain/errors.js";
import type { FsError } from "../../ports/fs.js";
import type { ProviderConfig } from "../../schemas/providerConfig.js";
import { runClaudeAgent, runClaudeCompletion } from "./claudeCode.js";
import { runCodexAgent } from "./codexCli.js";
import { runVibeAgent } from "./mistralVibe.js";

type RunAgentError =
  | AgentInvocationError
  | RateLimitError
  | UsageLimitError
  | SecurityEnforcementError
  | FsError;

export function makeNodeBackendLayer(providerConfig: ProviderConfig): Layer.Layer<Backend> {
  return Layer.succeed(Backend, {
    runAgent: (prompt, options) => {
      if (options.provider === "claude-code") {
        return runClaudeAgent(prompt, options).pipe(
          Effect.mapError(
            (e): RunAgentError =>
              e instanceof AgentSessionIdMissingError
                ? new AgentInvocationError({ message: e.message })
                : e,
          ),
        );
      }
      if (options.provider === "mistral-vibe") {
        const entry = providerConfig.providers["mistral-vibe"];
        if (!entry) {
          return Effect.fail(
            new AgentInvocationError({ message: "mistral-vibe not found in provider config" }),
          );
        }
        return runVibeAgent(prompt, options, entry).pipe(
          Effect.mapError(
            (e): RunAgentError =>
              e instanceof AgentSessionIdMissingError
                ? new AgentInvocationError({ message: e.message })
                : e,
          ),
        );
      }
      if (options.provider === "codex-cli") {
        const entry = providerConfig.providers["codex-cli"];
        if (!entry) {
          return Effect.fail(
            new AgentInvocationError({ message: "codex-cli not found in provider config" }),
          );
        }
        return runCodexAgent(prompt, options, entry).pipe(
          Effect.mapError(
            (e): RunAgentError =>
              e instanceof AgentSessionIdMissingError
                ? new AgentInvocationError({ message: e.message })
                : e,
          ),
        );
      }
      return Effect.fail(
        new AgentInvocationError({
          message: `Provider "${options.provider}" is not yet wired in the dispatcher (config: ${JSON.stringify(Object.keys(providerConfig.providers))})`,
        }),
      );
    },

    complete: (prompt, options) => {
      if (options.provider === "claude-code") {
        return runClaudeCompletion(prompt, options);
      }
      if (options.provider === "codex-cli") {
        return Effect.fail(
          new AgentInvocationError({
            message: "sealed completion is not yet supported for codex-cli",
          }),
        );
      }
      if (options.provider === "mistral-vibe") {
        return Effect.fail(
          new AgentInvocationError({
            message: "sealed completion is not yet supported for mistral-vibe",
          }),
        );
      }
      return Effect.fail(
        new AgentInvocationError({
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
            new AgentInvocationError({ message: "mistral-vibe not found in provider config" }),
          );
        }
        return runVibeAgent(prompt, options, entry, sessionId);
      }
      if (options.provider === "codex-cli") {
        const entry = providerConfig.providers["codex-cli"];
        if (!entry) {
          return Effect.fail(
            new AgentInvocationError({ message: "codex-cli not found in provider config" }),
          );
        }
        return runCodexAgent(prompt, options, entry, sessionId);
      }
      return Effect.fail(
        new AgentInvocationError({
          message: `Provider "${options.provider}" is not yet wired in the dispatcher (config: ${JSON.stringify(Object.keys(providerConfig.providers))})`,
        }),
      );
    },
  });
}
