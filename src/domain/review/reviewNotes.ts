import type { ReviewNote } from "../../schemas/gateReport.js";

/** The review notes one phase's last gate attempt left, in report order. */
export interface PhaseReviewNotes {
  readonly phaseId: string;
  readonly notes: ReadonlyArray<ReviewNote>;
}

/** One distinct note text of an owner, with every phase that reported it. */
interface GatheredReviewNote {
  readonly note: string;
  readonly phaseIds: ReadonlyArray<string>;
}

/** Every distinct note of one owner. */
export interface ReviewNoteGroup {
  readonly owner: string;
  readonly notes: ReadonlyArray<GatheredReviewNote>;
}

/**
 * Groups the phases' review notes by owner. Owners come in first-seen order
 * (phase order, then the report's order). Within an owner, each distinct
 * note text is listed once, at its first sighting, with every phase that
 * reported it, in phase order.
 */
export function gatherReviewNotes(
  phases: ReadonlyArray<PhaseReviewNotes>,
): ReadonlyArray<ReviewNoteGroup> {
  const owners = new Map<string, Map<string, string[]>>();
  for (const { phaseId, notes } of phases) {
    for (const { owner, note } of notes) {
      let byNote = owners.get(owner);
      if (byNote === undefined) {
        byNote = new Map();
        owners.set(owner, byNote);
      }
      const phaseIds = byNote.get(note);
      if (phaseIds === undefined) byNote.set(note, [phaseId]);
      else if (!phaseIds.includes(phaseId)) phaseIds.push(phaseId);
    }
  }
  return [...owners].map(([owner, byNote]) => ({
    owner,
    notes: [...byNote].map(([note, phaseIds]) => ({ note, phaseIds })),
  }));
}

/**
 * The review handoff's `## Review notes` section, or undefined when there is
 * no note: an intro, then one `### <owner>` list per owner.
 */
export function renderReviewNotes(groups: ReadonlyArray<ReviewNoteGroup>): string | undefined {
  if (groups.length === 0) return undefined;
  const sections = groups.map(
    ({ owner, notes }) =>
      `### ${owner}\n\n${notes.map(({ note, phaseIds }) => `- ${note} (${phaseIds.join(", ")})`).join("\n")}`,
  );
  return [
    "## Review notes",
    "Notes the gate steps left for a person. None was sent to the agent.",
    ...sections,
  ].join("\n\n");
}
