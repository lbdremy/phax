import { expect, it } from "vitest";

it.skip("is skipped", () => {
  expect(1).toBe(1);
});

it.todo("is to do");
