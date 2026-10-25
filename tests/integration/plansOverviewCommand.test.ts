import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeFakeProviderCli, type FakeProviderCli } from "../helpers/fakeProviderCli.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import { CURRENT_STAMPS } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

// `phax plans overview` from source in a made-up git repository. HOME, the git
// configuration and the state root are all temporary, and the fake `claude`
// and `codex` are on PATH, so no real ~/.phax, ~/.claude, ~/.codex, ~/.vibe or
// global git config is read and no real provider can start.

const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");

let base: string;
let repo: string;
let scripts: string;
let fake: FakeProviderCli;
let restoreGit: () => void;

const PLAN_REL = "docs/plans/2610240900-widget-plan.md";

function git(args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runCli(args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync("tsx", [mainTs, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...phaxHomeEnv(),
      PATH: fake.env["PATH"]!,
      PHAX_FAKE_CLI_LOG: fake.env["PHAX_FAKE_CLI_LOG"]!,
      PHAX_FAKE_CLI_SCRIPT: fake.env["PHAX_FAKE_CLI_SCRIPT"]!,
    },
  });
}

function planMd(opts: { frontmatter?: string; anchor?: string } = {}): string {
  const frontmatter = opts.frontmatter ?? "---\nstatus: Draft\nsource-spec: null\n---\n";
  const anchor = opts.anchor ?? " {#phase-01-widget}";
  return `${frontmatter}# Made-up widget

## Required commands

- (none)

## phase-01 — Add the widget${anchor}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

### Planned files to create

- src/domain/x.ts
- scripts/y.sh

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
}

function commit(): void {
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
}

/** A made-up architecture provider: counts its calls, then answers with `parts`. */
function providerScript(name: string, mode: "answer" | "fail"): { command: string; calls: string } {
  const script = join(scripts, `${name}.mjs`);
  const calls = join(scripts, `${name}.calls`);
  const report = {
    $schema: schemaUrl("architecture-report", CURRENT_STAMPS["architecture-report"]),
    body: "# Architecture — made-up",
    parts: [
      {
        id: "domain",
        name: "domain",
        description: "The pure logic.",
        globs: ["src/domain/**"],
      },
    ],
  };
  writeFileSync(
    script,
    [
      `import { appendFileSync } from "node:fs";`,
      `let stdin = "";`,
      `for await (const chunk of process.stdin) stdin += chunk;`,
      `appendFileSync(${JSON.stringify(calls)}, stdin + "\\n");`,
      mode === "fail"
        ? `process.stderr.write("the provider is down\\n"); process.exit(1);`
        : `process.stdout.write(${JSON.stringify(JSON.stringify(report))});`,
    ].join("\n"),
  );
  return { command: `node ${script}`, calls };
}

function writeConfig(extra: object = {}): void {
  writeFileSync(
    join(repo, "phax.json"),
    JSON.stringify({
      version: 1,
      name: "made-up",
      state: { root: join(base, "state") },
      gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
      ...extra,
    }),
  );
}

const callCount = (calls: string): number =>
  existsSync(calls) ? readFileSync(calls, "utf8").split("\n").filter(Boolean).length : 0;

beforeAll(() => {
  restoreGit = isolateGit();
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-plans-overview-")));
  repo = join(base, "repo");
  scripts = join(base, "scripts");
  mkdirSync(join(repo, "docs", "plans"), { recursive: true });
  mkdirSync(scripts);
  fake = makeFakeProviderCli(join(base, "fake"));
  fake.setScript({ sessionId: "unused", finalText: "unused" });
  git(["init", "-q", "-b", "main"]);
  disableGitAutoMaintenance(repo);
  writeFileSync(join(repo, ".gitignore"), ".phax-context/\nphax.local.json\n");
});

afterAll(() => {
  restoreGit();
  removeTempDir(base);
});

describe("phax plans overview", () => {
  it("shows a clean Draft plan with no provider, starts no CLI and writes nothing", () => {
    writeConfig();
    writeFileSync(join(repo, PLAN_REL), planMd());
    commit();

    const result = runCli(["plans", "overview", PLAN_REL]);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      [
        "widget — Made-up widget  (Draft · no source spec)",
        "architecture: no provider configured — planned files shown",
        "",
        "phase-01 — Add the widget  claude-sonnet-5-5 · medium · headless",
        "  oracle role  none",
        "  files        src/domain/x.ts, scripts/y.sh",
        "  - the widget is shown — small · example · the rendered widget · in-phase",
        "",
        "no source spec: no criterion coverage",
        "",
      ].join("\n"),
    );
    expect(fake.invocations()).toEqual([]);
    expect(git(["status", "--porcelain"])).toBe("");
  });

  it("runs a made-up architecture provider once and groups the files by part", () => {
    const provider = providerScript("counting", "answer");
    writeConfig({ architecture: { command: provider.command } });
    commit();

    const result = runCli(["plans", "overview", PLAN_REL]);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("architecture: parts from the configured provider");
    expect(result.stdout).toContain("  domain       src/domain/x.ts");
    expect(result.stdout).toContain("  (no part)    scripts/y.sh");
    expect(callCount(provider.calls)).toBe(1);
    const request = JSON.parse(readFileSync(provider.calls, "utf8")) as { files: string[] };
    expect(request.files).toEqual(["src/domain/x.ts", "scripts/y.sh"]);
    expect(fake.invocations()).toEqual([]);
    expect(git(["status", "--porcelain"])).toBe("");
  });

  it("degrades to the planned files when the provider exits 1, with one warning line", () => {
    const provider = providerScript("failing", "fail");
    writeConfig({ architecture: { command: provider.command } });
    commit();

    const result = runCli(["plans", "overview", PLAN_REL]);

    expect(result.status).toBe(0);
    expect(callCount(provider.calls)).toBe(1);
    const stderr = result.stderr.trimEnd().split("\n");
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toMatch(/^Warning: architecture provider failed: .*the provider is down/);
    expect(result.stdout).toContain("architecture: provider failed — planned files shown");
    expect(result.stdout).toContain("  files        src/domain/x.ts, scripts/y.sh");
    expect(git(["status", "--porcelain"])).toBe("");
  });

  it("prints one JSON document and nothing else with --json", () => {
    const provider = providerScript("json", "answer");
    writeConfig({ architecture: { command: provider.command } });
    commit();

    const result = runCli(["plans", "overview", PLAN_REL, "--json"]);

    expect(result.status).toBe(0);
    const overview = JSON.parse(result.stdout) as {
      plan: string;
      name: string;
      status: string;
      architecture: unknown;
      phases: Array<{
        id: string;
        placement: unknown;
        testLines: unknown[];
        oracleRole: unknown;
      }>;
      coverage: unknown;
    };
    expect(result.stdout.trimEnd()).toBe(JSON.stringify(overview, null, 2));
    expect(overview.plan).toBe(PLAN_REL);
    expect(overview.name).toBe("widget");
    expect(overview.status).toBe("Draft");
    expect(overview.architecture).toEqual({ kind: "parts" });
    expect(overview.coverage).toEqual({ kind: "no-source-spec" });
    expect(overview.phases).toHaveLength(1);
    expect(overview.phases[0]!.oracleRole).toEqual({ kind: "none" });
    expect(overview.phases[0]!.placement).toEqual([
      { part: "domain", files: ["src/domain/x.ts"] },
      { part: null, files: ["scripts/y.sh"] },
    ]);
    expect(overview.phases[0]!.testLines).toEqual([
      {
        guarantee: "the widget is shown",
        size: "small",
        technique: "example",
        oracle: "the rendered widget",
        loop: "in-phase",
        criterion: null,
      },
    ]);
  });

  it("keeps stdout one document with --json when the provider fails", () => {
    const provider = providerScript("json-failing", "fail");
    writeConfig({ architecture: { command: provider.command } });
    commit();

    const result = runCli(["plans", "overview", PLAN_REL, "--json"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ architecture: { kind: "failed" } });
    expect(result.stderr).toMatch(/^Warning: architecture provider failed: /);
  });

  it("exits 1 with one line naming phax plans lint for a heading missing its anchor", () => {
    writeConfig();
    writeFileSync(join(repo, "plan.md"), planMd({ anchor: "" }));

    const result = runCli(["plans", "overview", "plan.md"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("plan.md: the plan does not parse — run phax plans lint plan.md\n");
  });

  it("exits 1 with the validation error, not the lint line, for an invalid frontmatter status", () => {
    writeConfig();
    const rel = "docs/plans/2610240901-bogus-plan.md";
    writeFileSync(
      join(repo, rel),
      planMd({ frontmatter: "---\nstatus: Bogus\nsource-spec: null\n---\n" }),
    );

    const result = runCli(["plans", "overview", rel]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    const stderr = result.stderr.trimEnd().split("\n");
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain(rel);
    expect(stderr[0]).toContain("invalid frontmatter");
    expect(result.stderr).not.toContain("phax plans lint");
  });

  it("exits 1 naming the read failure for a plan file that is not there", () => {
    writeConfig();

    const result = runCli(["plans", "overview", "docs/plans/missing.md"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^docs\/plans\/missing\.md: cannot be read \(/);
  });
});
