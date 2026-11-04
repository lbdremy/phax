import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WIDGET_PLAN_REL, widgetPlanMd } from "../fixtures/commandAnswers/before.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// `phax plans status`, `plans overlap` and `plans estimate` through the command runner, spawned
// as `tsx src/cli/main.ts` in a temporary repository with a temporary HOME and git
// configuration: no real ~/.phax, ~/.claude, ~/.codex, ~/.vibe or global git config is read, no
// provider runs and no probe is made (`--no-probe`, `--no-extract`).
//   ac-json-every-command, ac-error-sentence, ac-written and ac-groups.

const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");

const MESSAGE_KINDS = ["note", "written", "error", "refused", "defect"];
const OTHER_PLAN_REL = "docs/plans/2610240910-other-plan.md";
const STALE_PLAN_REL = "docs/plans/2610240920-stale-plan.md";

let base: string;
let repo: string;
let restoreGit: () => void;

function runCli(args: readonly string[], cwd = repo): SpawnSyncReturns<string> {
  return spawnSync("tsx", [mainTs, ...args], { cwd, encoding: "utf8", env: phaxHomeEnv() });
}

function write(rel: string, content: string): void {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), content);
}

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "ignore" });
}

function messageLines(stderr: string): ReadonlyArray<{ kind: string }> {
  return stderr
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { kind: string });
}

beforeAll(() => {
  restoreGit = isolateGit();
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-plans-inspection-")));
  repo = join(base, "repo");
  const state = join(base, "state");
  mkdirSync(repo);
  mkdirSync(state);
  git("-C", repo, "init", "-q", "-b", "main");
  disableGitAutoMaintenance(repo);
  // isolateGit leaves no identity: the fixture's commit names its own.
  git("-C", repo, "config", "--local", "user.name", "Ada Example");
  git("-C", repo, "config", "--local", "user.email", "ada@example.test");
  write(
    "phax.json",
    JSON.stringify({
      version: 1,
      name: "made-up",
      state: { root: state },
      gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
    }),
  );
  write(WIDGET_PLAN_REL, widgetPlanMd());
  write(OTHER_PLAN_REL, widgetPlanMd().replace("src/domain/x.ts", "src/domain/z.ts"));
  // An Approved plan with no approval record: stale-computed (missing-record).
  write(STALE_PLAN_REL, widgetPlanMd().replace("status: Draft", "status: Approved"));
  git("add", "-A");
  git("commit", "-q", "-m", "initial");
});

afterAll(() => {
  restoreGit();
  removeTempDir(base);
});

describe("the three plans commands under --json", () => {
  const CALLS: ReadonlyArray<readonly string[]> = [
    ["plans", "status", "--json"],
    ["plans", "overlap", WIDGET_PLAN_REL, OTHER_PLAN_REL, "--no-extract", "--json"],
    ["plans", "estimate", WIDGET_PLAN_REL, "--no-probe", "--json"],
  ];

  // ac-json-every-command
  it("each writes one indented JSON value on stdout and only message lines on stderr", () => {
    for (const args of CALLS) {
      const result = runCli(args);
      const call = args.join(" ");

      expect(result.status, `${call}: ${result.stderr}`).toBe(0);
      const value: unknown = JSON.parse(result.stdout);
      expect(result.stdout, call).toBe(`${JSON.stringify(value, null, 2)}\n`);
      // Today's unversioned objects: no $schema.
      expect(Object.keys(value as object), call).not.toContain("$schema");
      for (const message of messageLines(result.stderr)) {
        expect(MESSAGE_KINDS, call).toContain(message.kind);
      }
    }
  });

  it("answers today's keys, in today's order", () => {
    const status = JSON.parse(runCli(CALLS[0]!).stdout) as object;
    const overlap = JSON.parse(runCli(CALLS[1]!).stdout) as object;
    const estimate = JSON.parse(runCli(CALLS[2]!).stdout) as { verdict: string };

    expect(Object.keys(status)).toEqual(["report", "orphanRecords"]);
    expect(Object.keys(overlap)).toEqual([
      "footprints",
      "edges",
      "cleanPairs",
      "largestParallelSafeSet",
      "waves",
      "exhaustiveSearchSkipped",
    ]);
    expect(estimate.verdict).toBe("thin-history");
  });

  it("prints today's text without --json", () => {
    const status = runCli(["plans", "status"]);
    const overlap = runCli(["plans", "overlap", WIDGET_PLAN_REL, OTHER_PLAN_REL, "--no-extract"]);
    const estimate = runCli(["plans", "estimate", WIDGET_PLAN_REL, "--no-probe"]);

    expect(status.status, status.stderr).toBe(0);
    expect(status.stdout).toContain(`${STALE_PLAN_REL}: STALE`);
    expect(overlap.status, overlap.stderr).toBe(0);
    expect(overlap.stdout).toContain("2610240900-widget-plan");
    expect(estimate.status, estimate.stderr).toBe(0);
    expect(estimate.stdout).toContain("thin-history");
  });
});

