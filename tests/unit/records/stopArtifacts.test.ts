import { describe, expect, it } from "vitest";
import { isStopArtifact } from "../../../src/domain/records/stopArtifacts.js";

// Every name a stop writes into a phase folder (interactiveFiles.ts,
// interactiveStop.ts, closeStop.ts and the effect runner's parked review
// stop), and the names of the agent's own work beside them.

describe("isStopArtifact", () => {
  it.each([
    "review-seed.md",
    "first-reading.md",
    "interactive-session.json",
    "correction-handoff.md",
    "correction-reconciliation.json",
    "correction-reconciliation.md",
    "review-diff.patch",
    "review-gate",
    "review-stop.closing.json",
    "refused-turn-01",
    "refused-turn-12",
    "first-turn-01.jsonl",
    "first-turn-02-retry.jsonl",
    "closing-turn-01.jsonl",
    "closing-turn-03-retry.jsonl",
    "first-turn-01-correction-handoff.md",
    "closing-turn-02-correction-handoff.md",
  ])("recognises %s as a stop's file", (name) => {
    expect(isStopArtifact(name)).toBe(true);
  });

  it.each([
    "output.jsonl",
    "phase-handoff.md",
    "diff.patch",
    "gate-attribution.json",
    "checks-attempt-01.log",
    "file-reconciliation.json",
    "file-reconciliation.md",
    "status.json",
    "prompt.md",
    "agent-binding.json",
    "retry-output.jsonl",
    // Near misses: a stop's names are matched exactly.
    "refused-turn-1",
    "closing-turn-01.log",
    "first-turn-01-retry-correction-handoff.md",
    "review-gate.log",
  ])("keeps %s as the phase's own", (name) => {
    expect(isStopArtifact(name)).toBe(false);
  });
});
