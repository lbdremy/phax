import { describe, expect, it } from "vitest";

it("adds", () => {
  expect(1 + 1).toBe(2);
});

describe("outer", () => {
  describe("inner", () => {
    it("concatenates", () => {
      expect("a" + "b").toBe("ab");
    });
  });
});
