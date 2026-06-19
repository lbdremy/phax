import { describe, expect, it } from "vitest";
import {
  dailyJournalFileName,
  journalFilesToPrune,
} from "../../../src/domain/telemetry/journal.js";

describe("dailyJournalFileName", () => {
  it("formats a date as telemetry-YYYY-MM-DD.jsonl using UTC", () => {
    const date = new Date("2025-06-19T23:59:59.000Z");
    expect(dailyJournalFileName(date)).toBe("telemetry-2025-06-19.jsonl");
  });

  it("pads single-digit month and day", () => {
    const date = new Date("2025-01-05T00:00:00.000Z");
    expect(dailyJournalFileName(date)).toBe("telemetry-2025-01-05.jsonl");
  });

  it("uses UTC date, not local time", () => {
    // midnight UTC is still the previous day in UTC-12
    const date = new Date("2025-06-20T00:00:00.000Z");
    expect(dailyJournalFileName(date)).toBe("telemetry-2025-06-20.jsonl");
  });
});

describe("journalFilesToPrune", () => {
  const today = new Date("2025-06-19T12:00:00.000Z");

  it("returns files older than retentionDays", () => {
    const names = [
      "telemetry-2025-06-11.jsonl", // 8 days old — prune
      "telemetry-2025-06-12.jsonl", // 7 days old — boundary: keep (cutoff is < not <=)
      "telemetry-2025-06-13.jsonl", // 6 days old — keep
      "telemetry-2025-06-19.jsonl", // today — keep
    ];
    const result = journalFilesToPrune(names, today, 7);
    expect(result).toEqual(["telemetry-2025-06-11.jsonl"]);
  });

  it("ignores non-matching filenames", () => {
    const names = [
      "telemetry.json",
      "providers.json",
      "other-2025-01-01.jsonl",
      "telemetry-2025-06-01.jsonl", // old — prune
    ];
    const result = journalFilesToPrune(names, today, 7);
    expect(result).toEqual(["telemetry-2025-06-01.jsonl"]);
  });

  it("returns empty array when all files are within retention window", () => {
    const names = ["telemetry-2025-06-18.jsonl", "telemetry-2025-06-19.jsonl"];
    const result = journalFilesToPrune(names, today, 7);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when names list is empty", () => {
    expect(journalFilesToPrune([], today, 7)).toHaveLength(0);
  });

  it("handles boundary exactly: file at cutoff date is kept", () => {
    // today=2025-06-19, retention=7 → cutoff=2025-06-12T00:00:00Z
    // file on 2025-06-12 is NOT older than cutoff (equal is not older), so kept
    const names = ["telemetry-2025-06-12.jsonl"];
    const result = journalFilesToPrune(names, today, 7);
    expect(result).toHaveLength(0);
  });
});
