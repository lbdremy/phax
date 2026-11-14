// In-phase tests for the property harness's configuration, its budget and the guard that keeps
// every property file on it. Every call hands the harness an explicit env object.
import { readdirSync, readFileSync } from "node:fs";
import { join, matchesGlob } from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import config from "../../../vitest.config.js";
import {
  checkProperty,
  PropertyConfigError,
  propertyTimeout,
  readPropertyParameters,
} from "../../helpers/property/harness.js";

const refusal = (env: Record<string, string>, variable: string) => {
  let thrown: unknown;
  try {
    readPropertyParameters(env);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(PropertyConfigError);
  expect((thrown as Error).message).toContain(variable);
};

describe("harness configuration", () => {
  it.each(["abc", "1.5", String(2 ** 31)])("refuses PHAX_PROPERTY_SEED=%s", (seed) => {
    refusal({ PHAX_PROPERTY_SEED: seed }, "PHAX_PROPERTY_SEED");
  });

  it.each(["0", "-1", "ten"])("refuses PHAX_PROPERTY_RUNS=%s", (runs) => {
    refusal({ PHAX_PROPERTY_RUNS: runs }, "PHAX_PROPERTY_RUNS");
  });

  it("refuses a malformed PHAX_PROPERTY_PATH", () => {
    refusal({ PHAX_PROPERTY_SEED: "1", PHAX_PROPERTY_PATH: "1:a" }, "PHAX_PROPERTY_PATH");
  });

  it.each([{}, { PHAX_PROPERTY_SEED: "random" }])(
    "refuses a path without a fixed seed (%j)",
    (seedEnv) => {
      const env = { ...seedEnv, PHAX_PROPERTY_PATH: "1:2" };
      refusal(env, "PHAX_PROPERTY_PATH");
      refusal(env, "PHAX_PROPERTY_SEED");
    },
  );

  it("accepts a path with a fixed seed", () => {
    expect(readPropertyParameters({ PHAX_PROPERTY_SEED: "7", PHAX_PROPERTY_PATH: "1:2" })).toEqual({
      seed: 7,
      path: "1:2",
      runs: 100,
      seedSource: "env",
    });
  });
});

describe("propertyTimeout", () => {
  it.each([
    [100, 30_000],
    [150, 60_000],
    [2000, 600_000],
  ])("is the unit timeout scaled for %i runs: %i ms", (runs, expected) => {
    const parameters = readPropertyParameters({ PHAX_PROPERTY_RUNS: String(runs) });
    expect(propertyTimeout(parameters)).toBe(expected);
  });
});

describe("checkProperty", () => {
  it("returns on a true property", () => {
    expect(() => {
      checkProperty(fc.integer(), (n) => n === n, {});
    }).not.toThrow();
  });

  it("throws the report for a false property", () => {
    let thrown: unknown;
    try {
      checkProperty(fc.integer({ min: 0, max: 50 }), (n) => n < 10, {});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("Property failed after");
    expect(message).toContain("Counter-example:");
    expect(message).toContain("  10");
    expect(message).toContain("PHAX_PROPERTY_SEED=");
    expect(message).toContain("pnpm test:unit tests/unit/property/harnessConfig.test.ts -t '");
  });
});

describe("property files", () => {
  const dir = join(process.cwd(), "tests/unit/property");
  const own = new Set(["harness.test.ts", "harnessConfig.test.ts"]);
  const files = readdirSync(dir).filter((name) => name.endsWith(".test.ts") && !own.has(name));

  it.each(files)("%s runs its properties through checkProperty", (name) => {
    const source = readFileSync(join(dir, name), "utf8");
    expect(source).toMatch(/\bcheckProperty\b/);
    expect(source).not.toContain("fc.assert(");
    expect(source).not.toContain("fc.check(");
  });

  it("is collected by the unit project", () => {
    const projects = (config.test?.projects ?? []) as ReadonlyArray<{
      readonly test?: { readonly name?: string; readonly include?: ReadonlyArray<string> };
    }>;
    const unit = projects.find((project) => project.test?.name === "unit");
    const include = unit?.test?.include ?? [];
    expect(include.length).toBeGreaterThan(0);
    expect(
      include.some((glob) =>
        matchesGlob("tests/unit/property/persistedFormats.property.test.ts", glob),
      ),
    ).toBe(true);
  });
});
