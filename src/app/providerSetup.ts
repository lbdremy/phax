import { Effect } from "effect";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Shell } from "../ports/shell.js";
import { ConfigValidationError } from "../domain/errors.js";
import { PROVIDER_CONFIG_PATH, MODEL_ROUTING_PATH, loadProviderConfig } from "./loadRouting.js";
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

    const current = yield* loadProviderConfig();
    const probes = yield* probeProviders(current);
    const plan = planProviderConfig(current, probes, { prune: options.prune });

    let backupPath: string | undefined;
    let routingScaffolded = false;

    if (options.write) {
      const fileExists = yield* Effect.mapError(
        fs.exists(PROVIDER_CONFIG_PATH),
        (e: FsError) =>
          new ConfigValidationError({ message: e.message, path: PROVIDER_CONFIG_PATH }),
      );

      if (fileExists) {
        const rawText = yield* Effect.mapError(
          fs.readText(PROVIDER_CONFIG_PATH),
          (e: FsError) =>
            new ConfigValidationError({ message: e.message, path: PROVIDER_CONFIG_PATH }),
        );
        backupPath = `${PROVIDER_CONFIG_PATH}.phax-backup-${Date.now()}`;
        yield* Effect.mapError(
          fs.writeAtomic(backupPath, rawText),
          (e: FsError) => new ConfigValidationError({ message: e.message, path: backupPath! }),
        );
      }

      yield* Effect.mapError(
        fs.writeAtomic(PROVIDER_CONFIG_PATH, JSON.stringify(plan.config, null, 2)),
        (e: FsError) =>
          new ConfigValidationError({ message: e.message, path: PROVIDER_CONFIG_PATH }),
      );
    }

    if (options.withRouting) {
      const routingExists = yield* Effect.mapError(
        fs.exists(MODEL_ROUTING_PATH),
        (e: FsError) => new ConfigValidationError({ message: e.message, path: MODEL_ROUTING_PATH }),
      );

      if (!routingExists) {
        yield* Effect.mapError(
          fs.writeAtomic(MODEL_ROUTING_PATH, JSON.stringify(DEFAULT_MODEL_ROUTING, null, 2)),
          (e: FsError) =>
            new ConfigValidationError({ message: e.message, path: MODEL_ROUTING_PATH }),
        );
        routingScaffolded = true;
      }
    }

    return {
      plan,
      written: options.write,
      backupPath,
      routingScaffolded,
      providerConfigPath: PROVIDER_CONFIG_PATH,
      modelRoutingPath: MODEL_ROUTING_PATH,
    };
  });
}
