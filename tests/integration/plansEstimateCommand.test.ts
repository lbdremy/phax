import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// `phax plans estimate` from source in a made-up repository, with HOME and the
// state root in a temp dir so no real ~/.phax or ~/.claude is read. Every
// invocation passes --no-probe, so no real `claude` process starts.

const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");

let base: string;
let repo: string;
let home: string;

function git(cwd: string, args: string): void {
  execSync(`git ${args}`, { cwd, stdio: "ignore" });
}

function runCli(args: string[]): SpawnSyncReturns<string> {
  return spawnSync("tsx", [mainTs, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
}

const planMd = `---
status: Draft
source-spec: null
---
# Made-up widget

## Required commands

- (none)

## phase-01 — Add the widget {#phase-01-widget}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

### Planned files to create

- src/widget.ts

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Commit subject

feat(widget): add the widget

### Commit body

Adds the widget.
`;

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-plans-estimate-")));
  repo = join(base, "repo");
  home = join(base, "home");
  mkdirSync(join(repo, "docs", "plans"), { recursive: true });
  mkdirSync(home);
  git(repo, "init -q -b main");
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
  writeFileSync(join(repo, "docs", "plans", "2610170900-widget-plan.md"), planMd);
  writeFileSync(join(repo, "docs", "plans", "widget-plan.md"), planMd);
  git(repo, "add .");
  git(
    repo,
    "-c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false commit -q -m init",
  );
});

afterAll(() => {
  removeTempDir(base);
});

describe("phax plans estimate", () => {
  it("exits 12 on a docs/plans/ plan with an off-grammar name", () => {
    const result = runCli(["plans", "estimate", "docs/plans/widget-plan.md", "--no-probe"]);
    expect(result.status).toBe(12);
    expect(result.stdout).toBe("");
  });

  it("reports thin history with no ledger and exits 0", () => {
    const result = runCli([
      "plans",
      "estimate",
      "docs/plans/2610170900-widget-plan.md",
      "--no-probe",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("History: 0 phases — an estimate needs 60; none printed");
    expect(result.stdout).toContain("Verdict: thin-history");
  });

  it("prints one JSON document whose verdict is thin-history with --json", () => {
    const result = runCli([
      "plans",
      "estimate",
      "docs/plans/2610170900-widget-plan.md",
      "--no-probe",
      "--json",
    ]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as {
      verdict: string;
      history: { phases: number };
      phases: unknown[];
      run: unknown;
    };
    expect(report.verdict).toBe("thin-history");
    expect(report.history.phases).toBe(0);
    expect(report.phases).toEqual([]);
    expect(report.run).toBeNull();
  });
});
