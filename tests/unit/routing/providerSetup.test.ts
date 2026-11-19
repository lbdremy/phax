import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "../../../src/schemas/providerConfig.js";
import {
  obsoleteProviderFields,
  planProviderConfig,
  retiredEquivalenceKeys,
  withoutObsoleteProviderFields,
  type ProviderProbeResult,
} from "../../../src/domain/routing/providerSetup.js";
import {
  DEFAULT_MODEL_ROUTING,
  RETIRED_MODEL_IDS,
  RETIRED_MODEL_SUCCESSORS,
} from "../../../src/domain/routing/defaults.js";

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
      defaultAgent: "auto-approve",
      families: {
        "mistral-medium": {
          models: [{ id: "mistral-medium-3.5", efforts: ["off", "high"], status: "active" }],
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

const noFields = { fieldsDropped: [] } as const;

/** BASE_CONFIG with the Vibe family replaced by `models`. */
function withVibeModels(models: ProviderConfig["providers"][string]["families"]): ProviderConfig {
  return {
    providers: {
      ...BASE_CONFIG.providers,
      "mistral-vibe": { ...BASE_CONFIG.providers["mistral-vibe"]!, families: models },
    },
  };
}

const SUCCESSOR_ENTRY = { id: "mistral-medium-3.5", efforts: ["off", "high"], status: "active" };

describe("planProviderConfig", () => {
  it("enables an available-but-disabled provider", () => {
    const plan = planProviderConfig(BASE_CONFIG, [probe("mistral-vibe", true)], {
      prune: false,
      ...noFields,
    });

    expect(plan.enabled).toEqual(["mistral-vibe"]);
    expect(plan.disabled).toEqual([]);
    expect(plan.config.providers["mistral-vibe"]!.enabled).toBe(true);
  });

  it("with prune: true, disables an enabled-but-unavailable provider", () => {
    const plan = planProviderConfig(BASE_CONFIG, [probe("claude-code", false)], {
      prune: true,
      ...noFields,
    });

    expect(plan.disabled).toEqual(["claude-code"]);
    expect(plan.enabled).toEqual([]);
    expect(plan.config.providers["claude-code"]!.enabled).toBe(false);
  });

  it("with prune: false, leaves an enabled-but-unavailable provider untouched", () => {
    const plan = planProviderConfig(BASE_CONFIG, [probe("claude-code", false)], {
      prune: false,
      ...noFields,
    });

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
          defaultAgent: "custom-agent",
          families: {
            "mistral-medium": {
              models: [{ id: "mistral-medium-3.5", efforts: ["high"], status: "active" }],
            },
          },
        },
      },
    };

    const plan = planProviderConfig(customConfig, [probe("mistral-vibe", true)], {
      prune: false,
      ...noFields,
    });

    const entry = plan.config.providers["mistral-vibe"]!;
    expect(entry.enabled).toBe(true);
    expect(entry.executable).toBe("/usr/local/bin/vibe");
    expect(entry.defaultAgent).toBe("custom-agent");
    expect(entry.families).toEqual({
      "mistral-medium": {
        models: [{ id: "mistral-medium-3.5", efforts: ["high"], status: "active" }],
      },
    });
  });

  it("is idempotent — running the plan's config back through yields no changes", () => {
    const probes: ProviderProbeResult[] = [
      probe("claude-code", true),
      probe("mistral-vibe", true),
      probe("codex-cli", false),
    ];

    const first = planProviderConfig(BASE_CONFIG, probes, { prune: false, ...noFields });
    const second = planProviderConfig(first.config, probes, { prune: false, ...noFields });

    expect(second.enabled).toEqual([]);
    expect(second.disabled).toEqual([]);
    expect(second.unchanged).toContain("claude-code");
    expect(second.unchanged).toContain("mistral-vibe");
    expect(second.unchanged).toContain("codex-cli");
  });

  it("reports a provider with no probe result as unchanged", () => {
    const plan = planProviderConfig(BASE_CONFIG, [probe("mistral-vibe", true)], {
      prune: true,
      ...noFields,
    });

    expect(plan.unchanged).toContain("codex-cli");
    expect(plan.config.providers["codex-cli"]!.enabled).toBe(false);
  });

  it("does not mutate the input config", () => {
    const originalEnabled = BASE_CONFIG.providers["mistral-vibe"]!.enabled;

    planProviderConfig(BASE_CONFIG, [probe("mistral-vibe", true)], { prune: false, ...noFields });

    expect(BASE_CONFIG.providers["mistral-vibe"]!.enabled).toBe(originalEnabled);
  });

  it("handles all providers unchanged when probes match current state", () => {
    const probes: ProviderProbeResult[] = [
      probe("claude-code", true),
      probe("mistral-vibe", false),
      probe("codex-cli", false),
    ];

    const plan = planProviderConfig(BASE_CONFIG, probes, { prune: true, ...noFields });

    expect(plan.enabled).toEqual([]);
    expect(plan.disabled).toEqual([]);
    expect(plan.unchanged).toHaveLength(3);
  });

  it("carries the dropped field paths it is given", () => {
    const plan = planProviderConfig(BASE_CONFIG, [], {
      prune: false,
      fieldsDropped: ["providers.mistral-vibe.modelEnvVar"],
    });

    expect(plan.fieldsDropped).toEqual(["providers.mistral-vibe.modelEnvVar"]);
  });
});

