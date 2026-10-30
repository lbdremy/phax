import { Effect, Layer } from "effect";
import { Backend } from "../../ports/backend.js";
import { AgentInvocationError } from "../../domain/errors.js";
import { ProviderStoreRoots } from "../../ports/providerStores.js";
import {
  STRUCTURED_CALLS,
  type StructuredCallsTable,
} from "../../domain/session/structuredCalls.js";
import type { ProviderConfig } from "../../schemas/providerConfig.js";
import {
  captureClaudeTranscript,
  runClaudeAgent,
  runClaudeCompletion,
  runClaudeProbe,
} from "./claudeCode.js";
import { captureCodexTranscript, runCodexAgent, runCodexCompletion } from "./codexCli.js";
import { captureVibeTranscript, runVibeAgent, runVibeCompletion } from "./mistralVibe.js";
import { archivePreviousFailure } from "./agentErrorLog.js";
import type { AgentRunOptions } from "../../ports/backend.js";

/**
 * An agent session, after archiving the failure an earlier session left in
 * its folder (see `archivePreviousFailure`): one place for every provider.
 */
function afterArchivingPreviousFailure<A, E>(
  options: AgentRunOptions,
  session: () => Effect.Effect<A, E>,
): Effect.Effect<A, E> {
  return Effect.suspend(() => {
    archivePreviousFailure(options.phaseFolderPath, options.outputJsonlPath);
    return session();
  });
}

/**
 * The backend that runs the provider CLIs. Its adapters read the provider
 * store roots in context when the layer is built: the CLI provides
 * `ProviderStoreRootsLive`, and without it the default holds no root.
 * `options.structuredCalls` says, per structured call, whether Claude Code is
 * handed the answer schema natively; it defaults to `STRUCTURED_CALLS`, and
 * tests inject a flipped table.
 */
export function makeNodeBackendLayer(
  providerConfig: ProviderConfig,
  options?: { readonly structuredCalls?: StructuredCallsTable },
): Layer.Layer<Backend> {
  const table = options?.structuredCalls ?? STRUCTURED_CALLS;
  return Layer.effect(
    Backend,
    Effect.map(ProviderStoreRoots, (roots) => nodeBackend(providerConfig, roots, table)),
  );
}

function nodeBackend(
  providerConfig: ProviderConfig,
  roots: ProviderStoreRoots["Type"],
  table: StructuredCallsTable,
): Backend["Type"] {
  return {
    runAgent: (prompt, options) =>
      afterArchivingPreviousFailure(options, () => {
        if (options.provider === "claude-code") {
          return runClaudeAgent(prompt, options, undefined, table);
        }
        if (options.provider === "mistral-vibe") {
          const entry = providerConfig.providers["mistral-vibe"];
          if (!entry) {
            return Effect.fail(
              new AgentInvocationError({ message: "mistral-vibe not found in provider config" }),
            );
          }
          return runVibeAgent(prompt, options, entry);
        }
        if (options.provider === "codex-cli") {
          const entry = providerConfig.providers["codex-cli"];
          if (!entry) {
            return Effect.fail(
              new AgentInvocationError({ message: "codex-cli not found in provider config" }),
            );
          }
          return runCodexAgent(prompt, options, entry);
        }
        return Effect.fail(
          new AgentInvocationError({
            message: `Provider "${options.provider}" is not yet wired in the dispatcher (config: ${JSON.stringify(Object.keys(providerConfig.providers))})`,
          }),
        );
      }),

    complete: (prompt, options) => {
      if (options.provider === "claude-code") {
        return runClaudeCompletion(prompt, options, table);
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
        const entry = providerConfig.providers["mistral-vibe"];
        if (!entry) {
          return Effect.fail(
            new AgentInvocationError({ message: "mistral-vibe not found in provider config" }),
          );
        }
        return runVibeCompletion(prompt, options, entry);
      }
      return Effect.fail(
        new AgentInvocationError({
          message: `Provider "${options.provider}" is not yet wired in the dispatcher (config: ${JSON.stringify(Object.keys(providerConfig.providers))})`,
        }),
      );
    },

    probe: (prompt, options) => runClaudeProbe(prompt, options),

    resumeAgentSession: (sessionId, prompt, options) =>
      afterArchivingPreviousFailure(options, () => {
        if (options.provider === "claude-code") {
          return runClaudeAgent(prompt, options, sessionId, table);
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
      }),

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
