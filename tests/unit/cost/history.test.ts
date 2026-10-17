// What the estimate learns from made-up cost ledgers: training samples,
// the burn rate, the run-level median, the window calibration and the last
// observed windows. Every ledger, run and price is made up.
import { describe, expect, it } from "vitest";
import { priceTokens, referencePrice } from "../../../src/domain/cost/fit.js";
import {
  burnRate,
  calibrateWindows,
  lastObservedWindows,
  runLevelMedian,
  trainingSamples,
} from "../../../src/domain/cost/history.js";
import {
  daysAgo,
  HOUR_MS,
  historicalPhase,
  iso,
  ledger,
  ledgerEntry,
  ledgerSource,
  NOW_MS,
  rateLimitSample,
  sizedRun,
} from "../../helpers/costHistory.js";

describe("trainingSamples", () => {
  it("sums a phase's turn, fixes and handoff across models, and skips a phase under $0.01 or absent", () => {
    const source = ledgerSource("demo.alpha.r1", [
      ledgerEntry({
        role: "phase",
        phase: "phase-01",
        models: {
          "claude-opus-5-5": { inputTokens: 100, outputTokens: 10_000, costUsd: 0.2 },
          "claude-haiku-5-5": { outputTokens: 2000, costUsd: 0.001 },
        },
      }),
      ledgerEntry({
        role: "fix",
        phase: "phase-01",
        tokens: { cacheReadTokens: 500_000, cacheWriteTokens: 20_000 },
        costUsd: 0.26,
      }),
      ledgerEntry({
        role: "handoff",
        phase: "phase-01",
        tokens: { outputTokens: 500 },
        costUsd: 0.01,
      }),
      ledgerEntry({
        role: "phase",
        phase: "phase-02",
        tokens: { outputTokens: 100 },
        costUsd: 0.002,
      }),
      ledgerEntry({ role: "compliance", tokens: { outputTokens: 90_000 }, costUsd: 1.8 }),
    ]);
    const run = sizedRun("demo.alpha.r1", daysAgo(3), [
      historicalPhase({ id: "phase-01", effort: "medium", editBytes: 4000 }),
      historicalPhase({ id: "phase-02" }),
      historicalPhase({ id: "phase-03", model: "gpt-5.5" }),
    ]);
    const samples = trainingSamples([source], [run]);
    expect(samples).toHaveLength(1);
    const [only] = samples;
    expect(only!.tokens).toEqual([100, 12_500, 500_000, 20_000]);
    expect(only!.costUsd).toBeCloseTo(0.471, 9);
    expect(only!.y).toBeCloseTo(
      Math.log(priceTokens([100, 12_500, 500_000, 20_000], referencePrice())),
      12,
    );
    expect(only!.atMs).toBe(Date.parse(daysAgo(3)));
    expect(only!.x.slice(0, 5)).toEqual([1, 1, 0, 0, 0]);
  });

  it("skips a sized run with no ledger of its run key", () => {
    const run = sizedRun("demo.alpha.r9", daysAgo(1), [historicalPhase()]);
    const other = { runKey: "demo.alpha.r8", ledger: ledger([ledgerEntry({ costUsd: 5 })]) };
    expect(trainingSamples([other], [run])).toEqual([]);
  });
});

describe("burnRate", () => {
  it("is cost over agent hours of the complete entries of the last 30 days, ignoring partial entries with agentMs 0", () => {
    const ledgers = [
      ledgerSource("demo.r1", [
        ledgerEntry({ costUsd: 30, agentMs: HOUR_MS, endedAt: daysAgo(2) }),
        ledgerEntry({ costUsd: 10, agentMs: HOUR_MS, endedAt: daysAgo(29) }),
        ledgerEntry({ costUsd: 99, agentMs: 0, completeness: "partial", endedAt: daysAgo(1) }),
        ledgerEntry({ costUsd: 99, agentMs: 0, endedAt: daysAgo(1) }),
        ledgerEntry({ costUsd: 99, agentMs: HOUR_MS, endedAt: daysAgo(31) }),
      ]),
    ];
    expect(burnRate(ledgers, NOW_MS)).toBeCloseTo(20, 12);
  });

  it("is null with no such entry", () => {
    const ledgers = [ledgerSource("demo.r1", [ledgerEntry({ agentMs: 0, endedAt: daysAgo(1) })])];
    expect(burnRate(ledgers, NOW_MS)).toBeNull();
    expect(burnRate([], NOW_MS)).toBeNull();
  });
});

