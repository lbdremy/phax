import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isolateGit } from "../helpers/isolateGit.js";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { phaseStatusFile } from "../helpers/phaseStatusFixture.js";
import { removeTempDir } from "../helpers/tempGit.js";
import {
  addNonArchivedEntry,
  apparentSize,
  branchExists,
  createPruneRepo,
  removePruneRepo,
  seedArchivedRun,
  type PruneRepo,
} from "./helpers/pruneRepo.js";

// `init`, `unlock`, `archive` and `prune` on the command runner (spec command-contracts:
// ac-json-every-command, ac-written, ac-no-person, ac-error-sentence, ac-text-unchanged): each
// spawns `tsx src/cli/main.ts` in a temporary repository, with a temporary PHAX home and an
// isolated git configuration, so no real ~/.phax or global git config is read.

const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");
const DIGEST = /^sha256:[0-9a-f]{64}$/;

let restoreGit: () => void;
let roots: PruneRepo;
let scratch: string;

function runCli(args: readonly string[], cwd: string = roots.repo): SpawnSyncReturns<string> {
  return spawnSync("tsx", [mainTs, ...args], { cwd, encoding: "utf8", env: phaxHomeEnv() });
}

/** The lines of a stream, each parsed: every line of stderr under `--json` is a message. */
function messageLines(stderr: string): Array<{ kind: string; text?: string }> {
  return stderr
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { kind: string; text?: string });
}

const sha256 = (bytes: Buffer): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const lockPath = (name: string): string => join(roots.stateRoot, "locks", `acme.${name}.lock`);

function writeLock(name: string, pid: number, updatedAt: string): void {
  mkdirSync(join(roots.stateRoot, "locks"), { recursive: true });
  writeFileSync(
    lockPath(name),
    JSON.stringify({
      runKey: `acme.${name}`,
      pid,
      status: "active",
      createdAt: updatedAt,
      updatedAt,
    }),
  );
}

/** The run folder of a run phax can read: its run status and one phase status. */
function seedRunFolder(name: string, state: string): void {
  const runDir = join(roots.stateRoot, "runs", `acme.${name}`);
  mkdirSync(join(runDir, "phase-01"), { recursive: true });
  writeFileSync(
    join(runDir, "run-status.json"),
    JSON.stringify({
      version: 1,
      namespace: "acme",
      shortName: name,
      runId: `run-${name}-0001`,
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-02T10:00:00.000Z",
      phasesCount: 1,
      currentPhaseIndex: 0,
      state,
    }),
  );
  writeFileSync(
    join(runDir, "phase-01", "status.json"),
    JSON.stringify(
      phaseStatusFile({
        phaseId: "phase-01",
        phaseIndex: 0,
        state: "review_open",
        model: "claude-sonnet-4-6",
        effort: "low",
        branchName: `phax/${name}--phase-01`,
        base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
        worktreePath: join(roots.stateRoot, "worktrees", `acme.${name}`, "phase-01"),
        createdAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-02T10:00:00.000Z",
      }),
    ),
  );
}

/** A run in the registry with the folder phax reads it from. */
function seedRun(name: string, state: "review_open" | "created"): void {
  addNonArchivedEntry(roots, name, state);
  seedRunFolder(name, state);
}

/** A process id that no process holds now. */
function deadPid(): number {
  const child = spawnSync("node", ["-e", ""]);
  return child.pid;
}

beforeAll(() => {
  restoreGit = isolateGit();
});

afterAll(() => {
  restoreGit();
});

beforeEach(() => {
  roots = createPruneRepo();
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "phax-lifecycle-scratch-")));
  return () => {
    removePruneRepo(roots);
    removeTempDir(scratch);
  };
});

