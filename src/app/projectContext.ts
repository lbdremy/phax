import { join } from "node:path";
import { homedir } from "node:os";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";

const DEFAULT_STATE_ROOT = join(homedir(), ".phax");

export function effectiveStateRoot(config: ResolvedConfig | undefined): string {
  if (config !== undefined) {
    return config.stateRoot;
  }
  return DEFAULT_STATE_ROOT;
}
