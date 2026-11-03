import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { conformance } from "@steme-lab/cli-command/conformance";
import { runner } from "../src/index.ts";

const report = await Effect.runPromise(conformance(runner));

describe("Commander's runner holds every conformance case", () => {
  for (const entry of report.cases) {
    it(entry.id, () => {
      expect(entry.held, entry.why).toBe(true);
    });
  }

  it("fails no case", () => {
    expect(report.failed).toBe(0);
  });
});
