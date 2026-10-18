// The cost model behind `phax plans estimate`. Pure. Log token volume, priced
// at a fixed reference model, regressed on effort and planned-file sizes by
// weighted least squares, the weights halving every 30 days back from now. A
// prediction is repriced at the phase's own model through the history's
// weighted token mix, and its range is the weighted residual quantiles. The
// reference is the spike spikes/plan-estimate/phax_estimate.py (`features`,
// `fit`, `solve`, `reprice`, `quantiles`).
import { listPriceFor, type ModelListPrice } from "../routing/prices.js";

/** The model every historical phase's token volume is priced at. */
export const REFERENCE_MODEL = "claude-opus-5-5";
/** A sample's weight halves every this many days. */
export const HALF_LIFE_DAYS = 30;
/** The sized historical phases an estimate needs. */
export const MIN_HISTORY_PHASES = 60;
/** The seeded draws behind a run's quantiles. */
export const RUN_DRAWS = 4000;
export const RUN_SEED = 7;

const DAY_MS = 86_400_000;
const RIDGE = 1e-6;
const PIVOT_EPSILON = 1e-12;

/** Input, output, cache read and cache write tokens. */
export type TokenMix = readonly [number, number, number, number];

/** One historical phase: its features, its log reference-priced volume and when its run started. */
export interface TrainingSample {
  readonly x: readonly number[];
  readonly y: number;
  readonly atMs: number;
  readonly tokens: TokenMix;
  readonly costUsd: number;
}

/** The effort levels the model tells apart; `low` is the baseline. */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

const INDICATED: readonly EffortLevel[] = ["medium", "high", "xhigh", "max"];

/** `ultracode` and `ultra` count as max; low, `none`, `off` and any other value are the baseline. */
export function effortLevel(effort: string): EffortLevel {
  switch (effort) {
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return effort;
    case "ultracode":
    case "ultra":
      return "max";
    default:
      return "low";
  }
}

/** An intercept, the effort indicators, log1p(edit KB), log1p(optional KB) and log1p(files to create). */
export function features(
  effort: string,
  editBytes: number,
  optionalBytes: number,
  createCount: number,
): number[] {
  const level = effortLevel(effort);
  return [
    1,
    ...INDICATED.map((indicated) => (level === indicated ? 1 : 0)),
    Math.log1p(editBytes / 1000),
    Math.log1p(optionalBytes / 1000),
    Math.log1p(createCount),
  ];
}

/** The reference model's list price. */
export function referencePrice(): ModelListPrice {
  return listPriceFor(REFERENCE_MODEL)!;
}

/** Tokens priced at `price`, cache writes at the 1-hour write price, USD. */
export function priceTokens(tokens: TokenMix, price: ModelListPrice): number {
  return (
    (tokens[0] * price.inputUsdPerMTok +
      tokens[1] * price.outputUsdPerMTok +
      tokens[2] * price.cacheReadUsdPerMTok +
      tokens[3] * price.cacheWrite1hUsdPerMTok) /
    1e6
  );
}

/** A sample's weight: 0.5 per half-life between its run's start and now. */
export function sampleWeight(atMs: number, nowMs: number): number {
  return 0.5 ** (Math.max(0, nowMs - atMs) / DAY_MS / HALF_LIFE_DAYS);
}

/** Gauss–Jordan elimination with partial pivoting; a vanishing pivot gives a 0 coefficient. */
function solve(a: readonly (readonly number[])[], b: readonly number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(m[r]![c]!) > Math.abs(m[pivot]![c]!)) pivot = r;
    }
    [m[c], m[pivot]] = [m[pivot]!, m[c]!];
    const row = m[c]!;
    if (Math.abs(row[c]!) < PIVOT_EPSILON) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const target = m[r]!;
      const factor = target[c]! / row[c]!;
      for (let k = 0; k <= n; k++) target[k] = target[k]! - factor * row[k]!;
    }
  }
  return m.map((row, i) => (Math.abs(row[i]!) > PIVOT_EPSILON ? row[n]! / row[i]! : 0));
}

/** A fitted cost model: coefficients, residuals and weights by sample, and the weighted token mix. */
export interface CostModel {
  readonly beta: readonly number[];
  readonly residuals: readonly number[];
  readonly weights: readonly number[];
  readonly mix: TokenMix;
}