describe("plans status --apply", () => {
  // ac-written
  it("lists each flipped plan in `written`, with a sha256 digest of the bytes read back", () => {
    const result = runCli(["plans", "status", "--apply", "--json"]);

    expect(result.status, result.stderr).toBe(0);
    const value = JSON.parse(result.stdout) as {
      applied: Array<{ path: string }>;
      written: Array<{ path: string; format: string | null; digest: string }>;
    };
    expect(Object.keys(value)).toEqual(["report", "orphanRecords", "applied", "written"]);
    expect(value.applied.map((flip) => flip.path)).toEqual([STALE_PLAN_REL]);
    expect(value.written).toHaveLength(1);
    const [record] = value.written;
    expect(record?.path).toBe(STALE_PLAN_REL);
    expect(record?.format).toBeNull();
    expect(record?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(readFileSync(join(repo, STALE_PLAN_REL), "utf8")).toContain("status: Stale");
  });
});

describe("a broken phax.json", () => {
  const CALLS: ReadonlyArray<readonly string[]> = [
    ["plans", "status"],
    ["plans", "overlap", WIDGET_PLAN_REL, OTHER_PLAN_REL, "--no-extract"],
    ["plans", "estimate", WIDGET_PLAN_REL, "--no-probe"],
  ];
  let broken: string;

  beforeAll(() => {
    broken = join(base, "broken");
    mkdirSync(broken);
    writeFileSync(join(broken, "phax.json"), "{ not json");
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: broken });
  });

  // ac-error-sentence
  it("exits 1 with `Config error: …` on stderr, and nothing on stdout", () => {
    for (const args of CALLS) {
      const result = runCli(args, broken);
      expect(result.status, args.join(" ")).toBe(1);
      expect(result.stderr, args.join(" ")).toMatch(/^Config error: /);
      expect(result.stdout).toBe("");
    }
  });

  // ac-error-sentence
  it("writes one `error` line with exit 1 under --json", () => {
    for (const args of CALLS) {
      const result = runCli([...args, "--json"], broken);
      expect(result.status, args.join(" ")).toBe(1);
      const lines = messageLines(result.stderr) as Array<{ kind: string; exit?: number }>;
      expect(lines.filter((line) => line.kind === "error")).toHaveLength(1);
      expect(lines.find((line) => line.kind === "error")?.exit).toBe(1);
      expect(result.stdout).toBe("");
    }
  });
});

describe("the plans group", () => {
  // ac-groups
  it("alone writes its help, with today's long help, on stderr and exits 64", () => {
    const result = runCli(["plans"]);

    expect(result.status).toBe(64);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Parent command for reporting on plans");
    expect(result.stderr).toContain("Examples:");
    for (const name of ["status", "overlap", "lint", "overview", "estimate"]) {
      expect(result.stderr).toContain(name);
    }
  });
});
