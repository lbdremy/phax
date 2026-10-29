import { Effect } from "effect";
import { join } from "node:path";
import { type KeepAwakePlatform, type NextStep, buildWhatsNext } from "../domain/whatsNext.js";
import type { GateRefusal } from "../domain/effects.js";
import {
  describeProtectedChange,
  type ProtectedChange,
} from "../domain/security/protectedPaths.js";
import { shellQuote } from "../domain/interactive/commandLine.js";
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
  /** The refused step, its reason and its remedy (kind `gate_refused`). */
  readonly refusal?: GateRefusal | undefined;
  /** Which step stopped the phase (kinds `gates_exhausted` and `gate_refused`). */
  readonly failedStep?: "configured" | "oracle" | "protected-paths" | undefined;
  /** The protected paths still changed (kinds `gates_exhausted` and `gate_refused`). */
  readonly protectedChanges?: readonly ProtectedChange[] | undefined;
  /** The phase's last fix transcript, or null when none was made (kind `gates_exhausted`). */
  readonly lastFixTranscript?: string | null | undefined;
  /** The commit the protected paths are put back from: the phase base after a
   *  gate pause, the phase commit after a handoff pause. Undefined when the
   *  phase's status.json could not be read. */
  readonly protectedRestore?: ProtectedRestore | undefined;
  /** Current wall time — injected so the builder stays pure/testable. */
  readonly now: Date;
  /** Host platform — injected so the builder stays pure/testable. */
  readonly platform: KeepAwakePlatform;
}

/** Operator-only: the wrong-oracle recovery; no agent prompt carries it. */
const OracleSkipSentence =
  "Either resume as is — the gate, oracle step included, is re-run first — or, if the oracle itself is wrong, correct it in the phase worktree and resume with --skip-oracle: the phase's configured gate still runs, with the usual fix loop, and the oracle step is recorded as skipped.";

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

/** The commit a protected path is put back from, and what it is to the phase. */
export interface ProtectedRestore {
  readonly commit: string;
  readonly name: "phase base" | "phase commit";
}

/**
 * The shell command, run in the phase worktree, that puts one protected path
 * back to its content at `commit`: checked out of it when it was edited or
 * deleted, removed when it was created. A renamed path is either side of the
 * rename, so it is checked out when `commit` holds it and removed otherwise.
 * A symbolic link or a nested repository is removed, link or directory, and
 * what `commit` holds at its path is checked out.
 */
function restoreCommand(change: ProtectedChange, commit: string): string {
  const path = shellQuote(change.path);
  const checkout = `git checkout ${commit} -- ${path}`;
  const atCommit = `git cat-file -e ${shellQuote(`${commit}:${change.path}`)} 2>/dev/null`;
  switch (change.kind) {
    case "edited":
    case "deleted":
      return checkout;
    case "created":
      return `rm -- ${path}`;
    case "renamed":
      return `if ${atCommit}; then ${checkout}; else rm -- ${path}; fi`;
    case "symlink":
    case "nested-repository":
      return `rm -rf -- ${path}; if ${atCommit}; then ${checkout}; fi`;
  }
}

/**
 * Each protected path still changed with its kind, why it cannot stay, and
 * (when asked) where the last fix transcript is, then, when the commit to
 * restore from is known, that commit and the command putting each path back.
 * Empty when none changed.
 */
function protectedPathsSection(
  changes: readonly ProtectedChange[],
  restore: ProtectedRestore | undefined,
  lastFixTranscript?: string | null,
): string[] {
  if (changes.length === 0) return [];
  return [
    "## Protected paths changed",
    "",
    ...(restore === undefined
      ? []
      : [`Compared with the ${restore.name}, commit ${restore.commit}:`, ""]),
    ...changes.map((change) => `- ${describeProtectedChange(change)}`),
    "",
    "No phase of this run may change these paths: they are the operator's decision.",
    ...(lastFixTranscript === undefined
      ? []
      : [
          lastFixTranscript === null
            ? "No fix attempt was made."
            : `The last fix attempt's transcript: ${lastFixTranscript}`,
        ]),
    "",
    ...(restore === undefined
      ? []
      : [
          `To put each path back to its content at the ${restore.name}, run in the phase worktree:`,
          "",
          "```bash",
          ...changes.map((change) => restoreCommand(change, restore.commit)),
          "```",
          "",
        ]),
  ];
}

