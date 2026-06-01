import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, Either } from "effect";
import { FileSystem, FsError } from "../ports/fs.js";
import { ConfigValidationError } from "../domain/errors.js";
import { type ModelRouting, decodeModelRouting } from "../schemas/modelRouting.js";
import { type ProviderConfig, decodeProviderConfig } from "../schemas/providerConfig.js";
import { formatParseError } from "../schemas/formatError.js";
import { DEFAULT_MODEL_ROUTING, DEFAULT_PROVIDER_CONFIG } from "../domain/routing/defaults.js";

export const MODEL_ROUTING_PATH = join(homedir(), ".phax", "model-routing.json");
export const PROVIDER_CONFIG_PATH = join(homedir(), ".phax", "providers.json");

export function loadModelRouting(): Effect.Effect<ModelRouting, ConfigValidationError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const fileExists = yield* Effect.mapError(
      fs.exists(MODEL_ROUTING_PATH),
      (e: FsError) => new ConfigValidationError({ message: e.message, path: MODEL_ROUTING_PATH }),
    );

    if (!fileExists) return DEFAULT_MODEL_ROUTING;

    const text = yield* Effect.mapError(
      fs.readText(MODEL_ROUTING_PATH),
      (e: FsError) => new ConfigValidationError({ message: e.message, path: MODEL_ROUTING_PATH }),
    );

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      return yield* Effect.fail(
        new ConfigValidationError({
          message: `Failed to parse "${MODEL_ROUTING_PATH}": ${String(err)}`,
          path: MODEL_ROUTING_PATH,
        }),
      );
    }

    const decoded = decodeModelRouting(raw);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(
        new ConfigValidationError({
          message: `Invalid model-routing.json at "${MODEL_ROUTING_PATH}":\n${formatParseError(decoded.left)}`,
          path: MODEL_ROUTING_PATH,
        }),
      );
    }

    return decoded.right;
  });
}

export function loadProviderConfig(): Effect.Effect<
  ProviderConfig,
  ConfigValidationError,
  FileSystem
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const fileExists = yield* Effect.mapError(
      fs.exists(PROVIDER_CONFIG_PATH),
      (e: FsError) => new ConfigValidationError({ message: e.message, path: PROVIDER_CONFIG_PATH }),
    );

    if (!fileExists) return DEFAULT_PROVIDER_CONFIG;

    const text = yield* Effect.mapError(
      fs.readText(PROVIDER_CONFIG_PATH),
      (e: FsError) => new ConfigValidationError({ message: e.message, path: PROVIDER_CONFIG_PATH }),
    );

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      return yield* Effect.fail(
        new ConfigValidationError({
          message: `Failed to parse "${PROVIDER_CONFIG_PATH}": ${String(err)}`,
          path: PROVIDER_CONFIG_PATH,
        }),
      );
    }

    const decoded = decodeProviderConfig(raw);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(
        new ConfigValidationError({
          message: `Invalid providers.json at "${PROVIDER_CONFIG_PATH}":\n${formatParseError(decoded.left)}`,
          path: PROVIDER_CONFIG_PATH,
        }),
      );
    }

    return decoded.right;
  });
}
