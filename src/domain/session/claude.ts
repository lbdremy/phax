import type { PhaseAgentBinding } from "../../schemas/phaseAgentBinding.js";
import type { PrePromptedInvocationOpts, ResumeInvocation, SessionAdapter } from "./types.js";

export interface DecideInvocationInput {
  readonly cwd: string;
  /** A new session under a known id, or the kept authoring session resumed. */
  readonly session: { readonly kind: "new" | "resume"; readonly id: string };
  readonly model: string;
  readonly effort: string;
  /** The Claude permission flags of the session's policy (`claudePermissionFlags`). */
  readonly permissionFlags: readonly string[];
  /** The short first message pointing the session at its prompt file. */
  readonly prompt: string;
}

/**
 * The interactive `claude` launch of `phax artifact decide`: `--session-id`
 * for a new session or `--resume` for the kept authoring session, then the
 * model and effort, the permission flags, and the positional prompt after
 * `--`. decide
 * runs on Claude Code only, so this stays outside `SessionAdapter`.
 */
export function buildDecideInvocation(input: DecideInvocationInput): {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
} {
  const sessionArgs =
    input.session.kind === "new"
      ? ["--session-id", input.session.id]
      : ["--resume", input.session.id];
  return {
    executable: "claude",
    args: [
      ...sessionArgs,
      "--model",
      input.model,
      "--effort",
      input.effort,
      ...input.permissionFlags,
      // The permission flags may end on a variadic option (`--disallowed-tools
      // Bash`, `--add-dir <dir>`): `--` keeps the prompt from joining its values.
      "--",
      input.prompt,
    ],
    cwd: input.cwd,
  };
}

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
