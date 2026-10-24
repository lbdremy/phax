// What `phax plans estimate` learns from this machine's cost ledgers. Pure.
// Sized historical phases become training samples; the ledgers' entries give
// the agent burn rate and the run-level compliance median; their rate-limit
// samples calibrate each subscription window's capacity and give the last
// observed windows. The reference is the spike
// spikes/plan-estimate/phax_estimate.py (`training_set`, `calibrate`,
// `last_observed_quota`), on ledgers instead of streams.
import type { CostLedger, CostLedgerEntry, RateLimitSample } from "../../schemas/costLedger.js";
import type { PhaseMode } from "../../schemas/phaxPlan.js";
import type { WindowsReading } from "./estimate.js";
import {
  features,
  priceTokens,
  referencePrice,
  type TokenMix,
  type TrainingSample,
} from "./fit.js";
import { WINDOW_MS, type SubscriptionWindow } from "./forecast.js";

/** One run's ledger, keyed like its sized run. */
export interface LedgerSource {
  readonly runKey: string;
  readonly ledger: CostLedger;
}

/** One phase of a historical run's plan, sized at the run's base commit. */
export interface HistoricalPhasePlan {
  readonly id: string;
  readonly model: string;
  readonly effort: string;
  readonly mode: PhaseMode;
  readonly editBytes: number;
  readonly optionalBytes: number;
  readonly createCount: number;
}

/** A historical run of this repository whose plan phases were sized. */
export interface SizedRun {
  readonly runKey: string;
  /** ISO instant. */
  readonly startedAt: string;
  readonly phases: readonly HistoricalPhasePlan[];
}

const DAY_MS = 86_400_000;
const BURN_DAYS = 30;
const RUN_LEVEL_DAYS = 60;
const CALIBRATION_DAYS = 28;
/** A phase whose reference-priced volume is under this is not a sample. */
export const MIN_SAMPLE_USD = 0.01;

function within(instant: string, days: number, nowMs: number): boolean {
  const at = Date.parse(instant);
  return at <= nowMs && at >= nowMs - days * DAY_MS;
}

/** The roles a headless phase's samples are made of; the turns of an interactive phase are not among them. */
const PHASE_ROLES: ReadonlySet<CostLedgerEntry["role"]> = new Set(["phase", "fix", "handoff"]);
const TURN_ROLES: ReadonlySet<CostLedgerEntry["role"]> = new Set(["first-turn", "closing-turn"]);

/** The summed token mix and cost of a phase's entries in `roles`, across models. */
function phaseVolume(
  ledger: CostLedger,
  phaseId: string,
  roles: ReadonlySet<CostLedgerEntry["role"]>,
): { readonly mix: TokenMix; readonly costUsd: number; readonly entries: number } {
  let [input, output, cacheRead, cacheWrite, costUsd, entries] = [0, 0, 0, 0, 0, 0];
  for (const entry of ledger.entries) {
    if (entry.phase !== phaseId || !roles.has(entry.role)) continue;
    entries += 1;
    costUsd += entry.costUsd;
    for (const cost of Object.values(entry.models)) {
      input += cost.inputTokens;
      output += cost.outputTokens;
      cacheRead += cost.cacheReadTokens;
      cacheWrite += cost.cacheWriteTokens;
    }
  }
  return { mix: [input, output, cacheRead, cacheWrite], costUsd, entries };
}

/**
 * One sample per sized headless phase whose ledger holds at least $0.01 of
 * reference-priced volume: the tokens of its `phase`, `fix` and `handoff`
 * entries, summed across models. An interactive phase is no sample, and its
 * turn entries count nowhere here: its work is a person's, which the fit
 * cannot learn.
 */
