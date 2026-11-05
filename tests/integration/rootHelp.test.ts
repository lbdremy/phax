import { describe, expect, it } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PHAX_RELEASE } from "../../src/schemas/release.js";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { removeTempDir } from "../helpers/tempGit.js";

// Today's root help, pinned byte for byte. The fixture is the stdout of
// `tsx src/cli/main.ts --help` run in a temporary directory (never a phase
// worktree) with COLUMNS=80. Later phases change it only where the plan's
// Root help arbitration says (each command gaining `[options]` once it takes
// --json), and phase-09's runner-written root help must reproduce it.

const repoRoot = join(fileURLToPath(import.meta.url), "../../..");
const mainTs = join(repoRoot, "src/cli/main.ts");
const fixturePath = join(repoRoot, "tests/fixtures/help/phax-root-help.txt");

const CLI_SPAWN_TIMEOUT_MS = 30_000;

function runCli(args: ReadonlyArray<string>): SpawnSyncReturns<string> {
  const cwd = mkdtempSync(join(tmpdir(), "phax-root-help-"));
  try {
    return spawnSync("tsx", [mainTs, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...phaxHomeEnv(), COLUMNS: "80" },
    });
  } finally {
    removeTempDir(cwd);
  }
}

describe("phax root help", () => {
  it(
    "--help prints today's root help byte for byte and exits 0",
    () => {
      const result = runCli(["--help"]);
      expect(result.status, `stderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toBe(readFileSync(fixturePath, "utf8"));
    },
    CLI_SPAWN_TIMEOUT_MS,
  );

  it.each([["--version"], ["-V"]])(
    "%s prints the release and exits 0",
    (flag) => {
      const result = runCli([flag]);
      expect(result.status, `stderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toBe(`${PHAX_RELEASE}\n`);
    },
    CLI_SPAWN_TIMEOUT_MS,
  );
});
