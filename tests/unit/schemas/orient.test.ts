import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeOrientExpandResponse,
  decodeOrientIndexResponse,
} from "../../../src/schemas/orient.js";

const validRow = {
  id: "row-1",
  title: "Watch out for X",
  severity: "warn",
  trigger: "touches src/foo.ts",
};

describe("decodeOrientIndexResponse", () => {
  it("decodes a valid index response", () => {
    const result = decodeOrientIndexResponse({ rows: [validRow] });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.rows).toHaveLength(1);
      expect(result.right.rows[0]?.id).toBe("row-1");
    }
  });

  it("decodes an empty index response", () => {
    const result = decodeOrientIndexResponse({ rows: [] });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects a row with an invalid severity", () => {
    const result = decodeOrientIndexResponse({
      rows: [{ ...validRow, severity: "critical" }],
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a row missing a required field", () => {
    const { trigger: _trigger, ...rowWithoutTrigger } = validRow;
    const result = decodeOrientIndexResponse({ rows: [rowWithoutTrigger] });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a non-array rows field", () => {
    const result = decodeOrientIndexResponse({ rows: "not-an-array" });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("decodeOrientExpandResponse", () => {
  it("decodes an expand response with a body", () => {
    const result = decodeOrientExpandResponse({ row: { ...validRow, body: "Full explanation." } });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.row?.body).toBe("Full explanation.");
    }
  });

  it("decodes a null row", () => {
    const result = decodeOrientExpandResponse({ row: null });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.row).toBeNull();
    }
  });

  it("rejects an expanded row missing the body", () => {
    const result = decodeOrientExpandResponse({ row: validRow });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an expanded row with an invalid severity", () => {
    const result = decodeOrientExpandResponse({
      row: { ...validRow, severity: "critical", body: "Full explanation." },
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});