/**
 * Weighted least squares with a 1e-6 ridge on the samples; callers pass at
 * least one. The weights are scaled so the newest sample weighs 1: the fit
 * and the residual draws only see their ratios, and the ridge then stays
 * negligible however old the whole history is.
 */
export function fitCostModel(samples: readonly TrainingSample[], nowMs: number): CostModel {
  const decayed = samples.map((sample) => sampleWeight(sample.atMs, nowMs));
  const heaviest = Math.max(...decayed);
  const weights = decayed.map((weight) => weight / heaviest);
  const k = samples[0]!.x.length;
  const xtx = Array.from({ length: k }, (_row, i) =>
    Array.from({ length: k }, (_column, j) =>
      samples.reduce(
        (sum, sample, s) => sum + weights[s]! * sample.x[i]! * sample.x[j]!,
        i === j ? RIDGE : 0,
      ),
    ),
  );
  const xty = Array.from({ length: k }, (_, i) =>
    samples.reduce((sum, sample, s) => sum + weights[s]! * sample.x[i]! * sample.y, 0),
  );
  const beta = solve(xtx, xty);
  const residuals = samples.map((sample) => sample.y - dot(beta, sample.x));
  const mixAt = (field: number) =>
    samples.reduce((sum, sample, s) => sum + weights[s]! * sample.tokens[field]!, 0);
  return { beta, residuals, weights, mix: [mixAt(0), mixAt(1), mixAt(2), mixAt(3)] };
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, value, i) => sum + value * b[i]!, 0);
}

/** The token mix priced at `price` over the same mix priced at the reference. */
export function repriceRatio(price: ModelListPrice, mix: TokenMix): number {
  return priceTokens(mix, price) / priceTokens(mix, referencePrice());
}

/** The smallest value, in sorted order, whose cumulative weight reaches q·Σw. */
export function weightedQuantile(
  values: readonly number[],
  weights: readonly number[],
  q: number,
): number {
  const order = values.map((_, i) => i).toSorted((a, b) => values[a]! - values[b]!);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const target = q * total;
  let cumulative = 0;
  for (const i of order) {
    cumulative += weights[i]!;
    if (cumulative >= target) return values[i]!;
  }
  return values[order.at(-1)!]!;
}

/** A phase's base estimate and its P10/P50/P90, USD at its own model's list price. */
export interface PhaseQuantiles {
  readonly base: number;
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
}

export function phaseQuantiles(
  model: CostModel,
  x: readonly number[],
  price: ModelListPrice,
): PhaseQuantiles {
  const base = Math.exp(dot(model.beta, x)) * repriceRatio(price, model.mix);
  const at = (q: number) => base * Math.exp(weightedQuantile(model.residuals, model.weights, q));
  return { base, p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}

/** The mulberry32 generator: uniform draws in [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A run's P10/P50/P90, USD. */
export interface RunQuantiles {
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
}

/**
 * A run's quantiles from `RUN_DRAWS` seeded draws: each draw picks one
 * residual per phase independently, with probability proportional to its
 * weight, and sums base·exp(residual) plus the run-level cost.
 */
export function runQuantiles(
  model: CostModel,
  bases: readonly number[],
  runLevelUsd: number,
): RunQuantiles {
  if (bases.length === 0) return { p10: runLevelUsd, p50: runLevelUsd, p90: runLevelUsd };
  const random = mulberry32(RUN_SEED);
  const cumulative: number[] = [];
  let total = 0;
  for (const weight of model.weights) {
    total += weight;
    cumulative.push(total);
  }
  const pick = (): number => {
    const target = random() * total;
    let low = 0;
    let high = cumulative.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (cumulative[middle]! > target) high = middle;
      else low = middle + 1;
    }
    return model.residuals[low]!;
  };
  const draws: number[] = [];
  for (let d = 0; d < RUN_DRAWS; d++) {
    draws.push(bases.reduce((sum, base) => sum + base * Math.exp(pick()), runLevelUsd));
  }
  draws.sort((a, b) => a - b);
  const at = (q: number) => draws[Math.min(draws.length - 1, Math.floor(q * draws.length))]!;
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}
