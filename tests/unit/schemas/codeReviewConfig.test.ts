import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodePhaxConfig,
  decodePhaxUserOverlay,
  resolveCodeReviewConfig,
} from "../../../src/schemas/phaxConfig.js";

const minimalValidPhaxConfig = {
  version: 1,
  name: "test",
  state: { root: ".phax" },
  gateProfiles: { full: [{ command: "pnpm test", surface: "local", firing: "every-phase" }] },
} as const;

describe("review.code.enabled", () => {
  it("is false when absent, when review.code holds only model and effort, and without review.code", () => {
    expect(resolveCodeReviewConfig(undefined).enabled).toBe(false);
    expect(resolveCodeReviewConfig({}).enabled).toBe(false);
    expect(resolveCodeReviewConfig({ model: "claude-sonnet-5-5", effort: "medium" }).enabled).toBe(
      false,
    );
  });

  it.each([true, false])("resolves %s as given, keeping the model and effort", (enabled) => {
    expect(
      resolveCodeReviewConfig({ enabled, model: "claude-sonnet-5-5", effort: "medium" }),
    ).toEqual({ enabled, model: "claude-sonnet-5-5", effort: "medium" });
  });

  it("decodes in phax.json", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      review: { code: { enabled: true } },
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) expect(result.right.review?.code?.enabled).toBe(true);
  });

  it.each(["true", 1, null])("refuses %j in phax.json", (value) => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      review: { code: { enabled: value } },
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("decodes in the user overlay", () => {
    const result = decodePhaxUserOverlay({ review: { code: { enabled: true } } });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) expect(result.right.review?.code?.enabled).toBe(true);
  });

  it.each(["true", 1, null])("refuses %j in the user overlay", (value) => {
    const result = decodePhaxUserOverlay({ review: { code: { enabled: value } } });
    expect(Either.isLeft(result)).toBe(true);
  });
});
