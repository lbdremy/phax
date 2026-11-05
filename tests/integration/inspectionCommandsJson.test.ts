import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { phaseStatusFile } from "../helpers/phaseStatusFixture.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// The seven root inspection commands (`validate`, `session-info`, `path`, `brief`,
// `architecture`, `completions`, `report`) through the command runner, spawned as
// `tsx src/cli/main.ts` in temporary repositories with a temporary HOME and git configuration, a
// fixture provider script for `brief` and `architecture`, a fake `usage` and a fake `gh` first on
// PATH: no real ~/.phax, ~/.claude, ~/.codex or ~/.vibe, no global git config, no real provider
// and no real `gh` is touched.
//   ac-json-every-command, ac-text-unchanged and ac-error-sentence.

const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");

const NAMESPACE = "made-up";
const SHORT = "my-run";
const NOW = "2026-10-24T09:00:00.000Z";
const MESSAGE_KINDS = ["note", "written", "error", "refused", "defect"];

let base: string;
let repo: string;
let providerRepo: string;
let state: string;
let worktree: string;
let fakeBin: string;
let ghLog: string;
let restoreGit: () => void;

function runCli(args: readonly string[], cwd = repo): SpawnSyncReturns<string> {
  // The fake `usage` and `gh` come first on PATH; HOME is a temporary home.
  return spawnSync("tsx", [mainTs, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...phaxHomeEnv(),
      PATH: `${fakeBin}:${process.env["PATH"] ?? ""}`,
      FAKE_GH_LOG: ghLog,
    },
  });
}

function write(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function messageLines(stderr: string): ReadonlyArray<{ kind: string }> {
  return stderr
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { kind: string });
}

function executable(name: string, source: string): string {
  const file = join(fakeBin, name);
  writeFileSync(file, source);
  chmodSync(file, 0o755);
  return file;
}

/** A provider that reads its request, then prints the answer it was given. */
function providerScript(name: string, answer: unknown): string {
  const file = join(base, name);
  writeFileSync(
    file,
    `let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => { process.stdout.write(${JSON.stringify(JSON.stringify(answer))}); });
`,
  );
  return file;
}

function initRepo(root: string, config: Record<string, unknown>): void {
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  disableGitAutoMaintenance(root);
  // isolateGit leaves no identity: the fixture's commit names its own.
  git(root, "config", "--local", "user.name", "Ada Example");
  git(root, "config", "--local", "user.email", "ada@example.test");
  write(root, "phax.json", JSON.stringify(config));
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "initial");
}

beforeAll(() => {
  restoreGit = isolateGit();
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-inspection-root-")));
  state = join(base, "state");
  fakeBin = join(base, "bin");
  ghLog = join(base, "gh.log");
  worktree = join(base, "worktrees", "phase-01");
  mkdirSync(state);
  mkdirSync(fakeBin);
  mkdirSync(worktree, { recursive: true });

  const common = {
    version: 1,
    name: NAMESPACE,
    state: { root: state },
    gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
  };
  repo = join(base, "repo");
  initRepo(repo, common);
  providerRepo = join(base, "provider-repo");
  const briefReport = {
    $schema: currentSchemaUrl("brief-report"),
    rules: [],
    findings: [],
  };
  const architectureReport = {
    $schema: currentSchemaUrl("architecture-report"),
    body: "A layered CLI.",
    parts: [{ id: "cli", name: "CLI", description: "The command layer", globs: ["src/cli/**"] }],
  };
  initRepo(providerRepo, {
    ...common,
    brief: { command: `node ${providerScript("brief.cjs", briefReport)}`, push: "findings" },
    architecture: { command: `node ${providerScript("architecture.cjs", architectureReport)}` },
  });

  // A run with one review_open phase and its worktree path.
  const runPath = join(state, "runs", `${NAMESPACE}.${SHORT}`);
  write(
    runPath,
    "run-status.json",
    JSON.stringify({
      version: 1,
      namespace: NAMESPACE,
      shortName: SHORT,
      runId: "run-abc",
      state: "review_open",
      createdAt: NOW,
      updatedAt: NOW,
      phasesCount: 1,
      gateProfileId: "fast",
    }),
  );
  write(
    runPath,
    "phase-01/status.json",
    JSON.stringify(
      phaseStatusFile({
        phaseId: "phase-01",
        phaseIndex: 0,
        state: "review_open",
        model: "claude-sonnet-5-5",
        effort: "low",
        branchName: `ai/${SHORT}--phase-01`,
        base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
        createdAt: NOW,
        updatedAt: NOW,
        worktreePath: worktree,
      }),
    ),
  );
  // The run's telemetry, for `report <run>`.
  write(
    state,
    `runs/${SHORT}/semantic.jsonl`,
    `${JSON.stringify({ ts: NOW, type: "step.started", runId: "run-abc", step: "phase-01" })}\n`,
  );

  // A fake `usage`: prints a script naming the shell it was asked for.
  executable(
    "usage",
    `#!/bin/sh
cat > /dev/null
printf 'FAKE COMPLETION %s\\n' "$3"
`,
  );
  // A fake `gh`: logs each call, answers an issue and a gist with a URL.
  executable(
    "gh",
    `#!/bin/sh
echo "$*" >> "$FAKE_GH_LOG"
case "$1 $2" in
  "issue create") echo "https://github.com/made-up/repo/issues/7" ;;
  "gist create") echo "https://gist.github.com/made-up/abc" ;;
  *) echo '{"url":"https://github.com/made-up/repo"}' ;;
esac
`,
  );
});

