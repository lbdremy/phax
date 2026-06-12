import { describe, expect, it } from "vitest";
import { selectPrTitle } from "../../../src/domain/publish/title.js";

describe("selectPrTitle", () => {
  it("returns configuredTitle verbatim when provided", () => {
    expect(
      selectPrTitle({
        configuredTitle: "My custom title",
        runTitle: "Run Title",
        phaseTitle: "Phase Title",
        shortName: "my-run",
      }),
    ).toBe("My custom title");
  });

  it("trims configuredTitle", () => {
    expect(selectPrTitle({ configuredTitle: "  trimmed  ", shortName: "x" })).toBe("trimmed");
  });

  it("falls back to runTitle with PHAX prefix when configuredTitle is absent", () => {
    expect(
      selectPrTitle({
        runTitle: "Push branch and create PR",
        phaseTitle: "Phase One",
        shortName: "my-run",
      }),
    ).toBe("PHAX: Push branch and create PR");
  });

  it("falls back to phaseTitle with PHAX prefix when configuredTitle and runTitle are absent", () => {
    expect(
      selectPrTitle({
        phaseTitle: "Publication domain model",
        shortName: "my-run",
      }),
    ).toBe("PHAX: Publication domain model");
  });

  it("falls back to shortName with PHAX prefix when all other candidates are absent", () => {
    expect(selectPrTitle({ shortName: "my-run" })).toBe("PHAX: my-run");
  });

  it("skips empty configuredTitle and uses runTitle", () => {
    expect(selectPrTitle({ configuredTitle: "   ", runTitle: "Run Title", shortName: "x" })).toBe(
      "PHAX: Run Title",
    );
  });

  it("skips empty runTitle and uses phaseTitle", () => {
    expect(selectPrTitle({ runTitle: "", phaseTitle: "Phase Title", shortName: "x" })).toBe(
      "PHAX: Phase Title",
    );
  });

  it("skips empty phaseTitle and uses shortName", () => {
    expect(selectPrTitle({ phaseTitle: "  ", shortName: "fallback-name" })).toBe(
      "PHAX: fallback-name",
    );
  });

  it("does not prefix configuredTitle even if it looks generated", () => {
    expect(selectPrTitle({ configuredTitle: "Update files", shortName: "x" })).toBe("Update files");
  });
});
