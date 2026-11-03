import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { runner } from "../../../../src/cli/commandLibrary/commander/index.js";
import { conformance } from "../../../../src/cli/commandLibrary/contract/conformance/index.js";

// The conformance cases that need no runner (the contract's own usage spec): they hold against
// the stub runner, which dies on every call. The acceptance test conformance.test.ts skips the
// same ids.
const CONTRACT_ONLY: ReadonlyArray<string> = [
  "usage.complete-nodes",
  "usage.json-schema-listing",
  "usage.program-exits",
];

const report = await Effect.runPromise(conformance(runner));

describe("the conformance cases that hold on the contract alone", () => {
  for (const id of CONTRACT_ONLY) {
    it(`${id} holds against the stub runner`, () => {
      const entry = report.cases.find((each) => each.id === id);
      expect(entry, id).toBeDefined();
      expect(entry?.held, entry?.why).toBe(true);
    });
  }

  it("are exactly the cases the stub runner holds", () => {
    const held = report.cases.filter((entry) => entry.held).map((entry) => entry.id);
    expect(held).toEqual(CONTRACT_ONLY);
    expect(report.held).toBe(CONTRACT_ONLY.length);
  });

  it("every other case fails against the stub, saying why", () => {
    for (const entry of report.cases) {
      if (entry.held) continue;
      expect(entry.why, entry.id).toContain("command runner not implemented (phase-02)");
    }
  });
});
