import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { makeNodeBackendLayer } from "../../src/infra/providers/dispatcher.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import { ClaudeInvocationError } from "../../src/domain/errors.js";
import { Backend, type AgentRunOptions } from "../../src/ports/backend.js";

const baseOptions: AgentRunOptions = {
  provider: "claude-code",
  model: "claude-sonnet-4-6",
  effort: "medium",
  cwd: "/tmp",
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
      expect((result.left as ClaudeInvocationError).message).not.toContain("not yet wired");
    }
    // If it succeeded (claude installed + valid run), that also confirms correct routing.
    // Either way, the test passes — the guard is never entered.
    expect(true).toBe(true);
  });

  it("mistral-vibe routes to the Vibe adapter, not the 'not yet wired' guard", async () => {
    const result = await runWithProvider({
      ...baseOptions,
      provider: "mistral-vibe",
      model: "phax-mistral-medium-3.5-medium",
    });

    // Whether the real `vibe` binary is present or not, the dispatch must have
    // reached the Vibe adapter. Confirm the "not yet wired" guard was not hit.
    if (Either.isLeft(result)) {
      expect((result.left as ClaudeInvocationError).message).not.toContain("not yet wired");
    }
    expect(true).toBe(true);
  });

  it("codex-cli fails with a clear 'not yet wired' error", async () => {
    const result = await runWithProvider({ ...baseOptions, provider: "codex-cli" });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ClaudeInvocationError);
      expect((result.left as ClaudeInvocationError).message).toContain("not yet wired");
    }
  });
});