afterAll(() => {
  restoreGit();
  removeTempDir(base);
});

describe("the seven root inspection commands under --json", () => {
  interface Call {
    readonly args: readonly string[];
    readonly cwd?: string;
    readonly keys: readonly string[];
  }
  const CALLS: ReadonlyArray<Call> = [
    { args: ["validate"], keys: ["namespace", "sources", "protectedPaths", "assignments", "plan"] },
    {
      args: ["path", SHORT],
      keys: ["qualifiedName", "crossProject", "worktreePath"],
    },
    {
      args: ["session-info", SHORT],
      keys: ["qualifiedName", "crossProject", "runId", "state", "phase", "stop", "binding"],
    },
    { args: ["completions", "zsh"], keys: ["shell", "script"] },
    { args: ["report", SHORT], keys: ["issueUrl"] },
    { args: ["brief", "src/a.ts"], cwd: "provider", keys: ["files", "report", "recordWarning"] },
    { args: ["architecture"], cwd: "provider", keys: ["kind", "report", "bounds", "scoped"] },
  ];

  // ac-json-every-command
  it("each writes one indented JSON value on stdout and only message lines on stderr", () => {
    for (const call of CALLS) {
      const result = runCli(
        [...call.args, "--json"],
        call.cwd === "provider" ? providerRepo : repo,
      );
      const label = call.args.join(" ");
      expect(result.status, `${label}: ${result.stderr}`).toBe(0);
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(result.stdout, label).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
      expect(Object.keys(parsed), label).toEqual(expect.arrayContaining([...call.keys]));
      expect(parsed["$schema"], label).toBeUndefined();
      for (const line of messageLines(result.stderr)) {
        expect(MESSAGE_KINDS, label).toContain(line.kind);
      }
    }
    // Seven sequential CLI cold-starts: the default 30s budget is too tight under the full
    // parallel run, as for the other multi-spawn tests of this file.
  }, 120_000);

  it("answers the facts of each command", () => {
    const validated = JSON.parse(runCli(["validate", "--json"]).stdout) as {
      namespace: string;
      sources: { project: string; local: string | null; global: string | null };
      plan: unknown;
    };
    expect(validated.namespace).toBe(NAMESPACE);
    expect(validated.sources.project).toBe(join(repo, "phax.json"));
    expect(validated.sources.local).toBeNull();
    expect(validated.plan).toBeNull();

    const path = JSON.parse(runCli(["path", SHORT, "--json"]).stdout) as unknown;
    expect(path).toEqual({
      qualifiedName: `${NAMESPACE}.${SHORT}`,
      crossProject: false,
      worktreePath: worktree,
    });

    const info = JSON.parse(runCli(["session-info", SHORT, "--json"]).stdout) as {
      runId: string;
      state: string;
      phase: { id: string };
      binding: unknown;
      debug: unknown;
    };
    expect(info.runId).toBe("run-abc");
    expect(info.state).toBe("review_open");
    expect(info.phase.id).toBe("phase-01");
    expect(info.binding).toBeNull();
    expect(info.debug).toBeNull();

    const completions = JSON.parse(runCli(["completions", "zsh", "--json"]).stdout) as unknown;
    expect(completions).toEqual({ shell: "zsh", script: "FAKE COMPLETION zsh\n" });

    const report = JSON.parse(runCli(["report", SHORT, "--json"]).stdout) as unknown;
    expect(report).toEqual({ issueUrl: "https://github.com/made-up/repo/issues/7" });

    const brief = JSON.parse(runCli(["brief", "src/a.ts", "--json"], providerRepo).stdout) as {
      files: string[];
      report: { $schema: string; rules: unknown[] };
    };
    expect(brief.files).toEqual(["src/a.ts"]);
    expect(brief.report.$schema).toBe(currentSchemaUrl("brief-report"));

    const architecture = JSON.parse(runCli(["architecture", "--json"], providerRepo).stdout) as {
      kind: string;
      report: { body: string; parts: { id: string }[] };
    };
    expect(architecture.kind).toBe("report");
    expect(architecture.report.body).toBe("A layered CLI.");
    expect(architecture.report.parts.map((part) => part.id)).toEqual(["cli"]);
  }, 120_000);

  it("prints each command's contract with --json-schema and runs nothing", () => {
    for (const name of [
      "validate",
      "session-info",
      "path",
      "brief",
      "architecture",
      "completions",
      "report",
    ]) {
      const result = runCli([name, "--json-schema"]);
      expect(result.status, name).toBe(0);
      expect(JSON.parse(result.stdout), name).toBeTypeOf("object");
      expect(result.stderr, name).toBe("");
    }
  }, 120_000);
});

