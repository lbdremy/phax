import { Effect } from "effect";
import { join } from "node:path";
import { FileSystem, type FsError } from "../ports/fs.js";

export interface ResumeInstructionsInput {
  /** The run folder (`~/.phax/runs/<short>`). */
  readonly runPath: string;
  readonly shortName: string;
  /** Why the run stopped, e.g. "Rate limit" or "Usage limit". */
  readonly reason: string;
  /** Discriminates the pause kind; determines which body is rendered. */
  readonly kind?: string | undefined;
  /** Best-effort reset time parsed from the limit message, if any. */
  readonly resetAt?: string | undefined;
  /** The phase that was in flight when the limit was hit. */
  readonly phaseId?: string | undefined;
  /** Worktree of the in-flight phase — preserved for resume. */
  readonly worktreePath?: string | undefined;
  /** Claude session id of the in-flight phase — preserved for `enter-phase`. */
  readonly sessionId?: string | undefined;
  /** The raw limit message from Claude Code, for context. */
  readonly rawMessage?: string | undefined;
}

function buildGateExhaustionInstructions(input: ResumeInstructionsInput): string {
  const phaseId = input.phaseId ?? "(unknown)";
  const lines: string[] = [
    `# Resume Instructions: ${input.shortName}`,
    "",
    "This run paused because its gate checks failed after exhausting all fix attempts.",
    "Fix the gate manually in the worktree, then resume — the gate is re-run first on",
    "resume, and if it passes the phase commits with no fresh agent invocation.",
    "",
    "## Why it stopped",
    "",
    `- **Reason:** ${input.reason}`,
    `- **Current phase:** ${phaseId}`,
    `- **Worktree:** ${input.worktreePath ?? "(not yet created)"}`,
    `- **Claude session:** ${input.sessionId ?? "(not captured)"}`,
    "",
    "## Fix the gate manually",
    "",
    "Navigate to the worktree and fix whatever caused the gate to fail:",
    "",
    "```bash",
    `cd ${input.worktreePath ?? "<worktree-path>"}`,
    "# fix the failing gate, then:",
    "```",
    "",
    "## Resume the run",
    "",
    "```bash",
    `phax resume ${input.shortName} --yes`,
    "```",
    "",
    "## If the Claude session was lost",
    "",
    "If the session ID is missing or the session context is gone, use:",
    "",
    "```bash",
    `phax reset-phase ${input.shortName} ${phaseId}`,
    "```",
    "",
  ];
  return lines.join("\n");
}

function buildRateLimitInstructions(input: ResumeInstructionsInput): string {
  const phaseId = input.phaseId ?? "(unknown)";
  const lines: string[] = [
    `# Resume Instructions: ${input.shortName}`,
    "",
    `This run paused before completing. Once the limit clears, resume it with the`,
    "commands below — completed phases are not re-run.",
    "",
    "## Why it stopped",
    "",
    `- **Reason:** ${input.reason}`,
    `- **Reset time:** ${input.resetAt ?? "(not reported — retry later)"}`,
    `- **Current phase:** ${phaseId}`,
    `- **Worktree:** ${input.worktreePath ?? "(not yet created)"}`,
    `- **Claude session:** ${input.sessionId ?? "(not captured)"}`,
    "",
    "## Resume the run",
    "",
    "```bash",
    `phax resume ${input.shortName} --yes`,
    "```",
    "",
    "## Enter the phase session interactively",
    "",
    "```bash",
    `phax enter-phase ${input.shortName} ${phaseId}`,
    "```",
    "",
  ];

  if (input.rawMessage !== undefined && input.rawMessage.trim().length > 0) {
    lines.push("## Limit message", "", "```", input.rawMessage.trim().slice(0, 1000), "```", "");
  }

  return lines.join("\n");
}

export function buildResumeInstructions(input: ResumeInstructionsInput): string {
  if (input.kind === "gates_exhausted") {
    return buildGateExhaustionInstructions(input);
  }
  return buildRateLimitInstructions(input);
}

/**
 * Write `resume-instructions.md` into the run folder after a rate/usage-limit
 * stop (spec §9). Best-effort: failures are surfaced as `FsError` to the caller.
 */
export function writeResumeInstructions(
  input: ResumeInstructionsInput,
): Effect.Effect<string, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = join(input.runPath, "resume-instructions.md");
    yield* fs.writeAtomic(path, buildResumeInstructions(input));
    return path;
  });
}
