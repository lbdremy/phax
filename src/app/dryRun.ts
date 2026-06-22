import { join } from "node:path";
import { resolveGateProfile } from "./gates.js";
import { checkRequiredCommands } from "../domain/security/agentCommands.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import type { PhaxPlan } from "../schemas/phaxPlan.js";
import type { SecurityMode } from "../domain/security/types.js";

export interface DryRunPhase {
  readonly index: number;
  readonly id: string;
  readonly title: string;
  readonly model: string;
  readonly effort: string;
  readonly worktreePath: string;
}

export interface DryRunReport {
  readonly shortName: string;
  readonly branch: string;
  readonly projectName: string;
  readonly stateRoot: string;
  readonly gateProfileId: string;
  readonly securityMode: SecurityMode;
  readonly setupCommands: readonly string[];
  readonly cleanupCommands: readonly string[];
  readonly gateCommands: readonly string[];
  readonly agentCommands: readonly string[];
  readonly requiredCommands: readonly string[];
  readonly uncoveredRequiredCommands: readonly string[];
  readonly phases: readonly DryRunPhase[];
  readonly runPath: string;
  readonly providerPriorityOverride?: readonly string[];
}

export function buildDryRunReport(
  plan: PhaxPlan,
  config: ResolvedConfig,
  gateProfileId?: string,
  providerPriorityOverride?: readonly string[],
  securityMode?: SecurityMode,
): DryRunReport {
  const profileId = gateProfileId ?? "full";
  const gateCommands = resolveGateProfile(config, profileId);

  // Use the passed securityMode if provided, otherwise fall back to config
  const effectiveSecurityMode = securityMode ?? config.security.profile;

  const agentCommands = config.security.agentCommands;
  const requiredCommands = plan.run.requiredCommands;
  const { missing: uncoveredRequiredCommands } = checkRequiredCommands({
    requiredCommands,
    configCommands: agentCommands,
    gateCommands,
  });

  const worktreesRoot = join(config.stateRoot, "worktrees", plan.run.shortName);
  const phases: DryRunPhase[] = plan.phases.map((p, i) => ({
    index: i,
    id: p.id,
    title: p.title,
    model: p.model,
    effort: p.effort,
    worktreePath: join(worktreesRoot, p.id),
  }));

  return {
    shortName: plan.run.shortName,
    branch: plan.run.branch,
    projectName: config.namespace,
    stateRoot: config.stateRoot,
    gateProfileId: profileId,
    securityMode: effectiveSecurityMode,
    setupCommands: config.raw.commands?.setup ?? [],
    cleanupCommands: config.raw.commands?.cleanup ?? [],
    gateCommands,
    agentCommands,
    requiredCommands,
    uncoveredRequiredCommands,
    phases,
    runPath: join(config.stateRoot, "runs", plan.run.shortName),
    ...(providerPriorityOverride !== undefined ? { providerPriorityOverride } : {}),
  };
}

export function formatDryRunReport(report: DryRunReport): string {
  const lines: string[] = [];

  lines.push(`Dry run: ${report.shortName}`);
  lines.push(`  Branch:       ${report.branch}`);
  lines.push(`  Project:      ${report.projectName}`);
  lines.push(`  Gate profile: ${report.gateProfileId}`);
  lines.push(`  Security:     ${report.securityMode}`);
  lines.push(`  Run path:     ${report.runPath}`);
  if (report.providerPriorityOverride !== undefined) {
    lines.push(`  Priority:     ${report.providerPriorityOverride.join(" → ")} (override)`);
  }
  lines.push("");

  lines.push("Setup commands:");
  if (report.setupCommands.length > 0) {
    for (const cmd of report.setupCommands) {
      lines.push(`  $ ${cmd}`);
    }
  } else {
    lines.push("  (none)");
  }
  lines.push("");

  lines.push("Gate commands:");
  for (const cmd of report.gateCommands) {
    lines.push(`  $ ${cmd}`);
  }
  lines.push("");

  lines.push("Agent commands (security.agentCommands):");
  if (report.agentCommands.length > 0) {
    for (const cmd of report.agentCommands) {
      lines.push(`  ${cmd}`);
    }
  } else {
    lines.push("  (none)");
  }
  lines.push("");

  lines.push("Required commands (plan.run.requiredCommands):");
  if (report.requiredCommands.length > 0) {
    for (const cmd of report.requiredCommands) {
      const covered = !report.uncoveredRequiredCommands.includes(cmd);
      lines.push(`  ${covered ? "✓" : "✗"} ${cmd}`);
    }
    if (report.uncoveredRequiredCommands.length > 0) {
      lines.push(
        `  ⚠  Preflight will fail: ${report.uncoveredRequiredCommands.length} required command(s) not covered.`,
      );
    }
  } else {
    lines.push("  (none)");
  }
  lines.push("");

  lines.push("Cleanup commands:");
  if (report.cleanupCommands.length > 0) {
    for (const cmd of report.cleanupCommands) {
      lines.push(`  $ ${cmd}`);
    }
  } else {
    lines.push("  (none)");
  }
  lines.push("");

  lines.push(`Phases (${report.phases.length} total):`);
  for (const phase of report.phases) {
    lines.push(
      `  [${phase.index + 1}] ${phase.id} — ${phase.title} (${phase.model}, ${phase.effort})`,
    );
    lines.push(`       worktree: ${phase.worktreePath}`);
  }

  return lines.join("\n");
}
