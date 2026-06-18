import type { PhaseAgentBinding } from "../../schemas/phaseAgentBinding.js";
import type { ResumeInvocation, SessionAdapter } from "./types.js";

// codex-cli has no confirmed interactive-resume invocation. The automated path
// uses `codex exec resume <id>` (non-interactive). Until the interactive form
// is verified against the installed CLI, interactive re-entry is unsupported.
export const codexSessionAdapter: SessionAdapter = {
  buildResumeInvocation(_binding: PhaseAgentBinding): ResumeInvocation {
    return {
      unsupported:
        "codex-cli does not support interactive resume via phax. " +
        "To resume manually, run: codex exec resume <session-id> from the bound worktree.",
    };
  },

  describe(binding: PhaseAgentBinding): string {
    return `codex-cli session ${binding.sessionId ?? "(no session)"} in ${binding.worktreePath} (interactive resume unsupported)`;
  },
};
