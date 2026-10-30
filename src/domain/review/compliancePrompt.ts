import { answerJsonSchema } from "../../schemas/answerSchemas.js";

export const COMPLIANCE_REVIEW_MD_FILENAME = "compliance-review.md";
export const COMPLIANCE_REVIEW_JSON_FILENAME = "compliance-review.json";

export interface BuildCompliancePromptInput {
  readonly planMd: string;
  readonly reconciliationMd: string;
  readonly phases: ReadonlyArray<{ id: string; title: string }>;
  readonly phaseHandoffs: ReadonlyArray<{ phaseId: string; handoffMd: string }>;
  // The phases a person reviewed at a stop, with the interactive handoff of each.
  readonly reviewedPhases: ReadonlyArray<{
    phaseId: string;
    cause: "declared" | "held";
    handoffMd: string;
  }>;
  readonly worktreePath: string;
  /** The commit the run started from, or null when no phase noted one. */
  readonly baseRef: string | null;
  /** The run's branch, holding every phase's commits. */
  readonly runBranch: string;
  /** The git commands the session may run, read only. */
  readonly gitCommands: readonly string[];
}

function idList(ids: readonly string[]): string {
  return ids.map((id) => `\`${id}\``).join(", ");
}

export function buildCompliancePrompt(input: BuildCompliancePromptInput): string {
  const {
    planMd,
    reconciliationMd,
    phases,
    phaseHandoffs,
    reviewedPhases,
    worktreePath,
    baseRef,
    runBranch,
    gitCommands,
  } = input;

  const reviewedPhasesSection =
    reviewedPhases.length === 0
      ? ""
      : [
          "## Reviewed phases",
          "",
          "A person reviewed and corrected these phases at a stop. Judge their review corrections",
          "against the interactive handoff shown here, never as deviations from the plan.",
          "",
          ...reviewedPhases.flatMap((r) => [
            `### Phase ${r.phaseId} (${r.cause} stop)`,
            "",
            r.handoffMd,
            "",
          ]),
        ].join("\n");

  const phaseHandoffsSection =
    phaseHandoffs.length === 0
      ? ""
      : [
          "## Phase handoffs",
          "",
          ...phaseHandoffs.flatMap((h) => [`### Phase ${h.phaseId} handoff`, "", h.handoffMd, ""]),
        ].join("\n");

  const stopInstruction = (phaseId: string): string => {
    const reviewed = reviewedPhases.find((r) => r.phaseId === phaseId);
    return reviewed === undefined
      ? ""
      : `\nA person corrected this phase at a ${reviewed.cause} stop: judge its review corrections against its interactive handoff under Reviewed phases, not as plan deviations.`;
  };

  const perPhaseInstructions = phases
    .map(
      (p) =>
        `### Phase ${p.id} — "${p.title}"\n` +
        `Judge this phase against its plan section across these dimensions:\n` +
        `- **objective**: Was the phase objective delivered as specified?\n` +
        `- **excluded-scope**: Was the "Excluded scope" respected (no scope creep)?\n` +
        `- **files**: Were planned file deviations justified in the phase's phase-handoff.md?\n` +
        `- **tests**: Are the promised tests from "Test strategy" present at the stated layer?\n` +
        `- **boundaries**: Were the declared "Boundary contracts" respected?\n` +
        `- **commit**: Does the actual commit subject/body match the planned commit?\n` +
        `- **handoff**: Does the inlined phase-handoff.md for this phase, shown above, cover the required handoff content?` +
        stopInstruction(p.id),
    )
    .join("\n\n");

  return [
    "# Plan-compliance review",
    "",
    "You are an independent plan-compliance reviewer for a phax multi-phase development run.",
    "Your sole task is to judge whether what was actually built matches the approved plan.",
    "This is NOT a code review and NOT a gate — it is advisory only.",
    "",
    "## Ground rules",
    "",
    "1. **Conformance only.** Judge only plan-vs-execution. Do not evaluate code quality,",
    "   correctness, or style. If you incidentally notice something broken while reading code,",
    '   record it as a *pointer* under `"pointers"` ("possible bug at X — confirm via code review")',
    "   and nowhere else — outside the verdict, not influencing it.",
    "2. **Trust the reconciliation.** The global file reconciliation below is the authoritative",
    "   file-level fact source (planned vs unplanned/missing/extra-touched). Do not recompute",
    "   diffs — spend your reasoning on the semantic judgments listed above.",
    "3. **Read only.** You write no file and edit nothing. You can read files, and run only these",
    `   read-only git commands: ${idList(gitCommands)}.`,
    "4. **Fresh perspective.** You have no memory of the execution session.",
    "",
    "## Worktree path (for code inspection)",
    "",
    worktreePath,
    "",
    "## The change",
    "",
    baseRef === null
      ? `The run's branch is \`${runBranch}\`; no base commit was noted.`
      : `The run's branch is \`${runBranch}\`, started from \`${baseRef}\`: \`git diff ${baseRef}..HEAD\` is the whole change and \`git log ${baseRef}..HEAD\` lists its commits.`,
    "",
    "## Plan",
    "",
    planMd,
    "",
    "## Global file reconciliation (authoritative — do not recompute)",
    "",
    reconciliationMd,
    "",
    phaseHandoffsSection,
    "",
    ...(reviewedPhasesSection === "" ? [] : [reviewedPhasesSection, ""]),
    "## Per-phase review instructions",
    "",
    perPhaseInstructions,
    "",
    "## Roll-up",
    "",
    "After reviewing all phases, produce a run-level verdict:",
    "- `conformant` — all phases conform; no deviations.",
    "- `conformant-with-deviations` — deviations present but all justified.",
    "- `divergent` — one or more phases have unjustified or significant deviations.",
    "",
    "## Verdict enum reference",
    "",
    "- Run-level and phase-level verdict: `conformant` | `conformant-with-deviations` | `divergent`",
    "- Finding severity: `info` | `deviation` | `concern`",
    "- Finding dimension: `objective` | `excluded-scope` | `files` | `tests` | `boundaries` | `commit` | `handoff`",
    "",
    "## Answer",
    "",
    "Your final message is your answer: one JSON object alone, with no code fence and no commentary,",
    "valid against this JSON Schema, with every key required and no other key:",
    "",
    "```json",
    JSON.stringify(answerJsonSchema("compliance-review"), null, 2),
    "```",
    "",
    `- \`perPhase\` names each of these phase ids exactly once, in any order: ${idList(phases.map((p) => p.id))}.`,
    "- `unplannedChanges` are the files touched beyond the plan (read them from the reconciliation),",
    "  each with its `phaseId`, the `path` and a `note`. A file that several phases touched is one",
    "  entry per phase that touched it, each with that phase's `phaseId`.",
    "- `unmetPromises` are the tests or artifacts the plan promised and you did not find, each with",
    "  its `phaseId`, the `promise` and a `note`.",
    "- Either ledger may be `[]`: an empty list says there was none.",
  ].join("\n");
}
