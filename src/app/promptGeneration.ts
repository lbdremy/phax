import { Effect } from "effect";
import { join } from "node:path";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { PhaxPlan, PhaxPlanPhase } from "../schemas/phaxPlan.js";
import { renderPlanOutline } from "../domain/plan/outline.js";
import type { OracleRole } from "../domain/plan/oraclePairs.js";
import { HANDOFF_GUIDANCE_LINES, REQUIRED_HANDOFF_SECTIONS } from "./handoffGuidance.js";
import { PHASE_PLAN_FILE } from "./worktree.js";

export interface BuildPhasePromptOptions {
  /** The plan body before the first phase section, without the frontmatter. */
  readonly planPreamble: string;
  /** The current phase's section of plan.md, verbatim. */
  readonly phaseSection: string;
  /** The whole plan, read only to build the outline. */
  readonly plan: PhaxPlan;
  readonly currentPhase: PhaxPlanPhase;
  readonly previousHandoff?: string | undefined;
  readonly previousReconciliation?: string | undefined;
  readonly gateCommands: string[];
  /** The `## Brief for this phase` section, present exactly when a brief provider is configured. */
  readonly briefSection?: string | undefined;
  /** The phase's role in an oracle pair, or null for an ordinary phase. */
  readonly oracleRole: OracleRole | null;
}

/**
 * The `## Oracle role` section: one fixed paragraph per role, naming the
 * counterpart phase and the oracle files. It names no test framework or marker.
 */
function oracleRoleLines(role: OracleRole | null): string[] {
  if (role === null) return [];
  const files = role.pair.files.join(", ");
  const paragraph =
    role.role === "oracle"
      ? `This phase writes the oracles that ${role.pair.dischargingPhase} will discharge. In the oracle files (${files}), every test you add or modify must carry your test framework's expected-failure marker, so that the test command stays green. You may delete tests. The oracles provider checks this at the gate.`
      : `This phase discharges the oracles ${role.pair.oraclePhase} wrote. In the oracle files (${files}), the only change allowed is removing every expected-failure marker. Make the implementation satisfy the oracles as written. If an oracle cannot pass unchanged, stop and say so in the handoff: that is a spec question, not a bug to work around.`;
  return ["## Oracle role", "", paragraph, ""];
}

export function buildPhasePrompt(opts: BuildPhasePromptOptions): string {
  const {
    planPreamble,
    phaseSection,
    plan,
    currentPhase,
    previousHandoff,
    previousReconciliation,
    gateCommands,
    briefSection,
    oracleRole,
  } = opts;
  const handoffSection = previousHandoff ?? "(no previous phase)";

  const reconciliationSection =
    previousReconciliation !== undefined
      ? ["## Previous phase file reconciliation", "", previousReconciliation, ""]
      : [];

  const briefLines = briefSection !== undefined ? [briefSection, ""] : [];

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
    "(not provided — see the approved plan below)",
    "",
    "## Approved plan: shared preamble",
    "",
    planPreamble,
    "",
    "## Plan outline",
    "",
    renderPlanOutline(plan.phases, currentPhase.id),
    "",
    `The full plan is at \`${PHASE_PLAN_FILE}\`; read it only when this phase needs another phase's detail.`,
    "",
    "## Approved plan: current phase",
    "",
    phaseSection,
    "",
    ...oracleRoleLines(oracleRole),
    "## Previous phase handoff",
    "",
    handoffSection,
    "",
    ...reconciliationSection,
    "## Current phase",
    "",
    JSON.stringify(currentPhase, null, 2),
    "",
    ...briefLines,
    "## Execution rules",
    "",
    "- Respect the current phase scope.",
    "- Preserve existing behavior unless the spec explicitly changes it.",
    "- Prefer small, coherent changes.",
    "- Keep architectural boundaries explicit.",
    "- Do not include unrelated refactors.",
    "- Do not implement excluded scope.",
    "- Do not move work from future phases into this phase unless required to keep the current phase coherent.",
    '- If any planned file was not touched or any unplanned (non-optional) file was changed, explain why under "## What the next phase needs to know" in `phase-handoff.md`.',
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
    ...REQUIRED_HANDOFF_SECTIONS,
    "",
    ...HANDOFF_GUIDANCE_LINES,
    "Keep it 150–400 words. No session transcript summaries.",
    "",
    "The handoff must be concise but sufficient for the next phase to start in a fresh Claude Code session using only:",
    "",
    "- the plan preamble;",
    "- its own section of the plan;",
    "- the plan outline;",
    `- \`${PHASE_PLAN_FILE}\`, the full plan;`,
    "- its phase definition;",
    "- this `phase-handoff.md`.",
  ].join("\n");
}

export interface GeneratePhasePromptOptions {
  readonly phaseFolderPath: string;
  readonly planPreamble: string;
  readonly phaseSection: string;
  readonly plan: PhaxPlan;
  readonly currentPhase: PhaxPlanPhase;
  readonly previousHandoff?: string | undefined;
  readonly previousReconciliation?: string | undefined;
  readonly gateCommands: string[];
  readonly briefSection?: string | undefined;
  readonly oracleRole: OracleRole | null;
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
