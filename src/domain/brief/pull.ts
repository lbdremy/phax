/** Where pulled brief records wait in a phase worktree, relative to its root. */
export const PULLED_BRIEFS_DIR = ".phax-context/briefs";

/**
 * The marker, inside `PULLED_BRIEFS_DIR`, saying the phase's briefs are
 * collected: a pull that finds it is answered and not recorded (spec Q7).
 */
export const BRIEFS_CLOSED_MARKER = "closed";

const PULLED_BRIEF_NAME = /^brief-(\d{2,})\.json$/;

/**
 * The name of the next pulled brief record: one past the highest `brief-NN.json`
 * among `existing` (two or more digits), at least `brief-01.json`.
 */
export function nextPulledBriefName(existing: readonly string[]): string {
  let highest = 0;
  for (const name of existing) {
    const match = PULLED_BRIEF_NAME.exec(name);
    if (match?.[1] !== undefined) highest = Math.max(highest, Number(match[1]));
  }
  return `brief-${String(highest + 1).padStart(2, "0")}.json`;
}
