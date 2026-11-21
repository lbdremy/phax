// Pinned by tests/integration/vitestAcceptanceExample.test.ts › "phax's own acceptance
// declaration": the example reads this file at HEAD and in the working tree. Never edit it: an
// uncommitted edit turns that test red. No vitest project includes tests/fixtures, so it never runs.
import { expect, test } from "vitest";

test("a pinned test the acceptance example reads and leaves alone", () => {
  expect(1 + 1).toBe(2);
});
