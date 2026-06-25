import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface AgentErrorContext {
  readonly argv: readonly string[];
  readonly exitCode?: number | undefined;
  readonly stderr?: string | undefined;
}

/**
 * Write a human-readable agent-error.log into the phase folder when an agent
 * process exits non-zero or fails to spawn. Never throws — a logging failure
 * must not mask the underlying agent failure.
 */
export function writeAgentErrorLog(
  phaseFolderPath: string | undefined,
  ctx: AgentErrorContext,
): void {
  if (!phaseFolderPath) return;
  try {
    const content = [
      ctx.argv.join(" "),
      `exit code: ${ctx.exitCode ?? "unknown"}`,
      "",
      ctx.stderr ?? "",
    ].join("\n");
    const filePath = join(phaseFolderPath, "agent-error.log");
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf8");
  } catch {
    // never throw — logging failure must not mask the underlying agent failure
  }
}
