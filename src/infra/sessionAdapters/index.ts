import { spawnSync } from "node:child_process";
import type { ProviderId } from "../../domain/routing/types.js";
import type { OutputPort } from "../../ports/output.js";
import type { SessionAdapter } from "./types.js";
import { claudeSessionAdapter } from "./claude.js";
import { codexSessionAdapter } from "./codex.js";
import { mistralSessionAdapter } from "./mistral.js";

export type { SessionAdapter };

export function getSessionAdapter(provider: ProviderId): SessionAdapter {
  switch (provider) {
    case "claude-code":
      return claudeSessionAdapter;
    case "codex-cli":
      return codexSessionAdapter;
    case "mistral-vibe":
      return mistralSessionAdapter;
  }
}

/** @public — consumed by enter* commands in phase-05 */
export function spawnInteractive(
  invocation: { executable: string; args: readonly string[]; cwd: string },
  out: OutputPort,
): number {
  out.log(`Entering ${invocation.executable} session in ${invocation.cwd}`);
  const result = spawnSync(invocation.executable, [...invocation.args], {
    cwd: invocation.cwd,
    stdio: "inherit",
  });
  if (result.error) {
    out.error(`Failed to launch ${invocation.executable}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 0;
}
