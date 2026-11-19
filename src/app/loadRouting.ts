import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, Result } from "effect";
import { FileSystem, FsError } from "../ports/fs.js";
import { ConfigValidationError } from "../domain/errors.js";
import { type ModelRouting, decodeModelRouting } from "../schemas/modelRouting.js";
import { type ProviderConfig, decodeProviderConfig } from "../schemas/providerConfig.js";
import { formatParseError } from "../schemas/formatError.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
  RETIRED_MODEL_IDS,
  RETIRED_MODEL_SUCCESSORS,
} from "../domain/routing/defaults.js";
import {
  type ObsoleteProviderField,
  obsoleteProviderFields,
  retiredEquivalenceKeys,
  retiredModelIds,
  withoutObsoleteProviderFields,
} from "../domain/routing/providerSetup.js";

export const MODEL_ROUTING_PATH = join(homedir(), ".phax", "model-routing.json");
export const PROVIDER_CONFIG_PATH = join(homedir(), ".phax", "providers.json");

function fileExists(path: string): Effect.Effect<boolean, ConfigValidationError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    return yield* Effect.mapError(
      fs.exists(path),
      (e: FsError) => new ConfigValidationError({ message: e.message, path }),
    );
  });
}

/** The parsed JSON of the file at `path`; unreadable or invalid JSON is refused. */
function readJsonFile(path: string): Effect.Effect<unknown, ConfigValidationError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const text = yield* Effect.mapError(
      fs.readText(path),
      (e: FsError) => new ConfigValidationError({ message: e.message, path }),
    );
    try {
      return JSON.parse(text) as unknown;
    } catch (err) {
      return yield* Effect.fail(
        new ConfigValidationError({ message: `Failed to parse "${path}": ${String(err)}`, path }),
      );
    }
  });
}

/**
 * The routing table: ~/.phax/model-routing.json, else the built-in one. A file with an
 * equivalence key on a retired id is refused, naming each key and what to use instead.
 */
export function loadModelRouting(): Effect.Effect<ModelRouting, ConfigValidationError, FileSystem> {
  return Effect.gen(function* () {
    if (!(yield* fileExists(MODEL_ROUTING_PATH))) return DEFAULT_MODEL_ROUTING;

    const raw = yield* readJsonFile(MODEL_ROUTING_PATH);

    const decoded = decodeModelRouting(raw);
    if (Result.isFailure(decoded)) {
      return yield* Effect.fail(
        new ConfigValidationError({
          message: `Invalid model-routing.json at "${MODEL_ROUTING_PATH}":\n${formatParseError(decoded.failure)}`,
          path: MODEL_ROUTING_PATH,
        }),
      );
    }

    const retired = retiredEquivalenceKeys(decoded.success);
    if (retired.length > 0) {
      const lines = retired
        .map((id) => {
          const successor = RETIRED_MODEL_SUCCESSORS[id];
          return `  - ${id}: ${successor === undefined ? RETIRED_MODEL_IDS[id] : `use ${successor}`}`;
        })
        .join("\n");
      return yield* Effect.fail(
        new ConfigValidationError({
          message:
            `"${MODEL_ROUTING_PATH}" keys equivalence edges on models phax no longer routes to:\n${lines}\n` +
            "Rename the key, keeping its edges, or delete the file to use phax's built-in table.",
          path: MODEL_ROUTING_PATH,
        }),
      );
    }

    return decoded.success;
  });
}

function decodeProviderFile(raw: unknown): Effect.Effect<ProviderConfig, ConfigValidationError> {
  const decoded = decodeProviderConfig(raw);
  if (Result.isFailure(decoded)) {
    return Effect.fail(
      new ConfigValidationError({
        message: `Invalid providers.json at "${PROVIDER_CONFIG_PATH}":\n${formatParseError(decoded.failure)}`,
        path: PROVIDER_CONFIG_PATH,
      }),
    );
  }
  return Effect.succeed(decoded.success);
}

/**
 * The provider catalog: ~/.phax/providers.json, else the built-in one. A file that carries a
 * field phax no longer reads, or still lists an id phax no longer routes to, is refused, naming
 * each and `phax agent setup providers --write`, which drops them. The fields are checked on
 * the raw JSON first, then the file is decoded strictly, then its ids are checked.
 */
export function loadProviderConfig(): Effect.Effect<
  ProviderConfig,
  ConfigValidationError,
  FileSystem
> {
  return Effect.gen(function* () {
    if (!(yield* fileExists(PROVIDER_CONFIG_PATH))) return DEFAULT_PROVIDER_CONFIG;

    const raw = yield* readJsonFile(PROVIDER_CONFIG_PATH);

    const obsolete = obsoleteProviderFields(raw);
    if (obsolete.length > 0) {
      const lines = obsolete.map((f) => `  - ${f.path}: ${f.reason}`).join("\n");
      return yield* Effect.fail(
        new ConfigValidationError({
          message:
            `"${PROVIDER_CONFIG_PATH}" carries fields phax no longer reads:\n${lines}\n` +
            "Run `phax agent setup providers --write` to drop them, or delete them from the file.",
          path: PROVIDER_CONFIG_PATH,
        }),
      );
    }

    const config = yield* decodeProviderFile(raw);
    const retired = retiredModelIds(config);
    if (retired.length > 0) {
      const lines = retired.map((id) => `  - ${id}: ${RETIRED_MODEL_IDS[id]}`).join("\n");
      return yield* Effect.fail(
        new ConfigValidationError({
          message:
            `"${PROVIDER_CONFIG_PATH}" lists models phax no longer routes to:\n${lines}\n` +
            "Run `phax agent setup providers --write` to drop them (it also enables every " +
            "installed provider), or delete them from the file.",
          path: PROVIDER_CONFIG_PATH,
        }),
      );
    }
    return config;
  });
}

/**
 * ~/.phax/providers.json decoded as it is, retired ids included and obsolete fields stripped
 * (and returned), else the built-in catalog. Only `phax agent setup providers` reads it this
 * way, to rewrite the file without them.
 */
export function readProviderConfigFile(): Effect.Effect<
  {
    readonly config: ProviderConfig;
    readonly fieldsDropped: readonly ObsoleteProviderField[];
  },
  ConfigValidationError,
  FileSystem
> {
  return Effect.gen(function* () {
    if (!(yield* fileExists(PROVIDER_CONFIG_PATH))) {
      return { config: DEFAULT_PROVIDER_CONFIG, fieldsDropped: [] };
    }
    const raw = yield* readJsonFile(PROVIDER_CONFIG_PATH);
    const config = yield* decodeProviderFile(withoutObsoleteProviderFields(raw));
    return { config, fieldsDropped: obsoleteProviderFields(raw) };
  });
}
