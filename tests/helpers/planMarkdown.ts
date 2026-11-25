/**
 * A made-up plan.md for a test plan: its `## Gate profile` declaration when
 * the plan's run names one, then one `## <id> — <title> {#anchor}` section per
 * phase, so the run preflight's phase-sections check locates every phase.
 */
interface PlanMdInput {
  readonly run: { readonly title: string; readonly gateProfile?: string };
  readonly phases: readonly {
    readonly id: string;
    readonly title: string;
    readonly planMarkdownAnchor: string;
  }[];
}

export function planMdFor(plan: PlanMdInput): string {
  const { gateProfile } = plan.run;
  const declaration =
    gateProfile === undefined ? [] : ["## Gate profile", "", `\`${gateProfile}\``, ""];
  const lines = [
    `# ${plan.run.title}`,
    "",
    ...declaration,
    "## Required commands",
    "",
    "- (none)",
    "",
  ];
  for (const phase of plan.phases) {
    const anchor = phase.planMarkdownAnchor.replace(/^#/, "");
    lines.push(`## ${phase.id} — ${phase.title} {#${anchor}}`, "");
    lines.push(`Carry out ${phase.id}'s made-up instructions.`, "");
  }
  return lines.join("\n");
}