describe("phax init --json", { timeout: 120_000 }, () => {
  it("--yes answers phax.json, phax.schema.json and phax.user.schema.json as written-file records", () => {
    const result = runCli(["init", "--yes", "--json"], scratch);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.endsWith("}\n")).toBe(true);
    expect(result.stdout).toContain('\n  "');
    for (const line of messageLines(result.stderr)) expect(line.kind).toBe("note");
    const value = JSON.parse(result.stdout) as {
      kind: string;
      interactive: boolean;
      schemaReference: string;
      written: Array<{ path: string; digest: string }>;
    };
    expect(value.kind).toBe("created");
    expect(value.interactive).toBe(false);
    expect(value.schemaReference).toBe("./phax.schema.json");
    expect(value.written.map((each) => each.path)).toEqual([
      "phax.json",
      "phax.schema.json",
      "phax.user.schema.json",
    ]);
    for (const each of value.written) {
      expect(each.digest).toMatch(DIGEST);
      expect(each.digest).toBe(sha256(readFileSync(join(scratch, each.path))));
    }
  });

  it("without --yes is refused with 64 and one refused line, writing no file", () => {
    const result = runCli(["init", "--json"], scratch);

    expect(result.status).toBe(64);
    expect(result.stdout).toBe("");
    const lines = messageLines(result.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe("refused");
    // The remedy is the flag that lifts the wizard, not dropping --json.
    expect(lines[0]?.text).toBe("error: --json: init prompts; pass --yes");
    expect(readdirSync(scratch)).toEqual([]);
  });

  it("without --json keeps today's lines, and an initialized directory its two-line refusal", () => {
    const first = runCli(["init", "--yes"], scratch);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain(`Created PHAX config: ${join(scratch, "phax.json")}`);
    expect(first.stdout).toContain(
      "Next: review phax.json, then run `phax validate` or `phax run`.",
    );

    const again = runCli(["init", "--yes"], scratch);
    expect(again.status).toBe(1);
    expect(again.stderr).toBe(
      `PHAX is already initialized: ${join(scratch, "phax.json")}\nUse --force to reconfigure.\n`,
    );
  });

  it("an initialized directory is one error line under --json", () => {
    runCli(["init", "--yes"], scratch);

    const result = runCli(["init", "--yes", "--json"], scratch);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    const lines = messageLines(result.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe("error");
  });
});

describe("phax unlock", { timeout: 120_000 }, () => {
  it("answers a missing lock as none", () => {
    seedRun("garden-sync", "review_open");

    const result = runCli(["unlock", "garden-sync", "--json"]);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      shortName: "garden-sync",
      removed: "none",
      qualifiedName: "acme.garden-sync",
    });
    expect(result.stdout).toBe(
      `${JSON.stringify({ shortName: "garden-sync", removed: "none", qualifiedName: "acme.garden-sync" }, null, 2)}\n`,
    );
    expect(messageLines(result.stderr)).toEqual([]);
  });

  it("answers a lock whose process is gone as stale, and removes it", () => {
    seedRun("garden-sync", "review_open");
    writeLock("garden-sync", deadPid(), new Date().toISOString());

    const result = runCli(["unlock", "garden-sync", "--json"]);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      shortName: "garden-sync",
      removed: "stale",
      qualifiedName: "acme.garden-sync",
    });
    expect(existsSync(lockPath("garden-sync"))).toBe(false);
  });

  it("answers a lock that outlived its lifetime as expired", () => {
    seedRun("garden-sync", "review_open");
    writeLock("garden-sync", process.pid, "2020-01-01T00:00:00.000Z");

    const result = runCli(["unlock", "garden-sync", "--json"]);

    expect(result.status, result.stderr).toBe(0);
    expect((JSON.parse(result.stdout) as { removed: string }).removed).toBe("expired");
  });

  it("prints today's sentences without --json", () => {
    seedRun("garden-sync", "review_open");
    expect(runCli(["unlock", "garden-sync"]).stdout).toBe(
      'No lock found for "acme.garden-sync".\n',
    );

    writeLock("garden-sync", process.pid, new Date().toISOString());
    const forced = runCli(["unlock", "garden-sync", "--force"]);
    expect(forced.status).toBe(0);
    expect(forced.stdout).toBe('Lock for "acme.garden-sync" forcibly removed.\n');

    writeLock("garden-sync", deadPid(), new Date().toISOString());
    expect(runCli(["unlock", "garden-sync"]).stdout).toBe(
      'Stale lock for "acme.garden-sync" removed (process no longer running).\n',
    );
  });

  it("a held lock keeps today's sentence and exit 1, and is one error line under --json", () => {
    seedRun("garden-sync", "review_open");
    writeLock("garden-sync", process.pid, new Date().toISOString());
    const sentence = `Lock for "acme.garden-sync" is held by pid ${process.pid}. Use --force to remove it anyway.`;

    const text = runCli(["unlock", "garden-sync"]);
    expect(text.status).toBe(1);
    expect(text.stdout).toBe("");
    expect(text.stderr).toBe(`${sentence}\n`);

    const json = runCli(["unlock", "garden-sync", "--json"]);
    expect(json.status).toBe(1);
    expect(json.stdout).toBe("");
    const lines = messageLines(json.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe("error");
    expect(JSON.parse(json.stderr)).toMatchObject({
      error: "LockHeldError",
      exit: 1,
      fields: { message: sentence, qualifiedName: "acme.garden-sync", pid: process.pid },
    });
    expect(existsSync(lockPath("garden-sync"))).toBe(true);
  });
});

