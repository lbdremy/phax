import { describe, expect, it } from "vitest";
import { suggestSimilar } from "../../../../src/cli/commandLibrary/commander/suggest.js";

describe("suggestSimilar, as Commander suggests", () => {
  it("names the closest option", () => {
    expect(suggestSimilar("--activ", ["--active", "--archived", "--json"])).toBe(
      "\n(Did you mean --active?)",
    );
  });

  it("names every option at the same closest distance, sorted", () => {
    expect(suggestSimilar("--trac", ["--trace", "--track"])).toBe(
      "\n(Did you mean one of --trace, --track?)",
    );
  });

  it("names a command", () => {
    expect(suggestSimilar("lnit", ["lint", "overview"])).toBe("\n(Did you mean lint?)");
  });

  it("names nothing when no candidate is close", () => {
    expect(suggestSimilar("--colour", ["--active", "--json"])).toBe("");
    expect(suggestSimilar("--x", ["--y"])).toBe("");
  });
});
