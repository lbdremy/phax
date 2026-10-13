import { describe, expect, it } from "vitest";
import { LIVE_RUN_PHASES, liveRun, type LiveRunLine } from "../../../site/build/liveRun.js";

const lines = liveRun();

function transitions(phase?: string): ReadonlyArray<LiveRunLine> {
  return lines.filter(
    (line) => line.kind === "state.transition" && (phase === undefined || line.phase === phase),
  );
}

describe("the home's live run", () => {
  it("walks the golden path in order, from the spec to the pull request", () => {
    const stages = lines.map((line) => line.stage);
    expect([...new Set(stages)]).toEqual(["spec", "plan", "run", "review", "pr"]);
    expect(stages).toEqual(
      stages.toSorted(
        (left, right) =>
          ["spec", "plan", "run", "review", "pr"].indexOf(left) -
          ["spec", "plan", "run", "review", "pr"].indexOf(right),
      ),
    );
  });

  it("chains every run transition from the state the previous one left", () => {
    const run = transitions();
    expect(run[0]).toMatchObject({ label: "RunStarted", before: "created" });
    for (const [index, line] of run.entries()) {
      if (index > 0) expect(line.before, line.label).toBe(run[index - 1]?.after);
    }
    expect(run.at(-1)).toMatchObject({
      label: "FinalReviewOpened",
      after: "review_open:review_open",
    });
  });

  it("fails the second phase's first gate and fixes it before the gate passes", () => {
    expect(transitions("phase-02").map((line) => line.label)).toEqual([
      "PhaseStartRequested",
      "WorktreeCreated",
      "GateFailed",
      "FixStarted",
      "FixCompleted",
      "GatePassed",
      "CommitCreated",
      "CleanupStarted",
      "CleanupCompleted",
    ]);
    expect(lines.filter((line) => line.failed === true).map((line) => line.kind)).toEqual([
      "gate.evaluated",
      "state.transition",
    ]);
  });

  it("commits every phase and completes the plan and the spec before the review opens", () => {
    for (const phase of LIVE_RUN_PHASES) {
      expect(
        transitions(phase).some((line) => line.label === "CommitCreated"),
        phase,
      ).toBe(true);
    }
    const completions = lines.filter(
      (line) => line.kind === "artifact" && line.after === "Completed",
    );
    expect(completions.map((line) => line.label)).toEqual(["plan greet", "spec greet"]);
    const review = lines.findIndex((line) => line.label === "FinalReviewOpened");
    for (const line of completions) expect(lines.indexOf(line)).toBeLessThan(review);
  });
});
