import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../../src/domain/routing/defaults.js";
import { preflightPhaseModels } from "../../../src/domain/routing/preflight.js";
import type { ModelRouting } from "../../../src/schemas/modelRouting.js";
import type { ProviderConfig } from "../../../src/schemas/providerConfig.js";

// Minimal catalog: one active claude-sonnet entry
const minimalProviderConfig: ProviderConfig = {
  providers: {
    "claude-code": {
      enabled: true,
      executable: "claude",
      families: {
        "claude-sonnet": {
          models: [
            {
              id: "claude-sonnet-4-6",
              efforts: ["low", "medium", "high", "max"],
              status: "active",
            },
          ],
        },
      },
    },
  },
};

const minimalRouting: ModelRouting = {
  version: 2,
  providerPriority: ["claude-code"],
  allowDowngrade: true,
  equivalence: {},
  requestedModelNormalization: {},
};

describe("preflightPhaseModels — no failures", () => {
  it("returns empty failures for a valid model and effort", () => {
    const result = preflightPhaseModels(
      [{ id: "phase-01", model: "claude-sonnet-4-6", effort: "medium" }],
      minimalRouting,
      minimalProviderConfig,
    );
    expect(result.failures).toHaveLength(0);
  });

  it("returns empty failures for all default catalog entries with supported efforts", () => {
    const result = preflightPhaseModels(
      [
        { id: "phase-01", model: "claude-sonnet-4-6", effort: "high" },
        { id: "phase-02", model: "claude-opus-4-8", effort: "xhigh" },
        { id: "phase-03", model: "claude-haiku-4-5-20251001", effort: "none" },
      ],
      DEFAULT_MODEL_ROUTING,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(result.failures).toHaveLength(0);
  });

  it("validates multiple phases and only reports failures", () => {
    const result = preflightPhaseModels(
      [
        { id: "phase-01", model: "claude-sonnet-4-6", effort: "low" },
        { id: "phase-02", model: "not-in-catalog", effort: "medium" },
      ],
      minimalRouting,
      minimalProviderConfig,
    );
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.phaseId).toBe("phase-02");
  });
});

describe("preflightPhaseModels — id not found", () => {
  it("reports id-not-found when the model is not in the catalog", () => {
    const result = preflightPhaseModels(
      [{ id: "phase-01", model: "unknown-model-99", effort: "medium" }],
      minimalRouting,
      minimalProviderConfig,
    );
    expect(result.failures).toHaveLength(1);
    const failure = result.failures[0]!;
    expect(failure.phaseId).toBe("phase-01");
    expect(failure.model).toBe("unknown-model-99");
    expect(failure.reasons).toHaveLength(1);
    expect(failure.reasons[0]).toContain("not found in catalog");
    expect(failure.alternatives).toHaveLength(0);
  });

  it("stops further checks when id is not found", () => {
    const result = preflightPhaseModels(
      [{ id: "phase-01", model: "ghost-model", effort: "ultracode" }],
      minimalRouting,
      minimalProviderConfig,
    );
    expect(result.failures[0]?.reasons).toHaveLength(1);
    expect(result.failures[0]?.reasons[0]).toContain("not found in catalog");
  });
});

describe("preflightPhaseModels — unsupported effort", () => {
  it("reports unsupported effort with alternatives listing supported efforts", () => {
    const result = preflightPhaseModels(
      [{ id: "phase-01", model: "claude-sonnet-4-6", effort: "ultracode" }],
      minimalRouting,
      minimalProviderConfig,
    );
    expect(result.failures).toHaveLength(1);
    const failure = result.failures[0]!;
    expect(failure.reasons[0]).toContain("ultracode");
    expect(failure.reasons[0]).toContain("not supported");
    expect(failure.alternatives).toHaveLength(1);
    expect(failure.alternatives[0]?.id).toBe("claude-sonnet-4-6");
    expect(failure.alternatives[0]?.efforts).toContain("medium");
  });

  it("includes the supported efforts in the reason message", () => {
    const result = preflightPhaseModels(
      [{ id: "phase-01", model: "claude-sonnet-4-6", effort: "xhigh" }],
      minimalRouting,
      minimalProviderConfig,
    );
    const reason = result.failures[0]?.reasons[0] ?? "";
    expect(reason).toContain("low, medium, high, max");
  });
});

