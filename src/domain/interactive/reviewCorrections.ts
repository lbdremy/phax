// The `## Review corrections` section of a later phase's prompt: the
// interactive handoff of every closed stop before it. Pure.

export interface ReviewCorrectionStop {
  readonly phaseId: string;
  /** The stop's interactive handoff, verbatim. */
  readonly handoff: string;
  /** The files the review changed, from the stop's reconciliation. */
  readonly changedFiles: readonly string[];
}

function joinNames(ids: readonly string[]): string {
  if (ids.length <= 1) return ids.join("");
  return `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1] ?? ""}`;
}

/**
 * The section for the closed `stops`, in plan order, or null when there are
 * none (so the prompts of plans without a stop stay byte-identical). It says
 * that it wins over earlier handoffs where they disagree and that the
 * phase's own plan section still binds.
 */
export function renderReviewCorrectionsSection(
  stops: readonly ReviewCorrectionStop[],
): string | null {
  if (stops.length === 0) return null;
  return [
    "## Review corrections",
    "",
    `A person reviewed and corrected the run at ${joinNames(stops.map((s) => s.phaseId))}. Where this section disagrees with an earlier phase's handoff, this section wins. Your own plan section still binds.`,
    "",
    ...stops.flatMap((stop) => [
      `### ${stop.phaseId} (interactive)`,
      "",
      stop.handoff.trimEnd(),
      "",
      stop.changedFiles.length === 0
        ? "No file changed."
        : ["Files changed by the review:", ...stop.changedFiles.map((f) => `- ${f}`)].join("\n"),
      "",
    ]),
  ]
    .join("\n")
    .trimEnd();
}