function buildGateExhaustionInstructions(input: ResumeInstructionsInput): string {
  const phaseId = input.phaseId ?? "(unknown)";
  const failedStep = input.failedStep ?? "configured";
  const protectedChanges = input.protectedChanges ?? [];
  const lastFixTranscript = input.lastFixTranscript ?? null;
  const wn = buildWhatsNext(
    {
      kind: "gates_exhausted",
      shortName: input.shortName,
      phaseId: input.phaseId,
      failedStep,
      protectedChanges,
      lastFixTranscript,
    },
    input.now,
  );

  const opening =
    failedStep === "protected-paths"
      ? [
          "This run paused because its gate attempts changed protected paths, and the fix",
          "attempts did not put them back. Every gate step passed.",
        ]
      : failedStep === "oracle"
        ? [
            "This run paused because the oracle step failed after exhausting all fix attempts.",
            OracleSkipSentence,
          ]
        : [
            "This run paused because its gate checks failed after exhausting all fix attempts.",
            "Fix the gate manually in the worktree, then resume — the gate is re-run first on",
            "resume, and if it passes the phase commits with no fresh agent invocation.",
          ];

  const lines: string[] = [
    `# Resume Instructions: ${input.shortName}`,
    "",
    ...opening,
    "",
    "## Why it stopped",
    "",
    `- **Reason:** ${input.reason}`,
    `- **Current phase:** ${phaseId}`,
    `- **Worktree:** ${input.worktreePath ?? "(not yet created)"}`,
    `- **Claude session:** ${input.sessionId ?? "(not captured)"}`,
    "",
    ...protectedPathsSection(protectedChanges, input.protectedRestore, lastFixTranscript),
    ...stepsToMarkdown(wn.steps),
  ];
  return lines.join("\n");
}

function buildGateRefusalInstructions(input: ResumeInstructionsInput): string {
  const phaseId = input.phaseId ?? "(unknown)";
  const refusal = input.refusal ?? {
    command: "(unknown)",
    reason: "(not recorded)",
    remedy: "(not recorded)",
  };
  // A refusal is a step's: it is never the protected-paths check.
  const failedStep = input.failedStep === "oracle" ? "oracle" : "configured";
  const protectedChanges = input.protectedChanges ?? [];
  const wn = buildWhatsNext(
    {
      kind: "gate_refused",
      shortName: input.shortName,
      phaseId,
      failedStep,
      protectedChanges,
      ...refusal,
    },
    input.now,
  );

  const lines: string[] = [
    `# Resume Instructions: ${input.shortName}`,
    "",
    `This run paused because the gate step \`${refusal.command}\` refused to run.`,
    ...(failedStep === "oracle"
      ? [
          "No fix attempt was made. Fix the cause and resume — the gate, oracle step included, is",
          "re-run first, with the full fix budget — or, if the oracle itself is wrong, correct it in",
          "the phase worktree and resume with --skip-oracle: the phase's configured gate still runs,",
          "with the usual fix loop, and the oracle step is recorded as skipped.",
        ]
      : [
          "No fix attempt was made. Fix the cause, then resume — the gate is re-run first,",
          "with the full fix budget.",
        ]),
    "",
    "## Why it stopped",
    "",
    `- **Reason:** ${input.reason}`,
    `- **Step:** \`${refusal.command}\``,
    `- **Refused because:** ${refusal.reason}`,
    `- **Remedy:** ${refusal.remedy}`,
    `- **Current phase:** ${phaseId}`,
    `- **Worktree:** ${input.worktreePath ?? "(not yet created)"}`,
    `- **Claude session:** ${input.sessionId ?? "(not captured)"}`,
    "",
    ...protectedPathsSection(protectedChanges, input.protectedRestore),
    ...stepsToMarkdown(wn.steps),
  ];
  return lines.join("\n");
}

