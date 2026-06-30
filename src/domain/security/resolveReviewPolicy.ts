import { join } from "node:path";
import type { ResolvedSecurityConfig } from "../../schemas/securityConfig.js";
import type { SecurityMode, SecurityPolicy } from "./types.js";

export interface ResolveReviewPolicyInput {
  readonly mode: SecurityMode;
  readonly worktreePath: string;
  readonly config: ResolvedSecurityConfig;
}

function dedupe(paths: readonly string[]): readonly string[] {
  return [...new Set(paths)];
}

export function resolveReviewSecurityPolicy(input: ResolveReviewPolicyInput): SecurityPolicy {
  const { mode, worktreePath, config } = input;

  // The only writable path is the gitignored .phax-context/ directory — tracked source
  // is never writable, even if the run mode is "unsafe". The FS jail is the structural
  // read-only guarantee; the agentCommands allowlist is not relied upon for it.
  const allowWrite = [join(worktreePath, ".phax-context")];
  const allowRead = dedupe([worktreePath, ...allowWrite, ...config.filesystem.allowRead]);

  return {
    mode,
    // allowWriteProtected is always [] for the review phase — the reviewer has
    // read-only access to the worktree and no protected-path grant is appropriate.
    filesystem: { allowRead, allowWrite, allowWriteProtected: [] },
    // Override to tightest network and MCP settings — the reviewer has no legitimate
    // reason to reach external APIs beyond the provider CLI (which runs outside the sandbox).
    network: { profile: "provider-only" },
    mcp: { mode: "disabled", allow: [] },
    // Git is needed for read-only diff and log inspection. The FS jail ensures
    // git commands cannot write outside .phax-context/, so broad token is safe.
    agentCommands: ["git"],
    failClosed: true,
  };
}
