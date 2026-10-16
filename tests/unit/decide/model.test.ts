import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { resolveDecideModel } from "../../../src/domain/decide/model.js";
import { DEFAULT_DECIDE_EFFORT, DEFAULT_DECIDE_MODEL } from "../../../src/schemas/phaxConfig.js";

// Spec artifact-decide §5.3 and the plan's arbitration: decide runs on Claude
// Code only, from its flags, else the built-in default.

describe("resolveDecideModel", () => {
  it("falls back to the catalog default, claude-opus-5-5 at high", () => {
    expect(DEFAULT_DECIDE_MODEL).toBe("claude-opus-5-5");
    expect(DEFAULT_DECIDE_EFFORT).toBe("high");
    expect(resolveDecideModel(undefined, undefined)).toEqual(
      Either.right({
        model: "claude-opus-5-5",
        effort: "high",
        modelSource: "catalog default",
        effortSource: "catalog default",
      }),
    );
  });

  it("takes --model and --effort when given", () => {
    expect(resolveDecideModel("claude-sonnet-5-5", "medium")).toEqual(
      Either.right({
        model: "claude-sonnet-5-5",
        effort: "medium",
        modelSource: "flag",
        effortSource: "flag",
      }),
    );
  });

  it("names each source on its own", () => {
    const resolved = resolveDecideModel(undefined, "xhigh");
    expect(Either.getOrThrow(resolved)).toMatchObject({
      model: "claude-opus-5-5",
      effort: "xhigh",
      modelSource: "catalog default",
      effortSource: "flag",
    });
  });

  it("refuses a model outside the Claude Code catalog, naming Claude Code", () => {
    for (const model of ["gpt-6-sol", "phax-mistral-medium-3.5-high", "opus", "claude-opus-9"]) {
      const resolved = resolveDecideModel(model, undefined);
      expect(Either.isLeft(resolved), model).toBe(true);
      if (Either.isLeft(resolved)) {
        expect(resolved.left).toContain(`--model ${model} is not a Claude Code model`);
        expect(resolved.left).toContain("decide runs on Claude Code only");
      }
    }
  });

  it("refuses an effort the Claude entry does not list", () => {
    const resolved = resolveDecideModel("claude-sonnet-4-6", "xhigh");
    expect(Either.isLeft(resolved)).toBe(true);
    if (Either.isLeft(resolved)) {
      expect(resolved.left).toContain("--effort xhigh");
      expect(resolved.left).toContain("low, medium, high, max");
    }
  });
});
