import { Effect, Either } from "effect";
import type { ProviderConfig } from "../schemas/providerConfig.js";
import { Shell } from "../ports/shell.js";
import type { ProviderProbeResult } from "../domain/routing/providerSetup.js";

const probeOne = (provider: string, executable: string) =>
  Effect.gen(function* () {
    const shell = yield* Shell;
    const result = yield* Effect.either(
      shell.run({ command: [executable, "--version"], cwd: process.cwd() }),
    );
    const available = Either.isRight(result) && result.right.exitCode === 0;
    return { provider, available } satisfies ProviderProbeResult;
  });

export function probeProviders(
  providerConfig: ProviderConfig,
): Effect.Effect<ProviderProbeResult[], never, Shell> {
  const providers = Object.entries(providerConfig.providers) as Array<
    [string, { enabled: boolean; executable: string }]
  >;

  return Effect.all(
    providers.map(([provider, entry]) => probeOne(provider, entry.executable)),
    { concurrency: "unbounded" },
  );
}
