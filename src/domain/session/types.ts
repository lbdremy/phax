import type { PhaseAgentBinding } from "../../schemas/phaseAgentBinding.js";

export type ResumeInvocation =
  | { readonly executable: string; readonly args: readonly string[]; readonly cwd: string }
  | { readonly unsupported: string };

export interface SessionAdapter {
  buildResumeInvocation(binding: PhaseAgentBinding): ResumeInvocation;
  describe(binding: PhaseAgentBinding): string;
}
