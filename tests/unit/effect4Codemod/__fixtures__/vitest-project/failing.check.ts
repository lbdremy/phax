import { describe, expect, it } from "vitest";

describe("failing", () => {
  it("always fails", () => {
    expect(1).toBe(2);
  });

  it("passes beside it", () => {
    expect(true).toBe(true);
  });
});
