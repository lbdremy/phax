import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LIVE_INDEX_URL,
  guardServedSchemas,
  runGuard,
  type Fetch,
} from "../../../site/build/deploy-guard.js";

const index = (paths: ReadonlyArray<string>, releases: ReadonlyArray<string> = ["0.17.0"]) =>
  `${JSON.stringify({ releases, paths }, null, 2)}\n`;

const BUILT_0_17 = ["/schemas/registry/0.17.0.json", "/schemas/run-status/0.17.0.json"];
const LIVE_0_18 = [...BUILT_0_17, "/schemas/registry/0.18.0.json"];

const answer =
  (status: number, body = ""): Fetch =>
  async () =>
    new Response(body, { status });

const dirs: Array<string> = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A build directory serving exactly `paths`. */
function buildDir(paths: ReadonlyArray<string>): string {
  const dir = mkdtempSync(join(tmpdir(), "phax-guard-"));
  dirs.push(dir);
  for (const path of paths) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), "{}\n");
  }
  return dir;
}

describe("guardServedSchemas", () => {
  it("refuses a 0.17.0 build against a live index listing 0.18.0, naming the path", () => {
    expect(
      guardServedSchemas({ releases: ["0.17.0", "0.18.0"], paths: LIVE_0_18 }, new Set(BUILT_0_17)),
    ).toBe(
      "✗ deploy guard: this build does not serve /schemas/registry/0.18.0.json, which docs.phax.run serves",
    );
  });

  it("passes a build serving a superset of the live paths", () => {
    expect(
      guardServedSchemas(
        { releases: ["0.17.0"], paths: BUILT_0_17 },
        new Set([...LIVE_0_18, "/schemas/plan/0.18.0.json"]),
      ),
    ).toBeUndefined();
  });

  it("names only the first missing path", () => {
    const finding = guardServedSchemas(
      { releases: ["0.18.0"], paths: ["/schemas/a/0.18.0.json", "/schemas/b/0.18.0.json"] },
      new Set(),
    );
    expect(finding).toContain("/schemas/a/0.18.0.json");
    expect(finding).not.toContain("/schemas/b/0.18.0.json");
  });
});

describe("runGuard", () => {
  it("fetches the live index at docs.phax.run by default", async () => {
    const seen: Array<string> = [];
    await runGuard({
      fetch: async (url) => {
        seen.push(url);
        return new Response("", { status: 404 });
      },
      buildDir: buildDir([]),
    });
    expect(seen).toEqual([LIVE_INDEX_URL]);
    expect(LIVE_INDEX_URL).toBe("https://docs.phax.run/schemas/index.json");
  });

  it("passes a 404 as a first deploy", async () => {
    const result = await runGuard({ fetch: answer(404), buildDir: buildDir(BUILT_0_17) });
    expect(result.pass).toBe(true);
  });

  it("refuses a build that drops a live path", async () => {
    const result = await runGuard({
      fetch: answer(200, index(LIVE_0_18, ["0.17.0", "0.18.0"])),
      buildDir: buildDir(BUILT_0_17),
    });
    expect(result).toEqual({
      pass: false,
      finding:
        "✗ deploy guard: this build does not serve /schemas/registry/0.18.0.json, which docs.phax.run serves",
    });
  });

  it("passes a build serving a superset of the live index", async () => {
    const result = await runGuard({
      fetch: answer(200, index(BUILT_0_17)),
      buildDir: buildDir(LIVE_0_18),
    });
    expect(result.pass).toBe(true);
  });

  it("refuses a listed path that is a directory in the build", async () => {
    const dir = buildDir([]);
    mkdirSync(join(dir, "schemas/registry/0.17.0.json"), { recursive: true });
    const result = await runGuard({
      fetch: answer(200, index(["/schemas/registry/0.17.0.json"])),
      buildDir: dir,
    });
    expect(result.pass).toBe(false);
  });

  it("refuses a 500", async () => {
    const result = await runGuard({ fetch: answer(500, "oops"), buildDir: buildDir(BUILT_0_17) });
    expect(result).toEqual({
      pass: false,
      finding: `✗ deploy guard: ${LIVE_INDEX_URL} answered 500; expected 200 or 404`,
    });
  });

  it("refuses when the fetch throws", async () => {
    const result = await runGuard({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
      buildDir: buildDir(BUILT_0_17),
    });
    expect(result).toEqual({
      pass: false,
      finding: `✗ deploy guard: could not fetch ${LIVE_INDEX_URL}: fetch failed`,
    });
  });

  it.each([
    ["HTML", "<!doctype html><title>phax</title>"],
    ["JSON without paths", '{ "releases": ["0.17.0"] }'],
    ["paths that are not strings", '{ "releases": [], "paths": [1] }'],
    ["a path outside /schemas/", index(["/index.html"])],
    ["a path climbing out of the build", index(["/schemas/../../etc/passwd"])],
  ])("refuses a malformed body: %s", async (_name, body) => {
    const result = await runGuard({ fetch: answer(200, body), buildDir: buildDir(BUILT_0_17) });
    expect(result).toEqual({
      pass: false,
      finding: `✗ deploy guard: ${LIVE_INDEX_URL} is not a schema index { releases, paths }`,
    });
  });
});
