import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface ArtifactContext {
  readonly repoDir: string;
  readonly phaxHome: string;
  readonly shortName?: string;
}

export function printArtifacts(ctx: ArtifactContext, note?: string): void {
  const lines: string[] = ["", "=== phax E2E FAILURE ARTIFACTS ==="];

  if (note) lines.push(`Note: ${note}`);
  lines.push(`Temp repo:      ${ctx.repoDir}`);
  lines.push(`Temp PHAX_HOME: ${ctx.phaxHome}`);

  const { shortName } = ctx;
  if (shortName) {
    const runPath = join(ctx.phaxHome, "runs", shortName);
    lines.push(`Run path:       ${runPath}`);

    const statusPath = join(runPath, "run-status.json");
    if (existsSync(statusPath)) {
      try {
        const status = JSON.parse(readFileSync(statusPath, "utf8")) as {
          state?: string;
          currentPhaseIndex?: number;
          lastError?: string;
        };
        lines.push(`Run state:      ${status.state ?? "(unknown)"}`);
        if (status.currentPhaseIndex !== undefined) {
          lines.push(`Current phase:  index ${status.currentPhaseIndex}`);
        }
        if (status.lastError) lines.push(`Last error:     ${status.lastError}`);
      } catch {
        lines.push("Run status:     (unreadable)");
      }
    } else {
      lines.push("Run status:     (not found)");
    }

    // Find the most recent phase log
    try {
      const phaseDirs = readdirSync(runPath)
        .filter((e) => /^phase-\d{2}$/.test(e))
        .toSorted()
        .toReversed();

      for (const dir of phaseDirs) {
        const logPath = join(runPath, dir, "agent.log");
        if (existsSync(logPath)) {
          lines.push(`Last log:       ${logPath}`);
          break;
        }
      }
    } catch {
      // Ignore if run path doesn't exist yet
    }

    lines.push(`Resume cmd:     phax resume ${shortName} --yes`);
    lines.push(`Enter cmd:      phax enter ${shortName}`);
    lines.push(`Session info:   phax session-info ${shortName}`);
  }

  lines.push("Temp dirs kept for debugging (skipping cleanup).");
  lines.push("===================================");

  console.error(lines.join("\n"));
}
