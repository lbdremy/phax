import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Either } from "effect";
import { serializeBriefRequest, stampBriefRequest } from "../../src/app/briefProvider.js";
import { runBrief } from "../../src/cli/commands/brief.js";
import { phaseBriefRequest } from "../../src/domain/brief/request.js";
import type { OutputPort } from "../../src/ports/output.js";
import { readBriefRecordFile } from "../../src/schemas/persisted.js";
import { CURRENT_STAMPS } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

// A made-up repository with a linked phase worktree, made-up phax.json files
// and a made-up provider script that saves its stdin and cwd. HOME points at a
// temp dir, so no real ~/.phax/config.json is read.

let base: string;
let mainRoot: string;
let worktree: string;
let scripts: string;
let home: string;
let originalHome: string | undefined;

const BASE_SHA = "0123456789abcdef0123456789abcdef01234567";
const phaseRequest = stampBriefRequest(
  phaseBriefRequest(
    {
      phase: "phase-02",
      base: BASE_SHA,
      terminal: false,
      phases: [
        { id: "phase-01", files: ["src/core/billing/port.ts"] },
        { id: "phase-02", files: ["src/core/billing/invoice.ts"] },
      ],
    },
    null,
  ),
);

function git(cwd: string, args: string): void {
  execSync(`git ${args}`, { cwd, stdio: "ignore" });
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-brief-command-")));
  mainRoot = join(base, "repo");
  worktree = join(base, "phase-02");
  scripts = join(base, "scripts");
  home = join(base, "home");
  mkdirSync(mainRoot);
  mkdirSync(scripts);
  mkdirSync(home);
  git(mainRoot, "init -q -b main");
  writeFileSync(join(mainRoot, "README.md"), "made-up\n");
  git(mainRoot, "add README.md");
  git(
    mainRoot,
    "-c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false commit -q -m init",
  );
  git(mainRoot, `worktree add -q -b phase-02 ${worktree}`);
  mkdirSync(join(worktree, ".phax-context"));
  writeFileSync(
    join(worktree, ".phax-context", "brief-request.json"),
    serializeBriefRequest(phaseRequest),
  );
  originalHome = process.env["HOME"];
  process.env["HOME"] = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  rmSync(base, { recursive: true, force: true });
});

function writeConfig(file: "phax.json" | "phax.local.json", config: object): void {
  writeFileSync(join(mainRoot, file), JSON.stringify(config));
}

const projectConfig = (briefConfig?: { command: string; push: string }) => ({
  version: 1,
  name: "made-up",
  gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
  ...(briefConfig !== undefined ? { brief: briefConfig } : {}),
});

function report(
  rules: unknown[],
  findings: unknown[],
  release: string = CURRENT_STAMPS["brief-report"],
): string {
  return JSON.stringify({ $schema: schemaUrl("brief-report", release), rules, findings });
}

// The spec §6 brief report, made up.
const GUIDE = { summary: "keep I/O in the module's caller", read: "guides/no-node-import.md" };

const RULES = [
  {
    rule: "a module under src/ exports its function",
    files: ["src/greet.ts", "src/farewell.ts"],
    guide: null,
  },
  {
    rule: "a module under src/ imports no node: module",
    files: ["src/greet.ts", "src/farewell.ts"],
    guide: GUIDE,
  },
];

const GREET_FINDING = {
  id: "no-node-import src/greet.ts node:fs",
  rule: "a module under src/ imports no node: module",
  location: { file: "src/greet.ts", lines: [1, 1] },
  message: "imports node:fs",
  related: [],
  guide: GUIDE,
  due: "this-phase",
};

const FINDINGS = [
  GREET_FINDING,
  {
    id: "exports-function src/farewell.ts",
    rule: "a module under src/ exports its function",
    location: { file: "src/farewell.ts", lines: null },
    message: "no exported function",
    related: [],
    guide: null,
    due: "later",
  },
];

const WHOLE_REPORT = [
  "Rules",
  "  a module under src/ exports its function",
  "    files:  src/greet.ts, src/farewell.ts",
  "  a module under src/ imports no node: module",
  "    files:  src/greet.ts, src/farewell.ts",
  "    guide:  keep I/O in the module's caller (read guides/no-node-import.md)",
  "Findings",
  "  src/greet.ts:1   due this phase",
  "    rule:   a module under src/ imports no node: module",
  "    found:  imports node:fs",
  "    guide:  keep I/O in the module's caller (read guides/no-node-import.md)",
  "  src/farewell.ts   due later",
  "    rule:   a module under src/ exports its function",
  "    found:  no exported function",
].join("\n");

/**
 * Configures a provider that appends `{ stdin, cwd }` to calls.jsonl, prints
 * `stdout`, writes `stderr` and exits `code`.
 */
