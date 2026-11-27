import { Effect, Result } from "effect";
import { FileSystem, FsError } from "../ports/fs.js";
import { ConfigValidationError } from "../domain/errors.js";
import { phaxHomeFile } from "../domain/phaxHome.js";
import { resolvePhaxHome } from "./phaxHome.js";
import { type ModelRouting, decodeModelRouting } from "../schemas/modelRouting.js";
import { type ProviderConfig, decodeProviderConfig } from "../schemas/providerConfig.js";
import { formatParseError } from "../schemas/formatError.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
  RETIRED_MODEL_IDS,
} from "../domain/routing/defaults.js";
import {
  type ObsoleteProviderField,
  type ProviderConfigSource,
  type RetiredEquivalenceKey,
  obsoleteProviderFields,
  retiredEquivalenceKeys,
  retiredModelIds,
  withoutObsoleteProviderFields,
} from "../domain/routing/providerSetup.js";

/** The path of `name` in this call's phax home; an invalid PHAX_HOME is refused. */
export function phaxHomeFilePath(
  name: "providers.json" | "model-routing.json",
): Effect.Effect<string, ConfigValidationError> {
  return Effect.map(Effect.fromResult(resolvePhaxHome()), (home) => phaxHomeFile(home, name));
}

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

/** `"off"`, `"off" and "high"`, `"low", "medium" and "max"`. */
function quotedList(items: readonly string[]): string {
  const quoted = items.map((item) => `"${item}"`);
  const last = quoted.pop();
  return quoted.length === 0 ? (last ?? "") : `${quoted.join(", ")} and ${last}`;
}

const edges = (levels: readonly string[]): string =>
  `${quotedList(levels)} ${levels.length === 1 ? "edge" : "edges"}`;

/** What to do with one retired equivalence key: move its edges the successor offers, delete the rest. */
function retiredKeyFix(key: RetiredEquivalenceKey): string {
  if (key.successor === null) return `delete it: ${RETIRED_MODEL_IDS[key.key]}`;
  const offers = `${key.successor.id} offers only ${key.successor.efforts.join(" and ")}`;
  if (key.moved.length === 0) return `delete it: ${offers}`;
  const move = `move its ${edges(key.moved)} into the "${key.successor.id}" key`;
  return key.deleted.length === 0
    ? move
    : `${move} and delete its ${edges(key.deleted)}: ${offers}`;
}

/**
 * The routing table: model-routing.json in the phax home, else the built-in one. A file with an
 * equivalence key on a retired id is refused, naming each key and what to do with its edges: move
 * those at a level the successor offers into one successor key, delete the others.
 */
export function loadModelRouting(): Effect.Effect<ModelRouting, ConfigValidationError, FileSystem> {
  return Effect.gen(function* () {
    const routingPath = yield* phaxHomeFilePath("model-routing.json");
    if (!(yield* fileExists(routingPath))) return DEFAULT_MODEL_ROUTING;

    const raw = yield* readJsonFile(routingPath);

    const decoded = decodeModelRouting(raw);
    if (Result.isFailure(decoded)) {
      return yield* Effect.fail(
        new ConfigValidationError({
          message: `Invalid model-routing.json at "${routingPath}":\n${formatParseError(decoded.failure)}`,
          path: routingPath,
        }),
      );
    }

    const retired = retiredEquivalenceKeys(decoded.success);
    if (retired.length > 0) {
      const lines = retired.map((key) => `  - ${key.key}: ${retiredKeyFix(key)}`).join("\n");
      const successors = [
        ...new Set(
          retired.flatMap((k) => (k.moved.length > 0 && k.successor ? [k.successor.id] : [])),
        ),
      ];
      const closing =
        successors.length === 0
          ? "Delete them, or delete the file to use phax's built-in table."
          : `Merge the moved edges into ${successors.map((id) => `one "${id}" key`).join(" and ")}, ` +
            "not one key per retired key: JSON keeps only the last of two keys with the same name " +
            "and drops the other's edges. Then delete the retired keys, or delete the file to use " +
            "phax's built-in table.";
      return yield* Effect.fail(
        new ConfigValidationError({
          message:
            `"${routingPath}" keys equivalence edges on models phax no longer routes to:\n${lines}\n` +
            closing,
          path: routingPath,
        }),
      );
    }

    return decoded.success;
  });
}

function decodeProviderFile(
  raw: unknown,
  providersPath: string,
): Effect.Effect<ProviderConfig, ConfigValidationError> {
  const decoded = decodeProviderConfig(raw);
  if (Result.isFailure(decoded)) {
    return Effect.fail(
      new ConfigValidationError({
        message: `Invalid providers.json at "${providersPath}":\n${formatParseError(decoded.failure)}`,
        path: providersPath,
      }),
    );
  }
  return Effect.succeed(decoded.success);
}

/**
 * The provider catalog: providers.json in the phax home, else the built-in one. A file that carries a
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
    const providersPath = yield* phaxHomeFilePath("providers.json");
    if (!(yield* fileExists(providersPath))) return DEFAULT_PROVIDER_CONFIG;

    const raw = yield* readJsonFile(providersPath);

    const obsolete = obsoleteProviderFields(raw);
    if (obsolete.length > 0) {
      const lines = obsolete.map((f) => `  - ${f.path}: ${f.reason}`).join("\n");
      return yield* Effect.fail(
        new ConfigValidationError({
          message:
            `"${providersPath}" carries fields phax no longer reads:\n${lines}\n` +
            "Run `phax agent setup providers --write` to drop them, or delete them from the file.",
          path: providersPath,
        }),
      );
    }

    const config = yield* decodeProviderFile(raw, providersPath);
    const retired = retiredModelIds(config);
    if (retired.length > 0) {
      const lines = retired.map((id) => `  - ${id}: ${RETIRED_MODEL_IDS[id]}`).join("\n");
      return yield* Effect.fail(
        new ConfigValidationError({
          message:
            `"${providersPath}" lists models phax no longer routes to:\n${lines}\n` +
            "Run `phax agent setup providers --write` to drop them, or delete them from the file.",
          path: providersPath,
        }),
      );
    }
    return config;
  });
}

/**
 * providers.json in the phax home, decoded as it is, retired ids included and obsolete fields stripped
 * (and returned), else the built-in catalog; `source` says which. Only `phax agent setup
 * providers` reads it this way, to rewrite the file without them.
 */
export function readProviderConfigFile(): Effect.Effect<
  {
    readonly source: ProviderConfigSource;
    readonly config: ProviderConfig;
    readonly fieldsDropped: readonly ObsoleteProviderField[];
  },
  ConfigValidationError,
  FileSystem
> {
  return Effect.gen(function* () {
    const providersPath = yield* phaxHomeFilePath("providers.json");
    if (!(yield* fileExists(providersPath))) {
      return { source: "built-in", config: DEFAULT_PROVIDER_CONFIG, fieldsDropped: [] };
    }
    const raw = yield* readJsonFile(providersPath);
    const config = yield* decodeProviderFile(withoutObsoleteProviderFields(raw), providersPath);
    return { source: "file", config, fieldsDropped: obsoleteProviderFields(raw) };
  });
}
