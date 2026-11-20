import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { cachedWorld } from "../fixtures/worlds/worldCache.js";

// Run by tests/integration/worldCache.test.ts in a nested vitest with a private TMPDIR, to see
// that the cache's directory is gone once this file ends. Alone, in the suite, it is an ordinary
// test of the cache.

it("builds a cached world", async () => {
  const buildPath = await cachedWorld("probe", async (path) => {
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", path], { stdio: "pipe" });
    execFileSync("git", ["config", "--local", "maintenance.auto", "false"], {
      cwd: path,
      stdio: "pipe",
    });
    execFileSync("git", ["config", "--local", "gc.auto", "0"], { cwd: path, stdio: "pipe" });
  });
  expect(existsSync(buildPath)).toBe(true);
  const report = process.env["PHAX_WORLD_CACHE_PROBE_REPORT"];
  if (report !== undefined && report !== "") writeFileSync(report, buildPath);
});
