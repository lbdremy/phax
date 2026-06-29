export const ADJUST_PLAN_PROMPT_FILENAME = "adjust-plan-prompt.md";

function formatList(paths: readonly string[]): string {
  return paths.length === 0 ? "  (none)" : paths.map((p) => `  - ${p}`).join("\n");
}

export interface AdjustPlanPromptInput {
  readonly planPath: string;
  readonly planMarkdown: string;
  readonly landedLabel: string;
  readonly landedChanges: {
    readonly added: readonly string[];
    readonly modified: readonly string[];
    readonly deletedOrRenamed: readonly string[];
  };
  readonly impact?: {
    readonly shared: ReadonlyArray<{ path: string; severity: string; reason: string }>;
    readonly severity: string;
  };
}

export function buildAdjustPlanPrompt(input: AdjustPlanPromptInput): string {
  const { planPath, planMarkdown, landedLabel, landedChanges, impact } = input;

  const impactSection = impact
    ? `
## Deterministic impact (shared files)

Severity: **${impact.severity}**

The following files are shared between the landed run and the target plan:

${impact.shared.map((f) => `- \`${f.path}\` — ${f.severity}: ${f.reason}`).join("\n")}

Use this as your starting point when establishing drift.
`
    : "";

  return `# Plan Adjustment Session

> **This is an interactive session, not a gate.** Nothing will be applied without
> your explicit approval. Do not propose or change anything until you have
> established the drift and received approval.

## Session purpose

You are helping the developer adjust the plan at \`${planPath}\` in light of
the actual changes made by the **${landedLabel}** run. The developer will drive
this session; you ask questions, propose changes, and wait for approval before
making any edits.

## Landed run: actual changes from **${landedLabel}**

These are the real files the run touched (from its persisted reconciliation):

**Added:**
${formatList(landedChanges.added)}

**Modified:**
${formatList(landedChanges.modified)}

**Deleted or renamed:**
${formatList(landedChanges.deletedOrRenamed)}
${impactSection}
## Your instructions

### Step 1 — Establish the drift

Read the target plan below carefully. Identify which of the plan's declared
\`Planned files to create/edit\`, line-number references, and decisions are
invalidated, moved, or made stale by the landed run's actual changes listed above.
${impact ? "Start from the deterministic shared-file list above." : ""}

Summarise the drift you find before proposing anything.

### Step 2 — Ask clarifying questions

Where a judgment call is needed before proposing a concrete edit, ask the developer.
Do not assume intent. Wait for answers before proceeding to Step 3.

### Step 3 — Propose concrete edits

Propose the specific changes to \`${planPath}\`. For each change, declare:
- What is being changed and why (which landed change drives it).
- The impact of the proposed edit on downstream phases or other plans.

Present the full proposed diff or updated sections so the developer can review them.

### Step 4 — Wait for explicit approval

Do **not** apply any change until the developer explicitly approves. If the developer
asks for adjustments to the proposal, revise and present again. Repeat until approval
is given.

### Step 5 — Apply only after approval

Only after the developer gives explicit approval:
1. Edit \`${planPath}\` with the approved changes.
2. Commit the changes with a clear conventional-commit message that describes what
   was adjusted and why (referencing the landed run).

Do not pre-emptively make any edit or commit.

---

## Target plan: \`${planPath}\`

${planMarkdown}
`;
}

export function buildAdjustPlanPositionalPrompt(promptFilePath: string): string {
  return `Read \`${promptFilePath}\` and begin the plan adjustment it describes. Do not propose or change anything until you have read it.`;
}