describe("planProviderConfig — retired model ids", () => {
  it("drops the Mistral aliases phax retired, keeps the rest, and names what it dropped", () => {
    const vibe = BASE_CONFIG.providers["mistral-vibe"]!;
    const older = withVibeModels({
      "mistral-medium": {
        models: [
          { id: "mistral-medium-3.5", efforts: ["off", "high"], status: "active" },
          { id: "phax-mistral-medium-3.5-low", efforts: ["low"], status: "active" },
          { id: "phax-mistral-medium-3.5-max", efforts: ["max"], status: "active" },
        ],
      },
    });

    const plan = planProviderConfig(older, [], { prune: false, ...noFields });

    expect(plan.retiredRemoved).toEqual([
      "phax-mistral-medium-3.5-low",
      "phax-mistral-medium-3.5-max",
    ]);
    expect(plan.config.providers["mistral-vibe"]).toEqual(vibe);
    expect(plan.config.providers["claude-code"]).toEqual(BASE_CONFIG.providers["claude-code"]);
  });

  it("lists the successor in a family every model of which is retired", () => {
    const older = withVibeModels({
      "mistral-medium": {
        models: [{ id: "phax-mistral-medium-3.5-low", efforts: ["low"], status: "active" }],
      },
    });

    const plan = planProviderConfig(older, [], { prune: false, ...noFields });

    expect(plan.config.providers["mistral-vibe"]!.families).toEqual({
      "mistral-medium": { models: [SUCCESSOR_ENTRY] },
    });
    expect(plan.retiredRemoved).toEqual(["phax-mistral-medium-3.5-low"]);
    expect(plan.retiredReplaced).toEqual(["mistral-medium-3.5"]);
  });

  it("lists the successor once, where the first retired id stood, when both aliases retire", () => {
    const older = withVibeModels({
      "mistral-medium": {
        models: [
          { id: "custom-first", efforts: ["high"], status: "active" },
          { id: "phax-mistral-medium-3.5-off", efforts: ["off"], status: "active" },
          { id: "custom-middle", efforts: ["high"], status: "active" },
          { id: "phax-mistral-medium-3.5-high", efforts: ["high"], status: "active" },
        ],
      },
    });

    const plan = planProviderConfig(older, [], { prune: false, ...noFields });

    expect(
      plan.config.providers["mistral-vibe"]!.families!["mistral-medium"]!.models.map((m) => m.id),
    ).toEqual(["custom-first", "mistral-medium-3.5", "custom-middle"]);
    expect(plan.retiredReplaced).toEqual(["mistral-medium-3.5"]);
    expect(plan.retiredRemoved).toEqual([
      "phax-mistral-medium-3.5-off",
      "phax-mistral-medium-3.5-high",
    ]);
  });

  it("lists nothing in place when the family already lists the successor", () => {
    const older = withVibeModels({
      "mistral-medium": {
        models: [
          { id: "phax-mistral-medium-3.5-off", efforts: ["off"], status: "active" },
          { id: "mistral-medium-3.5", efforts: ["high"], status: "active" },
        ],
      },
    });

    const plan = planProviderConfig(older, [], { prune: false, ...noFields });

    expect(plan.config.providers["mistral-vibe"]!.families).toEqual({
      "mistral-medium": {
        models: [{ id: "mistral-medium-3.5", efforts: ["high"], status: "active" }],
      },
    });
    expect(plan.retiredReplaced).toEqual([]);
    expect(plan.retiredRemoved).toEqual(["phax-mistral-medium-3.5-off"]);
  });

  it("drops a retired id whose provider or family has no built-in successor entry", () => {
    const older: ProviderConfig = {
      providers: {
        "my-vibe": {
          enabled: true,
          executable: "vibe",
          families: {
            "mistral-medium": {
              models: [{ id: "phax-mistral-medium-3.5-off", efforts: ["off"], status: "active" }],
            },
          },
        },
      },
    };

    const plan = planProviderConfig(older, [], { prune: false, ...noFields });

    expect(plan.config.providers["my-vibe"]!.families).toEqual({});
    expect(plan.retiredReplaced).toEqual([]);
  });

  it("names nothing when no retired model is listed", () => {
    const plan = planProviderConfig(BASE_CONFIG, [], { prune: false, ...noFields });

    expect(plan.retiredRemoved).toEqual([]);
    expect(plan.retiredReplaced).toEqual([]);
  });

  it("gives every retired id a successor", () => {
    expect(Object.keys(RETIRED_MODEL_SUCCESSORS).toSorted()).toEqual(
      Object.keys(RETIRED_MODEL_IDS).toSorted(),
    );
    expect(new Set(Object.values(RETIRED_MODEL_SUCCESSORS))).toEqual(
      new Set(["mistral-medium-3.5"]),
    );
  });
});

