// The cost model on made-up samples: features, weighted least squares,
// half-life weights, repricing, the weighted quantile and the seeded run
// draws. Every sample and coefficient is made up.
import { describe, expect, it } from "vitest";
import {
  effortLevel,
  features,
  fitCostModel,
  HALF_LIFE_DAYS,
  phaseQuantiles,
  priceTokens,
  REFERENCE_MODEL,
  referencePrice,
  repriceRatio,
  RUN_DRAWS,
  RUN_SEED,
  runQuantiles,
  sampleWeight,
  weightedQuantile,
  type TrainingSample,
} from "../../../src/domain/cost/fit.js";
import { trainingSamples } from "../../../src/domain/cost/history.js";
import { listPriceFor } from "../../../src/domain/routing/prices.js";
import {
  DAY_MS,
  generateHistory,
  NOW_MS,
  TRUE_BETA,
  tokensForUsd,
} from "../../helpers/costHistory.js";

function sample(x: number[], y: number, atMs: number = NOW_MS): TrainingSample {
  const tokens = tokensForUsd(Math.exp(y));
  return {
    x,
    y,
    atMs,
    tokens: [
      tokens.inputTokens,
      tokens.outputTokens,
      tokens.cacheReadTokens,
      tokens.cacheWriteTokens,
    ],
    costUsd: Math.exp(y),
  };
}

const generated = generateHistory({ runs: 40, phasesPerRun: 5, seed: 11 });
const history = trainingSamples(
  generated.map((run) => run.source),
  generated.map((run) => run.sized),
);

describe("features", () => {
  it("is an intercept, four effort indicators and three log sizes", () => {
    expect(features("high", 9000, 1000, 2)).toEqual([
      1,
      0,
      1,
      0,
      0,
      Math.log1p(9),
      Math.log1p(1),
      Math.log1p(2),
    ]);
  });

  it("counts ultracode and ultra as max, and low, none, off or anything else as the baseline", () => {
    expect(effortLevel("ultracode")).toBe("max");
    expect(effortLevel("ultra")).toBe("max");
    for (const effort of ["low", "none", "off", "turbo"]) {
      expect(effortLevel(effort)).toBe("low");
      expect(features(effort, 0, 0, 0)).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    }
  });
});

describe("fitCostModel", () => {
  it("recovers known coefficients on noiseless data", () => {
    const efforts = ["low", "medium", "high", "xhigh", "max"];
    const samples: TrainingSample[] = [];
    for (let i = 0; i < 80; i++) {
      const x = features(
        efforts[i % 5]!,
        1000 * ((i * 7) % 23),
        1000 * ((i * 3) % 11),
        (i * 5) % 4,
      );
      const y = x.reduce((sum, value, k) => sum + value * TRUE_BETA[k]!, 0);
      samples.push(sample(x, y, NOW_MS - (i % 9) * DAY_MS));
    }
    const model = fitCostModel(samples, NOW_MS);
    model.beta.forEach((coefficient, k) => expect(coefficient).toBeCloseTo(TRUE_BETA[k]!, 3));
    for (const residual of model.residuals) expect(Math.abs(residual)).toBeLessThan(1e-3);
  });

  it("recovers the same coefficients from a history two years old: the ridge never takes over", () => {
    const efforts = ["low", "medium", "high", "xhigh", "max"];
    const samples: TrainingSample[] = [];
    for (let i = 0; i < 80; i++) {
      const x = features(
        efforts[i % 5]!,
        1000 * ((i * 7) % 23),
        1000 * ((i * 3) % 11),
        (i * 5) % 4,
      );
      const y = x.reduce((sum, value, k) => sum + value * TRUE_BETA[k]!, 0);
      samples.push(sample(x, y, NOW_MS - (730 + (i % 9)) * DAY_MS));
    }
    const model = fitCostModel(samples, NOW_MS);
    model.beta.forEach((coefficient, k) => expect(coefficient).toBeCloseTo(TRUE_BETA[k]!, 3));
    expect(Math.max(...model.weights)).toBe(1);
  });

  it("halves a sample's weight every 30 days back from now", () => {
    expect(HALF_LIFE_DAYS).toBe(30);
    expect(sampleWeight(NOW_MS, NOW_MS)).toBe(1);
    expect(sampleWeight(NOW_MS - 30 * DAY_MS, NOW_MS)).toBeCloseTo(0.5, 12);
    expect(sampleWeight(NOW_MS - 60 * DAY_MS, NOW_MS)).toBeCloseTo(0.25, 12);
    expect(sampleWeight(NOW_MS + DAY_MS, NOW_MS)).toBe(1);
    const model = fitCostModel(
      [sample([1], 0, NOW_MS), sample([1], 0, NOW_MS - 30 * DAY_MS)],
      NOW_MS,
    );
    expect(model.weights[1]! / model.weights[0]!).toBeCloseTo(0.5, 12);
  });

  it("weighs recent phases more: a history whose recent phases cost twice the older ones gives a P50 closer to the recent cost", () => {
    const samples: TrainingSample[] = [];
    for (let i = 0; i < 30; i++) {
      const x = features("high", 1000 * (1 + (i % 6)), 0, 0);
      const y = 0.5 + 0.4 * x[5]!;
      samples.push(sample(x, y, NOW_MS - (100 + (i % 20)) * DAY_MS));
      samples.push(sample(x, y + Math.log(2), NOW_MS - (i % 10) * DAY_MS));
    }
    const model = fitCostModel(samples, NOW_MS);
    const x = features("high", 3000, 0, 0);
    const older = Math.exp(0.5 + 0.4 * x[5]!);
    const { p50 } = phaseQuantiles(model, x, referencePrice());
    expect(Math.abs(p50 - 2 * older)).toBeLessThan(Math.abs(p50 - older));
  });
});

