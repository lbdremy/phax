import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../../src/domain/routing/defaults.js";
import { resolveModel } from "../../../src/domain/routing/resolve.js";
import type { ProviderId, SecurityFilter } from "../../../src/domain/routing/types.js";
import type { ModelRouting } from "../../../src/schemas/modelRouting.js";
import type { ProviderConfig } from "../../../src/schemas/providerConfig.js";

const mistralFirst: ModelRouting = {
  ...DEFAULT_MODEL_ROUTING,
  providerPriority: ["mistral-vibe", "codex-cli", "claude-code"],
};

// All non-Claude providers enabled so the priority walk actually reaches them.
const allEnabledProviderConfig: ProviderConfig = {
  providers: {
    ...DEFAULT_PROVIDER_CONFIG.providers,
    "mistral-vibe": { ...DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"]!, enabled: true },
    "codex-cli": { ...DEFAULT_PROVIDER_CONFIG.providers["codex-cli"]!, enabled: true },
  },
};

const denyProviders =
  (blocked: ReadonlyArray<ProviderId>, reason: string): SecurityFilter =>
  (provider) =>
    blocked.includes(provider) ? { allowed: false, reason } : { allowed: true };

describe("resolveModel — security fallback", () => {
  it("skips a non-strict provider to the next priority and records the reason", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      mistralFirst,
      allEnabledProviderConfig,
      denyProviders(["mistral-vibe"], "filesystem jail too weak"),
    );

    expect(result.selected.provider).toBe("codex-cli");
    expect(result.skippedForSecurity).toEqual([
      { provider: "mistral-vibe", reason: "filesystem jail too weak" },
    ]);
    expect(result.reason).toMatch(
      /Skipped for security: mistral-vibe \(filesystem jail too weak\)/,
    );
  });

  it("falls through to terminal claude-code when every non-claude provider is filtered", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      mistralFirst,
      allEnabledProviderConfig,
      denyProviders(["mistral-vibe", "codex-cli"], "blocked"),
    );

    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-sonnet");
    expect(result.skippedForSecurity).toEqual([
      { provider: "mistral-vibe", reason: "blocked" },
      { provider: "codex-cli", reason: "blocked" },
    ]);
    expect(result.reason).toMatch(/Skipped for security:.*mistral-vibe.*codex-cli/);
  });

  it("records the default reason when the filter rejects without supplying one", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      mistralFirst,
      allEnabledProviderConfig,
      (provider) => (provider === "mistral-vibe" ? { allowed: false } : { allowed: true }),
    );

    expect(result.selected.provider).toBe("codex-cli");
    expect(result.skippedForSecurity).toEqual([
      { provider: "mistral-vibe", reason: "blocked by security policy" },
    ]);
  });

  it("still resolves to claude-code via the terminal fallback even if the priority-walk filter denies it", () => {
    const calls: ProviderId[] = [];
    const filter: SecurityFilter = (provider) => {
      calls.push(provider);
      return { allowed: false, reason: "deny-all" };
    };

    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      mistralFirst,
      allEnabledProviderConfig,
      filter,
    );

    // Filter is consulted for every provider reached in the priority walk.
    expect(calls).toEqual(["mistral-vibe", "codex-cli", "claude-code"]);
    // The terminal claude-code fallback is the guaranteed strong baseline and
    // is not consulted against the filter, so resolution still succeeds with
    // claude-code even when the filter denies everything.
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-sonnet");
  });

  it("returns an unchanged resolution when the filter permits the top-priority provider", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      mistralFirst,
      allEnabledProviderConfig,
      () => ({ allowed: true }),
    );

    expect(result.selected.provider).toBe("mistral-vibe");
    expect(result.skippedForSecurity).toBeUndefined();
    expect(result.reason).not.toMatch(/Skipped for security/);
  });
});
