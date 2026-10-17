// The §10 yardstick on a made-up history: 30 runs of 4 phases over 120 days
// from a known log-linear model with log-normal noise (σ 0.35). Fitted
// without the 6 most recent runs, the run P50 is within ×1.35 of the actual
// cost at the median over those held-out runs.
import { describe, expect, it } from "vitest";
import { estimatePlan } from "../../../src/domain/cost/estimate.js";
import { generateHistory, NOW_MS } from "../../helpers/costHistory.js";

const HELD_OUT = 6;

/** The median, over the held-out runs, of max(P50/actual, actual/P50). */
function heldOutMedianError(seed: number): number {
  const runs = generateHistory({ runs: 30, phasesPerRun: 4, seed, sigma: 0.35, spanDays: 120 });
  const training = runs.slice(0, runs.length - HELD_OUT);
  const errors = runs.slice(runs.length - HELD_OUT).map((run) => {
    const report = estimatePlan({
      phases: run.sized.phases.map((phase) => ({ ...phase, provider: "claude-code" })),
      ledgers: training.map((t) => t.source),
      sizedRuns: training.map((t) => t.sized),
      unledgeredRuns: 0,
      compliance: { kind: "disabled" },
      windows: { kind: "no-subscription" },
      nowMs: NOW_MS,
    });
    if (report.run === null) throw new Error("expected a run estimate");
    return Math.max(report.run.p50 / run.actualUsd, run.actualUsd / report.run.p50);
  });
  errors.sort((a, b) => a - b);
  return (errors[HELD_OUT / 2 - 1]! + errors[HELD_OUT / 2]!) / 2;
}

describe("backtest", () => {
  it("holds the held-out run-level median error within ×1.35", () => {
    // Measured 1.23 at seed 1.
    expect(heldOutMedianError(1)).toBeLessThanOrEqual(1.35);
  });
});
