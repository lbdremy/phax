import { Effect } from "effect";
import { join } from "node:path";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { PhaxPlan, PhaxPlanPhase } from "../schemas/phaxPlan.js";

export interface BuildPhasePromptOptions {
  readonly planMd: string;
  readonly planJson: PhaxPlan;
  readonly currentPhase: PhaxPlanPhase;
  readonly previousHandoff?: string | undefined;
  readonly gateCommands: string[];
}

export function buildPhasePrompt(opts: BuildPhasePromptOptions): string {
  const { planMd, planJson, currentPhase, previousHandoff, gateCommands } =
    opts;
  const handoffSection = previousHandoff ?? "(no previous phase)";

  return [
    "# Execute one implementation phase",
    "",
    "You are executing one phase of a multi-phase AI-assisted development workflow.",
    "",
    "You must only execute the current phase.",
    "",
    "Do not broaden the scope.",
    "Do not anticipate future phases unless strictly necessary to avoid breaking the current phase.",
    "Do not redesign unrelated parts of the system.",
    "Do not add speculative features.",
    "Do not change the planned commit message.",
    "Do not run `git commit` yourself — phax commits your changes after gates pass.",
    "Write `phase-handoff.md` and `summary.md` inside `.phax-context/` (gitignored phax metadata folder), not at the worktree root.",
    "",
    "## Source intent/spec document",
    "",
    "(not provided — see human-readable plan below)",
    "",
    "## Human-readable approved plan",
    "",
    planMd,
    "",
    "## Machine-readable execution plan",
    "",
    JSON.stringify(planJson, null, 2),
    "",
    "## Previous phase handoff",
    "",
    handoffSection,
    "",
    "## Current phase",
    "",
    JSON.stringify(currentPhase, null, 2),
    "",
    "## Execution rules",
    "",
    "- Respect the current phase scope.",
    "- Preserve existing behavior unless the spec explicitly changes it.",
    "- Prefer small, coherent changes.",
    "- Keep architectural boundaries explicit.",
    "- Do not include unrelated refactors.",
    "- Do not implement excluded scope.",
    "- Do not move work from future phases into this phase unless required to keep the current phase coherent.",
    "- Run the gate commands again after your changes to verify the gates are satisfied.",
    gateCommands.join("\n"),
    "",
    "## Required output",
    "",
    "At the end, produce two Markdown artifacts inside `.phax-context/`:",
    "",
    "1. `.phax-context/summary.md`, a concise record of what happened in the phase;",
    "2. `.phax-context/phase-handoff.md`, the context that should be passed to the next phase.",
    "",
    "`summary.md` should use this format:",
    "",
    "# Phase summary",
    "",
    "## Completed",
    "",
    "## Decisions made",
    "",
    "## Files changed",
    "",
    "## Important constraints preserved",
    "",
    "## Known limitations",
    "",
    "## Follow-up for next phase",
    "",
    "`phase-handoff.md` must contain exactly these four sections in order (phax validates them):",
    "",
    "## What was delivered",
    "",
    "## Key decisions and why",
    "",
    "## Exact locations (file paths and exported names)",
    "",
    "## What the next phase needs to know",
    "",
    "Consult `.skills/phax-phase-handoff.md` for guidance on what to write in each section.",
    "Keep it 150–400 words. No session transcript summaries.",
    "",
    "The handoff must be concise but sufficient for the next phase to start in a fresh Claude Code session using only:",
    "",
    "- `plan.md`;",
    "- `phax-plan.json`;",
    "- the current phase definition;",
    "- the previous `phase-handoff.md`.",
  ].join("\n");
}

export interface GeneratePhasePromptOptions {
  readonly phaseFolderPath: string;
  readonly planMd: string;
  readonly planJson: PhaxPlan;
  readonly currentPhase: PhaxPlanPhase;
  readonly previousHandoff?: string | undefined;
  readonly gateCommands: string[];
}

export function generatePhasePrompt(
  opts: GeneratePhasePromptOptions,
): Effect.Effect<string, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const prompt = buildPhasePrompt(opts);
    const promptPath = join(opts.phaseFolderPath, "prompt.md");
    yield* fs.writeAtomic(promptPath, prompt);
    return promptPath;
  });
}
