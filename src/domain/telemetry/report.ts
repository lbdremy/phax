export interface ReportMetadata {
  readonly phaxVersion: string;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly source: string; // e.g. "run: my-run" or "global: 2026-06-19"
}

export const BODY_THRESHOLD_BYTES = 32 * 1024;
export const TAIL_SIZE = 50;

export function buildReportTitle(metadata: ReportMetadata): string {
  return `phax telemetry report: ${metadata.source}`;
}

export function buildFullLog(records: readonly string[]): string {
  return records.join("\n");
}

export function needsGist(fullLog: string): boolean {
  return Buffer.byteLength(fullLog, "utf8") > BODY_THRESHOLD_BYTES;
}

export function buildReportBody(
  metadata: ReportMetadata,
  records: readonly string[],
  gistUrl?: string,
): string {
  const tail = records.slice(-TAIL_SIZE);
  const tailSection =
    tail.length > 0 ? "```json\n" + tail.join("\n") + "\n```" : "(no events recorded)";

  let fullLogSection: string;
  if (gistUrl !== undefined) {
    fullLogSection = `Full log: ${gistUrl}`;
  } else {
    const full = buildFullLog(records);
    fullLogSection =
      full.length > 0
        ? "<details>\n<summary>Full log (" +
          String(records.length) +
          " records)</summary>\n\n```json\n" +
          full +
          "\n```\n</details>"
        : "(empty)";
  }

  return [
    "## Environment",
    "",
    "| Field | Value |",
    "|---|---|",
    `| phax version | ${metadata.phaxVersion} |`,
    `| node version | ${metadata.nodeVersion} |`,
    `| platform | ${metadata.platform}/${metadata.arch} |`,
    `| source | ${metadata.source} |`,
    "",
    `## Recent events (last ${String(TAIL_SIZE)})`,
    "",
    tailSection,
    "",
    "## Full log",
    "",
    fullLogSection,
  ].join("\n");
}
