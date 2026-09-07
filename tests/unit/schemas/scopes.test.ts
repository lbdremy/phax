import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeScopesResponse } from "../../../src/schemas/scopes.js";

describe("ScopesResponseSchema", () => {
  it("decodes a response with closed scopes", () => {
    const result = decodeScopesResponse({ closed: ["core", "adapters"] });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.closed).toEqual(["core", "adapters"]);
    }
  });

  it("decodes a response with no closed scopes", () => {
    const result = decodeScopesResponse({ closed: [] });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects a non-string entry in closed", () => {
    const result = decodeScopesResponse({ closed: [1] });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a missing closed field", () => {
    const result = decodeScopesResponse({});
    expect(Either.isLeft(result)).toBe(true);
  });
});
