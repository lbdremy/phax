// `phax plans estimate`'s report. Pure. A plan's phases, this machine's cost
// ledgers, the sized historical runs and a windows reading become one
// `EstimateReport`: P10/P50/P90 per phase and per run in API-list dollars,
// and a verdict on the subscription windows left. The verdict is
// thin-history below 60 sized phases; else the first of no-subscription,
// windows-unavailable and uncalibrated that applies; else both scenarios are
// played forward for fits, risky or wait. `nowMs` comes from outside; dollars
// are rounded to 2 decimals and instants are ISO-8601 UTC.
import { listPriceFor } from "../routing/prices.js";
import type { ProviderId } from "../routing/types.js";
import {
  effortLevel,
  features,
  fitCostModel,
  HALF_LIFE_DAYS,
  MIN_HISTORY_PHASES,
  phaseQuantiles,
  runQuantiles,
  type EffortLevel,
  type PhaseQuantiles,
  type TrainingSample,
} from "./fit.js";
import { playForward, verdictOf, type Playthrough, type SubscriptionWindow } from "./forecast.js";
import {
  burnRate,
  calibrateWindows,
  runLevelMedian,
  trainingSamples,
  type LedgerSource,
  type SizedRun,
} from "./history.js";

/** One phase of the plan, routed: `model` is the concrete model routing selects. */
export interface PlanPhaseInput {
  readonly id: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  readonly editBytes: number;
  readonly optionalBytes: number;
  readonly createCount: number;
}

/** A window as read: utilization in percent, and its ISO reset instant. */
interface ObservedWindow {
  readonly utilization: number;
  readonly resetsAt: string;
}

/** The subscription windows, read by the probe or from the ledgers' last samples. */
export type WindowsReading =
  | {
      readonly kind: "windows";
      readonly source: "probe" | "last-sample";
      /** ISO instant. */
      readonly observedAt: string;
      readonly fiveHour: ObservedWindow;
      readonly sevenDay: ObservedWindow;
    }
  | { readonly kind: "no-subscription" }
  | { readonly kind: "unavailable"; readonly reason: string };

/** The compliance review: disabled, routed to Claude Code, or routed to another provider. */
export type ComplianceInput =
  | { readonly kind: "disabled" }
  | { readonly kind: "claude-code" }
  | { readonly kind: "other-provider" };

interface UsdRange {
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
}

interface PhaseRouting {
  readonly id: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
}

type PhaseEstimate =
  | (PhaseRouting & { readonly estimate: UsdRange })
  | (PhaseRouting & {
      readonly estimate: null;
      readonly notEstimated: "other-provider" | "no-list-price";
    });

interface RunEstimate extends UsdRange {
  readonly runLevel: number;
}

type NotEstimatedPart =
  | "plan-extraction"
  | "plan-auditor"
  | "interactive-code-review"
  | "compliance-review";

interface EstimateHistory {
  /** The sized historical phases the fit used. */
  readonly phases: number;
  readonly required: typeof MIN_HISTORY_PHASES;
  readonly halfLifeDays: typeof HALF_LIFE_DAYS;
  /** Kept runs with no cost ledger. */
  readonly unledgeredRuns: number;
}

interface ReportWindow extends ObservedWindow {
  /** USD per 100 %, or null when the window is uncalibrated. */
  readonly capacityUsd: number | null;
}

interface ReportWindows {
  readonly source: "probe" | "last-sample";
  readonly observedAt: string;
  readonly fiveHour: ReportWindow;
  readonly sevenDay: ReportWindow;
}

type UncalibratedPart = "five-hour" | "seven-day" | "burn-rate";

interface ScenarioPause {
  readonly phase: string;
  readonly window: SubscriptionWindow;
  readonly at: string;
  readonly resumesAt: string;
}

interface Scenario {
  readonly pauses: readonly ScenarioPause[];
  readonly endsAt: string;
}

interface Scenarios {
  readonly p50: Scenario;
  readonly p90: Scenario;
}

interface ReportCommon {
  readonly history: EstimateHistory;
  readonly notEstimated: readonly NotEstimatedPart[];
  readonly burnRateUsdPerHour: number | null;
  readonly warnings: readonly string[];
}

/** The estimate of a plan, one variant per verdict. */
export type EstimateReport = ReportCommon &
  (
    | {
        readonly verdict: "thin-history";
        readonly phases: readonly [];
        readonly run: null;
        readonly windows: ReportWindows | null;
        readonly windowsUnavailable: null;
        readonly uncalibrated: readonly [];
        readonly scenarios: null;
      }
    | {
        readonly verdict: "no-subscription";
        readonly phases: readonly PhaseEstimate[];
        readonly run: RunEstimate;
        readonly windows: null;
        readonly windowsUnavailable: null;
        readonly uncalibrated: readonly [];
        readonly scenarios: null;
      }
    | {
        readonly verdict: "windows-unavailable";
        readonly phases: readonly PhaseEstimate[];
        readonly run: RunEstimate;
        readonly windows: null;
        readonly windowsUnavailable: string;
        readonly uncalibrated: readonly [];
        readonly scenarios: null;
      }
    | {
        readonly verdict: "uncalibrated";
        readonly phases: readonly PhaseEstimate[];
        readonly run: RunEstimate;
        readonly windows: ReportWindows;
        readonly windowsUnavailable: null;
        readonly uncalibrated: readonly UncalibratedPart[];
        readonly scenarios: null;
      }
    | {
        readonly verdict: "fits" | "risky" | "wait";
        readonly phases: readonly PhaseEstimate[];
        readonly run: RunEstimate;
        readonly windows: ReportWindows;
        readonly windowsUnavailable: null;
        readonly uncalibrated: readonly [];
        readonly scenarios: Scenarios;
      }
  );

