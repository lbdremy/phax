import type { PhaseAgentBinding } from "../../schemas/phaseAgentBinding.js";
import type { ResumeInvocation, SessionAdapter } from "./types.js";

export const claudeSessionAdapter: SessionAdapter = {
  buildResumeInvocation(binding: PhaseAgentBinding): ResumeInvocation {
    if (!binding.sessionId) {
      return {
        unsupported: `No session ID captured for this claude-code phase "${binding.phaseId}"; cannot resume interactively.`,
      };
    }
    return {
      executable: "claude",
      args: ["--resume", binding.sessionId],
      cwd: binding.worktreePath,
    };
  },

  describe(binding: PhaseAgentBinding): string {
    return `claude --resume ${binding.sessionId ?? "(no session)"} in ${binding.worktreePath}`;
  },
};
