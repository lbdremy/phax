// Acceptance tests for the property harness (spec property-tests §5.18 to §5.22). The harness is
// a stub for now, so every test is marked `it.fails`; the phase that lands the harness removes
// the markers and these tests must pass unchanged.
//
// Every test hands the harness an explicit env object, never process.env, so the deep pass's
// PHAX_PROPERTY_SEED=random and PHAX_PROPERTY_RUNS=2000 cannot change them.
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROPERTY_RUNS,
  readPropertyParameters,
  runProperty,
  seedNotice,
} from "../../helpers/property/harness.js";

const FILE = "tests/unit/property/harness.test.ts";

const locationOf = (title: string) => ({ file: FILE, name: `harness > ${title}` });

// The sorted distinct numbers of the input — except that it drops the last one whenever the input
// holds a duplicate. Deliberately broken, so a property over it has a counter-example to report.
const dedupeSorted = (numbers: ReadonlyArray<number>): ReadonlyArray<number> => {
  const distinct = [...new Set(numbers)].toSorted((a, b) => a - b);
  return distinct.length < numbers.length ? distinct.slice(0, -1) : distinct;
};

const dedupesToSortedDistinct = (numbers: ReadonlyArray<number>): boolean => {
  const expected = [...new Set(numbers)].toSorted((a, b) => a - b);
  return JSON.stringify(dedupeSorted(numbers)) === JSON.stringify(expected);
};

const numberLists = fc.array(fc.integer({ min: 0, max: 20 }));

describe("harness", () => {
  const printTitle = "prints the seed, the path, the shrunk literal and a replay line";
  it.fails(printTitle, () => {
    const outcome = runProperty(numberLists, dedupesToSortedDistinct, {
      env: {},
      location: locationOf(printTitle),
    });

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.report).toContain(String(outcome.seed));
    expect(outcome.report).toContain(outcome.path);
    expect(outcome.report).toContain(outcome.literal);
    expect(JSON.parse(outcome.literal)).toEqual(outcome.counterexample);
    expect(outcome.replay).toContain(`PHAX_PROPERTY_SEED=${outcome.seed}`);
    expect(outcome.replay).toContain(`PHAX_PROPERTY_PATH=${outcome.path}`);
    expect(outcome.replay).toContain("pnpm test:unit tests/unit/property/harness.test.ts");
    expect(outcome.replay).toContain(`harness > ${printTitle}`);
    expect(outcome.report).toContain(outcome.replay);
  });

  const rerunTitle = "replays the same shrunk counter-example from the printed seed and path";
  it.fails(rerunTitle, () => {
    const first = runProperty(numberLists, dedupesToSortedDistinct, {
      env: {},
      location: locationOf(rerunTitle),
    });
    expect(first.kind).toBe("failed");
    if (first.kind !== "failed") return;

    const again = runProperty(numberLists, dedupesToSortedDistinct, {
      env: { PHAX_PROPERTY_SEED: String(first.seed), PHAX_PROPERTY_PATH: first.path },
      location: locationOf(rerunTitle),
    });
    expect(again.kind).toBe("failed");
    if (again.kind !== "failed") return;
    expect(again.counterexample).toEqual(first.counterexample);
    expect(again.literal).toBe(first.literal);
  });

  const seedTitle = "generates the same inputs on every run while the seed is unset";
  it.fails(seedTitle, () => {
    const recordedRun = () => {
      const inputs: Array<ReadonlyArray<number>> = [];
      const outcome = runProperty(
        numberLists,
        (numbers) => {
          inputs.push(numbers);
          return true;
        },
        { env: {}, location: locationOf(seedTitle) },
      );
      return { outcome, inputs };
    };

    const first = recordedRun();
    const second = recordedRun();
    expect(first.outcome.kind).toBe("passed");
    expect(second.outcome.kind).toBe("passed");
    expect(first.inputs).toEqual(second.inputs);

    const unsetA = readPropertyParameters({});
    const unsetB = readPropertyParameters({});
    expect(unsetA.seed).toBe(unsetB.seed);
    expect(unsetA.seedSource).toBe("default");

    const random = readPropertyParameters({ PHAX_PROPERTY_SEED: "random" });
    expect(random.seedSource).toBe("random");
    expect(seedNotice(random)).toContain(String(random.seed));

    const fixed = readPropertyParameters({ PHAX_PROPERTY_SEED: "12345" });
    expect(fixed.seed).toBe(12345);
    expect(fixed.seedSource).toBe("env");
  });

  const budgetTitle = "checks 100 inputs unless PHAX_PROPERTY_RUNS sets another count";
  it.fails(budgetTitle, () => {
    expect(readPropertyParameters({}).runs).toBe(100);
    expect(readPropertyParameters({}).runs).toBe(DEFAULT_PROPERTY_RUNS);
    expect(readPropertyParameters({ PHAX_PROPERTY_RUNS: "2000" }).runs).toBe(2000);

    let calls = 0;
    const outcome = runProperty(
      numberLists,
      () => {
        calls += 1;
        return true;
      },
      { env: {}, location: locationOf(budgetTitle) },
    );
    expect(outcome.kind).toBe("passed");
    if (outcome.kind !== "passed") return;
    expect(outcome.runs).toBe(100);
    expect(calls).toBe(100);
  });
});
