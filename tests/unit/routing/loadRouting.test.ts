import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  loadModelRouting,
  loadProviderConfig,
  MODEL_ROUTING_PATH,
  PROVIDER_CONFIG_PATH,
  readProviderConfigFile,
} from "../../../src/app/loadRouting.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../../src/domain/routing/defaults.js";
import { makeFakeFileSystem } from "../../../src/infra/fakes/fs.js";
import { ConfigValidationError } from "../../../src/domain/errors.js";

const run = <A>(eff: Effect.Effect<A, ConfigValidationError, never>): Promise<A> =>
  Effect.runPromise(eff);

const runFail = <A>(
  eff: Effect.Effect<A, ConfigValidationError, never>,
): Promise<ConfigValidationError> => Effect.runPromise(Effect.flip(eff));

describe("loadModelRouting", () => {
  it("returns DEFAULT_MODEL_ROUTING when the file is absent", async () => {
    const { layer } = makeFakeFileSystem();
    const result = await run(loadModelRouting().pipe(Effect.provide(layer)));
    expect(result).toEqual(DEFAULT_MODEL_ROUTING);
  });

  it("decodes a valid user-provided model-routing.json", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(MODEL_ROUTING_PATH, JSON.stringify(DEFAULT_MODEL_ROUTING));
    const result = await run(loadModelRouting().pipe(Effect.provide(layer)));
    expect(result).toEqual(DEFAULT_MODEL_ROUTING);
  });

  it("fails with ConfigValidationError on malformed JSON", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(MODEL_ROUTING_PATH, "{ not valid json }");
    const err = await runFail(loadModelRouting().pipe(Effect.provide(layer)));
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect(err.path).toBe(MODEL_ROUTING_PATH);
  });

  it("fails with ConfigValidationError on unknown top-level key", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(
      MODEL_ROUTING_PATH,
      JSON.stringify({ ...DEFAULT_MODEL_ROUTING, unknownKey: true }),
    );
    const err = await runFail(loadModelRouting().pipe(Effect.provide(layer)));
    expect(err).toBeInstanceOf(ConfigValidationError);
  });

  it("fails with ConfigValidationError on invalid providerPriority value", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(
      MODEL_ROUTING_PATH,
      JSON.stringify({ ...DEFAULT_MODEL_ROUTING, providerPriority: ["not-a-provider"] }),
    );
    const err = await runFail(loadModelRouting().pipe(Effect.provide(layer)));
    expect(err).toBeInstanceOf(ConfigValidationError);
  });

  it("rejects a legacy v1 config (tiers/normalization/defaultTier) with no shim", async () => {
    const { impl, layer } = makeFakeFileSystem();
    const legacyV1 = {
      version: 1,
      providerPriority: ["claude-code"],
      allowDowngrade: true,
      defaultTier: "standard",
      families: { claude: ["claude-sonnet"] },
      tiers: { standard: { "claude-code": { family: "claude-sonnet" } } },
      normalization: { "claude-sonnet": { medium: "standard" } },
      requestedModelNormalization: {},
    };
    impl.setFile(MODEL_ROUTING_PATH, JSON.stringify(legacyV1));
    const err = await runFail(loadModelRouting().pipe(Effect.provide(layer)));
    expect(err).toBeInstanceOf(ConfigValidationError);
  });
});

describe("loadProviderConfig", () => {
  it("returns DEFAULT_PROVIDER_CONFIG when the file is absent", async () => {
    const { layer } = makeFakeFileSystem();
    const result = await run(loadProviderConfig().pipe(Effect.provide(layer)));
    expect(result).toEqual(DEFAULT_PROVIDER_CONFIG);
  });

  it("decodes a valid user-provided providers.json", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(PROVIDER_CONFIG_PATH, JSON.stringify(DEFAULT_PROVIDER_CONFIG));
    const result = await run(loadProviderConfig().pipe(Effect.provide(layer)));
    expect(result).toEqual(DEFAULT_PROVIDER_CONFIG);
  });

  it("fails with ConfigValidationError on malformed JSON", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(PROVIDER_CONFIG_PATH, "{ bad json");
    const err = await runFail(loadProviderConfig().pipe(Effect.provide(layer)));
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect(err.path).toBe(PROVIDER_CONFIG_PATH);
  });

  it("fails with ConfigValidationError on schema violation", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(
      PROVIDER_CONFIG_PATH,
      JSON.stringify({ providers: { "claude-code": { enabled: "yes", executable: "claude" } } }),
    );
    const err = await runFail(loadProviderConfig().pipe(Effect.provide(layer)));
    expect(err).toBeInstanceOf(ConfigValidationError);
  });
});

describe("path constants", () => {
  it("MODEL_ROUTING_PATH ends with .phax/model-routing.json", () => {
    expect(MODEL_ROUTING_PATH).toMatch(/\.phax[/\\]model-routing\.json$/);
  });

  it("refuses a providers.json that still lists the Mistral aliases phax retired, naming each and the setup command", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(PROVIDER_CONFIG_PATH, JSON.stringify(withRetiredMistralAliases()));
    const err = await runFail(loadProviderConfig().pipe(Effect.provide(layer)));
    expect(err.path).toBe(PROVIDER_CONFIG_PATH);
    expect(err.message).toContain(
      "  - phax-mistral-medium-3.5-low: the Mistral API refuses low reasoning for mistral-medium-3.5",
    );
    expect(err.message).toContain("phax-mistral-medium-3.5-medium");
    expect(err.message).toContain("phax-mistral-medium-3.5-max");
    expect(err.message).toContain("phax agent setup providers --write");
  });

  it("readProviderConfigFile reads the same file as it is, for setup to rewrite", async () => {
    const { impl, layer } = makeFakeFileSystem();
    const listed = withRetiredMistralAliases();
    impl.setFile(PROVIDER_CONFIG_PATH, JSON.stringify(listed));
    const result = await run(readProviderConfigFile().pipe(Effect.provide(layer)));
    expect(result).toEqual(listed);
  });

  it("PROVIDER_CONFIG_PATH ends with .phax/providers.json", () => {
    expect(PROVIDER_CONFIG_PATH).toMatch(/\.phax[/\\]providers\.json$/);
  });
});

/** The built-in catalog as an older phax wrote it: Mistral with all five aliases. */
function withRetiredMistralAliases(): typeof DEFAULT_PROVIDER_CONFIG {
  const vibe = DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"]!;
  return {
    providers: {
      ...DEFAULT_PROVIDER_CONFIG.providers,
      "mistral-vibe": {
        ...vibe,
        families: {
          "mistral-medium": {
            models: [
              { id: "phax-mistral-medium-3.5-off", efforts: ["off"], status: "active" },
              { id: "phax-mistral-medium-3.5-low", efforts: ["low"], status: "active" },
              { id: "phax-mistral-medium-3.5-medium", efforts: ["medium"], status: "active" },
              { id: "phax-mistral-medium-3.5-high", efforts: ["high"], status: "active" },
              { id: "phax-mistral-medium-3.5-max", efforts: ["max"], status: "active" },
            ],
          },
        },
      },
    },
  };
}
