import { join } from "node:path";
import { Either } from "effect";
import { loadConfig } from "./loadConfig.js";
import { loadPlan } from "./loadPlan.js";
import { resolveGateProfile } from "./gates.js";

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
  readonly setupCommands: readonly string[];
  readonly cleanupCommands: readonly string[];
  readonly gateCommands: readonly string[];
  readonly phases: readonly DryRunPhase[];
  readonly runPath: string;
}

export function buildDryRunReport(
  cwd: string,
  planPath: string,
  gateProfileId?: string,
): Either.Either<DryRunReport, string> {
  const configResult = loadConfig(cwd);
  if (Either.isLeft(configResult)) {
    return Either.left(`Config error: ${configResult.left.message}`);
  }
  const config = configResult.right;

  const planResult = loadPlan(planPath);
  if (Either.isLeft(planResult)) {
    return Either.left(`Plan error: ${planResult.left.message}`);
  }
  const plan = planResult.right;

  const profileId = gateProfileId ?? "full";
  let gateCommands: readonly string[];
  try {
    gateCommands = resolveGateProfile(config, profileId);
  } catch (err) {
    return Either.left(`Gate profile error: ${String(err)}`);
  }

  const worktreesRoot = join(config.stateRoot, "worktrees", plan.run.shortName);
  const phases: DryRunPhase[] = plan.phases.map((p, i) => ({
    index: i,
    id: p.id,
    title: p.title,
    model: p.model,
    effort: p.effort,
    worktreePath: join(worktreesRoot, p.id),
  }));

  return Either.right({
    shortName: plan.run.shortName,
    branch: plan.run.branch,
    projectName: config.raw.project.name,
    stateRoot: config.stateRoot,
    gateProfileId: profileId,
    setupCommands: config.raw.commands?.setup ?? [],
    cleanupCommands: config.raw.commands?.cleanup ?? [],
    gateCommands,
    phases,
    runPath: join(config.stateRoot, "runs", plan.run.shortName),
  });
}

export function formatDryRunReport(report: DryRunReport): string {
  const lines: string[] = [];

  lines.push(`Dry run: ${report.shortName}`);
  lines.push(`  Branch:       ${report.branch}`);
  lines.push(`  Project:      ${report.projectName}`);
  lines.push(`  Gate profile: ${report.gateProfileId}`);
  lines.push(`  Run path:     ${report.runPath}`);
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
