import type { PhaseAgentBinding } from "../../schemas/phaseAgentBinding.js";

export type ResumeInvocation =
  | { readonly executable: string; readonly args: readonly string[]; readonly cwd: string }
  | { readonly unsupported: string };

export interface BuildReviewInvocationOpts {
  readonly worktreePath: string;
  readonly sessionId: string;
  readonly initialPrompt: string | null; // null => resume; string => start new
  readonly model?: string;
  readonly effort?: string;
}

export interface SessionAdapter {
  buildResumeInvocation(binding: PhaseAgentBinding): ResumeInvocation;
  buildReviewInvocation(opts: BuildReviewInvocationOpts): ResumeInvocation;
  describe(binding: PhaseAgentBinding): string;
}