describe("path and completions without --json", () => {
  // ac-text-unchanged
  it("path prints exactly the worktree path and a newline", () => {
    const result = runCli(["path", SHORT]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${worktree}\n`);
    expect(result.stderr).toBe("");
  });

  it("completions prints exactly the usage CLI's output", () => {
    const result = runCli(["completions", "zsh"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("FAKE COMPLETION zsh\n");
    expect(result.stderr).toBe("");
  });
});

describe("path on an unknown run", () => {
  // ac-error-sentence
  it("exits 1 with today's sentence without --json and one error line with it", () => {
    const plain = runCli(["path", "no-such-run"]);
    expect(plain.status).toBe(1);
    expect(plain.stdout).toBe("");
    expect(plain.stderr).not.toBe("");
    expect(() => JSON.parse(plain.stderr)).toThrow();

    const json = runCli(["path", "no-such-run", "--json"]);
    expect(json.status).toBe(1);
    expect(json.stdout).toBe("");
    const lines = messageLines(json.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      kind: "error",
      error: "RunRefError",
      exit: 1,
      fields: { message: plain.stderr.trim() },
    });
  });
});

describe("architecture with no provider", () => {
  // ac-lint-verdict
  it("answers its JSON and exits 1, the verdict code", () => {
    const json = runCli(["architecture", "--json"]);
    expect(json.status).toBe(1);
    expect(JSON.parse(json.stdout)).toEqual({ kind: "no-provider", bounds: null });
    expect(messageLines(json.stderr)).toEqual([]);

    const plain = runCli(["architecture"]);
    expect(plain.status).toBe(1);
    expect(plain.stdout).toContain("architecture");
    expect(plain.stderr).toBe("");
  });
});

describe("report --no-gist", () => {
  // A log past the gist threshold: the default creates a gist, --no-gist inlines it.
  it("reaches run as noGist and inlines the log", () => {
    const bigRecord = JSON.stringify({ ts: NOW, data: "x".repeat(500) });
    write(state, "runs/big-run/semantic.jsonl", `${Array(100).fill(bigRecord).join("\n")}\n`);

    writeFileSync(ghLog, "");
    expect(runCli(["report", "big-run"]).status).toBe(0);
    const withGist = readFileSync(ghLog, "utf8");
    expect(withGist).toContain("gist create");

    writeFileSync(ghLog, "");
    const inline = runCli(["report", "big-run", "--no-gist"]);
    expect(inline.status).toBe(0);
    expect(inline.stdout).toBe("Issue created: https://github.com/made-up/repo/issues/7\n");
    const calls = readFileSync(ghLog, "utf8");
    expect(calls).toContain("issue create");
    expect(calls).not.toContain("gist create");
  });

  it("with an unknown run fails with today's sentence and exit 1", () => {
    const result = runCli(["report", "missing-run"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("phax report failed:");
  });
});

describe("validate", () => {
  it("answers the validated plan and refuses a bad one with exit 2", () => {
    const bad = runCli(["validate", "--plan", "missing-plan.json"]);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("Plan validation failed:");
    expect(bad.stderr).toContain("missing-plan.json");
    expect(existsSync(join(repo, "missing-plan.json"))).toBe(false);

    const json = runCli(["validate", "--plan", "missing-plan.json", "--json"]);
    expect(json.status).toBe(2);
    expect(messageLines(json.stderr)).toEqual([expect.objectContaining({ kind: "error" })]);
  });
});
