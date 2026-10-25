import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { resolveDecideModel, resolveVerdictsModel } from "../../../src/domain/decide/model.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../../src/domain/routing/defaults.js";
import type { ModelRouting } from "../../../src/schemas/modelRouting.js";
import {
  DEFAULT_DECIDE_EFFORT,
  DEFAULT_DECIDE_MODEL,
  DEFAULT_VERDICTS_EFFORT,
  DEFAULT_VERDICTS_MODEL,
} from "../../../src/schemas/phaxConfig.js";
import type { ProviderConfig } from "../../../src/schemas/providerConfig.js";

// Spec artifact-decide §5.3 and the plan's arbitration: decide runs on Claude
// Code only, from its flags, else the built-in default.

describe("resolveDecideModel", () => {
  it("falls back to the catalog default, claude-opus-5-5 at high", () => {
    expect(DEFAULT_DECIDE_MODEL).toBe("claude-opus-5-5");
    expect(DEFAULT_DECIDE_EFFORT).toBe("high");
    expect(resolveDecideModel(undefined, undefined)).toEqual(
      Either.right({
        model: "claude-opus-5-5",
        effort: "high",
        modelSource: "catalog default",
        effortSource: "catalog default",
      }),
    );
  });

  it("takes --model and --effort when given", () => {
    expect(resolveDecideModel("claude-sonnet-5-5", "medium")).toEqual(
      Either.right({
        model: "claude-sonnet-5-5",
        effort: "medium",
        modelSource: "flag",
        effortSource: "flag",
      }),
    );
  });

  it("names each source on its own", () => {
    const resolved = resolveDecideModel(undefined, "xhigh");
    expect(Either.getOrThrow(resolved)).toMatchObject({
      model: "claude-opus-5-5",
      effort: "xhigh",
      modelSource: "catalog default",
      effortSource: "flag",
    });
  });

  it("refuses a model outside the Claude Code catalog, naming Claude Code", () => {
    for (const model of ["gpt-6-sol", "phax-mistral-medium-3.5-high", "opus", "claude-opus-9"]) {
      const resolved = resolveDecideModel(model, undefined);
      expect(Either.isLeft(resolved), model).toBe(true);
      if (Either.isLeft(resolved)) {
        expect(resolved.left).toContain(`--model ${model} is not a Claude Code model`);
        expect(resolved.left).toContain("decide runs on Claude Code only");
      }
    }
  });

  it("refuses an effort the Claude entry does not list", () => {
    const resolved = resolveDecideModel("claude-sonnet-4-6", "xhigh");
    expect(Either.isLeft(resolved)).toBe(true);
    if (Either.isLeft(resolved)) {
      expect(resolved.left).toContain("--effort xhigh");
      expect(resolved.left).toContain("low, medium, high, max");
    }
  });
});

// Spec artifact-decide-verdicts: the writer's model is routed like headless
// authoring's, from its flags, else claude-sonnet-5-5 at medium.

const ROUTING = DEFAULT_MODEL_ROUTING;
const CODEX_ENABLED: ProviderConfig = {
  providers: {
    ...DEFAULT_PROVIDER_CONFIG.providers,
    "codex-cli": {
      ...DEFAULT_PROVIDER_CONFIG.providers["codex-cli"]!,
      enabled: true,
    },
  },
};

describe("resolveVerdictsModel", () => {
  it("defaults to claude-sonnet-5-5 at medium, built-in default, routed to claude-code", () => {
    expect(DEFAULT_VERDICTS_MODEL).toBe("claude-sonnet-5-5");
    expect(DEFAULT_VERDICTS_EFFORT).toBe("medium");
    expect(
      Either.getOrThrow(
        resolveVerdictsModel(undefined, undefined, ROUTING, DEFAULT_PROVIDER_CONFIG),
      ),
    ).toMatchObject({
      model: "claude-sonnet-5-5",
      effort: "medium",
      modelSource: "built-in default",
      effortSource: "built-in default",
      provider: "claude-code",
      concreteModel: "claude-sonnet-5-5",
      relationship: "exact",
      thinking: "medium",
    });
  });

  it.each([
    { model: "claude-opus-5-5", effort: "high" },
    { model: "claude-haiku-5-5", effort: "low" },
  ])("takes --model $model and --effort $effort, each source a flag", (c) => {
    expect(
      Either.getOrThrow(resolveVerdictsModel(c.model, c.effort, ROUTING, DEFAULT_PROVIDER_CONFIG)),
    ).toMatchObject({
      model: c.model,
      effort: c.effort,
      modelSource: "flag",
      effortSource: "flag",
      provider: "claude-code",
      concreteModel: c.model,
      relationship: "exact",
    });
  });

  it("names each source on its own", () => {
    expect(
      Either.getOrThrow(resolveVerdictsModel(undefined, "high", ROUTING, DEFAULT_PROVIDER_CONFIG)),
    ).toMatchObject({ modelSource: "built-in default", effortSource: "flag" });
  });

  it("routes to the provider routing selects: gpt-6-luna goes to codex-cli once it is enabled", () => {
    const resolved = Either.getOrThrow(
      resolveVerdictsModel("gpt-6-luna", undefined, ROUTING, CODEX_ENABLED),
    );
    expect(resolved).toMatchObject({
      model: "gpt-6-luna",
      provider: "codex-cli",
      concreteModel: "gpt-6-luna",
    });
  });

  it("runs a model with no equivalent on the fallback, keeping the model asked for", () => {
    const routing: ModelRouting = {
      ...ROUTING,
      requestedModelNormalization: { "mystery-1": "openai-gpt" },
    };
    const resolved = Either.getOrThrow(
      resolveVerdictsModel("mystery-1", "medium", routing, DEFAULT_PROVIDER_CONFIG),
    );
    expect(resolved).toMatchObject({
      model: "mystery-1",
      provider: "claude-code",
      relationship: "no_equivalent",
    });
    expect(resolved.concreteModel).toMatch(/^claude-sonnet/);
  });

  it("does not refuse an unknown model id: it routes", () => {
    const resolved = resolveVerdictsModel(
      "claude-opus-9",
      undefined,
      ROUTING,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(Either.isRight(resolved)).toBe(true);
  });

  it("refuses an effort outside low, medium and high, naming the effort and the allowed values", () => {
    for (const effort of ["xhigh", "max", "ultra", "loud"]) {
      const resolved = resolveVerdictsModel(undefined, effort, ROUTING, DEFAULT_PROVIDER_CONFIG);
      expect(Either.isLeft(resolved), effort).toBe(true);
      if (Either.isLeft(resolved)) {
        expect(resolved.left).toContain(`--effort ${effort}`);
        expect(resolved.left).toContain("low, medium, high");
      }
    }
  });
});
