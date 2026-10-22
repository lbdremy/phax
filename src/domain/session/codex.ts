import { SecurityEnforcementError } from "../errors.js";
import type { PhaseAgentBinding } from "../../schemas/phaseAgentBinding.js";
import { buildCodexSecurityFlags, mapReasoningEffort } from "./codexFlags.js";
import type {
  ContinueCommandOpts,
  FreshStartCommandOpts,
  PrePromptedInvocationOpts,
  ResumeInvocation,
  SessionAdapter,
  StopCommandResult,
  StopPosture,
} from "./types.js";

// The posture flags of a stop command (q-continue-approvals, provider-prompts):
// the phase's sandbox, writable roots and network flags with `on-request`
// approvals, so a step outside the sandbox needs the person's yes. An unsafe
// phase keeps its unsafe flag. A policy codex cannot enforce is `unsupported`.
function postureFlags(posture: StopPosture): readonly string[] | { readonly unsupported: string } {
  if (posture === "none") return [];
  try {
    return buildCodexSecurityFlags(posture.policy, "on-request");
  } catch (err) {
    if (err instanceof SecurityEnforcementError) return { unsupported: err.message };
    throw err;
  }
}

const modelFlags = (model: string, effort: string): string[] => [
  "-m",
  model,
  "-c",
  `model_reasoning_effort="${mapReasoningEffort(effort)}"`,
];

// codex-cli: `codex resume <id>` is the verified interactive resume. The
// automated path uses `codex exec resume <id>` (non-interactive); `phax enter`
// still uses the unsupported answers below, and `phax enter-phase` moves to
// the continue command.
export const codexSessionAdapter: SessionAdapter = {
  interactiveResume: "verified",

  buildContinueCommand(opts: ContinueCommandOpts): StopCommandResult {
    const flags = postureFlags(opts.posture);
    if ("unsupported" in flags) return flags;
    return {
      executable: "codex",
      args: ["resume", opts.sessionId, ...modelFlags(opts.model, opts.effort), ...flags],
      cwd: opts.cwd,
      env: {},
    };
  },

  buildFreshStartCommand(opts: FreshStartCommandOpts): StopCommandResult {
    const flags = postureFlags(opts.posture);
    if ("unsupported" in flags) return flags;
    return {
      executable: "codex",
      args: [...modelFlags(opts.model, opts.effort), ...flags, opts.prompt],
      cwd: opts.cwd,
      env: {},
    };
  },

  buildResumeInvocation(_binding: PhaseAgentBinding): ResumeInvocation {
    return {
      unsupported:
        "codex-cli does not support interactive resume via phax. " +
        "To resume manually, run: codex exec resume <session-id> from the bound worktree.",
    };
  },

  buildPrePromptedInvocation(opts: PrePromptedInvocationOpts): ResumeInvocation {
    if (opts.initialPrompt !== null) {
      return {
        unsupported:
          "codex-cli does not support a pre-prompted session yet; run `phax enter <short-name>` instead.",
      };
    }
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
