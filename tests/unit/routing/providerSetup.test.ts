import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "../../../src/schemas/providerConfig.js";
import {
  planProviderConfig,
  type ProviderProbeResult,
} from "../../../src/domain/routing/providerSetup.js";

const BASE_CONFIG: ProviderConfig = {
  providers: {
    "claude-code": {
      enabled: true,
      executable: "claude",
      families: {
        "claude-haiku": { model: "claude-haiku-4-5-20251001" },
        "claude-sonnet": { model: "claude-sonnet-4-6" },
        "claude-opus": { model: "claude-opus-4-7" },
      },
    },
    "mistral-vibe": {
      enabled: false,
      executable: "vibe",
      modelEnvVar: "VIBE_ACTIVE_MODEL",
      defaultAgent: "auto-approve",
      aliases: {
        "mistral-medium/off": "phax-mistral-medium-3.5-off",
        "mistral-medium/medium": "phax-mistral-medium-3.5-medium",
      },
    },
    "codex-cli": {
      enabled: false,
      executable: "codex",
      families: {
        "openai-chatgpt": { model: "gpt-5.5" },
      },
    },
  },
};

const probe = (provider: string, available: boolean): ProviderProbeResult => ({
  provider,
  available,
});

describe("planProviderConfig", () => {
  it("enables an available-but-disabled provider", () => {
    const plan = planProviderConfig(BASE_CONFIG, [probe("mistral-vibe", true)], { prune: false });

    expect(plan.enabled).toEqual(["mistral-vibe"]);
    expect(plan.disabled).toEqual([]);
    expect(plan.config.providers["mistral-vibe"]!.enabled).toBe(true);
  });

  it("with prune: true, disables an enabled-but-unavailable provider", () => {
    const plan = planProviderConfig(BASE_CONFIG, [probe("claude-code", false)], { prune: true });

    expect(plan.disabled).toEqual(["claude-code"]);
    expect(plan.enabled).toEqual([]);
    expect(plan.config.providers["claude-code"]!.enabled).toBe(false);
  });

  it("with prune: false, leaves an enabled-but-unavailable provider untouched", () => {
    const plan = planProviderConfig(BASE_CONFIG, [probe("claude-code", false)], { prune: false });

    expect(plan.disabled).toEqual([]);
    expect(plan.unchanged).toContain("claude-code");
    expect(plan.config.providers["claude-code"]!.enabled).toBe(true);
  });

  it("preserves custom entry fields verbatim", () => {
    const customConfig: ProviderConfig = {
      providers: {
        "mistral-vibe": {
          enabled: false,
          executable: "/usr/local/bin/vibe",
          modelEnvVar: "CUSTOM_VAR",
          defaultAgent: "custom-agent",
          aliases: {
            "mistral-medium/off": "my-alias",
          },
          families: {
            "mistral-medium": { model: "mistral-medium-3.5" },
          },
        },
      },
    };

    const plan = planProviderConfig(customConfig, [probe("mistral-vibe", true)], { prune: false });

    const entry = plan.config.providers["mistral-vibe"]!;
    expect(entry.enabled).toBe(true);
    expect(entry.executable).toBe("/usr/local/bin/vibe");
    expect(entry.modelEnvVar).toBe("CUSTOM_VAR");
    expect(entry.defaultAgent).toBe("custom-agent");
    expect(entry.aliases).toEqual({ "mistral-medium/off": "my-alias" });
    expect(entry.families).toEqual({ "mistral-medium": { model: "mistral-medium-3.5" } });
  });

  it("is idempotent — running the plan's config back through yields no changes", () => {
    const probes: ProviderProbeResult[] = [
      probe("claude-code", true),
      probe("mistral-vibe", true),
      probe("codex-cli", false),
    ];

    const first = planProviderConfig(BASE_CONFIG, probes, { prune: false });
    const second = planProviderConfig(first.config, probes, { prune: false });

    expect(second.enabled).toEqual([]);
    expect(second.disabled).toEqual([]);
    expect(second.unchanged).toContain("claude-code");
    expect(second.unchanged).toContain("mistral-vibe");
    expect(second.unchanged).toContain("codex-cli");
  });

  it("reports a provider with no probe result as unchanged", () => {
    const plan = planProviderConfig(BASE_CONFIG, [probe("mistral-vibe", true)], { prune: true });

    expect(plan.unchanged).toContain("codex-cli");
    expect(plan.config.providers["codex-cli"]!.enabled).toBe(false);
  });

  it("does not mutate the input config", () => {
    const originalEnabled = BASE_CONFIG.providers["mistral-vibe"]!.enabled;

    planProviderConfig(BASE_CONFIG, [probe("mistral-vibe", true)], { prune: false });

    expect(BASE_CONFIG.providers["mistral-vibe"]!.enabled).toBe(originalEnabled);
  });

  it("handles all providers unchanged when probes match current state", () => {
    const probes: ProviderProbeResult[] = [
      probe("claude-code", true),
      probe("mistral-vibe", false),
      probe("codex-cli", false),
    ];

    const plan = planProviderConfig(BASE_CONFIG, probes, { prune: true });

    expect(plan.enabled).toEqual([]);
    expect(plan.disabled).toEqual([]);
    expect(plan.unchanged).toHaveLength(3);
  });
});
