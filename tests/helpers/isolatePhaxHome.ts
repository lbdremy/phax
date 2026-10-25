import { mkdirSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterAll } from "vitest";
import { removeTempDir } from "./tempGit.js";

// Keeps every phax read and write of `~/.phax` (config.json, telemetry.json,
// model-routing.json, providers.json, runs, worktrees, the telemetry journal)
// inside a temporary home. A HOME stub alone is not enough: `PHAX_HOME_DIR` and
// `TELEMETRY_CONFIG_PATH` (src/app/loadTelemetryConfig.ts), `MODEL_ROUTING_PATH`
// and `PROVIDER_CONFIG_PATH` (src/app/loadRouting.ts) and the default state root
// (src/app/projectContext.ts) are computed from `homedir()` when their module
// loads, before any `beforeEach` runs.
//
// A suite writes one hoisted line, and calls `isolatePhaxHome()` in `beforeEach`:
//
//   vi.mock("node:os", async (importOriginal) => (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()))
//
//   let isolation: ReturnType<typeof isolatePhaxHome>;
//   beforeEach(() => { isolation = isolatePhaxHome(); });
//   afterEach(() => { isolation.restore(); });
//
// The contract has two homes. The module-level constants point at a per-file
// import-time home, created with an empty `.phax/` the first time the mocked
// `homedir()` is called and removed in `afterAll`. `homedir()` and `HOME` follow
// the per-test home `isolatePhaxHome()` creates. A file a suite writes at a
// module-level path therefore lands in the import-time home.
//
// Moving HOME also drops the developer's git identity: a suite that commits
// pairs `isolatePhaxHome()` with `isolateGit()`.
//
// A spawned phax CLI child is out of the guard's reach (tests/setup/phaxHomeGuard.ts
// watches the test process only): pass `phaxHomeEnv()` as the child's `env`.

// The real `node:os`, loaded without vitest's module graph: this file is
// imported from inside the `node:os` mock factory, which cannot import the
// module it is replacing.
const realOs = createRequire(import.meta.url)("node:os") as typeof import("node:os");

let importTimeHome: string | undefined;
let spawnHome: string | undefined;
// Per-test homes in creation order; the last one is current.
const testHomes: string[] = [];

// Nested isolations (a second world in one test) share the first one's saved
// HOME, put back when the last of them is restored.
let savedHome: string | undefined;

function newHome(prefix: string): string {
  const home = mkdtempSync(join(realOs.tmpdir(), prefix));
  mkdirSync(join(home, ".phax"));
  return home;
}

function removeImportTimeHome(): void {
  removeTempDir(importTimeHome);
  importTimeHome = undefined;
}

function removeSpawnHome(): void {
  removeTempDir(spawnHome);
  spawnHome = undefined;
}

// Registered when the helper first loads, which is while a test file is being
// collected, so it runs after the file's last test; a hook registered from
// inside a running test would not. The exit hook is the backstop for a worker
// that is torn down first.
afterAll(() => {
  removeImportTimeHome();
  removeSpawnHome();
});
process.once("exit", () => {
  removeImportTimeHome();
  removeSpawnHome();
});

function currentHome(): string {
  const current = testHomes.at(-1);
  if (current !== undefined) return current;
  if (importTimeHome === undefined) {
    importTimeHome = newHome("phax-import-home-");
  }
  return importTimeHome;
}

/**
 * The factory body of the suite's hoisted `node:os` mock: the real module with
 * `homedir()` answering the helper's current home.
 */
export function isolatedOs<T extends typeof import("node:os")>(original: T): T {
  const homedir = (): string => currentHome();
  const defaultExport = (original as { default?: object }).default;
  return {
    ...original,
    homedir,
    ...(defaultExport === undefined ? {} : { default: { ...defaultExport, homedir } }),
  };
}

/**
 * Point `homedir()` and `HOME` at a fresh per-test home with an empty `.phax/`
 * until `restore` is called; `restore` puts HOME back and removes the home.
 */
export function isolatePhaxHome(): { readonly home: string; readonly restore: () => void } {
  if (testHomes.length === 0) savedHome = process.env["HOME"];
  const home = newHome("phax-test-home-");
  testHomes.push(home);
  process.env["HOME"] = home;
  let restored = false;
  return {
    home,
    restore: () => {
      if (restored) return;
      restored = true;
      testHomes.splice(testHomes.indexOf(home), 1);
      removeTempDir(home);
      const current = testHomes.at(-1);
      if (current !== undefined) process.env["HOME"] = current;
      else if (savedHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = savedHome;
    },
  };
}

/**
 * The environment for a spawned phax CLI child: `process.env` with HOME in a
 * temporary home. That is the current per-test home when one is active,
 * otherwise a home of its own, removed in `afterAll`.
 */
export function phaxHomeEnv(): NodeJS.ProcessEnv {
  const active = testHomes.at(-1);
  if (active !== undefined) return { ...process.env, HOME: active };
  if (spawnHome === undefined) spawnHome = newHome("phax-spawn-home-");
  return { ...process.env, HOME: spawnHome };
}
