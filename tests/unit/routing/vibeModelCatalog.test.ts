import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  loadModelRouting,
  loadProviderConfig,
  PROVIDER_CONFIG_PATH,
} from "../../../src/app/loadRouting.js";
import { ConfigValidationError } from "../../../src/domain/errors.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../../src/domain/routing/defaults.js";
import { resolveModel } from "../../../src/domain/routing/resolve.js";
import { makeFakeFileSystem } from "../../../src/infra/fakes/fs.js";

describe("Vibe catalog: mistral-medium-3.5 (acceptance)", () => {
  it.fails("Claude requests reach mistral-medium-3.5", async () => {
    const { layer } = makeFakeFileSystem();
    const routing = await Effect.runPromise(loadModelRouting().pipe(Effect.provide(layer)));
    const loaded = await Effect.runPromise(loadProviderConfig().pipe(Effect.provide(layer)));
    const providers = {
      ...loaded,
      providers: {
        ...loaded.providers,
        "mistral-vibe": { ...loaded.providers["mistral-vibe"]!, enabled: true },
      },
    };
    expect(routing.providerPriority[0]).toBe("mistral-vibe");

    const high = resolveModel({ model: "claude-sonnet-4-6", effort: "high" }, routing, providers);
    expect(high.selected.provider).toBe("mistral-vibe");
    expect(high.selected.family).toBe("mistral-medium");
    expect(high.selected.concreteModel).toBe("mistral-medium-3.5");
    expect(high.selected.thinking).toBe("high");
    expect(high.relationship).toBe("equivalent");

    const off = resolveModel(
      { model: "claude-haiku-4-5-20251001", effort: "none" },
      routing,
      providers,
    );
    expect(off.selected.concreteModel).toBe("mistral-medium-3.5");
    expect(off.selected.thinking).toBe("off");
    expect(off.relationship).toBe("equivalent");

    expect(
      DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"]?.families?.["mistral-medium"]?.models,
    ).toEqual([{ id: "mistral-medium-3.5", efforts: ["off", "high"], status: "active" }]);
  });

  it.fails("the built-in equivalence keys Vibe's edges on mistral-medium-3.5", () => {
    const equivalence: Record<string, unknown> = DEFAULT_MODEL_ROUTING.equivalence;
    expect(equivalence["mistral-medium-3.5"]).toEqual({
      off: { claude: "claude-haiku-4-5-20251001", effort: "none", relation: "equivalent" },
      high: { claude: "claude-sonnet-4-6", effort: "high", relation: "equivalent" },
    });
    expect(
      Object.keys(DEFAULT_MODEL_ROUTING.equivalence).filter((k) =>
        k.startsWith("phax-mistral-medium-3.5"),
      ),
    ).toEqual([]);
  });

  it.fails("a providers.json listing the phax alias ids is refused", async () => {
    const { impl, layer } = makeFakeFileSystem();
    const file = {
      ...DEFAULT_PROVIDER_CONFIG,
      providers: {
        "claude-code": DEFAULT_PROVIDER_CONFIG.providers["claude-code"],
        "mistral-vibe": {
          enabled: true,
          executable: "vibe",
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
      },
    };
    impl.setFile(PROVIDER_CONFIG_PATH, JSON.stringify(file));
    const err = await Effect.runPromise(
      Effect.flip(loadProviderConfig().pipe(Effect.provide(layer))),
    );
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect(err.path).toBe(PROVIDER_CONFIG_PATH);
    expect(err.message).toContain("phax-mistral-medium-3.5-off");
    expect(err.message).toContain("phax-mistral-medium-3.5-high");
    expect(err.message).toContain("phax agent setup providers --write");
  });
});
