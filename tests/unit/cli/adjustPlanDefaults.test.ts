import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, DEFAULT_EFFORT } from "../../../src/cli/commands/adjustPlan.js";
import { entryFor } from "../../../src/domain/routing/catalog.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../../src/domain/routing/defaults.js";

describe("adjustPlan defaults", () => {
  it("defaults to claude-opus-5 at high effort", () => {
    expect(DEFAULT_MODEL).toBe("claude-opus-5");
    expect(DEFAULT_EFFORT).toBe("high");
  });

  it("names an id present in the routing catalog", () => {
    expect(entryFor(DEFAULT_MODEL, DEFAULT_PROVIDER_CONFIG)).toBeDefined();
  });
});
