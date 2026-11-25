import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFakeProviderCli, type FakeProviderCli } from "../helpers/fakeProviderCli.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import {
  type BoundedExit,
  CLI_BOUND_MS,
  CLI_LAUNCHER,
  GIT_BOUND_MS,
  boundedOutput,
  boundedSpawn,
  cliArgs,
} from "../helpers/boundedSpawn.js";

// A plan declares its one gate profile under `## Gate profile`. A plan that
// declares none, or more than one, is a structure error lint reports, and
// `phax run` refuses it before any provider spawn, worktree, run branch or run
// folder. Each test runs phax from source in its own temporary git repository,
// with its own HOME (so its own ~/.phax), an empty global git config and fake
// `claude` and `codex` on PATH that log every spawn.

let restoreGit: () => void;
let base: string;
let repo: string;
let home: string;
let stateRoot: string;
let fake: FakeProviderCli;

const MISSING = "the plan declares no gate profile (## Gate profile)";
const DOUBLED = "the plan declares more than one gate profile (## Gate profile)";

function git(args: readonly string[]): string {
  return boundedOutput("git", args, { boundMs: GIT_BOUND_MS, cwd: repo });
}

function runCli(args: readonly string[]): BoundedExit {
  return boundedSpawn(CLI_LAUNCHER, cliArgs(...args), {
    boundMs: CLI_BOUND_MS,
    cwd: repo,
    env: {
      ...process.env,
      HOME: home,
      PATH: fake.env["PATH"],
      PHAX_FAKE_CLI_LOG: fake.env["PHAX_FAKE_CLI_LOG"],
      PHAX_FAKE_CLI_SCRIPT: fake.env["PHAX_FAKE_CLI_SCRIPT"],
    },
  });
}

const PHASE = `## Required commands

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

### Test strategy

- the widget is shown — small · example · the rendered widget · in-phase

### Commit subject

feat(widget): add the widget

### Commit body

Adds the widget.
`;

/** A loose plan whose preamble holds `declaration` before its required commands. */
const planMd = (declaration: string): string =>
  `# Made-up widget\n\nAdds a widget.\n\n${declaration}${PHASE}`;

const PLANS = [
  { name: "a plan declaring no gate profile", declaration: "", message: MISSING },
  {
    name: "a plan declaring two gate profiles",
    declaration: "## Gate profile\n\n`fast`\n\n## Gate profile\n\n`full`\n\n",
    message: DOUBLED,
  },
  {
    name: "a plan declaring two ids in one section",
    declaration: "## Gate profile\n\n`fast` `full`\n\n",
    message: DOUBLED,
  },
] as const;

function writePlan(content: string): void {
  writeFileSync(join(repo, "plan.md"), content);
}

/** Every file under `dir`, relative to it; [] when it does not exist. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1));
}

beforeAll(() => {
  restoreGit = isolateGit();
});

afterAll(() => {
  restoreGit();
});

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-gate-profile-")));
  repo = join(base, "repo");
  home = join(base, "home");
  stateRoot = join(base, "state");
  mkdirSync(repo);
  mkdirSync(join(home, ".phax"), { recursive: true });
  fake = makeFakeProviderCli(join(base, "fake"));
  fake.setScript({ sessionId: "unused", finalText: "unused" });
  git(["init", "-q", "-b", "main"]);
  disableGitAutoMaintenance(repo);
  writeFileSync(join(repo, ".gitignore"), ".phax-context/\nphax.local.json\n");
  writeFileSync(
    join(repo, "phax.json"),
    JSON.stringify({
      version: 1,
      name: "made-up",
      state: { root: stateRoot },
      gateProfiles: {
        fast: [{ command: "true", surface: "local", firing: "every-phase" }],
        full: [{ command: "true", surface: "local", firing: "every-phase" }],
      },
    }),
  );
});

afterEach(() => {
  removeTempDir(base);
});

describe("phax plans lint on a plan's gate-profile declaration", () => {
  it("lints a plan declaring one profile with no finding", () => {
    writePlan(planMd("## Gate profile\n\n`fast`\n\n"));

    const result = runCli(["plans", "lint", "plan.md", "--json"]);

    expect(JSON.parse(result.stdout)).toMatchObject({ findings: [] });
    expect(result.status).toBe(0);
  });

  it.each(PLANS)("reports $name as one structure error and exits 1", ({ declaration, message }) => {
    writePlan(planMd(declaration));

    const json = runCli(["plans", "lint", "plan.md", "--json"]);
    const text = runCli(["plans", "lint", "plan.md"]);

    expect(JSON.parse(json.stdout)).toMatchObject({
      findings: [{ severity: "error", check: "structure", phase: null, message }],
    });
    expect(json.status).toBe(1);
    expect(text.stdout).toMatch(new RegExp(`error\\s+structure\\s+-\\s+${escape(message)}`));
    expect(text.status).toBe(1);
    expect(fake.invocations()).toEqual([]);
  });
});

describe("phax run on a plan's gate-profile declaration", () => {
  it.each(PLANS)(
    "refuses $name before any provider spawn, worktree, run branch or run folder",
    ({ declaration, message }) => {
      // phax run reads only an approved plan.
      writePlan(`---\nstatus: Approved\nsource-spec: null\n---\n${planMd(declaration)}`);
      git(["add", "."]);
      git([
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-q",
        "-m",
        "plan",
      ]);

      const result = runCli(["run", "--plan", "plan.md"]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`${message} — run \`phax plans lint `);
      expect(fake.invocations()).toEqual([]);
      expect(filesUnder(stateRoot)).toEqual([]);
      // The telemetry consent file is written at startup, before the plan is read.
      expect(filesUnder(join(home, ".phax")).filter((f) => f !== "telemetry.json")).toEqual([]);
      expect(git(["branch", "--list", "phax/*"])).toBe("");
      expect(git(["worktree", "list", "--porcelain"]).match(/^worktree /gm)).toHaveLength(1);
      expect(git(["status", "--porcelain"])).toBe("");
    },
  );
});

function escape(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
