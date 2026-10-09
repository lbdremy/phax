/**
 * Names the gate report saved next to a gate attempt log, mirroring
 * `requestPathFor`: the trailing `.log` is replaced with `.report-SS.json`,
 * where `SS` is the step's 1-based position, in two digits, among the steps
 * the attempt runs (`checks-attempt-01.log`, step 2 →
 * `checks-attempt-01.report-02.json`). A path that does not end in `.log`
 * simply gets `.report-SS.json` appended.
 */
export function reportPathFor(attemptLogPath: string, step: number): string {
  const base = attemptLogPath.endsWith(".log")
    ? attemptLogPath.slice(0, -".log".length)
    : attemptLogPath;
  return `${base}.report-${String(step).padStart(2, "0")}.json`;
}

/**
 * The attempt and step numbers of a saved gate report's file name
 * (`checks-attempt-NN.report-SS.json`, two or more digits each), or undefined
 * for any other name.
 */
export function parseReportName(
  name: string,
): { readonly attempt: number; readonly step: number } | undefined {
  const match = /^checks-attempt-(\d{2,})\.report-(\d{2,})\.json$/.exec(name);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return { attempt: Number(match[1]), step: Number(match[2]) };
}