function buildProtectedPathsChangedInstructions(input: ResumeInstructionsInput): string {
  const phaseId = input.phaseId ?? "(unknown)";
  const protectedChanges = input.protectedChanges ?? [];
  const wn = buildWhatsNext(
    {
      kind: "protected_paths_changed",
      shortName: input.shortName,
      phaseId: input.phaseId,
      protectedChanges,
    },
    input.now,
  );

  const lines: string[] = [
    `# Resume Instructions: ${input.shortName}`,
    "",
    "This run paused because a protected path differs from the phase commit after the",
    "phase committed. The handoff was neither validated nor copied, and no phase record",
    "was written.",
    "",
    "## Why it stopped",
    "",
    `- **Reason:** ${input.reason}`,
    `- **Current phase:** ${phaseId}`,
    `- **Worktree:** ${input.worktreePath ?? "(not yet created)"}`,
    "",
    ...protectedPathsSection(protectedChanges, input.protectedRestore),
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

function buildNetworkFailureInstructions(input: ResumeInstructionsInput): string {
  const phaseId = input.phaseId ?? "(unknown)";
  const lines: string[] = [
    `# Resume Instructions: ${input.shortName}`,
    "",
    "This run paused before completing: the provider session lost the network.",
    "Nothing waits for a reset time, so the resume can run as soon as the network is back —",
    "completed phases are not re-run.",
    "",
    "## Why it stopped",
    "",
    `- **Reason:** ${input.reason}`,
    `- **Current phase:** ${phaseId}`,
    `- **Worktree:** ${input.worktreePath ?? "(not yet created)"}`,
    `- **Provider session:** ${input.sessionId ?? "(not reported)"}`,
    "",
    "## Resume",
    "",
    // The resume starts a new provider session in the same worktree. A
    // --provider-priority given to the paused command is not recorded: pass
    // it again.
    "```bash",
    `phax resume ${input.shortName} --yes`,
    "```",
    "",
    "Pass `--provider-priority` again if the paused command was given one.",
    "",
  ];

  if (input.rawMessage !== undefined && input.rawMessage.trim().length > 0) {
    lines.push("## Provider message", "", "```", input.rawMessage.trim().slice(0, 1000), "```", "");
  }

  return lines.join("\n");
}

function buildCommitFailedInstructions(input: ResumeInstructionsInput): string {
  const phaseId = input.phaseId ?? "(unknown)";
  const wn = buildWhatsNext(
    {
      kind: "gates_exhausted",
      shortName: input.shortName,
      phaseId: input.phaseId,
      failedStep: "configured",
      protectedChanges: [],
      lastFixTranscript: null,
    },
    input.now,
  );

  const lines: string[] = [
    `# Resume Instructions: ${input.shortName}`,
    "",
    "This run paused because the commit step failed after the gate passed.",
    "The gate is already satisfied — only the commit (and subsequent handoff/cleanup)",
    "needs to be re-run. Fix the commit error in the worktree, then resume.",
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

function buildCleanupFailedInstructions(input: ResumeInstructionsInput): string {
  const phaseId = input.phaseId ?? "(unknown)";
  const wn = buildWhatsNext(
    {
      kind: "gates_exhausted",
      shortName: input.shortName,
      phaseId: input.phaseId,
      failedStep: "configured",
      protectedChanges: [],
      lastFixTranscript: null,
    },
    input.now,
  );

  const lines: string[] = [
    `# Resume Instructions: ${input.shortName}`,
    "",
    "This run paused because the cleanup step failed after the commit landed.",
    "The commit is safe on its branch — only the cleanup (worktree removal) needs",
    "to be re-run. Fix the cause, then resume.",
    "",
    "## Why it stopped",
    "",
    `- **Reason:** ${input.reason}`,
    `- **Current phase:** ${phaseId}`,
    `- **Worktree:** ${input.worktreePath ?? "(not yet created)"}`,
    "",
    ...stepsToMarkdown(wn.steps),
  ];
  return lines.join("\n");
}

function buildHoldPointFailedInstructions(input: ResumeInstructionsInput): string {
  const phaseId = input.phaseId ?? "(unknown)";
  const lines: string[] = [
    `# Resume Instructions: ${input.shortName}`,
    "",
    "This run paused before it could stop at a held phase. The phase is committed and",
    "its gate passed — only the stop itself failed. Fix the cause, then resume:",
    "`phax resume` reaches the stop again with no agent turn, gate or commit.",
    "",
    "## Why it stopped",
    "",
    `- **Reason:** ${input.reason}`,
    `- **Current phase:** ${phaseId}`,
    `- **Worktree:** ${input.worktreePath ?? "(not recorded)"}`,
    ...(input.rawMessage !== undefined ? [`- **Error:** ${input.rawMessage}`] : []),
    "",
    "## Resume",
    "",
    "```bash",
    `phax resume ${input.shortName}`,
    "```",
    "",
  ];
  return lines.join("\n");
}

function buildStopRecordRefusedInstructions(input: ResumeInstructionsInput): string {
  const phaseId = input.phaseId ?? "(unknown)";
  const lines: string[] = [
    `# Resume Instructions: ${input.shortName}`,
    "",
    "This run paused after closing a stop: the records destination refused the",
    "phase's record. The close and its commits stand. Apply the remedy below, then",
    "resume: `phax resume` writes the record once, runs the cleanup and goes on.",
    "",
    "## Why it stopped",
    "",
    `- **Reason:** ${input.reason}`,
    `- **Current phase:** ${phaseId}`,
    `- **Worktree:** ${input.worktreePath ?? "(not recorded)"}`,
    ...(input.rawMessage !== undefined ? [`- **Error:** ${input.rawMessage}`] : []),
    "",
    "## Resume",
    "",
    "```bash",
    `phax resume ${input.shortName}`,
    "```",
    "",
  ];
  return lines.join("\n");
}

function buildArtifactCompletionFailedInstructions(input: ResumeInstructionsInput): string {
  const phaseId = input.phaseId ?? "(unknown)";
  const wn = buildWhatsNext(
    {
      kind: "gates_exhausted",
      shortName: input.shortName,
      phaseId: input.phaseId,
      failedStep: "configured",
      protectedChanges: [],
      lastFixTranscript: null,
    },
    input.now,
  );

  const lines: string[] = [
    `# Resume Instructions: ${input.shortName}`,
    "",
    "This run paused because completing the plan (and, where applicable, its source",
    "spec) on the run branch failed. The run's gates already passed — the fix is usually",
    "a hand-edit of the artifact's frontmatter or clearing a dirty write-set in the",
    "worktree. Fix the cause, then resume — `phax resume` re-runs only the completion",
    "step.",
    "",
    "## Why it stopped",
    "",
    `- **Reason:** ${input.reason}`,
    `- **Current phase:** ${phaseId}`,
    `- **Worktree:** ${input.worktreePath ?? "(not yet created)"}`,
    "",
    ...stepsToMarkdown(wn.steps),
  ];
  return lines.join("\n");
}

function buildAwaitingReviewInstructions(input: ResumeInstructionsInput): string {
  const phaseId = input.phaseId ?? "(unknown)";
  const lines: string[] = [
    `# Resume Instructions: ${input.shortName}`,
    "",
    `This run waits for a person at ${phaseId}. Nothing runs until you close the stop.`,
    "Work in the phase worktree with any editor or agent, then close the stop from the",
    "main checkout: the gate runs first, and if it passes the phase commits and the run",
    "continues.",
    "",
    "## Why it stopped",
    "",
    `- **Reason:** ${input.reason}`,
    `- **Current phase:** ${phaseId}`,
    `- **Worktree:** ${input.worktreePath ?? "(not recorded)"}`,
    ...(input.rawMessage !== undefined ? [`- **Last close:** ${input.rawMessage}`] : []),
    "",
    "## Open the phase",
    "",
    "```bash",
    `phax enter-phase ${input.shortName} ${phaseId}`,
    "```",
    "",
    "## Close the stop (from the main checkout)",
    "",
    "```bash",
    `phax resume ${input.shortName}`,
    "```",
    "",
    "## Start the phase over",
    "",
    "```bash",
    `phax reset-phase ${input.shortName} ${phaseId}`,
    "```",
    "",
  ];
  return lines.join("\n");
}

export function buildResumeInstructions(input: ResumeInstructionsInput): string {
  if (input.kind === "awaiting_review") {
    return buildAwaitingReviewInstructions(input);
  }
  if (input.kind === "gates_exhausted") {
    return buildGateExhaustionInstructions(input);
  }
  if (input.kind === "gate_refused") {
    return buildGateRefusalInstructions(input);
  }
  if (input.kind === "protected_paths_changed") {
    return buildProtectedPathsChangedInstructions(input);
  }
  if (input.kind === "network_failure") {
    return buildNetworkFailureInstructions(input);
  }
  if (input.kind === "commit_failed") {
    return buildCommitFailedInstructions(input);
  }
  if (input.kind === "cleanup_failed") {
    return buildCleanupFailedInstructions(input);
  }
  if (input.kind === "artifact_completion_failed") {
    return buildArtifactCompletionFailedInstructions(input);
  }
  if (input.kind === "hold_point_failed") {
    return buildHoldPointFailedInstructions(input);
  }
  if (input.kind === "stop_record_refused") {
    return buildStopRecordRefusedInstructions(input);
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
