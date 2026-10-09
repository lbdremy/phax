import type { ReportLocation, ReportRelatedLocation } from "../schemas/report.js";

/**
 * A report location as the fix prompt, the pushed brief and `phax brief`
 * print it: `file`, `file:N` when the lines start and end on one line, or
 * `file:N-M`.
 */
export function renderReportLocation(location: ReportLocation | ReportRelatedLocation): string {
  if (location.lines === null) return location.file;
  const [start, end] = location.lines;
  return start === end ? `${location.file}:${start}` : `${location.file}:${start}-${end}`;
}
