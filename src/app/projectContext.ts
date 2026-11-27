import { Result } from "effect";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import { resolvePhaxHome } from "./phaxHome.js";

/**
 * The state root a command uses: the loaded config's, else the phax home resolved now. On an
 * invalid PHAX_HOME it falls back to the default home so the function stays total; the
 * program's guard refuses such a call before it gets here.
 */
export function effectiveStateRoot(config: ResolvedConfig | undefined): string {
  if (config !== undefined) {
    return config.stateRoot;
  }
  const home = resolvePhaxHome();
  if (Result.isSuccess(home)) return home.success.path;
  return Result.getOrThrow(resolvePhaxHome({})).path;
}
