import { Effect } from "effect";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Shell } from "../ports/shell.js";
import { ConfigValidationError } from "../domain/errors.js";
import { phaxHomeFilePath, readProviderConfigFile } from "./loadRouting.js";
import { DEFAULT_MODEL_ROUTING } from "../domain/routing/defaults.js";
import { planProviderConfig, type ProviderConfigPlan } from "../domain/routing/providerSetup.js";
import { probeProviders } from "./providerProbe.js";

export interface ProviderSetupOptions {
  readonly write: boolean;
  readonly prune: boolean;
  readonly withRouting: boolean;
}

export interface ProviderSetupResult {
  readonly plan: ProviderConfigPlan;
  readonly written: boolean;
  readonly backupPath: string | undefined;
  readonly routingScaffolded: boolean;
  readonly providerConfigPath: string;
  readonly modelRoutingPath: string;
}

export function providerSetup(
  options: ProviderSetupOptions,
): Effect.Effect<ProviderSetupResult, ConfigValidationError, FileSystem | Shell> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    // Both paths follow this call's phax home; writeAtomic creates a home that does not exist yet.
    const providersPath = yield* phaxHomeFilePath("providers.json");
    const routingPath = yield* phaxHomeFilePath("model-routing.json");

    const { source, config: current, fieldsDropped } = yield* readProviderConfigFile();
    const probes = yield* probeProviders(current);
    const plan = planProviderConfig(current, probes, {
      source,
      prune: options.prune,
      fieldsDropped: fieldsDropped.map((field) => field.path),
    });

    let backupPath: string | undefined;
    let routingScaffolded = false;

    if (options.write) {
      const fileExists = yield* Effect.mapError(
        fs.exists(providersPath),
        (e: FsError) => new ConfigValidationError({ message: e.message, path: providersPath }),
      );

      if (fileExists) {
        const rawText = yield* Effect.mapError(
          fs.readText(providersPath),
          (e: FsError) => new ConfigValidationError({ message: e.message, path: providersPath }),
        );
        backupPath = `${providersPath}.phax-backup-${Date.now()}`;
        yield* Effect.mapError(
          fs.writeAtomic(backupPath, rawText),
          (e: FsError) => new ConfigValidationError({ message: e.message, path: backupPath! }),
        );
      }

      yield* Effect.mapError(
        fs.writeAtomic(providersPath, JSON.stringify(plan.config, null, 2)),
        (e: FsError) => new ConfigValidationError({ message: e.message, path: providersPath }),
      );
    }

    if (options.withRouting) {
      const routingExists = yield* Effect.mapError(
        fs.exists(routingPath),
        (e: FsError) => new ConfigValidationError({ message: e.message, path: routingPath }),
      );

      if (!routingExists) {
        yield* Effect.mapError(
          fs.writeAtomic(routingPath, JSON.stringify(DEFAULT_MODEL_ROUTING, null, 2)),
          (e: FsError) => new ConfigValidationError({ message: e.message, path: routingPath }),
        );
        routingScaffolded = true;
      }
    }

    return {
      plan,
      written: options.write,
      backupPath,
      routingScaffolded,
      providerConfigPath: providersPath,
      modelRoutingPath: routingPath,
    };
  });
}