describe("preflightPhaseModels — deprecated model", () => {
  const configWithDeprecated: ProviderConfig = {
    providers: {
      "claude-code": {
        enabled: true,
        executable: "claude",
        families: {
          "claude-sonnet": {
            models: [
              {
                id: "claude-sonnet-4-6",
                efforts: ["low", "medium", "high", "max"],
                status: "active",
              },
              {
                id: "claude-sonnet-4-5",
                efforts: ["low", "medium", "high"],
                status: "deprecated",
              },
            ],
          },
        },
      },
    },
  };

  it("reports deprecated model and lists active alternatives", () => {
    const result = preflightPhaseModels(
      [{ id: "phase-01", model: "claude-sonnet-4-5", effort: "medium" }],
      minimalRouting,
      configWithDeprecated,
    );
    expect(result.failures).toHaveLength(1);
    const failure = result.failures[0]!;
    expect(failure.reasons.some((r) => r.includes("deprecated"))).toBe(true);
    expect(failure.alternatives.some((a) => a.id === "claude-sonnet-4-6")).toBe(true);
  });

  it("omits deprecated entries from alternatives", () => {
    const result = preflightPhaseModels(
      [{ id: "phase-01", model: "claude-sonnet-4-5", effort: "medium" }],
      minimalRouting,
      configWithDeprecated,
    );
    const altIds = result.failures[0]?.alternatives.map((a) => a.id) ?? [];
    expect(altIds).not.toContain("claude-sonnet-4-5");
  });

  it("only lists active alternatives that support the requested effort", () => {
    const configNoMatch: ProviderConfig = {
      providers: {
        "claude-code": {
          enabled: true,
          executable: "claude",
          families: {
            "claude-sonnet": {
              models: [
                {
                  id: "claude-sonnet-4-6",
                  efforts: ["low", "medium"],
                  status: "active",
                },
                {
                  id: "claude-sonnet-4-5",
                  efforts: ["high"],
                  status: "deprecated",
                },
              ],
            },
          },
        },
      },
    };
    const result = preflightPhaseModels(
      [{ id: "phase-01", model: "claude-sonnet-4-5", effort: "high" }],
      minimalRouting,
      configNoMatch,
    );
    // claude-sonnet-4-6 only has low/medium, not high → no alternatives
    const altIds = result.failures[0]?.alternatives.map((a) => a.id) ?? [];
    expect(altIds).not.toContain("claude-sonnet-4-6");
  });
});

