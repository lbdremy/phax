// The estimate report on made-up history: ranges, thin history, other
// providers, unpriced models, the run-level compliance cost, and the verdict
// precedence. Every ledger, plan and window is made up.
import { describe, expect, it } from "vitest";
import {
  estimatePlan,
  type ComplianceInput,
  type EstimateInput,
  type EstimateReport,
  type PlanPhaseInput,
  type WindowsReading,
} from "../../../src/domain/cost/estimate.js";
import { priceTokens } from "../../../src/domain/cost/fit.js";
import { listPriceFor } from "../../../src/domain/routing/prices.js";
import {
  daysAgo,
  DAY_MS,
  generateHistory,
  generateHistoryWithInteractive,
  HOUR_MS,
  INTERACTIVE_TURN_USD,
  iso,
  ledgerEntry,
  ledgerSource,
  NOW_MS,
  rateLimitSample,
} from "../../helpers/costHistory.js";

const generated = generateHistory({ runs: 100, phasesPerRun: 4, seed: 3 });
const ledgers = generated.map((run) => run.source);
const sizedRuns = generated.map((run) => run.sized);

/** A ledger outside the sized runs whose samples calibrate the windows at the given capacities. */
function calibration(fiveHourUsd: number, sevenDayUsd: number) {
  const reset5 = iso(NOW_MS - 2 * DAY_MS);
  const reset7 = iso(NOW_MS + 2 * DAY_MS);
  return ledgerSource("other.calibration.run", [
    ledgerEntry({
      agentMs: 0,
      endedAt: daysAgo(2.9),
      samples: [
        rateLimitSample("five-hour", 0, reset5, 0),
        rateLimitSample("seven-day", 0, reset7, 0),
        rateLimitSample("five-hour", 10, reset5, fiveHourUsd / 10),
        rateLimitSample("seven-day", 10, reset7, sevenDayUsd / 10),
      ],
    }),
  ]);
}

const plan: PlanPhaseInput[] = [
  { id: "phase-01", effort: "high", editBytes: 12_000, optionalBytes: 4000, createCount: 2 },
  { id: "phase-02", effort: "medium", editBytes: 30_000, optionalBytes: 0, createCount: 0 },
  { id: "phase-03", effort: "xhigh", editBytes: 6000, optionalBytes: 9000, createCount: 1 },
  { id: "phase-04", effort: "low", editBytes: 2000, optionalBytes: 0, createCount: 3 },
].map((phase) => ({
  ...phase,
  provider: "claude-code",
  model: "claude-opus-5-5",
  mode: "headless",
}));

const windows = (fiveHour: number, sevenDay: number): WindowsReading => ({
  kind: "windows",
  source: "probe",
  observedAt: iso(NOW_MS),
  fiveHour: { utilization: fiveHour, resetsAt: iso(NOW_MS + 3 * HOUR_MS) },
  sevenDay: { utilization: sevenDay, resetsAt: iso(NOW_MS + 4 * DAY_MS) },
});

function estimate(input: Partial<EstimateInput> = {}): EstimateReport {
  return estimatePlan({
    phases: plan,
    ledgers: [...ledgers, calibration(5000, 50_000)],
    sizedRuns,
    unledgeredRuns: 2,
    compliance: { kind: "disabled" },
    windows: windows(0, 0),
    nowMs: NOW_MS,
    ...input,
  });
}

