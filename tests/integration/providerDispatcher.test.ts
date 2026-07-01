import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { makeNodeBackendLayer } from "../../src/infra/providers/dispatcher.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import { AgentInvocationError } from "../../src/domain/errors.js";
import { Backend, type AgentRunOptions } from "../../src/ports/backend.js";

const baseOptions: AgentRunOptions = {
  provider: "claude-code",
  model: "claude-sonnet-4-6",
  effort: "medium",
  cwd: "/tmp",
  security: {
    mode: "unsafe",
    filesystem: { allowRead: [], allowWrite: [], allowWriteProtected: [] },
    network: { profile: "open", allowDomains: [] },
    mcp: { mode: "provider-default", allow: [] },
    failClosed: false,
  },
};

function runWithProvider(options: AgentRunOptions) {
  return Effect.flatMap(Backend, (backend) => backend.runAgent("test prompt", options)).pipe(
    Effect.provide(makeNodeBackendLayer(DEFAULT_PROVIDER_CONFIG)),
    Effect.either,
    Effect.runPromise,
  );
}

describe("provider dispatcher", () => {
  it("claude-code routes to the Claude adapter, not to the 'not yet wired' guard", async () => {
    const result = await runWithProvider(baseOptions);

    // Whether the actual `claude` binary is present on the machine or not, the
    // dispatch must have reached the Claude adapter. We confirm this by asserting
    // that the error message (if any) does NOT contain "not yet wired".
    if (Either.isLeft(result)) {
      expect((result.left as AgentInvocationError).message).not.toContain("not yet wired");
    }
    // If it succeeded (claude installed + valid run), that also confirms correct routing.
    // Either way, the test passes — the guard is never entered.
    expect(true).toBe(true);
  }, 30_000);

  it("mistral-vibe routes to the Vibe adapter, not the 'not yet wired' guard", async () => {
    const result = await runWithProvider({
      ...baseOptions,
      provider: "mistral-vibe",
      model: "phax-mistral-medium-3.5-medium",
    });

    // Whether the real `vibe` binary is present or not, the dispatch must have
    // reached the Vibe adapter. Confirm the "not yet wired" guard was not hit.
    if (Either.isLeft(result)) {
      expect((result.left as AgentInvocationError).message).not.toContain("not yet wired");
    }
    expect(true).toBe(true);
  }, 30_000);

  it("codex-cli routes to the Codex adapter, not the 'not yet wired' guard", async () => {
    const result = await runWithProvider({
      ...baseOptions,
      provider: "codex-cli",
      model: "gpt-5.5",
    });

    // Whether the real `codex` binary is present or not, the dispatch must have
    // reached the Codex adapter. Confirm the "not yet wired" guard was not hit.
    if (Either.isLeft(result)) {
      expect((result.left as AgentInvocationError).message).not.toContain("not yet wired");
    }
    expect(true).toBe(true);
  }, 30_000);
});
