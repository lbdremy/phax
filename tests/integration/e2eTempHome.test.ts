import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { loadModelRouting, loadProviderConfig } from "../../src/app/loadRouting.js";
import { DEFAULT_MODEL_ROUTING } from "../../src/domain/routing/defaults.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { childEnvironment, runCli } from "../e2e/helpers/runCli.js";
import { createTempEnv, tempPhaxHomeOf, type TempEnv } from "../e2e/helpers/tempEnv.js";
import { CLI_BOUND_MS } from "../helpers/boundedSpawn.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { isolatePhaxHome } from "../helpers/isolatePhaxHome.js";
import { removeTempDir } from "../helpers/tempGit.js";

// The e2e helpers that need no provider (plan e2e-phax-home, phase-06): createTempEnv's temporary
// phax home decodes in the branch's own format, runCli refuses anything createTempEnv did not
// make before spawning, and a spawned phax child gets PHAX_HOME at the temporary home and the
// test process's HOME.

const NO_TEMP_HOME =
  "runCli: no temporary phax home: pass the TempEnv createTempEnv returned, not a directory";

let restoreHome: () => void;
let restoreGit: () => void;
let savedPhaxHome: string | undefined;
const envs: TempEnv[] = [];
const extraDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  extraDirs.push(dir);
  return dir;
}

function newEnv(...args: Parameters<typeof createTempEnv>): TempEnv {
  const env = createTempEnv(...args);
  envs.push(env);
  return env;
}

/** Every entry directly under `dir`, with the sha256 of its content. */
function hashedListing(dir: string): ReadonlyArray<readonly [string, string]> {
  return readdirSync(dir)
    .toSorted()
    .map(
      (name) =>
        [
          name,
          createHash("sha256")
            .update(readFileSync(join(dir, name)))
            .digest("hex"),
        ] as const,
    );
}

/** Run `body` with PHAX_HOME set in the test process. */
function withPhaxHome<T>(phaxHome: string, body: () => T): T {
  const previous = process.env["PHAX_HOME"];
  process.env["PHAX_HOME"] = phaxHome;
  try {
    return body();
  } finally {
    if (previous === undefined) delete process.env["PHAX_HOME"];
    else process.env["PHAX_HOME"] = previous;
  }
}

beforeEach(() => {
  savedPhaxHome = process.env["PHAX_HOME"];
  restoreGit = isolateGit();
  ({ restore: restoreHome } = isolatePhaxHome());
});

afterEach(() => {
  if (savedPhaxHome === undefined) delete process.env["PHAX_HOME"];
  else process.env["PHAX_HOME"] = savedPhaxHome;
  for (const env of envs.splice(0)) env.cleanup();
  for (const dir of extraDirs.splice(0)) removeTempDir(dir);
  restoreHome();
  restoreGit();
});

describe("createTempEnv", () => {
  it("writes a home the branch decodes, enabling exactly the declared providers and claude-code (ac-e2e-shape)", async () => {
    const env = newEnv({ enable: ["mistral-vibe"] });

    const { providers, routing } = await withPhaxHome(env.phaxHome, () =>
      Effect.runPromise(
        Effect.all({ providers: loadProviderConfig(), routing: loadModelRouting() }).pipe(
          Effect.provide(NodeFileSystemLayer),
        ),
      ),
    );

    const enabled = Object.entries(providers.providers)
      .filter(([, entry]) => entry.enabled)
      .map(([id]) => id)
      .toSorted();
    expect(enabled).toEqual(["claude-code", "mistral-vibe"]);
    expect(routing).toEqual(DEFAULT_MODEL_ROUTING);
    expect(readdirSync(env.phaxHome).toSorted()).toEqual(["model-routing.json", "providers.json"]);
  });

  it("enables only claude-code when no provider is declared", async () => {
    const env = newEnv();
    const providers = await withPhaxHome(env.phaxHome, () =>
      Effect.runPromise(loadProviderConfig().pipe(Effect.provide(NodeFileSystemLayer))),
    );
    const enabled = Object.entries(providers.providers)
      .filter(([, entry]) => entry.enabled)
      .map(([id]) => id);
    expect(enabled).toEqual(["claude-code"]);
  });
});

