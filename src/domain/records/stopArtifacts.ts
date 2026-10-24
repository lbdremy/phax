// The files a stop writes into a phase folder: its seed, sessions, turns,
// correction handoff and reconciliation, review diff and gate. None is the
// agent's work, so a phase record never carries one.

const STOP_FILES: ReadonlySet<string> = new Set([
  "review-seed.md",
  "first-reading.md",
  "interactive-session.json",
  "correction-handoff.md",
  "correction-reconciliation.json",
  "correction-reconciliation.md",
  "review-diff.patch",
  "review-gate",
  // The copies of the stop's sessions' transcripts: never in a record, whatever
  // `records.transcript` says, since a continued session ran outside phax's
  // enforcement and may hold what the person typed.
  "interactive-transcripts",
  // The review-stop document a close parks in the phase folder.
  "review-stop.closing.json",
]);

/**
 * A first or closing turn's stream, with its corrective retry. Group 1 is the
 * kind, group 2 the turn number, group 3 the retry suffix.
 */
export const TURN_STREAM_PATTERN = /^(first|closing)-turn-(\d{2})(-retry)?\.jsonl$/;

const STOP_PATTERNS: readonly RegExp[] = [
  // The folders that keep a refused turn's versions.
  /^refused-turn-\d{2}$/,
  TURN_STREAM_PATTERN,
  // The person's handoff file as it stood before a turn.
  /^(first|closing)-turn-\d{2}-correction-handoff\.md$/,
];

/** Whether `name`, an entry of a phase folder, is one of a stop's files. */
export function isStopArtifact(name: string): boolean {
  return STOP_FILES.has(name) || STOP_PATTERNS.some((pattern) => pattern.test(name));
}
