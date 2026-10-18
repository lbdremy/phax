// The §10 yardstick on a made-up history: 30 runs of 4 phases over 120 days
// from a known log-linear model with log-normal noise (σ 0.35). Fitted
// without the 6 most recent runs, the run P50 is within ×1.35 of the actual
// cost at the median over those held-out runs, and over 10 such histories.
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

const SEEDS = 10;

describe("backtest", () => {
  it("holds the held-out run-level median error within ×1.35, at the median over 10 histories", () => {
    // One history can land past ×1.35 by chance (seeds 4 and 6 do); the median
    // over seeds tests the model, not the draw. Measured 1.18 over seeds 1–10.
    const errors = Array.from({ length: SEEDS }, (_, i) => heldOutMedianError(i + 1));
    errors.sort((a, b) => a - b);
    expect((errors[SEEDS / 2 - 1]! + errors[SEEDS / 2]!) / 2).toBeLessThanOrEqual(1.35);
  });
});
