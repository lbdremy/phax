// The Claude list-price table: every Claude-family model of the built-in
// catalog has a price, and a stream's model id resolves with a bracketed
// suffix or a date. The prices themselves are checked by review against
// Anthropic's published pricing page.
import { describe, expect, it } from "vitest";
import { DEFAULT_PROVIDER_CONFIG } from "../../../src/domain/routing/defaults.js";
import { CLAUDE_LIST_PRICES, listPriceFor } from "../../../src/domain/routing/prices.js";

const claudeCatalogIds = Object.values(
  DEFAULT_PROVIDER_CONFIG.providers["claude-code"]?.families ?? {},
).flatMap((family) => family.models.map((model) => model.id));

describe("CLAUDE_LIST_PRICES", () => {
  it("reads a non-empty Claude catalog", () => {
    expect(claudeCatalogIds.length).toBeGreaterThan(0);
  });

  it.each(claudeCatalogIds)("prices the catalog model %s", (id) => {
    expect(CLAUDE_LIST_PRICES[id]).toBeDefined();
  });

  it("holds positive prices, a cache read below input and a 1h write above a 5m write", () => {
    for (const [id, price] of Object.entries(CLAUDE_LIST_PRICES)) {
      expect(price.inputUsdPerMTok, id).toBeGreaterThan(0);
      expect(price.outputUsdPerMTok, id).toBeGreaterThan(price.inputUsdPerMTok);
      expect(price.cacheReadUsdPerMTok, id).toBeLessThan(price.inputUsdPerMTok);
      expect(price.cacheWrite1hUsdPerMTok, id).toBeGreaterThan(price.cacheWrite5mUsdPerMTok);
    }
  });
});

describe("listPriceFor", () => {
  it("resolves an exact id", () => {
    expect(listPriceFor("claude-opus-5-5")).toBe(CLAUDE_LIST_PRICES["claude-opus-5-5"]);
  });

  it("ignores a trailing bracketed suffix", () => {
    expect(listPriceFor("claude-opus-5-5[1m]")).toBe(CLAUDE_LIST_PRICES["claude-opus-5-5"]);
  });

  it("compares ids without their trailing date, on both sides", () => {
    expect(listPriceFor("claude-haiku-4-5")).toBe(CLAUDE_LIST_PRICES["claude-haiku-4-5-20251001"]);
    expect(listPriceFor("claude-sonnet-5-20261001")).toBe(CLAUDE_LIST_PRICES["claude-sonnet-5"]);
    expect(listPriceFor("claude-haiku-4-5-20260101[1m]")).toBe(
      CLAUDE_LIST_PRICES["claude-haiku-4-5-20251001"],
    );
  });

  it("returns undefined for an unknown id", () => {
    expect(listPriceFor("claude-example-9")).toBeUndefined();
    expect(listPriceFor("gpt-example")).toBeUndefined();
    expect(listPriceFor("toString")).toBeUndefined();
    expect(listPriceFor("")).toBeUndefined();
  });
});
