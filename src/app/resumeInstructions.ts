import { Effect } from "effect";
import { join } from "node:path";
import { type KeepAwakePlatform, type NextStep, buildWhatsNext } from "../domain/whatsNext.js";
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
  /** Current wall time — injected so the builder stays pure/testable. */
  readonly now: Date;
  /** Host platform — injected so the builder stays pure/testable. */
  readonly platform: KeepAwakePlatform;
}

function stepsToMarkdown(steps: readonly NextStep[]): string[] {
  const lines: string[] = [];
  for (const step of steps) {
    lines.push(`## ${step.title}`, "");
    if (step.detail) {
      for (const d of step.detail) {
        lines.push(d);
      }
      lines.push("");
    }
    if (step.command !== undefined) {
      lines.push("```bash", step.command, "```", "");
    }
  }
  return lines;
}

function buildGateExhaustionInstructions(input: ResumeInstructionsInput): string {
  const phaseId = input.phaseId ?? "(unknown)";
  const wn = buildWhatsNext(
    { kind: "gates_exhausted", shortName: input.shortName, phaseId: input.phaseId },
    input.now,
  );

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
    ...stepsToMarkdown(wn.steps),
  ];
  return lines.join("\n");
}

function buildRateLimitInstructions(input: ResumeInstructionsInput): string {
  const phaseId = input.phaseId ?? "(unknown)";
  const wn = buildWhatsNext(
    {
      kind: "limit",
      shortName: input.shortName,
      resetAt: input.resetAt,
      phaseId: input.phaseId,
      platform: input.platform,
    },
    input.now,
  );

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
    ...stepsToMarkdown(wn.steps),
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