describe("phax archive", { timeout: 120_000 }, () => {
  const seedReviewOpenRun = (name: string): void => seedRun(name, "review_open");

  it("answers one object naming the run", () => {
    seedReviewOpenRun("ship-it");

    const result = runCli(["archive", "ship-it", "--json"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      `${JSON.stringify({ qualifiedName: "acme.ship-it", crossProject: false }, null, 2)}\n`,
    );
    expect(messageLines(result.stderr)).toEqual([]);
    expect(existsSync(join(roots.stateRoot, "archive", "acme.ship-it"))).toBe(true);
  });

  it("prints today's success line without --json", () => {
    seedReviewOpenRun("ship-it");

    const result = runCli(["archive", "ship-it"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('Run "acme.ship-it" archived successfully.\n');
  });

  it("refuses an unfinished run with today's sentence, one error line under --json", () => {
    seedRun("half-done", "created");

    const text = runCli(["archive", "half-done"]);
    expect(text.status).toBe(1);
    expect(text.stderr).toMatch(/^Archive refused: /);

    const json = runCli(["archive", "half-done", "--json"]);
    expect(json.status).toBe(1);
    expect(json.stdout).toBe("");
    const lines = messageLines(json.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe("error");
  });
});

describe("phax prune --json", { timeout: 120_000 }, () => {
  it("--all --dry-run writes today's object byte for byte, with only message lines on stderr", () => {
    const run = seedArchivedRun(roots, { shortName: "old-idea" });

    const result = runCli(["prune", "--all", "--dry-run", "--json"]);

    expect(result.status, result.stderr).toBe(0);
    const size = apparentSize(run.archivePath);
    const expected = {
      namespace: "acme",
      dryRun: true,
      runs: [
        {
          name: "acme.old-idea",
          runId: run.entry.runId,
          outcome: "would-prune",
          archiveBytes: size,
          branchesDeleted: run.branches,
          branchesDiscarded: [],
          alreadyAbsent: [],
          remoteBranchesKept: [],
          kept: null,
        },
      ],
      totals: { pruned: 1, kept: 0, bytesFreed: size },
    };
    expect(result.stdout).toBe(`${JSON.stringify(expected, null, 2)}\n`);
    // The preview is said before the answer, as note lines.
    const lines = messageLines(result.stderr);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.kind).toBe("note");
    expect(lines[0]?.text).toBe('Prune from namespace "acme":');
    expect(existsSync(run.archivePath)).toBe(true);
  });

  it("<run> --yes applies, byte for byte today's object", () => {
    const run = seedArchivedRun(roots, { shortName: "old-idea" });
    const size = apparentSize(run.archivePath);

    const result = runCli(["prune", "old-idea", "--yes", "--json"]);

    expect(result.status, result.stderr).toBe(0);
    const expected = {
      namespace: "acme",
      dryRun: false,
      runs: [
        {
          name: "acme.old-idea",
          runId: run.entry.runId,
          outcome: "pruned",
          archiveBytes: size,
          branchesDeleted: run.branches,
          branchesDiscarded: [],
          // The seeded run has no worktree for git to list.
          alreadyAbsent: ["worktree metadata"],
          remoteBranchesKept: [],
          kept: null,
        },
      ],
      totals: { pruned: 1, kept: 0, bytesFreed: size },
    };
    expect(result.stdout).toBe(`${JSON.stringify(expected, null, 2)}\n`);
    for (const line of messageLines(result.stderr)) expect(line.kind).toBe("note");
    expect(existsSync(run.archivePath)).toBe(false);
  });

  it("with nothing archived answers today's empty document", () => {
    const result = runCli(["prune", "--all", "--yes", "--json"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      `${JSON.stringify({ namespace: "acme", dryRun: false, runs: [], totals: { pruned: 0, kept: 0, bytesFreed: 0 } }, null, 2)}\n`,
    );
  });

  it("-y and --yes prune alike", () => {
    const a = seedArchivedRun(roots, { shortName: "alpha" });
    const b = seedArchivedRun(roots, { shortName: "beta" });

    const short = runCli(["prune", "alpha", "-y"]);
    const long = runCli(["prune", "beta", "--yes"]);

    expect(short.status, short.stderr).toBe(0);
    expect(long.status, long.stderr).toBe(0);
    expect(short.stdout).toContain("✓ acme.alpha pruned");
    expect(long.stdout).toContain("✓ acme.beta pruned");
    expect(existsSync(a.archivePath)).toBe(false);
    expect(existsSync(b.archivePath)).toBe(false);
    for (const branch of [...a.branches, ...b.branches]) {
      expect(branchExists(roots, branch)).toBe(false);
    }
  });

  it("without --yes or --dry-run is refused with 64 before anything runs, never prompting", () => {
    const run = seedArchivedRun(roots, { shortName: "old-idea" });

    const result = runCli(["prune", "old-idea", "--json"]);

    expect(result.status).toBe(64);
    expect(result.stdout).toBe("");
    const lines = messageLines(result.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe("refused");
    expect(lines[0]?.text).toBe(
      "error: --json: prune prompts; pass --yes to proceed or --dry-run to preview only",
    );
    expect(existsSync(run.archivePath)).toBe(true);
  });

  it("without --json and without a terminal keeps today's preview and refusal", () => {
    const run = seedArchivedRun(roots, { shortName: "old-idea" });

    const result = runCli(["prune", "old-idea"]);

    expect(result.status).toBe(1);
    expect(result.stdout.startsWith('Prune from namespace "acme":\n')).toBe(true);
    expect(result.stderr).toBe(
      "✗ prune refused: no TTY to confirm; pass --yes to proceed or --dry-run to preview only\n",
    );
    expect(existsSync(run.archivePath)).toBe(true);
  });
});
