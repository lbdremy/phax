// Properties of the bridge from effect/Arbitrary into fast-check: a (seed, size) pair always maps
// to the same value, every value decodes under the schema it was derived from, a schema effect
// cannot derive is reported by its label, and a shrunk counter-example still fails.
import { isDeepStrictEqual } from "node:util";
import { Result, Schema } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CostLedgerFileSchema } from "../../../src/schemas/costLedger.js";
import { PlanDocumentFileSchema } from "../../../src/schemas/planDocument.js";
import { PlanPath } from "../../../src/schemas/planPath.js";
import { RunStatusFileSchema } from "../../../src/schemas/status.js";
import { fromSchema, sampleOnce } from "../../helpers/property/fromEffect.js";
import { checkProperty, propertyTimeout, runProperty } from "../../helpers/property/harness.js";

const decodesUnder =
  <S extends Schema.Top>(schema: S) =>
  (value: unknown): boolean =>
    Result.isSuccess(Schema.decodeUnknownResult(schema as never)(value));

const seedAndSize = fc.record({ seed: fc.integer(), size: fc.integer({ min: 0, max: 10 }) });

describe("fromEffect", () => {
  it(
    "yields the same value for the same seed and size",
    () => {
      checkProperty(seedAndSize, ({ seed, size }) =>
        isDeepStrictEqual(
          sampleOnce("run-status", RunStatusFileSchema, seed, size),
          sampleOnce("run-status", RunStatusFileSchema, seed, size),
        ),
      );
    },
    propertyTimeout(),
  );

  it(
    "yields run-status values its schema decodes",
    () => {
      checkProperty(
        fromSchema("run-status", RunStatusFileSchema),
        decodesUnder(RunStatusFileSchema),
      );
    },
    propertyTimeout(),
  );

  it(
    "yields cost-ledger values its schema decodes",
    () => {
      checkProperty(
        fromSchema("cost-ledger", CostLedgerFileSchema),
        decodesUnder(CostLedgerFileSchema),
      );
    },
    propertyTimeout(),
  );

  // The plan document's root checks (lineage pairing, question checks) discard most samples
  // above size 3, so this derivation stays small; the format registry repairs instead.
  it(
    "yields plan-document values its schema decodes",
    () => {
      checkProperty(
        fromSchema("plan-document", PlanDocumentFileSchema, { maxSize: 2 }),
        decodesUnder(PlanDocumentFileSchema),
      );
    },
    propertyTimeout(),
  );

  it(
    "yields only canonical plan paths",
    () => {
      checkProperty(fromSchema("plan path", PlanPath), decodesUnder(PlanPath));
    },
    propertyTimeout(),
  );

  it(
    "samples a plan path from size 1 without exhausting",
    () => {
      const positiveSize = fc.record({ seed: fc.integer(), size: fc.integer({ min: 1, max: 10 }) });
      checkProperty(
        positiveSize,
        ({ seed, size }) => sampleOnce("plan path", PlanPath, seed, size) !== undefined,
      );
    },
    propertyTimeout(),
  );

  // At size 0 every string is empty, which PlanPath refuses: the sample exhausts, and fromSchema
  // filters it out rather than failing.
  it("reports an exhausted sample as undefined", () => {
    expect(sampleOnce("plan path", PlanPath, 0, 0)).toBeUndefined();
  });

  it("names the label of a schema effect cannot derive", () => {
    const opaque = Schema.declare((input): input is string => typeof input === "string");
    expect(() => fromSchema("opaque-format", opaque)).toThrow(
      /^cannot derive a generator for opaque-format: /,
    );
  });

  const shrinkTitle = "reports a shrunk counter-example that still fails";
  it(shrinkTitle, () => {
    const shorterThanThree = (numbers: ReadonlyArray<number>): boolean => numbers.length < 3;
    const outcome = runProperty(
      fromSchema("finite list", Schema.Array(Schema.Finite)),
      shorterThanThree,
      {
        env: {},
        location: {
          file: "tests/unit/property/fromEffect.property.test.ts",
          name: `fromEffect > ${shrinkTitle}`,
        },
      },
    );
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(shorterThanThree(outcome.counterexample)).toBe(false);
  });
});
