import { Effect } from "effect";
import { join } from "node:path";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { PhaxPlan, PhaxPlanPhase } from "../schemas/phaxPlan.js";

export interface BuildPhasePromptOptions {
  readonly planMd: string;
  readonly planJson: PhaxPlan;
  readonly currentPhase: PhaxPlanPhase;
  readonly previousHandoff?: string | undefined;
}

export function buildPhasePrompt(opts: BuildPhasePromptOptions): string {
  const { planMd, planJson, currentPhase, previousHandoff } = opts;
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
    "",
    "## Required output",
    "",
    "At the end, produce two Markdown artifacts:",
    "",
    "1. `summary.md`, a concise record of what happened in the phase;",
    "2. `phase-handoff.md`, the context that should be passed to the next phase.",
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
    "`phase-handoff.md` should use this format:",
    "",
    "# Phase handoff",
    "",
    "## Phase completed",
    "",
    "## Current repository state",
    "",
    "## Important implementation decisions",
    "",
    "## Invariants and constraints to preserve",
    "",
    "## Files and modules the next phase should know about",
    "",
    "## Open questions or risks",
    "",
    "## Instructions for the next phase",
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
