// Sanity properties of the plan-parser text generators: every text stays within the byte cap and
// is well-formed UTF-16, every mutated text names its mutations, and fixed-seed samples show every
// mutation and fragment occurs and that mutated plans reach every outcome of the parser.
import { Result } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  extractPlanDeterministic,
  readPlanDeterministic,
} from "../../../src/domain/plan/parsePlanMarkdown.js";
import { checkProperty, propertyTimeout } from "../../helpers/property/harness.js";
import {
  anyPlanText,
  largePlanText,
  LARGE_TEXT_FRAGMENTS,
  mutatedPlanText,
  PLAN_TEXT_MUTATIONS,
  type PlanText,
} from "../../helpers/property/planText.js";

const MAX_BYTES = 65_536;
const SAMPLE_SEED = 20_261_116;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

const GENERATORS: ReadonlyArray<readonly [string, () => fc.Arbitrary<PlanText>]> = [
  ["anyPlanText", anyPlanText],
  ["mutatedPlanText", mutatedPlanText],
  ["largePlanText", largePlanText],
];

const originNames = (origin: string): string[] =>
  origin
    .slice(origin.indexOf(":") + 1)
    .split(",")
    .map((name) => name.trim());

/** Names from `names` that no sampled origin holds. */
const missingFrom = (names: readonly string[], samples: readonly PlanText[]): string[] =>
  names.filter((name) => !samples.some((s) => originNames(s.origin).includes(name)));

describe("plan text", () => {
  for (const [name, make] of GENERATORS) {
    it(
      `${name} makes texts of at most 64 KiB with no lone surrogate`,
      () => {
        checkProperty(make(), ({ text }) => {
          if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new Error("over 65,536 bytes");
          if (LONE_SURROGATE.test(text)) throw new Error("holds a lone surrogate");
          return true;
        });
      },
      propertyTimeout(),
    );
  }

  it(
    "mutatedPlanText names one to three known mutations in its origin",
    () => {
      checkProperty(mutatedPlanText(), ({ origin }) => {
        const names = originNames(origin);
        if (names.length < 1 || names.length > 3) throw new Error(`names ${names.length}`);
        const unknown = names.filter(
          (n) => !(PLAN_TEXT_MUTATIONS as readonly string[]).includes(n),
        );
        if (unknown.length > 0) throw new Error(`unknown mutation(s) ${unknown.join(", ")}`);
        return true;
      });
    },
    propertyTimeout(),
  );

  it("samples every mutation of PLAN_TEXT_MUTATIONS", () => {
    const samples = fc.sample(mutatedPlanText(), { seed: SAMPLE_SEED, numRuns: 400 });
    expect(missingFrom(PLAN_TEXT_MUTATIONS, samples)).toEqual([]);
  });

  it("samples every fragment of LARGE_TEXT_FRAGMENTS and a text over 60 KiB", () => {
    const samples = fc.sample(largePlanText(), { seed: SAMPLE_SEED, numRuns: 300 });
    expect(missingFrom(LARGE_TEXT_FRAGMENTS, samples)).toEqual([]);
    const biggest = Math.max(...samples.map((s) => Buffer.byteLength(s.text, "utf8")));
    expect(biggest).toBeGreaterThan(60 * 1024);
  });

  it("makes mutated plans that are extracted, refused, and read with a departing test line", () => {
    const samples = fc.sample(mutatedPlanText(), { seed: SAMPLE_SEED, numRuns: 400 });
    const extracted = samples.filter((s) => Result.isSuccess(extractPlanDeterministic(s.text)));
    const refused = samples.filter((s) => Result.isFailure(extractPlanDeterministic(s.text)));
    const departing = samples.filter((s) => {
      const reading = readPlanDeterministic(s.text);
      return Result.isSuccess(reading) && reading.success.departures.length > 0;
    });
    expect({
      extracted: extracted.length > 0,
      refused: refused.length > 0,
      departing: departing.length > 0,
    }).toEqual({ extracted: true, refused: true, departing: true });
  });
});
