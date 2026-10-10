/**
 * Numbers a phase's gate attempts from the file names in its phase folder.
 * Every per-attempt file carries its attempt's number, in two or more digits:
 * `checks-attempt-NN.log`, `.request.json`, `.attribution.json` (the step
 * record), `.report-SS.json`, and the fix transcript `fix-attempt-NN.jsonl`.
 * An attempt is recorded when its log exists; one cut short before its log
 * was written is not. The per-phase `gate-attribution.json` carries no number.
 */

const CHECKS_FILE =
  /^checks-attempt-(\d{2,})\.(?:log|request\.json|attribution\.json|report-\d{2,}\.json)$/;
const FIX_TRANSCRIPT = /^fix-attempt-(\d{2,})\.jsonl$/;
const ATTEMPT_LOG = /^checks-attempt-(\d{2,})\.log$/;

/** The attempt number of a per-attempt file name, or undefined for any other name. */
export function attemptNumberOf(name: string): number | undefined {
  const match = CHECKS_FILE.exec(name) ?? FIX_TRANSCRIPT.exec(name);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/**
 * The number of the next gate attempt: one above the highest number on any
 * per-attempt file, so no existing file is ever overwritten, or 1.
 */
export function nextAttemptNumber(names: readonly string[]): number {
  let highest = 0;
  for (const name of names) {
    highest = Math.max(highest, attemptNumberOf(name) ?? 0);
  }
  return highest + 1;
}

/** The numbers of the recorded attempts (those with a log), ascending. */
export function recordedAttempts(names: readonly string[]): readonly number[] {
  return names
    .flatMap((name) => {
      const match = ATTEMPT_LOG.exec(name);
      return match?.[1] === undefined ? [] : [Number(match[1])];
    })
    .toSorted((a, b) => a - b);
}

/** The highest recorded attempt below `attempt`, or undefined when there is none. */
export function previousRecordedAttempt(
  names: readonly string[],
  attempt: number,
): number | undefined {
  return recordedAttempts(names)
    .filter((recorded) => recorded < attempt)
    .at(-1);
}

/** The highest recorded attempt, or undefined when no attempt is recorded. */
export function lastRecordedAttempt(names: readonly string[]): number | undefined {
  return recordedAttempts(names).at(-1);
}

/** An attempt's log name, its number padded to two digits (`checks-attempt-03.log`). */
export function attemptLogName(attempt: number): string {
  return `checks-attempt-${String(attempt).padStart(2, "0")}.log`;
}

/** An attempt's fix transcript name, its number padded to two digits (`fix-attempt-03.jsonl`). */
export function fixTranscriptName(attempt: number): string {
  return `fix-attempt-${String(attempt).padStart(2, "0")}.jsonl`;
}

/**
 * Names the step record saved next to a gate attempt log, mirroring
 * `requestPathFor`: `checks-attempt-01.log` → `checks-attempt-01.attribution.json`.
 * A path that does not end in `.log` simply gets `.attribution.json` appended.
 */
export function stepRecordPathFor(attemptLogPath: string): string {
  const base = attemptLogPath.endsWith(".log")
    ? attemptLogPath.slice(0, -".log".length)
    : attemptLogPath;
  return `${base}.attribution.json`;
}
