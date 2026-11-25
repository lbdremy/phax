import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
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

// Every command that reads a plan answers a plan nested over 32 levels by
// naming the line and the limit. Each test runs phax from source in its own
// temporary git repository, with its own HOME (so its own ~/.phax), an empty
// global git config and fake `claude` and `codex` on PATH that log every spawn:
// no real ~/.phax, provider home or global git config is read.

let restoreGit: () => void;
let base: string;
let repo: string;
let home: string;
let stateRoot: string;
let fake: FakeProviderCli;

const LIMIT_MESSAGE = "blockquotes and lists nest over 32 levels deep";

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

// A list item inside `depth − 1` blockquotes: CommonMark nests it exactly
// `depth` containers deep (the first test below checks it with the parser),
// and the measure reads it as exactly `depth`, with no over-count to lean on.
const deepItem = (depth: number): string => `${"> ".repeat(depth - 1)}- deep item`;

/** The deepest chain of blockquotes and list items in `markdown`, as the parser reads it. */
function containerDepth(markdown: string): number {
  const depthOf = (node: Nodes): number => {
    const own = node.type === "blockquote" || node.type === "listItem" ? 1 : 0;
    const children = "children" in node ? node.children : [];
    return own + Math.max(0, ...children.map(depthOf));
  };
  return depthOf(fromMarkdown(markdown));
}

const PHASES = `## Gate profile

\`fast\`

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

### Test strategy

- the widget is shown — small · example · the rendered widget · in-phase

### Commit subject

feat(widget): add the widget

### Commit body

Adds the widget.
`;

/**
 * A loose plan with a valid preamble and one phase. The preamble's context
 * paragraph ends on line `line − 2`; with `deep`, a blank line and then `deep`
 * follow, so `deep` is line `line` of the file. Without it, the plan is the
 * same with neither of those two lines.
 */
function planMd(line: number, deep: string | null): string {
  const lines = ["# Made-up widget", ""];
  while (lines.length < line - 2) lines.push(`Context line ${lines.length + 1}.`);
  if (deep !== null) lines.push("", deep);
  return `${lines.join("\n")}\n\n${PHASES}`;
}

function writePlan(content: string): void {
  writeFileSync(join(repo, "plan.md"), content);
}

function lintFindings(): { readonly status: number | null; readonly findings: unknown } {
  const result = runCli(["plans", "lint", "plan.md", "--json"]);
  const report: unknown = JSON.parse(result.stdout);
  const findings =
    typeof report === "object" && report !== null && "findings" in report
      ? report.findings
      : undefined;
  return { status: result.status, findings };
}

const nestingFinding = (line: number) => ({
  severity: "error",
  check: "structure",
  phase: null,
  message: `line ${line}: ${LIMIT_MESSAGE}`,
});

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
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-plan-nesting-")));
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
      gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
    }),
  );
});

afterEach(() => {
  removeTempDir(base);
});

describe("the deep items these tests write", () => {
  it("nest as many blockquotes and list items as they say, in the parser's own reading", () => {
    for (const depth of [32, 33, 40]) {
      expect(containerDepth(planMd(12, deepItem(depth)))).toBe(depth);
    }
  });
});

describe("phax plans lint on a plan nested over the limit", () => {
  it("reports the deep-pass counter-example as the one structure finding on line 1, and exits 1", () => {
    writePlan(">".repeat(61_440));

    const { status, findings } = lintFindings();

    expect(findings).toEqual([nestingFinding(1)]);
    expect(status).toBe(1);
  });

  it("reports a 40-level item on line 40 as the only finding", () => {
    writePlan(planMd(40, deepItem(40)));

    const { status, findings } = lintFindings();

    expect(findings).toEqual([nestingFinding(40)]);
    expect(status).toBe(1);
  });

  it("lints a plan 32 levels deep as without its deep item, and refuses its 33-level twin on line 12", () => {
    writePlan(planMd(12, null));
    const shallow = lintFindings();
    writePlan(planMd(12, deepItem(32)));
    const atLimit = lintFindings();
    writePlan(planMd(12, deepItem(33)));
    const overLimit = lintFindings();

    expect(atLimit).toEqual(shallow);
    expect(JSON.stringify(atLimit.findings)).not.toContain(LIMIT_MESSAGE);
    expect(overLimit.findings).toEqual([nestingFinding(12)]);
    expect(overLimit.status).toBe(1);
  });
});

describe("phax run on a plan nested over the limit", () => {
  it("refuses before any provider spawn, extraction cache or run state", () => {
    // phax run reads only an approved plan; the four frontmatter lines count,
    // so the deep item is line 40 of the file.
    const frontmatter = "---\nstatus: Approved\nsource-spec: null\n---\n";
    writePlan(frontmatter + planMd(36, deepItem(40)));
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
    expect(result.stderr).toContain(`line 40: ${LIMIT_MESSAGE}`);
    expect(result.stderr).toContain("run phax plans lint");
    expect(fake.invocations()).toEqual([]);
    expect(filesUnder(stateRoot)).toEqual([]);
    // The telemetry consent file is written at startup, before the plan is read.
    expect(filesUnder(join(home, ".phax")).filter((f) => f !== "telemetry.json")).toEqual([]);
    expect(git(["status", "--porcelain"])).toBe("");
  });
});

describe("phax plans overview and estimate on a plan nested over the limit", () => {
  it("overview names the line, the limit and phax plans lint", () => {
    writePlan(planMd(40, deepItem(40)));

    const result = runCli(["plans", "overview", "plan.md"]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.trimEnd()).toBe(
      `plan.md: line 40: ${LIMIT_MESSAGE} — run phax plans lint plan.md`,
    );
    expect(fake.invocations()).toEqual([]);
  });

  it("estimate names the line, the limit and phax plans lint", () => {
    writePlan(planMd(40, deepItem(40)));

    const result = runCli(["plans", "estimate", "plan.md", "--no-probe"]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.trimEnd()).toBe(
      `plan.md cannot be parsed: line 40: ${LIMIT_MESSAGE}. Run \`phax plans lint plan.md\` for every finding.`,
    );
    expect(fake.invocations()).toEqual([]);
  });
});
