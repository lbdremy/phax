import { PROVIDER_SECURITY_CAPABILITIES } from "./capabilities.js";
import type { CommandEnforcement } from "./capabilities.js";
import type { ProviderId } from "../routing/types.js";

export interface AgentCommandRecord {
  readonly command: string;
  readonly source: "config" | "gate";
  readonly explicit: boolean;
  readonly requiredByPlan: boolean;
  readonly enforcement: CommandEnforcement;
  readonly degraded: boolean;
}

function normalise(raw: string): string {
  return raw.trim().split(/\s+/).filter(Boolean).join(" ");
}

function isNarrow(command: string): boolean {
  return command.includes(" ");
}

function canEnforcePrefix(enforcement: CommandEnforcement): boolean {
  return enforcement === "exact" || enforcement === "prefix";
}

export function computeFrozenAgentCommands(input: {
  readonly configCommands: readonly string[];
  readonly gateCommands: readonly string[];
  readonly requiredCommands: readonly string[];
  readonly provider: ProviderId;
}): { readonly records: readonly AgentCommandRecord[]; readonly degraded: boolean } {
  const enforcement = PROVIDER_SECURITY_CAPABILITIES[input.provider].commandEnforcement;
  const normalisedRequired = new Set(input.requiredCommands.map(normalise).filter(Boolean));

  // Build ordered, deduplicated map: config entries take precedence over gate entries.
  const seen = new Map<string, { source: "config" | "gate"; explicit: boolean }>();

  for (const raw of input.configCommands) {
    const cmd = normalise(raw);
    if (cmd && !seen.has(cmd)) {
      seen.set(cmd, { source: "config", explicit: true });
    }
  }

  for (const raw of input.gateCommands) {
    const cmd = normalise(raw);
    if (cmd && !seen.has(cmd)) {
      seen.set(cmd, { source: "gate", explicit: false });
    }
  }

  const records: AgentCommandRecord[] = [];
  let anyDegraded = false;

  for (const [cmd, meta] of seen) {
    const narrow = isNarrow(cmd);
    const degraded = narrow && !canEnforcePrefix(enforcement);
    if (degraded) anyDegraded = true;
    records.push({
      command: cmd,
      source: meta.source,
      explicit: meta.explicit,
      requiredByPlan: normalisedRequired.has(cmd),
      enforcement,
      degraded,
    });
  }

  return { records, degraded: anyDegraded };
}

export function checkRequiredCommands(input: {
  readonly requiredCommands: readonly string[];
  readonly configCommands: readonly string[];
  readonly gateCommands: readonly string[];
}): { readonly missing: readonly string[] } {
  const normalisedRequired = input.requiredCommands.map(normalise).filter(Boolean);

  const allowedTokens = [
    ...input.configCommands.map(normalise).filter(Boolean),
    ...input.gateCommands.map(normalise).filter(Boolean),
  ];

  const missing: string[] = [];

  for (const required of normalisedRequired) {
    const covered = allowedTokens.some((allowed) => {
      // Exact match.
      if (allowed === required) return true;
      // Broad-covers-narrow: allowed is a token-prefix of required.
      // e.g. allowed="deno" covers required="deno fmt".
      if (!isNarrow(allowed) && required.startsWith(allowed + " ")) return true;
      return false;
    });

    if (!covered) {
      missing.push(required);
    }
  }

  return { missing };
}
