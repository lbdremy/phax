import type { PhaseAgentBinding } from "../../schemas/phaseAgentBinding.js";
import type { PrePromptedInvocationOpts, ResumeInvocation, SessionAdapter } from "./types.js";

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

  buildPrePromptedInvocation(opts: PrePromptedInvocationOpts): ResumeInvocation {
    const { cwd, sessionId, initialPrompt, model, effort } = opts;
    const modelArgs = model ? ["--model", model] : [];
    const effortArgs = effort ? ["--effort", effort] : [];
    if (initialPrompt === null) {
      return {
        executable: "claude",
        args: ["--resume", sessionId, ...modelArgs, ...effortArgs],
        cwd,
      };
    }
    return {
      executable: "claude",
      args: ["--session-id", sessionId, ...modelArgs, ...effortArgs, initialPrompt],
      cwd,
    };
  },

  describe(binding: PhaseAgentBinding): string {
    return `claude --resume ${binding.sessionId ?? "(no session)"} in ${binding.worktreePath}`;
  },
};