function provider(stdout: string, code = 0, stderr = ""): void {
  const script = join(scripts, "brief.mjs");
  writeFileSync(
    script,
    [
      `import { appendFileSync } from "node:fs";`,
      `let stdin = "";`,
      `for await (const chunk of process.stdin) stdin += chunk;`,
      `appendFileSync(${JSON.stringify(join(scripts, "calls.jsonl"))}, JSON.stringify({ stdin, cwd: process.cwd() }) + "\\n");`,
      `process.stdout.write(${JSON.stringify(stdout)});`,
      `process.stderr.write(${JSON.stringify(stderr)});`,
      `process.exitCode = ${code};`,
    ].join("\n"),
  );
  writeConfig("phax.json", projectConfig({ command: `node ${script}`, push: "findings" }));
}

function calls(): { stdin: unknown; cwd: string }[] {
  const path = join(scripts, "calls.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const call = JSON.parse(line) as { stdin: string; cwd: string };
      return { stdin: JSON.parse(call.stdin) as unknown, cwd: call.cwd };
    });
}

function capture(): { out: OutputPort; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    out: {
      log: (m) => stdout.push(m),
      warn: (m) => stderr.push(m),
      error: (m) => stderr.push(m),
    },
    stdout,
    stderr,
  };
}

async function brief(cwd: string, ...paths: string[]) {
  const io = capture();
  const code = await runBrief(paths, io.out, cwd);
  return { code, stdout: io.stdout.join("\n"), stderr: io.stderr.join("\n") };
}

const briefsDir = () => join(worktree, ".phax-context", "briefs");

function pulledRecords(): string[] {
  return existsSync(briefsDir())
    ? readdirSync(briefsDir())
        .filter((name) => name.startsWith("brief-"))
        .toSorted()
    : [];
}

function readRecord(name: string) {
  const read = readBriefRecordFile(
    name,
    JSON.parse(readFileSync(join(briefsDir(), name), "utf8")) as unknown,
  );
  if (Either.isLeft(read)) throw new Error(read.left.message);
  return read.right;
}

describe("phax brief — inside a phase worktree", () => {
  it("sends the file's facts with the resolved, deduplicated paths, from the worktree root", async () => {
    provider(report(RULES, FINDINGS));
    const cwd = join(worktree, "src", "core");
    mkdirSync(cwd, { recursive: true });

    const result = await brief(cwd, "billing/tax.ts", "billing/invoice.ts", "billing/tax.ts");

    expect(result.code).toBe(0);
    const expected = {
      ...phaseRequest,
      files: ["src/core/billing/tax.ts", "src/core/billing/invoice.ts"],
    };
    expect(calls()).toEqual([{ stdin: expected, cwd: worktree }]);
    expect(pulledRecords()).toEqual(["brief-01.json"]);
    const record = readRecord("brief-01.json");
    expect(record.moment).toBe("pulled");
    expect(record.request).toEqual(expected);
    expect(record.outcome).toEqual({
      kind: "answered",
      answer: JSON.parse(report(RULES, FINDINGS)),
    });
  });

  it("with no path, asks for the phase's brief and prints it whole", async () => {
    provider(report(RULES, FINDINGS));

    const result = await brief(worktree);

    expect(result.code).toBe(0);
    expect(calls().map((call) => call.stdin)).toEqual([phaseRequest]);
    expect(result.stdout).toBe(WHOLE_REPORT);
  });

  it("records each pull in call order, a failed one included", async () => {
    provider(report(RULES, FINDINGS));
    expect((await brief(worktree, "src/a.ts")).code).toBe(0);
    expect((await brief(worktree, "src/b.ts")).code).toBe(0);
    provider("", 1, "made-up provider crash");
    const failed = await brief(worktree, "src/c.ts");

    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain("✗ brief provider exited with code 1");
    expect(failed.stderr).toContain("made-up provider crash");
    expect(pulledRecords()).toEqual(["brief-01.json", "brief-02.json", "brief-03.json"]);
    expect(
      ["brief-01.json", "brief-02.json", "brief-03.json"].map((n) => readRecord(n).request.files),
    ).toEqual([["src/a.ts"], ["src/b.ts"], ["src/c.ts"]]);
    expect(readRecord("brief-03.json").outcome.kind).toBe("failed");
  });

  it("answers and records nothing once the briefs are closed", async () => {
    provider(report(RULES, FINDINGS));
    mkdirSync(briefsDir(), { recursive: true });
    writeFileSync(join(briefsDir(), "closed"), "");

    const result = await brief(worktree, "src/a.ts");

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(WHOLE_REPORT);
    expect(calls()).toHaveLength(1);
    expect(pulledRecords()).toEqual([]);
  });

  it("refuses a request file that is not a brief request, without running the provider", async () => {
    provider(report([], []));
    writeFileSync(join(worktree, ".phax-context", "brief-request.json"), '{ "phase": 2 }');

    const result = await brief(worktree, "src/a.ts");

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      /^✗ phax brief: \.phax-context\/brief-request\.json is not a brief request: /,
    );
    expect(calls()).toEqual([]);
  });

  it("refuses a request file that is not the phase's own request", async () => {
    provider(report([], []));
    writeFileSync(
      join(worktree, ".phax-context", "brief-request.json"),
      serializeBriefRequest({ ...phaseRequest, files: ["src/a.ts"] }),
    );

    const result = await brief(worktree);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(".phax-context/brief-request.json is not a brief request");
    expect(calls()).toEqual([]);
  });

  it("uses a brief declared only in the main checkout's phax.local.json", async () => {
    provider(report([], []));
    const command = (
      JSON.parse(readFileSync(join(mainRoot, "phax.json"), "utf8")) as {
        brief: { command: string };
      }
    ).brief.command;
    writeConfig("phax.json", projectConfig());
    writeConfig("phax.local.json", { brief: { command, push: "findings-and-rules" } });
    expect(existsSync(join(worktree, "phax.local.json"))).toBe(false);

    const result = await brief(worktree, "src/x.ts");

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("No brief for src/x.ts.");
    expect(calls()).toHaveLength(1);
  });
});

