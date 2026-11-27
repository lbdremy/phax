import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Result, type Schema } from "effect";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../../src/domain/routing/defaults.js";
import { formatParseError } from "../../../src/schemas/formatError.js";
import { decodeModelRouting, type ModelRouting } from "../../../src/schemas/modelRouting.js";
import { decodeProviderConfig, type ProviderConfig } from "../../../src/schemas/providerConfig.js";
import { boundedOutput, GIT_BOUND_MS } from "../../helpers/boundedSpawn.js";
import { disableGitAutoMaintenance, removeTempDir } from "../../helpers/tempGit.js";
import type { E2EProvider } from "./providers.js";
import { cliThrewIn } from "./runCli.js";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/minimal-repo", import.meta.url));

/** Set only by createTempEnv: runCli spawns phax only against an environment carrying it. */
const TEMP_PHAX_HOME: unique symbol = Symbol("phax.e2e.tempPhaxHome");

/** A provider a suite can declare: the ids the real e2e exercises. */
type ProviderId = E2EProvider["id"];

export interface TempEnvOptions {
  /** Providers enabled in the temporary home's providers.json, besides claude-code. */
  readonly enable?: readonly ProviderId[];
  /** The temporary home's model-routing.json; the branch's built-in table when absent. */
  readonly routing?: ModelRouting;
}

export interface TempEnv {
  readonly repoDir: string;
  /** The temporary phax home: the child's PHAX_HOME and the fixture's state root. */
  readonly phaxHome: string;
  readonly [TEMP_PHAX_HOME]: true;
  cleanup(): void;
}

const NO_TEMP_HOME =
  "runCli: no temporary phax home: pass the TempEnv createTempEnv returned, not a directory";

/**
 * The temporary phax home of an environment createTempEnv made, whose providers.json is still
 * there. Anything else (a directory string, a hand-made object, a cleaned-up environment) throws.
 */
export function tempPhaxHomeOf(env: unknown): string {
  if (typeof env !== "object" || env === null) throw new Error(NO_TEMP_HOME);
  if (Reflect.get(env, TEMP_PHAX_HOME) !== true) throw new Error(NO_TEMP_HOME);
  const phaxHome: unknown = Reflect.get(env, "phaxHome");
  if (typeof phaxHome !== "string" || !existsSync(join(phaxHome, "providers.json"))) {
    throw new Error(NO_TEMP_HOME);
  }
  return phaxHome;
}

/** DEFAULT_PROVIDER_CONFIG with exactly claude-code and the declared providers enabled. */
function providerConfigEnabling(enable: readonly ProviderId[]): ProviderConfig {
  const enabled = new Set<string>(["claude-code", ...enable]);
  const providers = Object.fromEntries(
    Object.entries(DEFAULT_PROVIDER_CONFIG.providers).map(([id, entry]) => [
      id,
      { ...entry, enabled: enabled.has(id) },
    ]),
  );
  return { providers };
}

/** Write `value` as JSON after checking it with the branch's own decoder; a failure throws. */
function writeDecoded(
  file: string,
  value: unknown,
  decode: (input: unknown) => Result.Result<unknown, Schema.SchemaError>,
): void {
  const decoded = decode(value);
  if (Result.isFailure(decoded)) {
    throw new Error(
      `createTempEnv: ${file} does not decode:\n${formatParseError(decoded.failure)}`,
    );
  }
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

/**
 * A temporary repository copied from the fixture and a temporary phax home holding providers.json
 * (the declared providers plus claude-code enabled) and model-routing.json, both in the branch's
 * own format. The fixture's explicit state.root is pinned to the temporary home.
 */
export function createTempEnv(options: TempEnvOptions = {}): TempEnv {
  const base = tmpdir();
  const repoDir = mkdtempSync(join(base, "phax-e2e-repo-"));
  const phaxHome = mkdtempSync(join(base, "phax-e2e-home-"));

  const declared = options.enable ?? [];
  for (const id of declared) {
    if (!(id in DEFAULT_PROVIDER_CONFIG.providers)) {
      throw new Error(`createTempEnv: "${id}" is not a provider of the branch's providers.json`);
    }
  }
  writeDecoded(
    join(phaxHome, "providers.json"),
    providerConfigEnabling(declared),
    decodeProviderConfig,
  );
  writeDecoded(
    join(phaxHome, "model-routing.json"),
    options.routing ?? DEFAULT_MODEL_ROUTING,
    decodeModelRouting,
  );

  cpSync(FIXTURE_DIR, repoDir, { recursive: true });

  // The fixture's explicit state.root wins over PHAX_HOME: pin it to the temporary home too.
  const phaxConfigPath = join(repoDir, "phax.json");
  const config = JSON.parse(readFileSync(phaxConfigPath, "utf8")) as {
    state: { root: string };
  };
  config.state.root = phaxHome;
  writeFileSync(phaxConfigPath, JSON.stringify(config, null, 2));

  // The provider under test is forced per-suite via `phax run --provider-priority`,
  // so the plan's recommended model is left untouched here — routing normalizes it
  // to a family and the forced provider supplies its concrete model.

  // Initialise a real git repo so phax can create worktrees
  const gitOpts = { cwd: repoDir, boundMs: GIT_BOUND_MS };
  boundedOutput("git", ["init"], gitOpts);
  disableGitAutoMaintenance(repoDir);
  boundedOutput("git", ["config", "--local", "user.email", "e2e@phax.test"], gitOpts);
  boundedOutput("git", ["config", "--local", "user.name", "phax E2E"], gitOpts);
  boundedOutput("git", ["add", "."], gitOpts);
  boundedOutput("git", ["commit", "-m", "chore: initial commit"], gitOpts);

  return {
    repoDir,
    phaxHome,
    [TEMP_PHAX_HOME]: true,
    cleanup() {
      // A CLI call that threw printed these paths: keep them for reading.
      if (cliThrewIn(repoDir)) return;
      removeTempDir(repoDir);
      removeTempDir(phaxHome);
    },
  };
}