export interface EstimateInput {
  /** The plan's phases in plan order. */
  readonly phases: readonly PlanPhaseInput[];
  /** Every reachable ledger: kept runs of every namespace and pruned copies. */
  readonly ledgers: readonly LedgerSource[];
  /** This repository's kept runs, sized. */
  readonly sizedRuns: readonly SizedRun[];
  readonly unledgeredRuns: number;
  readonly compliance: ComplianceInput;
  readonly windows: WindowsReading;
  readonly nowMs: number;
}

/** Never estimated: their streams are not in the ledgers. */
const ALWAYS_NOT_ESTIMATED: readonly NotEstimatedPart[] = [
  "plan-extraction",
  "plan-auditor",
  "interactive-code-review",
];

/** An effort level with fewer historical samples than this gets a warning. */
const MIN_EFFORT_SAMPLES = 5;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function rounded2OrNull(value: number | null): number | null {
  return value === null ? null : round2(value);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function rangeOf(quantiles: PhaseQuantiles | UsdRange): UsdRange {
  return { p10: round2(quantiles.p10), p50: round2(quantiles.p50), p90: round2(quantiles.p90) };
}

/** The effort level a sample's indicators encode. */
function sampleLevel(sample: TrainingSample): EffortLevel {
  const levels = ["medium", "high", "xhigh", "max"] as const;
  for (let i = 0; i < levels.length; i++) {
    if (sample.x[i + 1] === 1) return levels[i]!;
  }
  return "low";
}

function scenarioOf(playthrough: Playthrough): Scenario {
  return {
    pauses: playthrough.pauses.map((pause) => ({
      phase: pause.phase,
      window: pause.window,
      at: iso(pause.atMs),
      resumesAt: iso(pause.resumesAtMs),
    })),
    endsAt: iso(playthrough.endsAtMs),
  };
}

function reportWindowsOf(
  reading: Extract<WindowsReading, { kind: "windows" }>,
  capacity: { readonly fiveHour: number | null; readonly sevenDay: number | null },
): ReportWindows {
  return {
    source: reading.source,
    observedAt: iso(Date.parse(reading.observedAt)),
    fiveHour: {
      utilization: reading.fiveHour.utilization,
      resetsAt: iso(Date.parse(reading.fiveHour.resetsAt)),
      capacityUsd: rounded2OrNull(capacity.fiveHour),
    },
    sevenDay: {
      utilization: reading.sevenDay.utilization,
      resetsAt: iso(Date.parse(reading.sevenDay.resetsAt)),
      capacityUsd: rounded2OrNull(capacity.sevenDay),
    },
  };
}

function thinHistoryReport(
  input: EstimateInput,
  common: Omit<ReportCommon, "warnings">,
): EstimateReport {
  const { windows } = input;
  const warnings =
    windows.kind === "no-subscription"
      ? ["Claude Code is not signed in with a subscription: there are no windows to read"]
      : windows.kind === "unavailable"
        ? [`the subscription windows are unavailable: ${windows.reason}`]
        : [];
  return {
    ...common,
    warnings,
    verdict: "thin-history",
    phases: [],
    run: null,
    windows:
      windows.kind === "windows"
        ? reportWindowsOf(windows, { fiveHour: null, sevenDay: null })
        : null,
    windowsUnavailable: null,
    uncalibrated: [],
    scenarios: null,
  };
}

/** The plan's estimate and its verdict on the subscription windows left. */
export function estimatePlan(input: EstimateInput): EstimateReport {
  const { nowMs, ledgers, compliance } = input;
  const samples = trainingSamples(ledgers, input.sizedRuns);
  const burn = burnRate(ledgers, nowMs);
  const history: EstimateHistory = {
    phases: samples.length,
    required: MIN_HISTORY_PHASES,
    halfLifeDays: HALF_LIFE_DAYS,
    unledgeredRuns: input.unledgeredRuns,
  };

  const medianRunLevel = compliance.kind === "claude-code" ? runLevelMedian(ledgers, nowMs) : null;
  const complianceEstimated = compliance.kind === "claude-code" && medianRunLevel !== null;
  const notEstimated: NotEstimatedPart[] = [...ALWAYS_NOT_ESTIMATED];
  if (compliance.kind !== "disabled" && !complianceEstimated) {
    notEstimated.push("compliance-review");
  }
  const burnRateUsdPerHour = rounded2OrNull(burn);

  if (samples.length < MIN_HISTORY_PHASES) {
    return thinHistoryReport(input, { history, notEstimated, burnRateUsdPerHour });
  }

  const model = fitCostModel(samples, nowMs);
  const runLevel = complianceEstimated ? medianRunLevel : 0;
  const warnings: string[] = [];
  const phases: PhaseEstimate[] = [];
  const estimated: { readonly id: string; readonly quantiles: PhaseQuantiles }[] = [];
  for (const phase of input.phases) {
    const routing: PhaseRouting = {
      id: phase.id,
      provider: phase.provider,
      model: phase.model,
      effort: phase.effort,
    };
    if (phase.provider !== "claude-code") {
      phases.push({ ...routing, estimate: null, notEstimated: "other-provider" });
      continue;
    }
    const price = listPriceFor(phase.model);
    if (price === undefined) {
      phases.push({ ...routing, estimate: null, notEstimated: "no-list-price" });
      continue;
    }
    const x = features(phase.effort, phase.editBytes, phase.optionalBytes, phase.createCount);
    const quantiles = phaseQuantiles(model, x, price);
    phases.push({ ...routing, estimate: rangeOf(quantiles) });
    estimated.push({ id: phase.id, quantiles });
    const level = effortLevel(phase.effort);
    const atLevel = samples.filter((sample) => sampleLevel(sample) === level).length;
    if (atLevel < MIN_EFFORT_SAMPLES) {
      warnings.push(
        `${phase.id}: only ${atLevel} historical phases at effort ${level}; its range is less reliable`,
      );
    }
  }

  const runRange = runQuantiles(
    model,
    estimated.map((phase) => phase.quantiles.base),
    runLevel,
  );
  const run: RunEstimate = { ...rangeOf(runRange), runLevel: round2(runLevel) };
  const common = { history, notEstimated, burnRateUsdPerHour, warnings, phases, run };

  const { windows } = input;
  if (windows.kind === "no-subscription") {
    return {
      ...common,
      verdict: "no-subscription",
      windows: null,
      windowsUnavailable: null,
      uncalibrated: [],
      scenarios: null,
    };
  }
  if (windows.kind === "unavailable") {
    return {
      ...common,
      verdict: "windows-unavailable",
      windows: null,
      windowsUnavailable: windows.reason,
      uncalibrated: [],
      scenarios: null,
    };
  }

  const calibration = calibrateWindows(ledgers, nowMs);
  const fiveHourUsd = calibration.fiveHour.capacityUsd;
  const sevenDayUsd = calibration.sevenDay.capacityUsd;
  const reportWindows = reportWindowsOf(windows, { fiveHour: fiveHourUsd, sevenDay: sevenDayUsd });
  if (fiveHourUsd === null || sevenDayUsd === null || burn === null) {
    const uncalibrated: UncalibratedPart[] = [];
    if (fiveHourUsd === null) uncalibrated.push("five-hour");
    if (sevenDayUsd === null) uncalibrated.push("seven-day");
    if (burn === null) uncalibrated.push("burn-rate");
    return {
      ...common,
      verdict: "uncalibrated",
      windows: reportWindows,
      windowsUnavailable: null,
      uncalibrated,
      scenarios: null,
    };
  }

  // Each scenario spends the run's own P50 or P90, so the verdict agrees with
  // the run line: the phases' quantiles do not add up to the run's, so they
  // only share the run total out in proportion, the run-level cost on the last.
  const play = (pick: (quantiles: PhaseQuantiles) => number, runTotalUsd: number): Playthrough => {
    const picked = estimated.map((phase) => pick(phase.quantiles));
    const pickedSum = picked.reduce((sum, usd) => sum + usd, 0);
    const scale = pickedSum > 0 ? (runTotalUsd - runLevel) / pickedSum : 0;
    const phaseCosts = estimated.map((phase, i) => ({ phase: phase.id, usd: picked[i]! * scale }));
    const last = phaseCosts.at(-1);
    if (last === undefined) {
      if (runLevel > 0) phaseCosts.push({ phase: "compliance-review", usd: runLevel });
    } else {
      phaseCosts[phaseCosts.length - 1] = { ...last, usd: last.usd + runLevel };
    }
    return playForward({
      phaseCosts,
      burnUsdPerHour: burn,
      fiveHour: {
        utilization: windows.fiveHour.utilization,
        resetsAtMs: Date.parse(windows.fiveHour.resetsAt),
      },
      sevenDay: {
        utilization: windows.sevenDay.utilization,
        resetsAtMs: Date.parse(windows.sevenDay.resetsAt),
      },
      capacity: { fiveHourUsd, sevenDayUsd },
      nowMs,
    });
  };
  const p50 = play((quantiles) => quantiles.p50, runRange.p50);
  const p90 = play((quantiles) => quantiles.p90, runRange.p90);
  return {
    ...common,
    verdict: verdictOf(p50, p90),
    windows: reportWindows,
    windowsUnavailable: null,
    uncalibrated: [],
    scenarios: { p50: scenarioOf(p50), p90: scenarioOf(p90) },
  };
}