export function trainingSamples(
  ledgers: readonly LedgerSource[],
  sizedRuns: readonly SizedRun[],
): TrainingSample[] {
  const byRun = new Map(ledgers.map((source) => [source.runKey, source.ledger]));
  const reference = referencePrice();
  const samples: TrainingSample[] = [];
  for (const run of sizedRuns) {
    const ledger = byRun.get(run.runKey);
    if (ledger === undefined) continue;
    for (const phase of run.phases) {
      if (phase.mode === "interactive") continue;
      const { mix, costUsd } = phaseVolume(ledger, phase.id, PHASE_ROLES);
      const volume = priceTokens(mix, reference);
      if (volume < MIN_SAMPLE_USD) continue;
      samples.push({
        x: features(phase.effort, phase.editBytes, phase.optionalBytes, phase.createCount),
        y: Math.log(volume),
        atMs: Date.parse(run.startedAt),
        tokens: mix,
        costUsd,
      });
    }
  }
  return samples;
}

/** The turns phax ran in one past interactive phase, and when its run started. */
export interface InteractiveTurnSample {
  readonly tokens: TokenMix;
  readonly atMs: number;
}

/**
 * One sample per sized interactive phase with at least one `first-turn` or
 * `closing-turn` entry whose reference-priced volume is at least $0.01: the
 * tokens of those entries, summed across models. That keeps out a phase
 * whose turns cost $0 in a Claude-only ledger (codex, vibe) and a first turn
 * that started no session.
 */
export function interactiveTurnSamples(
  ledgers: readonly LedgerSource[],
  sizedRuns: readonly SizedRun[],
): InteractiveTurnSample[] {
  const byRun = new Map(ledgers.map((source) => [source.runKey, source.ledger]));
  const reference = referencePrice();
  const samples: InteractiveTurnSample[] = [];
  for (const run of sizedRuns) {
    const ledger = byRun.get(run.runKey);
    if (ledger === undefined) continue;
    for (const phase of run.phases) {
      if (phase.mode !== "interactive") continue;
      const { mix, entries } = phaseVolume(ledger, phase.id, TURN_ROLES);
      if (entries === 0 || priceTokens(mix, reference) < MIN_SAMPLE_USD) continue;
      samples.push({ tokens: mix, atMs: Date.parse(run.startedAt) });
    }
  }
  return samples;
}

/**
 * USD per agent hour over the complete entries with a duration that ended in
 * the last 30 days, or null when there is none or the rate is not positive.
 */
export function burnRate(ledgers: readonly LedgerSource[], nowMs: number): number | null {
  let costUsd = 0;
  let agentMs = 0;
  for (const { ledger } of ledgers) {
    for (const entry of ledger.entries) {
      if (entry.completeness !== "complete" || entry.agentMs <= 0) continue;
      if (!within(entry.endedAt, BURN_DAYS, nowMs)) continue;
      costUsd += entry.costUsd;
      agentMs += entry.agentMs;
    }
  }
  if (agentMs === 0) return null;
  const rate = costUsd / (agentMs / 3_600_000);
  return rate > 0 ? rate : null;
}

/**
 * The median compliance-review cost, USD, of the ledgers whose last
 * compliance entry ended in the last 60 days (the sorted value at ⌊n/2⌋), or
 * null when there is none.
 */
export function runLevelMedian(ledgers: readonly LedgerSource[], nowMs: number): number | null {
  const costs: number[] = [];
  for (const { ledger } of ledgers) {
    const compliance = ledger.entries.filter((entry) => entry.role === "compliance");
    const last = compliance.at(-1);
    if (last === undefined || !within(last.endedAt, RUN_LEVEL_DAYS, nowMs)) continue;
    costs.push(compliance.reduce((sum, entry) => sum + entry.costUsd, 0));
  }
  if (costs.length === 0) return null;
  costs.sort((a, b) => a - b);
  return costs[Math.floor(costs.length / 2)]!;
}

/** A window's calibrated capacity, USD per 100 %, or null; and the groups it came from. */
interface WindowCalibration {
  readonly capacityUsd: number | null;
  readonly groups: number;
}

export interface WindowsCalibration {
  readonly fiveHour: WindowCalibration;
  readonly sevenDay: WindowCalibration;
}