describe("runLevelMedian", () => {
  it("is the sorted value at ⌊n/2⌋ of the compliance sums whose last entry ended in the last 60 days", () => {
    const ledgers = [
      ledgerSource("demo.r1", [
        ledgerEntry({ costUsd: 5 }),
        ledgerEntry({ role: "compliance", costUsd: 1, endedAt: daysAgo(70) }),
        ledgerEntry({ role: "compliance", costUsd: 1.5, endedAt: daysAgo(10) }),
      ]),
      ledgerSource("demo.r2", [
        ledgerEntry({ role: "compliance", costUsd: 4, endedAt: daysAgo(5) }),
      ]),
      ledgerSource("demo.r3", [
        ledgerEntry({ role: "compliance", costUsd: 2, endedAt: daysAgo(20) }),
      ]),
      ledgerSource("demo.r4", [
        ledgerEntry({ role: "compliance", costUsd: 9, endedAt: daysAgo(61) }),
      ]),
      ledgerSource("demo.r5", [ledgerEntry({ costUsd: 7, endedAt: daysAgo(1) })]),
    ];
    // Sums kept: 2.5, 4, 2 → sorted [2, 2.5, 4] → index 1.
    expect(runLevelMedian(ledgers, NOW_MS)).toBe(2.5);
  });

  it("is null when no ledger has a recent compliance entry", () => {
    const ledgers = [
      ledgerSource("demo.r1", [
        ledgerEntry({ role: "compliance", costUsd: 3, endedAt: daysAgo(90) }),
      ]),
    ];
    expect(runLevelMedian(ledgers, NOW_MS)).toBeNull();
  });
});