describe("phax brief — outside a phase", () => {
  it("sends the paths alone and writes nothing", async () => {
    provider(report([], []));

    const result = await brief(mainRoot, "src/greet.ts");

    expect(result.code).toBe(0);
    expect(calls()).toEqual([
      { stdin: { $schema: phaseRequest.$schema, files: ["src/greet.ts"] }, cwd: mainRoot },
    ]);
    expect(existsSync(join(mainRoot, ".phax-context"))).toBe(false);
  });

  it("refuses no path, a path outside the tree, and a cwd outside any git tree", async () => {
    provider(report([], []));
    const outsideGit = join(base, "elsewhere");
    mkdirSync(outsideGit);

    const noPath = await brief(mainRoot);
    const escaping = await brief(mainRoot, "../elsewhere.ts");
    const noTree = await brief(outsideGit, "src/a.ts");

    expect(noPath).toMatchObject({
      code: 1,
      stderr: "✗ phax brief: outside a phase, name at least one path",
    });
    expect(escaping).toMatchObject({
      code: 1,
      stderr: "✗ phax brief: ../elsewhere.ts is outside the working tree",
    });
    expect(noTree).toMatchObject({
      code: 1,
      stderr: `✗ phax brief: ${outsideGit} is not inside a git working tree`,
    });
    expect(calls()).toEqual([]);
  });
});

describe("phax brief — answers and config", () => {
  it("prints the no-brief line for an empty answer", async () => {
    provider(report([], []));
    const result = await brief(worktree, "src/x.ts");
    expect(result).toMatchObject({ code: 0, stdout: "No brief for src/x.ts." });
  });

  it("prints the phase's no-brief line for an empty phase brief", async () => {
    provider(report([], []));
    const result = await brief(worktree);
    expect(result).toMatchObject({ code: 0, stdout: "No brief for this phase's planned files." });
  });

  it("prints the whole report and exits 0", async () => {
    provider(report(RULES, FINDINGS));
    const result = await brief(worktree, "src/greet.ts", "src/farewell.ts");
    expect(result).toMatchObject({ code: 0, stdout: WHOLE_REPORT });
  });

  it("prints a finding due this phase as is outside a phase: phax judges nothing", async () => {
    const nowhere = { ...GREET_FINDING, location: { file: "src/nowhere.ts", lines: null } };
    provider(report([], [nowhere]));
    const result = await brief(mainRoot, "src/nowhere.ts");
    expect(result.code).toBe(0);
    expect(result.stdout.split("\n").slice(0, 2)).toEqual([
      "Findings",
      "  src/nowhere.ts   due this phase",
    ]);
  });

  it("treats a declining provider as a failed brief: its stderr, exit 1", async () => {
    provider("", 2, "the checks need hw-rules 2, and 1 is installed\n");
    const result = await brief(worktree, "src/greet.ts");
    expect(result).toMatchObject({
      code: 1,
      stderr: "✗ brief provider exited with code 2: the checks need hw-rules 2, and 1 is installed",
    });
    expect(readRecord("brief-01.json").outcome.kind).toBe("failed");
  });

  it("refuses a report from a newer release, naming brief-report and the release", async () => {
    provider(report([], [], "99.0.0"));
    const result = await brief(worktree, "src/x.ts");
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^✗ brief-report 99\.0\.0 is newer than this phax/);
    expect(result.stderr).toContain(
      `this phax reads ${schemaUrl("brief-report", CURRENT_STAMPS["brief-report"])}`,
    );
    expect(readRecord("brief-01.json").outcome.kind).toBe("failed");
  });

  it("exits 1 naming brief when no provider is configured", async () => {
    writeConfig("phax.json", projectConfig());
    const result = await brief(worktree, "src/x.ts");
    expect(result).toMatchObject({
      code: 1,
      stderr:
        '✗ No brief provider is configured: add "brief": { "command": "…", "push": "findings" } to phax.json',
    });
  });

  it("exits 2 on an invalid config", async () => {
    writeFileSync(join(mainRoot, "phax.json"), "{ not json");
    const result = await brief(worktree, "src/x.ts");
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Config error");
  });
});
