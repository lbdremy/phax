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
        "claude-haiku": {
          models: [{ id: "claude-haiku-4-5-20251001", efforts: ["none"], status: "active" }],
        },
        "claude-sonnet": {
          models: [
            {
              id: "claude-sonnet-4-6",
              efforts: ["low", "medium", "high", "max"],
              status: "active",
            },
          ],
        },
        "claude-opus": {
          models: [
            {
              id: "claude-opus-4-7",
              efforts: ["low", "medium", "high", "xhigh", "max"],
              status: "active",
            },
          ],
        },
      },
    },
    "mistral-vibe": {
      enabled: false,
      executable: "vibe",
      modelEnvVar: "VIBE_ACTIVE_MODEL",
      defaultAgent: "auto-approve",
      families: {
        "mistral-medium": {
          models: [
            { id: "phax-mistral-medium-3.5-off", efforts: ["off"], status: "active" },
            { id: "phax-mistral-medium-3.5-high", efforts: ["high"], status: "active" },
          ],
        },
      },
    },
    "codex-cli": {
      enabled: false,
      executable: "codex",
      families: {
        "openai-gpt": {
          models: [{ id: "gpt-5.5", efforts: ["low", "medium", "high"], status: "active" }],
        },
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
          families: {
            "mistral-medium": {
              models: [{ id: "phax-mistral-medium-3.5-high", efforts: ["high"], status: "active" }],
            },
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
    expect(entry.families).toEqual({
      "mistral-medium": {
        models: [{ id: "phax-mistral-medium-3.5-high", efforts: ["high"], status: "active" }],
      },
    });
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

  it("drops the Mistral aliases phax retired, keeps the rest, and names what it dropped", () => {
    const vibe = BASE_CONFIG.providers["mistral-vibe"]!;
    const older: ProviderConfig = {
      providers: {
        ...BASE_CONFIG.providers,
        "mistral-vibe": {
          ...vibe,
          families: {
            "mistral-medium": {
              models: [
                { id: "phax-mistral-medium-3.5-off", efforts: ["off"], status: "active" },
                { id: "phax-mistral-medium-3.5-low", efforts: ["low"], status: "active" },
                { id: "phax-mistral-medium-3.5-high", efforts: ["high"], status: "active" },
                { id: "phax-mistral-medium-3.5-max", efforts: ["max"], status: "active" },
              ],
            },
          },
        },
      },
    };

    const plan = planProviderConfig(older, [], { prune: false });

    expect(plan.retiredRemoved).toEqual([
      "phax-mistral-medium-3.5-low",
      "phax-mistral-medium-3.5-max",
    ]);
    expect(plan.config.providers["mistral-vibe"]).toEqual(vibe);
    expect(plan.config.providers["claude-code"]).toEqual(BASE_CONFIG.providers["claude-code"]);
  });

  it("drops a family every model of which is retired", () => {
    const older: ProviderConfig = {
      providers: {
        "mistral-vibe": {
          ...BASE_CONFIG.providers["mistral-vibe"]!,
          families: {
            "mistral-medium": {
              models: [{ id: "phax-mistral-medium-3.5-low", efforts: ["low"], status: "active" }],
            },
          },
        },
      },
    };

    const plan = planProviderConfig(older, [], { prune: false });

    expect(plan.config.providers["mistral-vibe"]!.families).toEqual({});
    expect(plan.retiredRemoved).toEqual(["phax-mistral-medium-3.5-low"]);
  });

  it("names nothing when no retired model is listed", () => {
    expect(planProviderConfig(BASE_CONFIG, [], { prune: false }).retiredRemoved).toEqual([]);
  });
});