describe("runCli refuses an environment createTempEnv did not make (ac-e2e-guard)", () => {
  it("throws on a bare directory before spawning", () => {
    const dir = tempDir("phax-e2e-bare-");
    // @ts-expect-error -- a directory is not a TempEnv: this must not compile
    expect(() => runCli(["validate"], dir, { boundMs: CLI_BOUND_MS })).toThrow(NO_TEMP_HOME);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("throws on a hand-made { repoDir, phaxHome } object before spawning", () => {
    const repoDir = tempDir("phax-e2e-plain-repo-");
    const phaxHome = tempDir("phax-e2e-plain-home-");
    writeFileSync(join(phaxHome, "providers.json"), "{}\n");
    const plain = { repoDir, phaxHome, cleanup: () => undefined };

    // @ts-expect-error -- an object without createTempEnv's brand is not a TempEnv
    expect(() => runCli(["validate"], plain, { boundMs: CLI_BOUND_MS })).toThrow(NO_TEMP_HOME);
    expect(() => tempPhaxHomeOf(plain)).toThrow(NO_TEMP_HOME);
    expect(readdirSync(repoDir)).toEqual([]);
    expect(readdirSync(phaxHome)).toEqual(["providers.json"]);
  });

  it("throws on an environment whose phax home is gone", () => {
    const env = createTempEnv();
    env.cleanup();
    expect(() => runCli(["validate"], env, { boundMs: CLI_BOUND_MS })).toThrow(NO_TEMP_HOME);
  });
});

describe("childEnvironment (ac-e2e-signins)", () => {
  it("keeps HOME, sets PHAX_HOME and merges the extra variables", () => {
    const child = childEnvironment("/tmp/phax-e2e-home", { EXTRA: "1" });
    expect(child["HOME"]).toBe(process.env["HOME"]);
    expect(child["PHAX_HOME"]).toBe("/tmp/phax-e2e-home");
    expect(child["EXTRA"]).toBe("1");
  });

  it("overrides a PHAX_HOME the test process exports", () => {
    const child = withPhaxHome("/tmp/phax-e2e-exported", () =>
      childEnvironment("/tmp/phax-e2e-home"),
    );
    expect(child["PHAX_HOME"]).toBe("/tmp/phax-e2e-home");
  });

  it("refuses an extra HOME or PHAX_HOME", () => {
    expect(() => childEnvironment("/tmp/phax-e2e-home", { HOME: "/tmp/elsewhere" })).toThrow(
      /HOME/,
    );
    expect(() => childEnvironment("/tmp/phax-e2e-home", { PHAX_HOME: "/tmp/elsewhere" })).toThrow(
      /PHAX_HOME/,
    );
  });
});

/** The names phax may leave in its home: its own files and run state, nothing else. */
const PHAX_HOME_ENTRY =
  /^(providers\.json|model-routing\.json|telemetry\.json|config\.json|telemetry-\d{4}-\d{2}-\d{2}\.jsonl|runs|worktrees|archive|[\w.-]*(lock|registry|ledger)[\w.-]*)$/;

describe("runCli spawns phax in the temporary home", () => {
  it("runs validate under PHAX_HOME, leaving only phax home files (ac-e2e-signins)", () => {
    const env = newEnv({ enable: ["mistral-vibe"] });

    const result = runCli(["validate"], env, { boundMs: CLI_BOUND_MS });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain(`  home:    ${env.phaxHome} (PHAX_HOME)`);
    const entries = readdirSync(env.phaxHome);
    expect(entries).toEqual(expect.arrayContaining(["providers.json", "model-routing.json"]));
    expect(entries.filter((name) => !PHAX_HOME_ENTRY.test(name))).toEqual([]);
  });

  it("overrides a PHAX_HOME the test process exports, leaving it untouched (ac-leak)", () => {
    const env = newEnv();
    const sentinel = tempDir("phax-e2e-sentinel-");
    writeFileSync(join(sentinel, "config.json"), JSON.stringify({ sentinel: true }) + "\n");
    const before = hashedListing(sentinel);

    const result = withPhaxHome(sentinel, () =>
      runCli(["validate", "--json"], env, { boundMs: CLI_BOUND_MS }),
    );

    expect(result.exitCode, result.stderr).toBe(0);
    const answer: unknown = JSON.parse(result.stdout);
    expect(answer).toHaveProperty("home", { path: env.phaxHome, from: "PHAX_HOME" });
    expect(hashedListing(sentinel)).toEqual(before);
  });
});
