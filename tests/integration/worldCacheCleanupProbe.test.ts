import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import { existsSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { cachedWorld } from "../fixtures/worlds/worldCache.js";

// Run by tests/integration/worldCache.test.ts in a nested vitest with a private TMPDIR, to see
// that the cache's directory is gone once this file ends. Alone, in the suite, it is an ordinary
// test of the cache.

it("builds a cached world", async () => {
  const buildPath = await cachedWorld("probe", async (path) => {
    boundedOutput("git", ["init", "-q", "--bare", "-b", "main", path], { boundMs: GIT_BOUND_MS });
    boundedOutput("git", ["config", "--local", "maintenance.auto", "false"], {
      boundMs: GIT_BOUND_MS,
      cwd: path,
    });
    boundedOutput("git", ["config", "--local", "gc.auto", "0"], {
      boundMs: GIT_BOUND_MS,
      cwd: path,
    });
  });
  expect(existsSync(buildPath)).toBe(true);
  const report = process.env["PHAX_WORLD_CACHE_PROBE_REPORT"];
  if (report !== undefined && report !== "") writeFileSync(report, buildPath);
});
