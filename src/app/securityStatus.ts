import { Effect } from "effect";
import { Shell } from "../ports/shell.js";
import { probeProviders } from "./providerProbe.js";
import { PROVIDER_SECURITY_CAPABILITIES } from "../domain/security/capabilities.js";
import type { ProviderConfig } from "../schemas/providerConfig.js";
import type { ProviderProbeResult } from "../domain/routing/providerSetup.js";
import type { ProviderId } from "../domain/routing/types.js";
import type { ProviderSecurityCapability } from "../domain/security/capabilities.js";

interface ProviderStatus {
  readonly provider: ProviderId;
  readonly available: boolean;
  readonly filesystemJail: string;
  readonly mcpAllowlist: string;
  readonly defaultSecureSupported: boolean;
}

export interface SecurityStatusReport {
  readonly providers: readonly ProviderStatus[];
}

/**
 * Build a security status report from live provider probes and the
 * known provider security capabilities.
 */
export function buildSecurityStatusReport(
  providerConfig: ProviderConfig,
  probeResults: readonly ProviderProbeResult[],
): SecurityStatusReport {
  const providers: ProviderId[] = ["claude-code", "codex-cli", "mistral-vibe"];
  const statuses: ProviderStatus[] = [];

  for (const provider of providers) {
    const cap = PROVIDER_SECURITY_CAPABILITIES[provider];
    if (!cap) continue;

    const probeResult = probeResults.find((p) => p.provider === provider);
    const available = probeResult?.available ?? false;

    statuses.push({
      provider,
      available,
      filesystemJail: cap.filesystemJail,
      mcpAllowlist: cap.mcpAllowlist,
      defaultSecureSupported: cap.filesystemJail === "strong",
    });
  }

  return { providers: statuses };
}

/**
 * Probe all providers and build a security status report.
 */
export function getSecurityStatus(
  providerConfig: ProviderConfig,
): Effect.Effect<SecurityStatusReport, never, Shell> {
  return Effect.gen(function* () {
    const probeResults = yield* probeProviders(providerConfig);
    return buildSecurityStatusReport(providerConfig, probeResults);
  });
}

/**
 * Format a security status report for CLI output.
 */
export function formatSecurityStatusReport(report: SecurityStatusReport): string {
  const lines: string[] = [
    "Provider Security Status",
    "",
    "Provider          | Available | Filesystem Jail | MCP Allowlist | Secure Default",
    "-".repeat(72),
  ];

  for (const p of report.providers) {
    const availableStr = p.available ? "✓" : "✗";
    const secureStr = p.defaultSecureSupported ? "✓" : "✗";
    lines.push(
      `${p.provider.padEnd(16)} | ${availableStr.padEnd(9)} | ${p.filesystemJail.padEnd(15)} | ${p.mcpAllowlist.padEnd(12)} | ${secureStr}`,
    );
  }

  lines.push("");
  lines.push("Legend:");
  lines.push("  Filesystem Jail: strong | partial | none");
  lines.push("  MCP Allowlist: supported | unsupported");
  lines.push("  Secure Default: ✓ = can satisfy strict secure mode");

  return lines.join("\n");
}
