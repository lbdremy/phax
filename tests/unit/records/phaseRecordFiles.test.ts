import { describe, expect, it } from "vitest";
import {
  isPhaseRecordFile,
  isTranscriptClassFile,
} from "../../../src/domain/records/phaseRecordFiles.js";

// Every name phax writes into a phase folder, classified as the spec's §4 and
// the phase-folder inventory say. "never" names are carried by no record.
type Kind = "transcript" | "carried" | "never";

const TABLE: readonly (readonly [string, Kind])[] = [
  // Transcript-class: exactly the spec's §4 list.
  ["output.jsonl", "transcript"],
  ["fix-attempt-01.jsonl", "transcript"],
  ["fix-attempt-123.jsonl", "transcript"],
  ["handoff-generation.jsonl", "transcript"],
  ["checks-attempt-01.log", "transcript"],
  ["checks-attempt-12.log", "transcript"],
  ["setup.log", "transcript"],
  ["agent-error.log", "transcript"],
  ["agent-error.failed-01.log", "transcript"],
  // Carried by both shapes.
  ["prompt.md", "carried"],
  ["status.json", "carried"],
  ["security.json", "carried"],
  ["model-resolution.json", "carried"],
  ["agent-binding.json", "carried"],
  ["claude-session-id.txt", "carried"],
  ["diff.patch", "carried"],
  ["file-reconciliation.json", "carried"],
  ["file-reconciliation.md", "carried"],
  ["gate-attribution.json", "carried"],
  ["phase-handoff.md", "carried"],
  ["brief-00.json", "carried"],
  ["brief-01.json", "carried"],
  ["checks-attempt-01.request.json", "carried"],
  ["checks-attempt-01.acceptance-request.json", "carried"],
  ["checks-attempt-01.oracle-request.json", "carried"],
  ["checks-attempt-01.attribution.json", "carried"],
  ["checks-attempt-01.report-02.json", "carried"],
  // Never carried: stop files, Vibe export directories, archived transcripts,
  // and anything else.
  ["output.failed-01.jsonl", "never"],
  ["fix-attempt-01.failed-01.jsonl", "never"],
  ["output.vibe-export", "never"],
  ["fix-attempt-01.vibe-export", "never"],
  ["review-seed.md", "never"],
  ["first-reading.md", "never"],
  ["interactive-session.json", "never"],
  ["interactive-transcripts", "never"],
  ["correction-handoff.md", "never"],
  ["correction-reconciliation.json", "never"],
  ["review-diff.patch", "never"],
  ["review-gate", "never"],
  ["review-stop.closing.json", "never"],
  ["first-turn-01.jsonl", "never"],
  ["refused-turn-01", "never"],
  ["retry-output.jsonl", "never"],
  ["notes.txt", "never"],
  ["checks-attempt-1.log", "never"],
  ["fix-attempt-01.log", "never"],
  ["brief-request.json", "never"],
  ["summary.md", "never"],
];

describe("phase record allowlist", () => {
  it.each(TABLE)("classifies %s as %s", (name, kind) => {
    expect(isPhaseRecordFile(name)).toBe(kind !== "never");
    expect(isTranscriptClassFile(name)).toBe(kind === "transcript");
  });
});
