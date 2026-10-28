import { spawnSync } from "node:child_process";

/**
 * The three agent providers the real E2E flow exercises. Each suite forces its
 * provider with `phax run --provider-priority <id>` (mirroring how an operator
 * pins a provider) and gates on the provider's executable being reachable.
 */
export type E2ESecurityMode = "secure" | "unsafe" | "isolated";

export interface E2EProvider {
  /** Canonical provider id passed to `--provider-priority`. */
  readonly id: "claude-code" | "mistral-vibe" | "codex-cli";
  /** Executable probed with `--version` to decide whether the suite runs. */
  readonly executable: string;
  /**
   * Security mode the suite forces with `--security`. Every provider has a
   * strong filesystem jail and runs under strict `secure` mode; mistral-vibe is
   * confined per invocation (`VIBE_*` variables under `--agent accept-edits`).
   */
  readonly securityMode: E2ESecurityMode;
}

export const E2E_PROVIDERS: readonly E2EProvider[] = [
  { id: "claude-code", executable: "claude", securityMode: "secure" },
  { id: "mistral-vibe", executable: "vibe", securityMode: "secure" },
  { id: "codex-cli", executable: "codex", securityMode: "secure" },
];

export function probeProvider(executable: string): boolean {
  try {
    const r = spawnSync(executable, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: "pipe",
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * The provider actually selected for a phase given the forced provider and the
 * security mode. Every provider has a strong filesystem jail, so strict `secure`
 * mode never skips the forced one and routing returns it as is. Mirrors
 * evaluateProviderSecurity in src/domain/security/capabilities.ts — keep in sync
 * if jail strengths change.
 */
export function expectedSelectedProvider(
  forced: E2EProvider["id"],
  _securityMode: E2ESecurityMode,
): string {
  return forced;
}
