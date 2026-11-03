import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { runner } from "../../../../src/cli/commandLibrary/commander/index.js";
import { conformance } from "../../../../src/cli/commandLibrary/contract/conformance/index.js";

// The conformance cases that need no runner (the contract's own usage spec). The acceptance
// test conformance.test.ts skips the same ids, which it wrote against the stub runner phase-02
// replaced; they are checked here against the runner.
const CONTRACT_ONLY: ReadonlyArray<string> = [
  "usage.complete-nodes",
  "usage.json-schema-listing",
  "usage.program-exits",
];

const report = await Effect.runPromise(conformance(runner));

describe("the conformance cases that hold on the contract alone", () => {
  for (const id of CONTRACT_ONLY) {
    it(`${id} holds`, () => {
      const entry = report.cases.find((each) => each.id === id);
      expect(entry, id).toBeDefined();
      expect(entry?.held, entry?.why).toBe(true);
    });
  }
});
