import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { LS_REGISTRY } from "../fixtures/commandAnswers/before.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Acceptance tests of spec command-contracts for `phax ls`, frozen until the
// phase that moves it onto the command runner: every test carries `.fails`,
// because `ls` is still a Commander command. Each spawns `tsx src/cli/main.ts`
// in a temporary repository with a temporary HOME and git configuration, so no
// real ~/.phax, ~/.claude, ~/.codex, ~/.vibe or global git config is read.
//   ac-unknown-option, ac-help and ac-json-schema-command for `ls`.

const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");

let base: string;
let repo: string;
let restoreGit: () => void;

function runCli(args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync("tsx", [mainTs, ...args], { cwd: repo, encoding: "utf8", env: phaxHomeEnv() });
}

beforeAll(() => {
  restoreGit = isolateGit();
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-ls-contracts-")));
  repo = join(base, "repo");
  const state = join(base, "state");
  mkdirSync(repo);
  mkdirSync(state);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  disableGitAutoMaintenance(repo);
  writeFileSync(
    join(repo, "phax.json"),
    JSON.stringify({
      version: 1,
      name: "made-up",
      state: { root: state },
      gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
    }),
  );
  writeFileSync(join(state, "registry.json"), JSON.stringify(LS_REGISTRY));
});

afterAll(() => {
  restoreGit();
  removeTempDir(base);
});

describe("phax ls and the command runner", () => {
  // ac-unknown-option
  it("refuses an undeclared option with one refused line from flags, exit 64", () => {
    const result = runCli(["ls", "--colour", "--json"]);

    expect(result.status).toBe(64);
    expect(result.stdout).toBe("");
    const lines = result.stderr.split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(1);
    const refused = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(refused).toMatchObject({ kind: "refused", source: "flags", exit: 64 });
    expect(refused["path"]).toEqual(["colour"]);
    expect(refused["text"]).toContain("--colour");
  });

  // ac-help
  it("answers --help in text, listing --json and --json-schema", () => {
    const result = runCli(["ls", "--help"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("--json");
    expect(result.stdout).toContain("--json-schema");
    expect(() => JSON.parse(result.stdout)).toThrow();
  });

  // ac-json-schema-command
  it("prints its contract with --json-schema, its output the run-list format", () => {
    const result = runCli(["ls", "--json-schema"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    const entry = JSON.parse(result.stdout) as {
      name: string[];
      stdin: unknown;
      output: unknown;
      errors: unknown;
    };
    expect(entry.name).toEqual(["ls"]);
    expect(entry.stdin).toBeNull();
    expect(entry.output).toEqual({ $ref: schemaUrl("run-list", "0.34.0") });
    expect(Array.isArray(entry.errors)).toBe(true);
  });
});