function isCents(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

describe("estimatePlan: ranges", () => {
  it("gives 400 phases and a four-phase plan ordered ranges per phase and for the run", () => {
    const report = estimate();
    expect(report.history).toEqual({
      phases: 400,
      required: 60,
      halfLifeDays: 30,
      unledgeredRuns: 2,
    });
    expect(report.phases.map((phase) => phase.id)).toEqual([
      "phase-01",
      "phase-02",
      "phase-03",
      "phase-04",
    ]);
    for (const phase of report.phases) {
      expect(phase.estimate).not.toBeNull();
      const range = phase.estimate!;
      expect(range.p10).toBeGreaterThan(0);
      expect(range.p10).toBeLessThanOrEqual(range.p50);
      expect(range.p50).toBeLessThanOrEqual(range.p90);
      expect([range.p10, range.p50, range.p90].every(isCents)).toBe(true);
    }
    const run = report.run!;
    expect(run.p10).toBeLessThanOrEqual(run.p50);
    expect(run.p50).toBeLessThanOrEqual(run.p90);
    expect(run.runLevel).toBe(0);
    expect(report.notEstimated).toEqual([
      "plan-extraction",
      "plan-auditor",
      "interactive-code-review",
    ]);
    expect(report.burnRateUsdPerHour).not.toBeNull();
    expect(isCents(report.burnRateUsdPerHour!)).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  it("is reproducible", () => {
    expect(estimate()).toEqual(estimate());
  });
});

describe("estimatePlan: thin history", () => {
  it("gives 12 phases thin-history, naming 12, with no estimate and the windows passed through without capacity", () => {
    const few = generateHistory({ runs: 3, phasesPerRun: 4, seed: 5 });
    const report = estimate({
      ledgers: [...few.map((run) => run.source), calibration(5000, 50_000)],
      sizedRuns: few.map((run) => run.sized),
      windows: windows(15, 29),
    });
    expect(report).toMatchObject({
      verdict: "thin-history",
      history: { phases: 12, required: 60 },
      phases: [],
      run: null,
      scenarios: null,
      windowsUnavailable: null,
      uncalibrated: [],
      windows: {
        source: "probe",
        observedAt: iso(NOW_MS),
        fiveHour: { utilization: 15, resetsAt: iso(NOW_MS + 3 * HOUR_MS), capacityUsd: null },
        sevenDay: { utilization: 29, resetsAt: iso(NOW_MS + 4 * DAY_MS), capacityUsd: null },
      },
    });
  });

  it("keeps an unavailable reading's reason as a warning", () => {
    const report = estimate({
      sizedRuns: [],
      windows: { kind: "unavailable", reason: "the probe ended without a rate-limit event" },
    });
    expect(report.verdict).toBe("thin-history");
    expect(report.windows).toBeNull();
    expect(report.warnings).toEqual([
      "the subscription windows are unavailable: the probe ended without a rate-limit event",
    ]);
  });
});

describe("estimatePlan: phases it does not estimate", () => {
  it("lists a codex-cli phase and leaves it out of the run and the verdict", () => {
    const withCodex = estimate({
      phases: [
        ...plan.slice(0, 2),
        { ...plan[2]!, provider: "codex-cli", model: "gpt-5.5" },
        plan[3]!,
      ],
    });
    const without = estimate({ phases: [plan[0]!, plan[1]!, plan[3]!] });
    expect(withCodex.phases[2]).toEqual({
      id: "phase-03",
      provider: "codex-cli",
      model: "gpt-5.5",
      effort: "xhigh",
      mode: "headless",
      estimate: null,
      notEstimated: "other-provider",
    });
    expect(withCodex.run).toEqual(without.run);
    expect(withCodex.verdict).toBe(without.verdict);
    expect(withCodex.scenarios).toEqual(without.scenarios);
  });

  it("lists a Claude model with no list price as no-list-price, never at $0", () => {
    const report = estimate({
      phases: [plan[0]!, { ...plan[1]!, model: "claude-house-special" }],
    });
    expect(report.phases[1]).toMatchObject({
      model: "claude-house-special",
      estimate: null,
      notEstimated: "no-list-price",
    });
    expect(report.run).toEqual(estimate({ phases: [plan[0]!] }).run);
  });
});

describe("estimatePlan: run-level cost", () => {
  const compliance = [
    ledgerSource("demo.c1", [
      ledgerEntry({ role: "compliance", costUsd: 1.2, endedAt: daysAgo(4) }),
    ]),
    ledgerSource("demo.c2", [
      ledgerEntry({ role: "compliance", costUsd: 3.4, endedAt: daysAgo(9) }),
    ]),
    ledgerSource("demo.c3", [
      ledgerEntry({ role: "compliance", costUsd: 2.6, endedAt: daysAgo(15) }),
    ]),
  ];

  it("adds the recent compliance median to the run when the review runs on Claude Code", () => {
    const base = estimate({ ledgers: [...ledgers, ...compliance, calibration(5000, 50_000)] });
    const report = estimate({
      ledgers: [...ledgers, ...compliance, calibration(5000, 50_000)],
      compliance: { kind: "claude-code" },
    });
    expect(report.run!.runLevel).toBe(2.6);
    expect(report.run!.p10).toBeCloseTo(base.run!.p10 + 2.6, 1);
    expect(report.run!.p50).toBeCloseTo(base.run!.p50 + 2.6, 1);
    expect(report.run!.p90).toBeCloseTo(base.run!.p90 + 2.6, 1);
    expect(report.notEstimated).not.toContain("compliance-review");
  });

  it("names the review as not estimated when it runs elsewhere or has no recent history", () => {
    const elsewhere = estimate({
      ledgers: [...ledgers, ...compliance, calibration(5000, 50_000)],
      compliance: { kind: "other-provider" },
    });
    const onClaude: ComplianceInput = { kind: "claude-code" };
    const noHistory = estimate({ compliance: onClaude });
    for (const report of [elsewhere, noHistory]) {
      expect(report.run!.runLevel).toBe(0);
      expect(report.notEstimated).toContain("compliance-review");
    }
  });
});

describe("estimatePlan: verdict precedence", () => {
  it("keeps the estimate under no-subscription, with windows null", () => {
    const report = estimate({ windows: { kind: "no-subscription" } });
    expect(report).toMatchObject({
      verdict: "no-subscription",
      windows: null,
      windowsUnavailable: null,
      scenarios: null,
    });
    expect(report.run).toEqual(estimate().run);
  });

  it("keeps the estimate under windows-unavailable, with its reason and windows null", () => {
    const report = estimate({
      windows: { kind: "unavailable", reason: "the probe reported the five-hour window only" },
    });
    expect(report).toMatchObject({
      verdict: "windows-unavailable",
      windows: null,
      windowsUnavailable: "the probe reported the five-hour window only",
      scenarios: null,
    });
    expect(report.phases).toHaveLength(4);
  });

  it("gives uncalibrated for a window with no capacity, showing the windows", () => {
    const report = estimate({ ledgers });
    expect(report).toMatchObject({
      verdict: "uncalibrated",
      uncalibrated: ["five-hour", "seven-day"],
      scenarios: null,
      windows: { fiveHour: { capacityUsd: null }, sevenDay: { capacityUsd: null } },
    });
  });

  it("gives uncalibrated for a null burn rate", () => {
    const old = generateHistory({
      runs: 20,
      phasesPerRun: 4,
      seed: 9,
      nowMs: NOW_MS - 60 * DAY_MS,
    });
    const report = estimate({
      ledgers: [...old.map((run) => run.source), calibration(5000, 50_000)],
      sizedRuns: old.map((run) => run.sized),
    });
    expect(report.burnRateUsdPerHour).toBeNull();
    expect(report).toMatchObject({
      verdict: "uncalibrated",
      uncalibrated: ["burn-rate"],
      windows: { fiveHour: { capacityUsd: 5000 }, sevenDay: { capacityUsd: 50_000 } },
    });
  });

  it("gives fits with room to spare, and wait when the five-hour window is nearly spent", () => {
    const fits = estimate();
    expect(fits.verdict).toBe("fits");
    expect(fits.scenarios!.p90.pauses).toEqual([]);
    expect(Date.parse(fits.scenarios!.p50.endsAt)).toBeGreaterThan(NOW_MS);

    const wait = estimate({
      ledgers: [...ledgers, calibration(50, 50_000)],
      windows: windows(95, 0),
    });
    expect(wait.verdict).toBe("wait");
    expect(wait.windows!.fiveHour.capacityUsd).toBe(50);
    expect(wait.scenarios!.p50.pauses[0]).toEqual({
      phase: "phase-01",
      window: "five-hour",
      at: expect.any(String),
      resumesAt: iso(NOW_MS + 3 * HOUR_MS),
    });
  });
});

describe("estimatePlan: scenarios spend the run line", () => {
  it("plays the run's own P50 and P90, not the sum of the phases' quantiles", () => {
    const report = estimate();
    const run = report.run!;
    const burn = report.burnRateUsdPerHour!;
    const spent = (endsAt: string) => ((Date.parse(endsAt) - NOW_MS) / HOUR_MS) * burn;
    const phaseSum = (pick: "p50" | "p90") =>
      report.phases.reduce((sum, phase) => sum + phase.estimate![pick], 0);
    // The phases' quantiles do not add up to the run's, so the test tells them apart.
    expect(Math.abs(phaseSum("p90") - run.p90)).toBeGreaterThan(1);
    expect(spent(report.scenarios!.p50.endsAt)).toBeCloseTo(run.p50, 1);
    expect(spent(report.scenarios!.p90.endsAt)).toBeCloseTo(run.p90, 1);
  });
});

describe("estimatePlan: warnings", () => {
  it("warns about a phase whose effort has fewer than 5 historical phases", () => {
    const sparse = generateHistory({ runs: 20, phasesPerRun: 4, seed: 13 }).map((run, r) => ({
      ...run,
      sized: {
        ...run.sized,
        phases: run.sized.phases.map((phase, p) => ({
          ...phase,
          effort: r < 3 && p === 0 ? "max" : "high",
        })),
      },
    }));
    const report = estimate({
      phases: [{ ...plan[0]!, effort: "ultracode" }, plan[0]!],
      ledgers: [...sparse.map((run) => run.source), calibration(5000, 50_000)],
      sizedRuns: sparse.map((run) => run.sized),
    });
    expect(report.warnings).toEqual([
      "phase-01: only 3 historical phases at effort max; its range is less reliable",
    ]);
  });
});

// ── Interactive phases ─────────────────────────────────────────────────────

// 20 runs of 3 headless phases (60 samples) and three runs of one interactive
// phase whose first and closing turns cost 0.5, 0.8 and 1.1 at the reference
// model, 5, 15 and 25 days ago.
const withTurns = generateHistoryWithInteractive({ seed: 21 });
const turnLedgers = withTurns.map((run) => run.source);
const turnRuns = withTurns.map((run) => run.sized);

const UNIT_MIX = [1000, 20_000, 2_000_000, 50_000] as const;
// The same token mix at Sonnet's list price over the reference model's.
const SONNET_RATIO =
  priceTokens(UNIT_MIX, listPriceFor("claude-sonnet-5-5")!) /
  priceTokens(UNIT_MIX, listPriceFor("claude-opus-5-5")!);
const [LOW, MID, HIGH] = INTERACTIVE_TURN_USD;
const cents = (value: number): number => Math.round(value * 100) / 100;

const reviewPhase: PlanPhaseInput = {
  id: "phase-02",
  provider: "claude-code",
  model: "claude-sonnet-5-5",
  effort: "medium",
  mode: "interactive",
  editBytes: 0,
  optionalBytes: 1000,
  createCount: 0,
};

function estimateWithTurns(input: Partial<EstimateInput> = {}): EstimateReport {
  return estimate({
    phases: [plan[0]!, reviewPhase, plan[3]!],
    ledgers: [...turnLedgers, calibration(500, 50_000)],
    sizedRuns: turnRuns,
    ...input,
  });
}

describe("estimatePlan: interactive phases", () => {
  it("counts only the headless phases as history and gives the interactive phase its own range from the turns", () => {
    const report = estimateWithTurns();
    expect(report.history.phases).toBe(60);
    expect(report.phases.map((phase) => [phase.id, phase.mode])).toEqual([
      ["phase-01", "headless"],
      ["phase-02", "interactive"],
      ["phase-04", "headless"],
    ]);
    // Repriced at Sonnet and weighted by recency (5, 15 and 25 days old),
    // each quantile is one of the three samples.
    expect(report.phases[1]!.estimate).toEqual({
      p10: cents(LOW * SONNET_RATIO),
      p50: cents(MID * SONNET_RATIO),
      p90: cents(HIGH * SONNET_RATIO),
    });
  });

  it.each([
    [
      "too few past interactive phases",
      2,
      "claude-code",
      "claude-sonnet-5-5",
      "thin-interactive-history",
    ],
    [
      "no past interactive phase",
      0,
      "claude-code",
      "claude-sonnet-5-5",
      "thin-interactive-history",
    ],
    ["another provider", 3, "codex-cli", "gpt-5.5", "other-provider"],
    ["a model with no list price", 3, "claude-code", "claude-house-special", "no-list-price"],
  ] as const)("does not size the phase for %s", (_name, samples, provider, model, reason) => {
    const report = estimateWithTurns({
      ledgers: [...turnLedgers.slice(0, 20 + samples), calibration(500, 50_000)],
      sizedRuns: turnRuns.slice(0, 20 + samples),
      phases: [plan[0]!, { ...reviewPhase, provider, model }, plan[3]!],
    });
    expect(report.phases[1]).toMatchObject({
      id: "phase-02",
      mode: "interactive",
      estimate: null,
      notEstimated: reason,
    });
    expect(report.phases[0]!.estimate).not.toBeNull();
    expect(report.run).toEqual(estimateWithTurns({ phases: [plan[0]!, plan[3]!] }).run);
  });

  it("keeps the run level the compliance median, with and without interactive phases", () => {
    const compliance = [
      ledgerSource("demo.c1", [
        ledgerEntry({ role: "compliance", costUsd: 1.2, endedAt: daysAgo(4) }),
      ]),
      ledgerSource("demo.c2", [
        ledgerEntry({ role: "compliance", costUsd: 3.4, endedAt: daysAgo(9) }),
      ]),
      ledgerSource("demo.c3", [
        ledgerEntry({ role: "compliance", costUsd: 2.6, endedAt: daysAgo(15) }),
      ]),
    ];
    const ledgersWith = [...turnLedgers, ...compliance, calibration(500, 50_000)];
    const withPhase = estimateWithTurns({
      ledgers: ledgersWith,
      compliance: { kind: "claude-code" },
    });
    const without = estimateWithTurns({
      ledgers: ledgersWith,
      compliance: { kind: "claude-code" },
      phases: [plan[0]!, plan[3]!],
    });
    expect(withPhase.run!.runLevel).toBe(2.6);
    expect(without.run!.runLevel).toBe(2.6);
  });

  it("adds the interactive phase's quantiles to the run's, quantile by quantile", () => {
    const withPhase = estimateWithTurns();
    const without = estimateWithTurns({ phases: [plan[0]!, plan[3]!] });
    const range = withPhase.phases[1]!.estimate!;
    for (const q of ["p10", "p50", "p90"] as const) {
      // Both are rounded to cents.
      expect(Math.abs(withPhase.run![q] - without.run![q] - range[q])).toBeLessThan(0.011);
    }
  });

  it("plays the run's own P50 and P90 with the interactive phase in it", () => {
    const report = estimateWithTurns();
    const burn = report.burnRateUsdPerHour!;
    const spent = (endsAt: string) => ((Date.parse(endsAt) - NOW_MS) / HOUR_MS) * burn;
    expect(spent(report.scenarios!.p50.endsAt)).toBeCloseTo(report.run!.p50, 1);
    expect(spent(report.scenarios!.p90.endsAt)).toBeCloseTo(report.run!.p90, 1);
  });

  describe("in the scenarios", () => {
    const own = (pick: "p50" | "p90") => estimateWithTurns().phases[1]!.estimate![pick];
    // Five-hour capacity is $500: a window with `left` dollars left is
    // (100 - left / 5) % used.
    const withRoomLeft = (left: number, input: Partial<EstimateInput> = {}) =>
      estimateWithTurns({ windows: windows(100 - left / 5, 0), ...input });

    it("spends the interactive phase's own P50 and P90 at its plan position", () => {
      const interactiveFirst = [reviewPhase, plan[0]!];
      for (const pick of ["p50", "p90"] as const) {
        const figure = own(pick);
        const pauseOf = (left: number) =>
          withRoomLeft(left, { phases: interactiveFirst }).scenarios![pick].pauses[0]?.phase;
        // A window that runs out inside the phase's own figure pauses in it;
        // one with a little more room pauses in the next phase.
        expect(pauseOf(figure - 0.03)).toBe("phase-02");
        expect(pauseOf(figure + 0.03)).toBe("phase-01");
      }
    });

    it("keeps the run level on the last phase, behind the interactive phase's own figure", () => {
      const compliance = [
        ledgerSource("demo.c1", [
          ledgerEntry({ role: "compliance", costUsd: 2.6, endedAt: daysAgo(4) }),
        ]),
      ];
      const input: Partial<EstimateInput> = {
        phases: [plan[0]!, reviewPhase],
        ledgers: [...turnLedgers, ...compliance, calibration(500, 50_000)],
        compliance: { kind: "claude-code" } as const,
      };
      const total = estimateWithTurns(input).run!.p50;
      const lastPhaseCost = own("p50") + 2.6;
      const pauseOf = (left: number) =>
        estimateWithTurns({ ...input, windows: windows(100 - left / 5, 0) }).scenarios!.p50
          .pauses[0]?.phase;
      // The headless phase spends everything but the last phase's cost.
      expect(pauseOf(total - lastPhaseCost - 0.07)).toBe("phase-01");
      expect(pauseOf(total - lastPhaseCost + 0.07)).toBe("phase-02");
    });
  });
});
