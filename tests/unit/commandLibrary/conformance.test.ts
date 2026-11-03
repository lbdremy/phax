import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { runner } from "../../../src/cli/commandLibrary/commander/index.js";
import { conformance } from "../../../src/cli/commandLibrary/contract/conformance/index.js";

// The ids that hold without a runner: what they check is the contract's own (`usageSpec`), so
// they hold against the stub too. tests/unit/commandLibrary/contract/conformanceContractOnly.test.ts
// checks them, and that they are exactly the ids the stub holds.
const CONTRACT_ONLY: ReadonlySet<string> = new Set([
  "usage.complete-nodes",
  "usage.json-schema-listing",
  "usage.program-exits",
]);

// The suite is asynchronous since `written.record` hashes with WebCrypto.
const report = await Effect.runPromise(conformance(runner));

describe("Commander's runner holds every conformance case", () => {
  for (const entry of report.cases) {
    if (CONTRACT_ONLY.has(entry.id)) continue;
    // Acceptance test: the stub runner dies on every call until phase-02 ports the runner.
    it.fails(entry.id, () => {
      expect(entry.held, entry.why).toBe(true);
    });
  }
});
