import { Effect, Either } from "effect";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeNodeBackendLayer } from "../../src/infra/providers/dispatcher.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import { AgentInvocationError } from "../../src/domain/errors.js";
import { Backend, type AgentRunOptions, type AgentRunResult } from "../../src/ports/backend.js";
import type { ProviderId } from "../../src/domain/routing/types.js";

// The adapters are stubbed on purpose: this test is about the dispatch
// decision, not about what a provider CLI does once reached. Calling the real
// adapters would spawn `claude` / `vibe` / `codex` against a live model —
// slow, non-deterministic, and dependent on which binaries the machine has.
const { STUB_RUN_RESULT } = vi.hoisted(() => ({
  STUB_RUN_RESULT: { finalText: "ok", sessionId: "session-1" } as unknown as AgentRunResult,
}));

vi.mock("../../src/infra/providers/claudeCode.js", () => ({
  runClaudeAgent: vi.fn(() => Effect.succeed(STUB_RUN_RESULT)),
  runClaudeCompletion: vi.fn(() => Effect.succeed(STUB_RUN_RESULT)),
}));
vi.mock("../../src/infra/providers/codexCli.js", () => ({
  runCodexAgent: vi.fn(() => Effect.succeed(STUB_RUN_RESULT)),
  runCodexCompletion: vi.fn(() => Effect.succeed(STUB_RUN_RESULT)),
}));
vi.mock("../../src/infra/providers/mistralVibe.js", () => ({
  runVibeAgent: vi.fn(() => Effect.succeed(STUB_RUN_RESULT)),
}));

const baseOptions: AgentRunOptions = {
  provider: "claude-code",
  model: "claude-sonnet-4-6",
  effort: "medium",
  cwd: "/tmp",
  security: {
    mode: "unsafe",
    filesystem: { allowRead: [], allowWrite: [] },
    network: { profile: "open", allowDomains: [] },
    mcp: { mode: "provider-default", allow: [] },
    failClosed: false,
  },
};

async function adapters() {
  const claude = vi.mocked(await import("../../src/infra/providers/claudeCode.js"));
  const codex = vi.mocked(await import("../../src/infra/providers/codexCli.js"));
  const vibe = vi.mocked(await import("../../src/infra/providers/mistralVibe.js"));
  return { claude, codex, vibe };
}

function runWithProvider(options: AgentRunOptions) {
  return Effect.flatMap(Backend, (backend) => backend.runAgent("test prompt", options)).pipe(
    Effect.provide(makeNodeBackendLayer(DEFAULT_PROVIDER_CONFIG)),
    Effect.either,
    Effect.runPromise,
  );
}

describe("provider dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes claude-code to the Claude adapter and no other", async () => {
    const { claude, codex, vibe } = await adapters();

    const result = await runWithProvider(baseOptions);

    expect(Either.isRight(result)).toBe(true);
    expect(claude.runClaudeAgent).toHaveBeenCalledWith("test prompt", baseOptions);
    expect(codex.runCodexAgent).not.toHaveBeenCalled();
    expect(vibe.runVibeAgent).not.toHaveBeenCalled();
  });

  it("routes mistral-vibe to the Vibe adapter with its provider-config entry", async () => {
    const { claude, codex, vibe } = await adapters();
    const options = {
      ...baseOptions,
      provider: "mistral-vibe" as const,
      model: "phax-mistral-medium-3.5-medium",
    };

    const result = await runWithProvider(options);

    expect(Either.isRight(result)).toBe(true);
    expect(vibe.runVibeAgent).toHaveBeenCalledWith(
      "test prompt",
      options,
      DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"],
    );
    expect(claude.runClaudeAgent).not.toHaveBeenCalled();
    expect(codex.runCodexAgent).not.toHaveBeenCalled();
  });

  it("routes codex-cli to the Codex adapter with its provider-config entry", async () => {
    const { claude, codex, vibe } = await adapters();
    const options = { ...baseOptions, provider: "codex-cli" as const, model: "gpt-5.5" };

    const result = await runWithProvider(options);

    expect(Either.isRight(result)).toBe(true);
    expect(codex.runCodexAgent).toHaveBeenCalledWith(
      "test prompt",
      options,
      DEFAULT_PROVIDER_CONFIG.providers["codex-cli"],
    );
    expect(claude.runClaudeAgent).not.toHaveBeenCalled();
    expect(vibe.runVibeAgent).not.toHaveBeenCalled();
  });

  it("falls through to the 'not yet wired' guard for an unknown provider", async () => {
    // Cast past ProviderId: the guard exists precisely for a provider the union
    // does not yet name, which is unreachable through the type alone.
    const result = await runWithProvider({
      ...baseOptions,
      provider: "some-future-cli" as ProviderId,
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(AgentInvocationError);
      expect((result.left as AgentInvocationError).message).toContain("not yet wired");
    }
  });
});
