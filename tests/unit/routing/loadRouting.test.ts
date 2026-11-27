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
    expect(err.message).toContain(
      "  - phax-mistral-medium-3.5-off: phax runs Vibe's mistral-medium-3.5 with --thinking off",
    );
    expect(err.message).toContain(
      "phax-mistral-medium-3.5-high: phax runs Vibe's mistral-medium-3.5 with --thinking high",
    );
    expect(err.message).toContain("phax agent setup providers --write");
  });

  it("readProviderConfigFile reads the same file as it is, for setup to rewrite", async () => {
    const { impl, layer } = makeFakeFileSystem();
    const listed = withRetiredMistralAliases();
    impl.setFile(PROVIDER_CONFIG_PATH, JSON.stringify(listed));
    const result = await run(readProviderConfigFile().pipe(Effect.provide(layer)));
    expect(result).toEqual({ source: "file", config: listed, fieldsDropped: [] });
  });

  it("readProviderConfigFile answers the built-in catalog, said to be built-in, when no file exists", async () => {
    const { layer } = makeFakeFileSystem();
    const result = await run(readProviderConfigFile().pipe(Effect.provide(layer)));
    expect(result).toEqual({
      source: "built-in",
      config: DEFAULT_PROVIDER_CONFIG,
      fieldsDropped: [],
    });
  });

  it("refuses a providers.json carrying modelEnvVar by its field path, why, and the setup command", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(PROVIDER_CONFIG_PATH, JSON.stringify(withModelEnvVar()));
    const err = await runFail(loadProviderConfig().pipe(Effect.provide(layer)));
    expect(err.path).toBe(PROVIDER_CONFIG_PATH);
    expect(err.message).toBe(
      `"${PROVIDER_CONFIG_PATH}" carries fields phax no longer reads:\n` +
        "  - providers.mistral-vibe.modelEnvVar: phax picks the Vibe model with --model\n" +
        "Run `phax agent setup providers --write` to drop them, or delete them from the file.",
    );
  });

  it("shows the fields message before the retired ids of a file with both defects", async () => {
    const { impl, layer } = makeFakeFileSystem();
    const both = withRetiredMistralAliases();
    const vibe = both.providers["mistral-vibe"]!;
    impl.setFile(
      PROVIDER_CONFIG_PATH,
      JSON.stringify({
        providers: { ...both.providers, "mistral-vibe": { ...vibe, modelEnvVar: "X" } },
      }),
    );
    const err = await runFail(loadProviderConfig().pipe(Effect.provide(layer)));
    expect(err.message).toContain("carries fields phax no longer reads");
    expect(err.message).not.toContain("lists models phax no longer routes to");
  });

  it("still refuses an unexpected key other than modelEnvVar through the strict decode", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(
      PROVIDER_CONFIG_PATH,
      JSON.stringify({
        providers: { "claude-code": { enabled: true, executable: "c", extra: 1 } },
      }),
    );
    const err = await runFail(loadProviderConfig().pipe(Effect.provide(layer)));
    expect(err.message).toContain("Invalid providers.json");
  });

  it("readProviderConfigFile strips modelEnvVar and returns where it was", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(PROVIDER_CONFIG_PATH, JSON.stringify(withModelEnvVar()));
    const result = await run(readProviderConfigFile().pipe(Effect.provide(layer)));
    expect(result.fieldsDropped).toEqual([
      {
        path: "providers.mistral-vibe.modelEnvVar",
        reason: "phax picks the Vibe model with --model",
      },
    ]);
    expect(result.config).toEqual(DEFAULT_PROVIDER_CONFIG);
  });

  it("loadModelRouting refuses a 0.40 table keyed on -off and -high, saying to merge them into one mistral-medium-3.5 key", async () => {
    const { impl, layer } = makeFakeFileSystem();
    const { "mistral-medium-3.5": _current, ...others } = DEFAULT_MODEL_ROUTING.equivalence;
    impl.setFile(
      MODEL_ROUTING_PATH,
      JSON.stringify({
        ...DEFAULT_MODEL_ROUTING,
        equivalence: { ...others, ...RETIRED_MISTRAL_KEYS_0_40 },
      }),
    );
    const err = await runFail(loadModelRouting().pipe(Effect.provide(layer)));
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect(err.path).toBe(MODEL_ROUTING_PATH);
    expect(err.message).toBe(
      `"${MODEL_ROUTING_PATH}" keys equivalence edges on models phax no longer routes to:\n` +
        '  - phax-mistral-medium-3.5-off: move its "off" edge into the "mistral-medium-3.5" key\n' +
        '  - phax-mistral-medium-3.5-high: move its "high" edge into the "mistral-medium-3.5" key\n' +
        'Merge the moved edges into one "mistral-medium-3.5" key, not one key per retired key: ' +
        "JSON keeps only the last of two keys with the same name and drops the other's edges. " +
        "Then delete the retired keys, or delete the file to use phax's built-in table.",
    );
  });

  it("loadModelRouting tells an older table to delete its -low, -medium and -max keys, naming the levels offered", async () => {
    const { impl, layer } = makeFakeFileSystem();
    const { "mistral-medium-3.5": _current, ...others } = DEFAULT_MODEL_ROUTING.equivalence;
    impl.setFile(
      MODEL_ROUTING_PATH,
      JSON.stringify({
        ...DEFAULT_MODEL_ROUTING,
        equivalence: { ...others, ...RETIRED_MISTRAL_KEYS_BEFORE_0_40 },
      }),
    );
    const err = await runFail(loadModelRouting().pipe(Effect.provide(layer)));
    const offers = "mistral-medium-3.5 offers only off and high";
    expect(err.message.split("\n").slice(1, 6)).toEqual([
      '  - phax-mistral-medium-3.5-off: move its "off" edge into the "mistral-medium-3.5" key',
      `  - phax-mistral-medium-3.5-low: delete it: ${offers}`,
      `  - phax-mistral-medium-3.5-medium: delete it: ${offers}`,
      '  - phax-mistral-medium-3.5-high: move its "high" edge into the "mistral-medium-3.5" key',
      `  - phax-mistral-medium-3.5-max: delete it: ${offers}`,
    ]);
  });

  it("loadModelRouting names the edges to move and to delete on one retired key", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(
      MODEL_ROUTING_PATH,
      JSON.stringify({
        ...DEFAULT_MODEL_ROUTING,
        equivalence: {
          "phax-mistral-medium-3.5-high": {
            ...RETIRED_MISTRAL_KEYS_BEFORE_0_40["phax-mistral-medium-3.5-high"],
            ...RETIRED_MISTRAL_KEYS_BEFORE_0_40["phax-mistral-medium-3.5-max"],
          },
        },
      }),
    );
    const err = await runFail(loadModelRouting().pipe(Effect.provide(layer)));
    expect(err.message).toContain(
      '  - phax-mistral-medium-3.5-high: move its "high" edge into the "mistral-medium-3.5" key ' +
        'and delete its "max" edge: mistral-medium-3.5 offers only off and high\n',
    );
  });

  it("PROVIDER_CONFIG_PATH ends with .phax/providers.json", () => {
    expect(PROVIDER_CONFIG_PATH).toMatch(/\.phax[/\\]providers\.json$/);
  });
});

