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
import { PHAX_RELEASE } from "../../src/schemas/release.js";
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

const projectConfig = (briefConfig?: { command: string }) => ({
  version: 1,
  name: "made-up",
  gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
  ...(briefConfig !== undefined ? { brief: briefConfig } : {}),
});

function answer(guarantees: unknown[], release = PHAX_RELEASE): string {
  return JSON.stringify({ $schema: schemaUrl("brief-answer", release), guarantees });
}

const FORBIDDEN_GUARANTEE = {
  id: "core-no-adapters",
  statement: "src/core imports no adapter from src/infra",
  places: [
    {
      location: { file: "src/core/billing/invoice.ts", line: 3 },
      state: "forbidden",
      due: "this-phase",
      what: "imports src/infra/stripe.ts",
      repair: "depend on PaymentPort",
    },
  ],
};

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
  writeConfig("phax.json", projectConfig({ command: `node ${script}` }));
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
    provider(answer([FORBIDDEN_GUARANTEE]));
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
      answer: JSON.parse(answer([FORBIDDEN_GUARANTEE])),
    });
  });

  it("with no path, asks for the phase's brief and prints it whole", async () => {
    provider(answer([FORBIDDEN_GUARANTEE]));

    const result = await brief(worktree);

    expect(result.code).toBe(0);
    expect(calls().map((call) => call.stdin)).toEqual([phaseRequest]);
    expect(result.stdout).toBe(
      [
        "core-no-adapters — src/core imports no adapter from src/infra",
        "  forbidden  src/core/billing/invoice.ts:3   due this phase",
        "    what:    imports src/infra/stripe.ts",
        "    repair:  depend on PaymentPort",
      ].join("\n"),
    );
  });

  it("records each pull in call order, a failed one included", async () => {
    provider(answer([FORBIDDEN_GUARANTEE]));
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
    provider(answer([FORBIDDEN_GUARANTEE]));
    mkdirSync(briefsDir(), { recursive: true });
    writeFileSync(join(briefsDir(), "closed"), "");

    const result = await brief(worktree, "src/a.ts");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("core-no-adapters");
    expect(calls()).toHaveLength(1);
    expect(pulledRecords()).toEqual([]);
  });

  it("refuses a request file that is not a brief request, without running the provider", async () => {
    provider(answer([]));
    writeFileSync(join(worktree, ".phax-context", "brief-request.json"), '{ "phase": 2 }');

    const result = await brief(worktree, "src/a.ts");

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      /^✗ phax brief: \.phax-context\/brief-request\.json is not a brief request: /,
    );
    expect(calls()).toEqual([]);
  });

  it("refuses a request file that is not the phase's own request", async () => {
    provider(answer([]));
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
    provider(answer([]));
    const command = (
      JSON.parse(readFileSync(join(mainRoot, "phax.json"), "utf8")) as {
        brief: { command: string };
      }
    ).brief.command;
    writeConfig("phax.json", projectConfig());
    writeConfig("phax.local.json", { brief: { command } });
    expect(existsSync(join(worktree, "phax.local.json"))).toBe(false);

    const result = await brief(worktree, "src/x.ts");

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("No brief for src/x.ts.");
    expect(calls()).toHaveLength(1);
  });
});

describe("phax brief — outside a phase", () => {
  it("sends the paths alone and writes nothing", async () => {
    provider(answer([]));

    const result = await brief(mainRoot, "src/greet.ts");

    expect(result.code).toBe(0);
    expect(calls()).toEqual([
      { stdin: { $schema: phaseRequest.$schema, files: ["src/greet.ts"] }, cwd: mainRoot },
    ]);
    expect(existsSync(join(mainRoot, ".phax-context"))).toBe(false);
  });

  it("refuses no path, a path outside the tree, and a cwd outside any git tree", async () => {
    provider(answer([]));
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
    provider(answer([]));
    const result = await brief(worktree, "src/x.ts");
    expect(result).toMatchObject({ code: 0, stdout: "No brief for src/x.ts." });
  });

  it("prints the phase's no-brief line for an empty phase brief", async () => {
    provider(answer([]));
    const result = await brief(worktree);
    expect(result).toMatchObject({ code: 0, stdout: "No brief for this phase's planned files." });
  });

  it("refuses an answer from a newer release, naming brief-answer and the release", async () => {
    provider(answer([], "99.0.0"));
    const result = await brief(worktree, "src/x.ts");
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^✗ brief answer refused at \$schema: /);
    expect(result.stderr).toContain("brief-answer");
    expect(result.stderr).toContain("99.0.0");
    expect(readRecord("brief-01.json").outcome.kind).toBe("failed");
  });

  it("exits 1 naming brief when no provider is configured", async () => {
    writeConfig("phax.json", projectConfig());
    const result = await brief(worktree, "src/x.ts");
    expect(result).toMatchObject({
      code: 1,
      stderr: '✗ No brief provider is configured: add "brief": { "command": "…" } to phax.json',
    });
  });

  it("exits 2 on an invalid config", async () => {
    writeFileSync(join(mainRoot, "phax.json"), "{ not json");
    const result = await brief(worktree, "src/x.ts");
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Config error");
  });
});
