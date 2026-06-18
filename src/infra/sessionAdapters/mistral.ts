import type { PhaseAgentBinding } from "../../schemas/phaseAgentBinding.js";
import type { ResumeInvocation, SessionAdapter } from "./types.js";

// mistral-vibe (vibe CLI) has no confirmed interactive-resume invocation. The
// automated path uses `vibe -p <prompt> --resume <id>` (non-interactive). Until
// the interactive form is verified against the installed CLI, interactive
// re-entry is unsupported. Never falls back to Claude (FR-5).
export const mistralSessionAdapter: SessionAdapter = {
  buildResumeInvocation(_binding: PhaseAgentBinding): ResumeInvocation {
    return {
      unsupported:
        "mistral-vibe does not support interactive resume via phax. " +
        "To resume manually, run: vibe --resume <session-id> from the bound worktree.",
    };
  },

  describe(binding: PhaseAgentBinding): string {
    return `mistral-vibe session ${binding.sessionId ?? "(no session)"} in ${binding.worktreePath} (interactive resume unsupported)`;
  },
};
