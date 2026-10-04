import { describe, it, expect } from "vitest";
import { Argument } from "commander";
import { emitArg } from "../../scripts/generate-usage-spec.js";

describe("emitArg", () => {
  it("marks an optional variadic argument with a trailing `...` (zero or more)", () => {
    expect(emitArg(new Argument("[short-name...]"), "")).toBe(`arg "[short-name]..."`);
  });

  it("marks a required variadic argument with a trailing `...` (one or more)", () => {
    expect(emitArg(new Argument("<plan...>"), "")).toBe(`arg "<plan>..."`);
  });

  it("leaves a single-value argument unmarked", () => {
    expect(emitArg(new Argument("<short-name>"), "")).toBe(`arg "<short-name>"`);
    expect(emitArg(new Argument("[id]"), "")).toBe(`arg "[id]"`);
  });
});
