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
   * Security mode the suite forces with `--security`. claude-code and codex-cli
   * have strong filesystem jails and run under strict `secure` mode. mistral-vibe
   * has only a partial jail, so strict secure mode would skip it and fall back to
   * claude-code — to actually exercise vibe the suite runs it in `unsafe` mode.
   */
  readonly securityMode: E2ESecurityMode;
}

export const E2E_PROVIDERS: readonly E2EProvider[] = [
  { id: "claude-code", executable: "claude", securityMode: "secure" },
  { id: "mistral-vibe", executable: "vibe", securityMode: "unsafe" },
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
 * security mode. In strict `secure` mode, providers without a strong filesystem
 * jail (mistral-vibe) cannot satisfy the policy, so routing skips them and falls
 * back to the terminal `claude-code` provider. claude-code and codex-cli have
 * strong jails and run natively. Mirrors evaluateProviderSecurity in
 * src/domain/security/capabilities.ts — keep in sync if jail strengths change.
 */
export function expectedSelectedProvider(
  forced: E2EProvider["id"],
  securityMode: E2ESecurityMode,
): string {
  if (securityMode === "secure" && forced === "mistral-vibe") {
    return "claude-code";
  }
  return forced;
}
