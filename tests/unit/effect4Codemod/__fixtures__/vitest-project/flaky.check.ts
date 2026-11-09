// Fails while the file named by PHAX_RATCHET_FLAKY_MARK is absent, creating it, so it
// passes on the next run.
import { existsSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";

it("passes the second time", () => {
  const mark = process.env["PHAX_RATCHET_FLAKY_MARK"];
  if (mark === undefined || mark === "") throw new Error("PHAX_RATCHET_FLAKY_MARK is not set");
  const seen = existsSync(mark);
  if (!seen) writeFileSync(mark, "seen\n");
  expect(seen).toBe(true);
});
