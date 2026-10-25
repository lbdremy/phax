import { describe, expect, it } from "vitest";
import { countCompletedPhases } from "../../src/domain/completedPhases.js";
import type { PhaseState } from "../../src/domain/state.js";

// Every PhaseState, and whether a phase in it has committed. The Record type
// makes a new state a compile error here until it is classified.
const COMMITTED: Record<PhaseState, boolean> = {
  pending: false,
  setting_up_worktree: false,
  running: false,
  gates_failed: false,
  gates_exhausted: false,
  fixing: false,
  failed: false,
  passed: false,
  committed: true,
  cleaning_up: true,
  cleaned_up: true,
  review_open: true,
  handoff_failed: true,
  skipped: false,
  rate_limited: false,
  // A declared stop waits here before its close commits.
  awaiting_review: false,
};

describe("countCompletedPhases", () => {
  it.each(Object.entries(COMMITTED) as [PhaseState, boolean][])(
    "a phase in %s counts: %s",
    (state, counts) => {
      expect(countCompletedPhases([{ state }])).toBe(counts ? 1 : 0);
    },
  );

  it("counts every committed phase of a run", () => {
    expect(
      countCompletedPhases([
        { state: "cleaned_up" },
        { state: "skipped" },
        { state: "cleaned_up" },
        { state: "review_open" },
      ]),
    ).toBe(3);
  });

  it("is zero for no phase", () => {
    expect(countCompletedPhases([])).toBe(0);
  });
});
