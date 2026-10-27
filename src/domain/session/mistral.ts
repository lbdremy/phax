import type { PhaseAgentBinding } from "../../schemas/phaseAgentBinding.js";
import type {
  ContinueCommandOpts,
  FreshStartCommandOpts,
  PrePromptedInvocationOpts,
  ResumeInvocation,
  SessionAdapter,
  StopCommandResult,
  StopPosture,
} from "./types.js";

const DEFAULT_MODEL_ENV_VAR = "VIBE_ACTIVE_MODEL";

// A fresh vibe session in the worktree carries the phase's writable roots
// beyond the worktree as `--add-dir`, and `--trust` for an unsafe phase, as
// the headless argv does.
function postureFlags(posture: StopPosture, cwd: string): readonly string[] {
  if (posture === "none") return [];
  if (posture.policy.mode === "unsafe") return ["--trust"];
  return posture.policy.filesystem.allowWrite
    .filter((p) => p !== cwd)
    .flatMap((p) => ["--add-dir", p]);
}

// mistral-vibe (vibe CLI) has no confirmed interactive-resume invocation. The
// automated path uses `vibe -p <prompt> --resume <id>` (non-interactive). Until
// the interactive form is verified against the installed CLI, interactive
// re-entry is unsupported and a stop prints a fresh start instead. Never falls
// back to Claude (FR-5).
export const mistralSessionAdapter: SessionAdapter = {
  interactiveResume: "unverified",

  buildContinueCommand(_opts: ContinueCommandOpts): StopCommandResult {
    return {
      unsupported:
        "mistral-vibe's interactive resume is unverified: phax does not build a continue command. " +
        "To resume manually, run: vibe --resume <session-id> from the bound worktree.",
    };
  },

  buildFreshStartCommand(opts: FreshStartCommandOpts): StopCommandResult {
    return {
      executable: "vibe",
      args: ["--workdir", opts.cwd, ...postureFlags(opts.posture, opts.cwd), opts.prompt],
      cwd: opts.cwd,
      env: { [opts.modelEnvVar ?? DEFAULT_MODEL_ENV_VAR]: opts.model },
    };
  },

  buildResumeInvocation(binding: PhaseAgentBinding): ResumeInvocation {
    return {
      unsupported:
        "mistral-vibe does not support interactive resume via phax. " +
        `To resume manually, run: vibe --resume ${binding.sessionId ?? "<session-id>"} from ${binding.worktreePath}.`,
    };
  },

  buildPrePromptedInvocation(opts: PrePromptedInvocationOpts): ResumeInvocation {
    if (opts.initialPrompt !== null) {
      return {
        unsupported:
          "mistral-vibe does not support a pre-prompted session yet; run `phax enter <short-name>` instead.",
      };
    }
    return {
      unsupported:
        "mistral-vibe does not support interactive resume via phax. " +
        `To resume manually, run: vibe --resume ${opts.sessionId} from ${opts.cwd}.`,
    };
  },

  describe(binding: PhaseAgentBinding): string {
    return `mistral-vibe session ${binding.sessionId ?? "(no session)"} in ${binding.worktreePath} (interactive resume unsupported)`;
  },
};
