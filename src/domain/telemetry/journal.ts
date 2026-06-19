const JOURNAL_FILE_RE = /^telemetry-(\d{4}-\d{2}-\d{2})\.jsonl$/;

export function dailyJournalFileName(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `telemetry-${y}-${m}-${d}.jsonl`;
}

export function journalFilesToPrune(
  existingNames: readonly string[],
  today: Date,
  retentionDays: number,
): readonly string[] {
  // Normalize cutoff to UTC midnight so boundary-day files are kept.
  const cutoff = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - retentionDays),
  );

  return existingNames.filter((name) => {
    const match = JOURNAL_FILE_RE.exec(name);
    if (match === null || match[1] === undefined) return false;
    const fileDate = new Date(match[1] + "T00:00:00Z");
    return fileDate < cutoff;
  });
}
