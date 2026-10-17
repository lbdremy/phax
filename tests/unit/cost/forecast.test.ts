// The forward play through made-up windows: pauses at the five-hour and the
// seven-day limits, and the verdict from the P50 and P90 scenarios.
import { describe, expect, it } from "vitest";
import { playForward, verdictOf, WINDOW_MS } from "../../../src/domain/cost/forecast.js";
import { DAY_MS, HOUR_MS, NOW_MS } from "../../helpers/costHistory.js";

// $50 per five-hour window at 38 %: $31 left, resetting in 3 hours.
const fiveHour = { utilization: 38, resetsAtMs: NOW_MS + 3 * HOUR_MS };
const sevenDay = { utilization: 20, resetsAtMs: NOW_MS + 4 * DAY_MS };
const capacity = { fiveHourUsd: 50, sevenDayUsd: 1000 };

const play = (costs: number[]) =>
  playForward({
    phaseCosts: costs.map((usd, i) => ({ phase: `phase-0${i + 1}`, usd })),
    burnUsdPerHour: 30,
    fiveHour,
    sevenDay,
    capacity,
    nowMs: NOW_MS,
  });

describe("playForward", () => {
  it("pauses a $39 scenario at the five-hour limit, naming the phase and the reset", () => {
    const p90 = play([20, 19]);
    // $31 at $30/h: the window runs out 1.0333 h in, during phase-02.
    expect(p90.pauses).toEqual([
      {
        phase: "phase-02",
        window: "five-hour",
        atMs: expect.closeTo(NOW_MS + (31 / 30) * HOUR_MS, 3),
        resumesAtMs: fiveHour.resetsAtMs,
      },
    ]);
    // $8 left after the reset: 16 minutes.
    expect(p90.endsAtMs).toBeCloseTo(fiveHour.resetsAtMs + (8 / 30) * HOUR_MS, 3);
  });

  it("gives risky for P50 $27 and P90 $39 with $31 left, fits under $31 and wait over it", () => {
    const p50 = play([15, 12]);
    const p90 = play([20, 19]);
    expect(p50.pauses).toEqual([]);
    expect(p50.endsAtMs).toBeCloseTo(NOW_MS + (27 / 30) * HOUR_MS, 3);
    expect(verdictOf(p50, p90)).toBe("risky");
    expect(verdictOf(play([10]), play([30]))).toBe("fits");
    expect(verdictOf(play([32]), play([40]))).toBe("wait");
  });

  it("opens the five-hour window again at its reset without a pause when there is room", () => {
    const slow = playForward({
      phaseCosts: [{ phase: "phase-01", usd: 40 }],
      burnUsdPerHour: 5,
      fiveHour: { utilization: 0, resetsAtMs: NOW_MS + HOUR_MS },
      sevenDay,
      capacity,
      nowMs: NOW_MS,
    });
    // $5 before the reset, then a fresh $50 window: 8 hours of agent time.
    expect(slow.pauses).toEqual([]);
    expect(slow.endsAtMs).toBeCloseTo(NOW_MS + 8 * HOUR_MS, 3);
  });

  it("pauses until the seven-day reset when the seven-day window runs out", () => {
    const sevenDayReset = NOW_MS + 2 * DAY_MS;
    const result = playForward({
      phaseCosts: [{ phase: "phase-03", usd: 30 }],
      burnUsdPerHour: 30,
      fiveHour: { utilization: 0, resetsAtMs: NOW_MS + 5 * HOUR_MS },
      sevenDay: { utilization: 98, resetsAtMs: sevenDayReset },
      capacity: { fiveHourUsd: 100, sevenDayUsd: 500 },
      nowMs: NOW_MS,
    });
    // $10 of seven-day room, then a pause until the weekly reset.
    expect(result.pauses).toEqual([
      {
        phase: "phase-03",
        window: "seven-day",
        atMs: expect.closeTo(NOW_MS + (10 / 30) * HOUR_MS, 3),
        resumesAtMs: sevenDayReset,
      },
    ]);
    expect(result.endsAtMs).toBeCloseTo(sevenDayReset + (20 / 30) * HOUR_MS, 3);
    expect(WINDOW_MS["seven-day"]).toBe(7 * DAY_MS);
  });
});
