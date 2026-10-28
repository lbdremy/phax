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
import { ProviderStoreRoots } from "../../ports/providerStores.js";
import type { ProviderConfig } from "../../schemas/providerConfig.js";
import {
  captureClaudeTranscript,
  runClaudeAgent,
  runClaudeCompletion,
  runClaudeProbe,
} from "./claudeCode.js";
import { captureCodexTranscript, runCodexAgent, runCodexCompletion } from "./codexCli.js";
import { captureVibeTranscript, runVibeAgent } from "./mistralVibe.js";

type RunAgentError =
  | AgentInvocationError
  | RateLimitError
  | UsageLimitError
  | SecurityEnforcementError
  | FsError;

/**
 * The backend that runs the provider CLIs. Its adapters read the provider
 * store roots in context when the layer is built: the CLI provides
 * `ProviderStoreRootsLive`, and without it the default holds no root.
 */
export function makeNodeBackendLayer(providerConfig: ProviderConfig): Layer.Layer<Backend> {
  return Layer.effect(
    Backend,
    Effect.map(ProviderStoreRoots, (roots) => nodeBackend(providerConfig, roots)),
  );
}

function nodeBackend(
  providerConfig: ProviderConfig,
  roots: ProviderStoreRoots["Type"],
): Backend["Type"] {
  return {
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
        const entry = providerConfig.providers["codex-cli"];
        if (!entry) {
          return Effect.fail(
            new AgentInvocationError({ message: "codex-cli not found in provider config" }),
          );
        }
        return runCodexCompletion(prompt, options, entry);
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

    probe: (prompt, options) => runClaudeProbe(prompt, options),

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

    captureTranscript: (request) => {
      switch (request.provider) {
        case "claude-code":
          return captureClaudeTranscript(roots.claude, request);
        case "codex-cli":
          return captureCodexTranscript(roots.codex, request);
        case "mistral-vibe":
          return captureVibeTranscript(request);
      }
    },
  };
}