/** The built-in catalog as an older phax wrote it: the Vibe entry carries `modelEnvVar`. */
function withModelEnvVar(): object {
  const vibe = DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"]!;
  return {
    providers: {
      ...DEFAULT_PROVIDER_CONFIG.providers,
      "mistral-vibe": { ...vibe, modelEnvVar: "VIBE_ACTIVE_MODEL" },
    },
  };
}

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

/** The Mistral keys of the routing table phax 0.40 scaffolded with `--with-routing`. */
const RETIRED_MISTRAL_KEYS_0_40 = {
  "phax-mistral-medium-3.5-off": {
    off: { claude: "claude-haiku-4-5-20251001", effort: "none", relation: "equivalent" },
  },
  "phax-mistral-medium-3.5-high": {
    high: { claude: "claude-sonnet-4-6", effort: "high", relation: "equivalent" },
  },
} as const;

/** The Mistral keys of the routing table phax scaffolded before the -low/-medium/-max ids retired. */
const RETIRED_MISTRAL_KEYS_BEFORE_0_40 = {
  "phax-mistral-medium-3.5-off": RETIRED_MISTRAL_KEYS_0_40["phax-mistral-medium-3.5-off"],
  "phax-mistral-medium-3.5-low": {
    low: { claude: "claude-sonnet-4-6", effort: "low", relation: "equivalent" },
  },
  "phax-mistral-medium-3.5-medium": {
    medium: { claude: "claude-sonnet-4-6", effort: "medium", relation: "equivalent" },
  },
  "phax-mistral-medium-3.5-high": RETIRED_MISTRAL_KEYS_0_40["phax-mistral-medium-3.5-high"],
  "phax-mistral-medium-3.5-max": {
    max: { claude: "claude-sonnet-4-6", effort: "max", relation: "equivalent" },
  },
} as const;
