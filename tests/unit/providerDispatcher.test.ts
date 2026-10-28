import { Effect, Either, Layer } from "effect";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeNodeBackendLayer } from "../../src/infra/providers/dispatcher.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import { AgentInvocationError } from "../../src/domain/errors.js";
import { Backend, type AgentRunOptions, type AgentRunResult } from "../../src/ports/backend.js";
import type { ProviderId } from "../../src/domain/routing/types.js";
import { ProviderStoreRoots } from "../../src/ports/providerStores.js";

// The adapters are stubbed on purpose: this test is about the dispatch
// decision, not about what a provider CLI does once reached. Calling the real
// adapters would spawn `claude` / `vibe` / `codex` against a live model —
// slow, non-deterministic, and dependent on which binaries the machine has.
const { STUB_RUN_RESULT } = vi.hoisted(() => ({
  STUB_RUN_RESULT: { finalText: "ok", sessionId: "session-1" } as unknown as AgentRunResult,
}));

const { STUB_READ } = vi.hoisted(() => ({
  STUB_READ: { status: "missing", reason: "not-found", detail: "stub" } as const,
}));

vi.mock("../../src/infra/providers/claudeCode.js", () => ({
  runClaudeAgent: vi.fn(() => Effect.succeed(STUB_RUN_RESULT)),
  runClaudeCompletion: vi.fn(() => Effect.succeed(STUB_RUN_RESULT)),
  captureClaudeTranscript: vi.fn(() => Effect.succeed(STUB_READ)),
}));
vi.mock("../../src/infra/providers/codexCli.js", () => ({
  runCodexAgent: vi.fn(() => Effect.succeed(STUB_RUN_RESULT)),
  runCodexCompletion: vi.fn(() => Effect.succeed(STUB_RUN_RESULT)),
  captureCodexTranscript: vi.fn(() => Effect.succeed(STUB_READ)),
}));
vi.mock("../../src/infra/providers/mistralVibe.js", () => ({
  runVibeAgent: vi.fn(() => Effect.succeed(STUB_RUN_RESULT)),
  runVibeCompletion: vi.fn(() => Effect.succeed({ finalText: "PONG" })),
  captureVibeTranscript: vi.fn(() => Effect.succeed(STUB_READ)),
}));

const baseOptions: AgentRunOptions = {
  provider: "claude-code",
  model: "claude-sonnet-4-6",
  effort: "medium",
  cwd: "/tmp",
  security: {
    mode: "unsafe",
    filesystem: { allowRead: [], allowWrite: [] },
    network: { profile: "open" },
    mcp: { mode: "provider-default", allow: [] },
    agentCommands: [],

    failClosed: false,
  },
};

async function adapters() {
  const claude = vi.mocked(await import("../../src/infra/providers/claudeCode.js"));
  const codex = vi.mocked(await import("../../src/infra/providers/codexCli.js"));
  const vibe = vi.mocked(await import("../../src/infra/providers/mistralVibe.js"));
  return { claude, codex, vibe };
}

function request(provider: ProviderId) {
  return {
    provider,
    sessionId: "X1",
    startedAt: "2026-10-24T10:00:00.000Z",
    cwd: "/tmp",
    phaseFolder: "/runs/r1/phase-02",
  };
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
      model: "phax-mistral-medium-3.5-high",
    };

    const result = await runWithProvider(options);

    expect(Either.isRight(result)).toBe(true);
    // Vibe takes no store root: nothing reads its home.
    expect(vibe.runVibeAgent).toHaveBeenCalledWith(
      "test prompt",
      options,
      DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"],
    );
    expect(claude.runClaudeAgent).not.toHaveBeenCalled();
    expect(codex.runCodexAgent).not.toHaveBeenCalled();
  });

  it("routes a mistral-vibe completion to the sealed Vibe completion with its provider-config entry", async () => {
    const { vibe } = await adapters();
    const options = {
      provider: "mistral-vibe" as const,
      model: "devstral-2",
      effort: "medium",
      cwd: "/tmp",
    };
    const result = await Effect.flatMap(Backend, (backend) =>
      backend.complete("test prompt", options),
    ).pipe(
      Effect.provide(makeNodeBackendLayer(DEFAULT_PROVIDER_CONFIG)),
      Effect.provide(
        Layer.succeed(ProviderStoreRoots, { claude: "/h/.claude", codex: "/h/.codex" }),
      ),
      Effect.runPromise,
    );
    expect(result.finalText).toBe("PONG");
    expect(vibe.runVibeCompletion).toHaveBeenCalledWith(
      "test prompt",
      options,
      DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"],
    );
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

  it("routes captureTranscript by provider, with the store root of Claude Code and codex and none for vibe", async () => {
    const { claude, codex, vibe } = await adapters();
    const roots = { claude: "/h/.claude", codex: "/h/.codex" };
    const capture = (provider: ProviderId) =>
      Effect.flatMap(Backend, (backend) => backend.captureTranscript(request(provider))).pipe(
        Effect.provide(makeNodeBackendLayer(DEFAULT_PROVIDER_CONFIG)),
        Effect.provide(Layer.succeed(ProviderStoreRoots, roots)),
        Effect.runPromise,
      );

    await capture("claude-code");
    await capture("codex-cli");
    await capture("mistral-vibe");

    expect(claude.captureClaudeTranscript).toHaveBeenCalledWith(
      "/h/.claude",
      request("claude-code"),
    );
    expect(codex.captureCodexTranscript).toHaveBeenCalledWith("/h/.codex", request("codex-cli"));
    expect(vibe.captureVibeTranscript).toHaveBeenCalledWith(request("mistral-vibe"));
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
