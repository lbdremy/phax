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
  // The review-stop document a close parks in the phase folder.
  "review-stop.closing.json",
]);

const STOP_PATTERNS: readonly RegExp[] = [
  // The folders that keep a refused turn's versions.
  /^refused-turn-\d{2}$/,
  // A first or closing turn's streams, with their corrective retry.
  /^(first|closing)-turn-\d{2}(-retry)?\.jsonl$/,
  // The person's handoff file as it stood before a turn.
  /^(first|closing)-turn-\d{2}-correction-handoff\.md$/,
];

/** Whether `name`, an entry of a phase folder, is one of a stop's files. */
export function isStopArtifact(name: string): boolean {
  return STOP_FILES.has(name) || STOP_PATTERNS.some((pattern) => pattern.test(name));
}
