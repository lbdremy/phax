/**
 * Names the diagnostics document persisted next to a gate attempt log.
 *
 * A diagnostic step's failing document is written beside its attempt log so it
 * rides the run record. The naming mirrors the log: the trailing `.log` is
 * replaced with `.diagnostics.json`
 * (`checks-attempt-01.log` → `checks-attempt-01.diagnostics.json`). A path that
 * does not end in `.log` simply gets `.diagnostics.json` appended.
 */
export function diagnosticsPathFor(attemptLogPath: string): string {
  const base = attemptLogPath.endsWith(".log")
    ? attemptLogPath.slice(0, -".log".length)
    : attemptLogPath;
  return `${base}.diagnostics.json`;
}