describe("preflightPhaseModels — disabled provider", () => {
  const disabledProviderConfig: ProviderConfig = {
    providers: {
      "codex-cli": {
        enabled: false,
        executable: "codex",
        families: {
          "openai-gpt": {
            models: [
              {
                id: "gpt-5.5",
                efforts: ["low", "medium", "high", "xhigh"],
                status: "active",
              },
            ],
          },
        },
      },
    },
  };

  const routingNoEquivalence: ModelRouting = {
    version: 2,
    providerPriority: ["codex-cli"],
    allowDowngrade: true,
    equivalence: {},
    requestedModelNormalization: {},
  };

  it("fails when the provider is disabled and no cross-family equivalence exists", () => {
    const result = preflightPhaseModels(
      [{ id: "phase-01", model: "gpt-5.5", effort: "medium" }],
      routingNoEquivalence,
      disabledProviderConfig,
    );
    expect(result.failures).toHaveLength(1);
    const failure = result.failures[0]!;
    expect(failure.reasons.some((r) => r.includes("disabled"))).toBe(true);
    expect(failure.reasons.some((r) => r.includes("no permitted cross-family"))).toBe(true);
  });

  it("passes when the provider is disabled but an equivalence route exists", () => {
    // gpt-5.5 has equivalence to claude-sonnet-4-6 in DEFAULT_MODEL_ROUTING,
    // and claude-code is enabled in DEFAULT_PROVIDER_CONFIG.
    const result = preflightPhaseModels(
      [{ id: "phase-01", model: "gpt-5.5", effort: "medium" }],
      DEFAULT_MODEL_ROUTING,
      DEFAULT_PROVIDER_CONFIG,
    );
    // codex-cli is disabled in DEFAULT_PROVIDER_CONFIG, but there's an equivalence
    // route to claude-code which is enabled → no failure
    expect(result.failures).toHaveLength(0);
  });

  it("fails when allowDowngrade is false and routing to Claude is a downgrade (spoke is better)", () => {
    // relation: "upgrade" means the spoke (gpt-5.5) is BETTER than the Claude hub.
    // Routing from disabled codex-cli to Claude inverts the relation: upgrade → downgrade.
    // allowDowngrade: false blocks the "downgrade" hop → no permitted route → preflight fails.
    const routingWithDowngrade: ModelRouting = {
      version: 2,
      providerPriority: ["codex-cli", "claude-code"],
      allowDowngrade: false,
      equivalence: {
        "gpt-5.5": {
          medium: { claude: "claude-sonnet-4-6", effort: "medium", relation: "upgrade" },
        },
      },
      requestedModelNormalization: {},
    };
    const configWithClaude: ProviderConfig = {
      providers: {
        "codex-cli": {
          enabled: false,
          executable: "codex",
          families: {
            "openai-gpt": {
              models: [{ id: "gpt-5.5", efforts: ["medium"], status: "active" }],
            },
          },
        },
        "claude-code": {
          enabled: true,
          executable: "claude",
          families: {
            "claude-sonnet": {
              models: [
                {
                  id: "claude-sonnet-4-6",
                  efforts: ["low", "medium", "high", "max"],
                  status: "active",
                },
              ],
            },
          },
        },
      },
    };
    const result = preflightPhaseModels(
      [{ id: "phase-01", model: "gpt-5.5", effort: "medium" }],
      routingWithDowngrade,
      configWithClaude,
    );
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.reasons.some((r) => r.includes("no permitted cross-family"))).toBe(
      true,
    );
  });

  it("passes when allowDowngrade is false but the equivalence is equivalent (not downgrade)", () => {
    const routingEquiv: ModelRouting = {
      version: 2,
      providerPriority: ["codex-cli", "claude-code"],
      allowDowngrade: false,
      equivalence: {
        "gpt-5.5": {
          medium: { claude: "claude-sonnet-4-6", effort: "medium", relation: "equivalent" },
        },
      },
      requestedModelNormalization: {},
    };
    const configWithClaude: ProviderConfig = {
      providers: {
        "codex-cli": {
          enabled: false,
          executable: "codex",
          families: {
            "openai-gpt": {
              models: [{ id: "gpt-5.5", efforts: ["medium"], status: "active" }],
            },
          },
        },
        "claude-code": {
          enabled: true,
          executable: "claude",
          families: {
            "claude-sonnet": {
              models: [
                {
                  id: "claude-sonnet-4-6",
                  efforts: ["low", "medium", "high", "max"],
                  status: "active",
                },
              ],
            },
          },
        },
      },
    };
    const result = preflightPhaseModels(
      [{ id: "phase-01", model: "gpt-5.5", effort: "medium" }],
      routingEquiv,
      configWithClaude,
    );
    expect(result.failures).toHaveLength(0);
  });
});

describe("preflightPhaseModels — multiple failures per phase", () => {
  it("accumulates multiple reasons for the same phase", () => {
    const configWithDeprecatedAndBadEffort: ProviderConfig = {
      providers: {
        "claude-code": {
          enabled: true,
          executable: "claude",
          families: {
            "claude-sonnet": {
              models: [
                {
                  id: "claude-sonnet-4-5",
                  efforts: ["low", "medium"],
                  status: "deprecated",
                },
                {
                  id: "claude-sonnet-4-6",
                  efforts: ["low", "medium", "high", "max"],
                  status: "active",
                },
              ],
            },
          },
        },
      },
    };
    const result = preflightPhaseModels(
      [{ id: "phase-01", model: "claude-sonnet-4-5", effort: "xhigh" }],
      minimalRouting,
      configWithDeprecatedAndBadEffort,
    );
    expect(result.failures).toHaveLength(1);
    const failure = result.failures[0]!;
    expect(failure.reasons.length).toBeGreaterThanOrEqual(2);
    expect(failure.reasons.some((r) => r.includes("xhigh"))).toBe(true);
    expect(failure.reasons.some((r) => r.includes("deprecated"))).toBe(true);
  });
});

describe("preflightPhaseModels — empty phases", () => {
  it("returns empty failures for an empty phase list", () => {
    const result = preflightPhaseModels([], minimalRouting, minimalProviderConfig);
    expect(result.failures).toHaveLength(0);
  });
});
