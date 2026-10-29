import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isolateGit } from "../helpers/isolateGit.js";
import { isolatePhaxHome, phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// `phax validate` and `phax run` from source in a made-up git repository: how
// the CLI reads phax.json's `protectedPaths`. Every spawned CLI gets a
// temporary HOME (phaxHomeEnv), and git is isolated from the person's
// configuration, so no real ~/.phax or global git config is read.

const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");

let base: string;
let repo: string;
let home: ReturnType<typeof isolatePhaxHome>;
let restoreGit: () => void;

beforeEach(() => {
  restoreGit = isolateGit();
  home = isolatePhaxHome();
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-protected-config-test-")));
  repo = join(base, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: repo, stdio: "pipe" });
  disableGitAutoMaintenance(repo);
});

afterEach(() => {
  removeTempDir(base);
  home.restore();
  restoreGit();
});

function runCli(args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync("tsx", [mainTs, ...args], { cwd: repo, encoding: "utf8", env: phaxHomeEnv() });
}

function writePhaxJson(extra: Record<string, unknown>): void {
  writeFileSync(
    join(repo, "phax.json"),
    JSON.stringify({
      version: 1,
      name: "acme-billing",
      state: { root: join(base, "state") },
      gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
      ...extra,
    }),
  );
}

const output = (result: SpawnSyncReturns<string>): string =>
  `${result.stdout ?? ""}${result.stderr ?? ""}`;

// `run` reads the configuration before the plan, so a refusal never reaches it.
const COMMANDS: readonly (readonly [string, readonly string[]])[] = [
  ["validate", ["validate"]],
  ["run", ["run", "--plan", "docs/plans/missing-plan.md"]],
];

describe("phax validate with a declared protectedPaths", { timeout: 60_000 }, () => {
  it("lists the protected paths, phax.json included, and exits 0", () => {
    writePhaxJson({ protectedPaths: ["**/steme.baseline.json"] });
    const result = runCli(["validate"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("  protected paths: **/steme.baseline.json, phax.json\n");
  });

  it("names a phax.json found below the git root by its repo-relative path", () => {
    mkdirSync(join(repo, "pkg"));
    writeFileSync(
      join(repo, "pkg", "phax.json"),
      JSON.stringify({
        version: 1,
        name: "acme-billing",
        state: { root: join(base, "state") },
        gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
        protectedPaths: ["**/steme.baseline.json"],
      }),
    );
    const result = spawnSync("tsx", [mainTs, "validate"], {
      cwd: join(repo, "pkg"),
      encoding: "utf8",
      env: phaxHomeEnv(),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("  protected paths: **/steme.baseline.json, pkg/phax.json\n");
  });

  it("prints no protected paths line for a project that declares none", () => {
    writePhaxJson({});
    const result = runCli(["validate"]);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("protected paths");
  });
});

describe.each(COMMANDS)(
  "phax %s refuses a malformed or misplaced protectedPaths",
  (_name, args) => {
    it.each([
      ["an empty list", [], "protectedPaths: a non-empty list of globs is required"],
      [
        "a .. segment",
        ["../shared/allow.json"],
        'protectedPaths[0]: "../shared/allow.json" has a .. segment',
      ],
      ["a leading /", ["/abs/x.json"], 'protectedPaths[0]: "/abs/x.json" starts with /'],
    ])(
      "exits 2 for %s, naming the entry and the rule",
      { timeout: 60_000 },
      (_case, list, message) => {
        writePhaxJson({ protectedPaths: list });
        const result = runCli(args);
        expect(result.status).toBe(2);
        expect(output(result)).toContain(message);
        expect(output(result)).toContain(join(repo, "phax.json"));
      },
    );

    it(
      "exits 2 for a glob inside a submodule, naming the entry and the submodule",
      { timeout: 60_000 },
      () => {
        writeFileSync(
          join(repo, ".gitmodules"),
          '[submodule "lint-rules"]\n\tpath = vendor/lint-rules\n\turl = https://example.test/lint-rules.git\n',
        );
        writePhaxJson({ protectedPaths: ["vendor/lint-rules/**"] });
        const result = runCli(args);
        expect(result.status).toBe(2);
        expect(output(result)).toContain(
          'protectedPaths[0]: "vendor/lint-rules/**" is inside the submodule vendor/lint-rules',
        );
      },
    );

    it(
      "exits 2 for protectedPaths in phax.local.json, naming the overlay file",
      { timeout: 60_000 },
      () => {
        writePhaxJson({});
        writeFileSync(
          join(repo, "phax.local.json"),
          JSON.stringify({ protectedPaths: ["a.json"] }),
        );
        const result = runCli(args);
        expect(result.status).toBe(2);
        expect(output(result)).toContain('"protectedPaths" is accepted only in phax.json');
        expect(output(result)).toContain(join(repo, "phax.local.json"));
      },
    );

    it(
      "exits 2 for protectedPaths in ~/.phax/config.json, naming the overlay file",
      { timeout: 60_000 },
      () => {
        writePhaxJson({});
        const overlay = join(home.home, ".phax", "config.json");
        writeFileSync(overlay, JSON.stringify({ protectedPaths: ["a.json"] }));
        const result = runCli(args);
        expect(result.status).toBe(2);
        expect(output(result)).toContain('"protectedPaths" is accepted only in phax.json');
        expect(output(result)).toContain(overlay);
      },
    );
  },
);