function calibrateWindow(
  ledgers: readonly LedgerSource[],
  window: SubscriptionWindow,
  nowMs: number,
): WindowCalibration {
  let costUsd = 0;
  let utilization = 0;
  let groups = 0;
  for (const { ledger } of ledgers) {
    for (const entry of ledger.entries) {
      if (!within(entry.endedAt, CALIBRATION_DAYS, nowMs)) continue;
      const byReset = new Map<string, { first: RateLimitSample; last: RateLimitSample }>();
      for (const sample of entry.rateLimitSamples) {
        if (sample.window !== window) continue;
        const group = byReset.get(sample.resetsAt);
        if (group === undefined) byReset.set(sample.resetsAt, { first: sample, last: sample });
        else group.last = sample;
      }
      for (const { first, last } of byReset.values()) {
        if (first === last) continue;
        const deltaCost = last.runCostUsd - first.runCostUsd;
        if (deltaCost <= 0) continue;
        costUsd += deltaCost;
        utilization += last.utilization - first.utilization;
        groups += 1;
      }
    }
  }
  return { capacityUsd: utilization > 0 ? (100 * costUsd) / utilization : null, groups };
}

/**
 * Each window's capacity from the groups of samples that share a reset in
 * one invocation's entry: a group of at least two samples, in an entry that
 * ended in the last 28 days, with a cost increase, adds its cost and
 * utilization increases. Null when the utilization increases sum to 0 or
 * less. A group never spans two entries: an invocation's cost after its last
 * sample shows in the next entry's first `runCostUsd` but not in the
 * utilization it reads, which would overstate the capacity (by about 1.7 times
 * on real history).
 */
export function calibrateWindows(
  ledgers: readonly LedgerSource[],
  nowMs: number,
): WindowsCalibration {
  return {
    fiveHour: calibrateWindow(ledgers, "five-hour", nowMs),
    sevenDay: calibrateWindow(ledgers, "seven-day", nowMs),
  };
}

function lastSample(
  ledgers: readonly LedgerSource[],
  window: SubscriptionWindow,
): { readonly sample: RateLimitSample; readonly entry: CostLedgerEntry } | null {
  let found: { sample: RateLimitSample; entry: CostLedgerEntry } | null = null;
  for (const { ledger } of ledgers) {
    for (const entry of ledger.entries) {
      const sample = entry.rateLimitSamples.findLast((candidate) => candidate.window === window);
      if (sample === undefined) continue;
      if (found === null || Date.parse(entry.endedAt) > Date.parse(found.entry.endedAt)) {
        found = { sample, entry };
      }
    }
  }
  return found;
}

/** A window as read: one whose reset is not after now is empty, resetting a window length from now. */
export function currentWindow(
  utilization: number,
  resetsAtMs: number,
  window: SubscriptionWindow,
  nowMs: number,
): { readonly utilization: number; readonly resetsAt: string } {
  return resetsAtMs > nowMs
    ? { utilization, resetsAt: new Date(resetsAtMs).toISOString() }
    : { utilization: 0, resetsAt: new Date(nowMs + WINDOW_MS[window]).toISOString() };
}

/**
 * The windows `--no-probe` reads: each window's last sample in the
 * latest-ending entry that holds one, observed at the older of the two
 * entries' ends.
 */
export function lastObservedWindows(
  ledgers: readonly LedgerSource[],
  nowMs: number,
): WindowsReading {
  const fiveHour = lastSample(ledgers, "five-hour");
  if (fiveHour === null) {
    return { kind: "unavailable", reason: "no five-hour sample in the cost ledgers" };
  }
  const sevenDay = lastSample(ledgers, "seven-day");
  if (sevenDay === null) {
    return { kind: "unavailable", reason: "no seven-day sample in the cost ledgers" };
  }
  const observedAtMs = Math.min(
    Date.parse(fiveHour.entry.endedAt),
    Date.parse(sevenDay.entry.endedAt),
  );
  return {
    kind: "windows",
    source: "last-sample",
    observedAt: new Date(observedAtMs).toISOString(),
    fiveHour: currentWindow(
      fiveHour.sample.utilization,
      Date.parse(fiveHour.sample.resetsAt),
      "five-hour",
      nowMs,
    ),
    sevenDay: currentWindow(
      sevenDay.sample.utilization,
      Date.parse(sevenDay.sample.resetsAt),
      "seven-day",
      nowMs,
    ),
  };
}