describe("calibrateWindows", () => {
  const recentReset = iso(NOW_MS - 3 * 24 * HOUR_MS + 2 * HOUR_MS);
  const laterReset = iso(NOW_MS - 2 * 24 * HOUR_MS);
  const oldReset = iso(NOW_MS - 40 * 24 * HOUR_MS);

  it("is $40 per 100 % from the last 28 days, ignoring older samples at $18", () => {
    const ledgers = [
      ledgerSource("demo.recent", [
        ledgerEntry({
          endedAt: daysAgo(3),
          samples: [
            rateLimitSample("five-hour", 10, recentReset, 0),
            rateLimitSample("five-hour", 20, recentReset, 4),
          ],
        }),
        ledgerEntry({
          endedAt: daysAgo(2.9),
          samples: [
            rateLimitSample("five-hour", 30, recentReset, 8),
            rateLimitSample("five-hour", 50, laterReset, 8),
            rateLimitSample("seven-day", 40, laterReset, 8),
            rateLimitSample("five-hour", 60, laterReset, 12),
          ],
        }),
      ]),
      ledgerSource("demo.old", [
        ledgerEntry({
          endedAt: daysAgo(40),
          samples: [
            rateLimitSample("five-hour", 0, oldReset, 0),
            rateLimitSample("five-hour", 50, oldReset, 9),
          ],
        }),
      ]),
    ];
    const calibration = calibrateWindows(ledgers, NOW_MS);
    expect(calibration.fiveHour.capacityUsd).toBeCloseTo(40, 9);
    expect(calibration.fiveHour.groups).toBe(2);
    // One seven-day sample: no group.
    expect(calibration.sevenDay).toEqual({ capacityUsd: null, groups: 0 });
  });

  it("needs two samples sharing a reset in one entry", () => {
    const ledgers = [
      ledgerSource("demo.a", [
        ledgerEntry({ samples: [rateLimitSample("seven-day", 10, laterReset, 0)] }),
        ledgerEntry({ samples: [rateLimitSample("seven-day", 20, laterReset, 5)] }),
      ]),
      ledgerSource("demo.b", [
        ledgerEntry({ samples: [rateLimitSample("seven-day", 30, laterReset, 10)] }),
      ]),
    ];
    expect(calibrateWindows(ledgers, NOW_MS).sevenDay).toEqual({ capacityUsd: null, groups: 0 });
  });

  it("never pairs one entry's last sample with the next entry's first", () => {
    // The first entry's cost after its last sample reaches the second entry's
    // first runCostUsd, not the utilization it reads.
    const ledgers = [
      ledgerSource("demo.a", [
        ledgerEntry({
          samples: [
            rateLimitSample("five-hour", 10, laterReset, 0),
            rateLimitSample("five-hour", 20, laterReset, 4),
          ],
        }),
        ledgerEntry({
          samples: [
            rateLimitSample("five-hour", 21, laterReset, 7),
            rateLimitSample("five-hour", 31, laterReset, 11),
          ],
        }),
      ]),
    ];
    expect(calibrateWindows(ledgers, NOW_MS).fiveHour).toEqual({ capacityUsd: 40, groups: 2 });
  });

  it("gives null when no group has a cost increase, or the utilization increases sum to 0 or less", () => {
    const flat = [
      ledgerSource("demo.a", [
        ledgerEntry({
          samples: [
            rateLimitSample("five-hour", 10, laterReset, 3),
            rateLimitSample("five-hour", 15, laterReset, 3),
          ],
        }),
      ]),
    ];
    expect(calibrateWindows(flat, NOW_MS).fiveHour).toEqual({ capacityUsd: null, groups: 0 });
    const falling = [
      ledgerSource("demo.a", [
        ledgerEntry({
          samples: [
            rateLimitSample("five-hour", 15, laterReset, 1),
            rateLimitSample("five-hour", 15, laterReset, 3),
          ],
        }),
      ]),
    ];
    expect(calibrateWindows(falling, NOW_MS).fiveHour).toEqual({ capacityUsd: null, groups: 1 });
  });
});

describe("lastObservedWindows", () => {
  it("takes each window's last sample in the latest-ending entry, observed at the older entry's end, and empties a reset that passed", () => {
    const fiveHourReset = iso(NOW_MS - HOUR_MS);
    const sevenDayReset = iso(NOW_MS + 3 * 24 * HOUR_MS);
    const ledgers = [
      ledgerSource("demo.a", [
        ledgerEntry({
          endedAt: daysAgo(1),
          samples: [rateLimitSample("seven-day", 33, sevenDayReset, 1)],
        }),
      ]),
      ledgerSource("demo.b", [
        ledgerEntry({
          endedAt: daysAgo(2),
          samples: [rateLimitSample("seven-day", 20, sevenDayReset, 1)],
        }),
        ledgerEntry({
          endedAt: iso(NOW_MS - 2 * HOUR_MS),
          samples: [
            rateLimitSample("five-hour", 40, fiveHourReset, 2),
            rateLimitSample("five-hour", 45, fiveHourReset, 3),
          ],
        }),
      ]),
    ];
    expect(lastObservedWindows(ledgers, NOW_MS)).toEqual({
      kind: "windows",
      source: "last-sample",
      observedAt: daysAgo(1),
      fiveHour: { utilization: 0, resetsAt: iso(NOW_MS + 5 * HOUR_MS) },
      sevenDay: { utilization: 33, resetsAt: sevenDayReset },
    });
  });

  it("is unavailable when a window has no sample", () => {
    const ledgers = [
      ledgerSource("demo.a", [
        ledgerEntry({ samples: [rateLimitSample("five-hour", 10, iso(NOW_MS + HOUR_MS), 1)] }),
      ]),
    ];
    expect(lastObservedWindows(ledgers, NOW_MS)).toEqual({
      kind: "unavailable",
      reason: "no seven-day sample in the cost ledgers",
    });
    expect(lastObservedWindows([], NOW_MS)).toEqual({
      kind: "unavailable",
      reason: "no five-hour sample in the cost ledgers",
    });
  });
});