describe("obsoleteProviderFields", () => {
  const FIELD = "phax picks the Vibe model with --model";

  it.each([
    ["no providers key", {}, []],
    ["a non-object raw value", "text", []],
    ["a null raw value", null, []],
    ["providers that is a list", { providers: [{ modelEnvVar: "X" }] }, []],
    ["a non-object entry", { providers: { "mistral-vibe": "vibe" } }, []],
    ["an entry without the field", { providers: { "mistral-vibe": { enabled: true } } }, []],
    [
      "one provider carrying it",
      { providers: { "mistral-vibe": { modelEnvVar: "VIBE_ACTIVE_MODEL" } } },
      [{ path: "providers.mistral-vibe.modelEnvVar", reason: FIELD }],
    ],
    [
      "several providers, claude-code included, in file order",
      {
        providers: {
          "claude-code": { modelEnvVar: "ANTHROPIC_MODEL" },
          "codex-cli": { enabled: false },
          "mistral-vibe": { modelEnvVar: "VIBE_ACTIVE_MODEL" },
        },
      },
      [
        { path: "providers.claude-code.modelEnvVar", reason: FIELD },
        { path: "providers.mistral-vibe.modelEnvVar", reason: FIELD },
      ],
    ],
  ])("%s", (_name, raw, expected) => {
    expect(obsoleteProviderFields(raw)).toEqual(expected);
  });

  it("withoutObsoleteProviderFields removes exactly the reported fields", () => {
    const raw = {
      providers: {
        "claude-code": { enabled: true, modelEnvVar: "ANTHROPIC_MODEL" },
        "mistral-vibe": { enabled: false, modelEnvVar: "VIBE_ACTIVE_MODEL", executable: "vibe" },
        broken: "text",
      },
    };

    const stripped = withoutObsoleteProviderFields(raw);

    expect(stripped).toEqual({
      providers: {
        "claude-code": { enabled: true },
        "mistral-vibe": { enabled: false, executable: "vibe" },
        broken: "text",
      },
    });
    expect(obsoleteProviderFields(stripped)).toEqual([]);
    expect(raw.providers["claude-code"]).toHaveProperty("modelEnvVar");
  });

  it("withoutObsoleteProviderFields returns a value with no providers object as it is", () => {
    expect(withoutObsoleteProviderFields({ other: 1 })).toEqual({ other: 1 });
    expect(withoutObsoleteProviderFields(7)).toBe(7);
  });
});

describe("retiredEquivalenceKeys", () => {
  it("is empty for the built-in table", () => {
    expect(retiredEquivalenceKeys(DEFAULT_MODEL_ROUTING)).toEqual([]);
  });

  it("finds the keys on retired ids, in table order", () => {
    const edges = DEFAULT_MODEL_ROUTING.equivalence["mistral-medium-3.5"]!;
    const routing = {
      ...DEFAULT_MODEL_ROUTING,
      equivalence: {
        "phax-mistral-medium-3.5-max": edges,
        ...DEFAULT_MODEL_ROUTING.equivalence,
        "phax-mistral-medium-3.5-off": edges,
      },
    };

    expect(retiredEquivalenceKeys(routing)).toEqual([
      "phax-mistral-medium-3.5-max",
      "phax-mistral-medium-3.5-off",
    ]);
  });
});