describe("weightedQuantile", () => {
  it("returns the smallest value whose cumulative weight reaches q·Σw", () => {
    expect(weightedQuantile([3, 1, 2], [1, 1, 1], 0.1)).toBe(1);
    expect(weightedQuantile([3, 1, 2], [1, 1, 1], 0.5)).toBe(2);
    expect(weightedQuantile([3, 1, 2], [1, 1, 1], 0.9)).toBe(3);
    expect(weightedQuantile([10, 20, 30], [1, 1, 8], 0.5)).toBe(30);
    expect(weightedQuantile([10, 20, 30], [4, 1, 5], 0.4)).toBe(10);
    expect(weightedQuantile([10, 20, 30], [4, 1, 5], 0.5)).toBe(20);
  });

  it("is ordered in q", () => {
    const values = history.map((s) => s.y);
    const weights = history.map((s) => sampleWeight(s.atMs, NOW_MS));
    const qs = [0.05, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99];
    const quantiles = qs.map((q) => weightedQuantile(values, weights, q));
    expect(quantiles).toEqual(quantiles.toSorted((a, b) => a - b));
  });
});

describe("phaseQuantiles", () => {
  const model = fitCostModel(history, NOW_MS);
  const opus = listPriceFor("claude-opus-5-5")!;
  const sonnet = listPriceFor("claude-sonnet-5-5")!;

  it("prices a phase at its own model: two phases that differ only by model differ by the mix's price ratio", () => {
    const x = features("high", 12_000, 3000, 1);
    const atOpus = phaseQuantiles(model, x, opus);
    const atSonnet = phaseQuantiles(model, x, sonnet);
    const expected = priceTokens(model.mix, sonnet) / priceTokens(model.mix, opus);
    expect(REFERENCE_MODEL).toBe("claude-opus-5-5");
    expect(repriceRatio(opus, model.mix)).toBeCloseTo(1, 12);
    expect(atSonnet.p50 / atOpus.p50).toBeCloseTo(expected, 12);
    expect(atSonnet.p10 / atOpus.p10).toBeCloseTo(expected, 12);
    expect(atSonnet.p90 / atOpus.p90).toBeCloseTo(expected, 12);
  });

  it("gives larger edit bytes a larger P50, and orders P10 ≤ P50 ≤ P90", () => {
    const small = phaseQuantiles(model, features("high", 2000, 0, 1), opus);
    const large = phaseQuantiles(model, features("high", 80_000, 0, 1), opus);
    expect(large.p50).toBeGreaterThan(small.p50);
    expect(small.p10).toBeLessThanOrEqual(small.p50);
    expect(small.p50).toBeLessThanOrEqual(small.p90);
  });
});

describe("runQuantiles", () => {
  const model = fitCostModel(history, NOW_MS);
  const bases = [3, 5, 2.5, 8];

  it("is reproducible across calls and ordered P10 ≤ P50 ≤ P90", () => {
    expect(RUN_DRAWS).toBe(4000);
    expect(RUN_SEED).toBe(7);
    const first = runQuantiles(model, bases, 1.5);
    expect(runQuantiles(model, bases, 1.5)).toEqual(first);
    expect(first.p10).toBeLessThanOrEqual(first.p50);
    expect(first.p50).toBeLessThanOrEqual(first.p90);
    expect(first.p10).toBeGreaterThan(1.5);
  });

  it("is the run-level cost alone with no estimated phase", () => {
    expect(runQuantiles(model, [], 2.25)).toEqual({ p10: 2.25, p50: 2.25, p90: 2.25 });
  });
});
