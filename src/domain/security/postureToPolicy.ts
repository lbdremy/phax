import type { SecurityPosture } from "../../schemas/securityPosture.js";
import type { SecurityPolicy } from "./types.js";

/**
 * Rebuild a phase's `SecurityPolicy` from the `security.json` posture it was
 * recorded with: mode, filesystem, network, mcp and the frozen agent
 * commands. `failClosed` is set as `resolveSecurityPolicy` sets it: false for
 * unsafe, true for every other mode.
 */
export function policyFromPosture(posture: SecurityPosture): SecurityPolicy {
  return {
    mode: posture.mode,
    filesystem: {
      allowRead: [...posture.filesystem.allowRead],
      allowWrite: [...posture.filesystem.allowWrite],
    },
    network: { profile: posture.network.profile },
    mcp: { mode: posture.mcp.mode, allow: [...posture.mcp.allow] },
    agentCommands: posture.agentCommands.map((c) => c.command),
    failClosed: posture.mode !== "unsafe",
  };
}
