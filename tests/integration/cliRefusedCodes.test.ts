// The bridge's codes end to end: `tsx src/cli/main.ts` in a made-up git repository, HOME and
// the git configuration temporary. A Commander refusal exits 64 with Commander's text, a group
// called alone writes its help on stderr and exits 64, `phax --json-schema` prints the runner
// program's catalogue, and `phax --usage` prints the committed phax.usage.kdl.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isolateGit } from "../helpers/isolateGit.js";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

const repoRoot = join(fileURLToPath(import.meta.url), "../../..");
const mainTs = join(repoRoot, "src/cli/main.ts");

let base: string;
let repo: string;
let restoreGit: () => void;

function runCli(args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync("tsx", [mainTs, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: phaxHomeEnv(),
  });
}

beforeAll(() => {
  restoreGit = isolateGit();
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-cli-refused-")));
  repo = join(base, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo, stdio: "ignore" });
  disableGitAutoMaintenance(repo);
  writeFileSync(
    join(repo, "phax.json"),
    JSON.stringify({
      version: 1,
      name: "made-up",
      state: { root: join(base, "state") },
      gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
    }),
  );
});

afterAll(() => {
  restoreGit();
  removeTempDir(base);
});

describe("a refused call exits 64 with Commander's text", { timeout: 60_000 }, () => {
  it.each([
    [
      "an unknown command in a group",
      ["plans", "lnit", "x"],
      "error: unknown command 'lnit'\n(Did you mean lint?)\nRun `phax --help` for usage.\n",
    ],
    [
      "an unknown option",
      ["validate", "--colour"],
      "error: unknown option '--colour'\nRun `phax --help` for usage.\n",
    ],
    [
      "a missing argument",
      ["unlock"],
      "error: missing required argument 'short-name'\nRun `phax --help` for usage.\n",
    ],
    // The runner's commands word their refusals as Commander does.
    [
      "an unknown option of a runner command, with its suggestion",
      ["ls", "--activ"],
      "error: unknown option '--activ'\n(Did you mean --active?)\nRun `phax --help` for usage.\n",
    ],
    [
      "an unknown option of a runner command",
      ["ls", "--colour"],
      "error: unknown option '--colour'\nRun `phax --help` for usage.\n",
    ],
    [
      "a missing argument of a runner command",
      ["plans", "lint"],
      "error: missing required argument 'plan'\nRun `phax --help` for usage.\n",
    ],
  ])("%s", (_label, args, stderr) => {
    const result = runCli(args);
    expect(result.status).toBe(64);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(stderr);
  });

  it.each([[["artifact"]], [["artifact", "new"]], [["agent", "setup"]]])(
    "%j alone writes its help on stderr and exits 64",
    (args) => {
      const result = runCli(args);
      expect(result.status).toBe(64);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(`Usage: phax ${args.join(" ")} [options] [command]`);
      expect(result.stderr).toContain("Commands:");
    },
  );
});

describe("phax --json-schema", { timeout: 60_000 }, () => {
  it("prints the runner program's catalogue", () => {
    const result = runCli(["--json-schema"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const catalogue = JSON.parse(result.stdout) as {
      program: string;
      version: string;
      exits: unknown;
      commands: unknown[];
      messages: Record<string, unknown>;
    };
    expect(catalogue.program).toBe("phax");
    expect(catalogue.version).toBe("0.34.0");
    expect(catalogue.exits).toEqual({ refused: 64, defect: 70 });
    expect(Object.keys(catalogue.messages).toSorted()).toEqual([
      "defect",
      "error",
      "note",
      "refused",
      "written",
    ]);
  });
});

describe("phax --usage", { timeout: 60_000 }, () => {
  const committed = (): string => readFileSync(join(repoRoot, "phax.usage.kdl"), "utf8");

  it.each([[["--usage"]], [["--usage", "--usage-format", "kdl"]]])(
    "%j prints the committed phax.usage.kdl and exits 0",
    (args) => {
      const result = runCli(args);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(committed());
    },
  );
});
