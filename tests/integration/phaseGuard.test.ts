import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { runner } from "../../src/cli/commandLibrary/commander/index.js";
import { memoryIo } from "../../src/cli/commandLibrary/contract/conformance/memoryIo.js";
import {
  defineCommand,
  defineGroup,
  defineProgram,
  reject,
  strip,
  type ExitCode,
} from "../../src/cli/commandLibrary/contract/index.js";
import { phaxProgram } from "../../src/cli/definitions/program.js";
import { execSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// A made-up repository with two linked worktrees: one holding `.phax-context/`
// (a phase worktree) and one without. The CLI runs from source with HOME at a
// temp dir, so no real ~/.phax is read or written.

const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");

let base: string;
let mainRoot: string;
let phaseWorktree: string;
let plainWorktree: string;
let home: string;

function git(cwd: string, args: string): void {
  execSync(`git ${args}`, { cwd, stdio: "ignore" });
}

function runCli(cwd: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync("tsx", [mainTs, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
}

const guardMessage = (command: string): string =>
  `✗ phax ${command} is not available inside a phase worktree; run it from the main checkout (inside, only phax brief, phax architecture and read-only commands run)`;

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-phase-guard-")));
  mainRoot = join(base, "repo");
  phaseWorktree = join(base, "phase-01");
  plainWorktree = join(base, "plain");
  home = join(base, "home");
  mkdirSync(mainRoot);
  mkdirSync(home);
  git(mainRoot, "init -q -b main");
  disableGitAutoMaintenance(mainRoot);
  writeFileSync(
    join(mainRoot, "phax.json"),
    JSON.stringify({
      version: 1,
      name: "made-up",
      gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
    }),
  );
  git(mainRoot, "add phax.json");
  git(
    mainRoot,
    "-c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false commit -q -m init",
  );
  git(mainRoot, `worktree add -q -b phase-01 ${phaseWorktree}`);
  git(mainRoot, `worktree add -q -b plain ${plainWorktree}`);
  mkdirSync(join(phaseWorktree, ".phax-context"));
});

afterAll(() => {
  removeTempDir(base);
});

describe("phase guard — inside a phase worktree", () => {
  it("refuses phax archive with the guard's message and exit 1", () => {
    const result = runCli(phaseWorktree, ["archive", "x"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(guardMessage("archive"));
  });

  it("refuses phax run with the guard's message and exit 1", () => {
    const result = runCli(phaseWorktree, ["run", "--plan", "p"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(guardMessage("run"));
  });

  it("refuses phax artifact decide --verdicts with the guard's message and exit 1, writing nothing", () => {
    writeFileSync(join(phaseWorktree, "verdicts.json"), "{}");
    const result = runCli(phaseWorktree, [
      "artifact",
      "decide",
      "docs/specs/2610250900-log-rotation.md",
      "--verdicts",
      "verdicts.json",
      "--by",
      "operator",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(guardMessage("artifact decide"));
    // No session ran and nothing was written: no state root, no commit.
    expect(result.stdout).toBe("");
    expect(existsSync(join(home, ".phax"))).toBe(false);
  });

  it("refuses from a subdirectory of the phase worktree too", () => {
    const sub = join(phaseWorktree, "src");
    mkdirSync(sub, { recursive: true });
    const result = runCli(sub, ["archive", "x"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(guardMessage("archive"));
  });

  it("lets --version through", () => {
    const result = runCli(phaseWorktree, ["--version"]);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("not available inside a phase worktree");
  });

  it("lets phax --json-schema print the runner's catalogue", () => {
    const result = runCli(phaseWorktree, ["--json-schema"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("lets phax --help, -V and help <command> answer", () => {
    for (const argv of [["--help"], ["-V"], ["help", "archive"]]) {
      const result = runCli(phaseWorktree, argv);
      expect(result.status, argv.join(" ")).toBe(0);
      expect(result.stderr, argv.join(" ")).toBe("");
    }
  });

  it("lets phax schema upgrade reach its own code", () => {
    const result = runCli(phaseWorktree, ["schema", "upgrade"]);
    expect(result.stderr).not.toContain("not available inside a phase worktree");
  });

  it("lets phax brief reach its own refusal when no provider is configured", () => {
    const result = runCli(phaseWorktree, ["brief", "src/x.ts"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No brief provider is configured");
    expect(result.stderr).not.toContain("not available inside a phase worktree");
  });
});

/** A double of a phax command: an optional operand, `flags` when given, and its name as output. */
const leaf = (name: string, flags?: Schema.Struct.Fields) =>
  defineCommand({
    name,
    summary: `The ${name} command`,
    input: {
      args: reject(Schema.Tuple([Schema.optionalKey(Schema.String)])),
      ...(flags === undefined ? {} : { flags: reject(Schema.Struct(flags)) }),
    },
    output: strip(Schema.String),
    exits: {},
    run: () => Effect.succeed(name),
  });

// The guard phaxProgram declares, run by the runner over the memory Io: a program of doubles
// shaped like phax's (`ls`, which the guard allows, `archive`, which it refuses, and `plans
// status`, refused with --apply), with the process's cwd set to a worktree of the made-up repo.
describe("phase guard — phaxProgram's guard on the runner", () => {
  const guarded = defineProgram({
    name: "phax",
    version: phaxProgram.version,
    exits: phaxProgram.exits,
    ...(phaxProgram.guard === undefined ? {} : { guard: phaxProgram.guard }),
    ...(phaxProgram.usage === undefined ? {} : { usage: phaxProgram.usage }),
    ...(phaxProgram.options === undefined ? {} : { options: phaxProgram.options }),
    commands: [
      leaf("ls"),
      leaf("archive"),
      defineGroup({
        name: "plans",
        summary: "Plans",
        commands: [
          leaf("status", {
            apply: Schema.optionalKey(Schema.Boolean),
          }),
        ],
      }),
    ],
  });

  async function call(cwd: string, argv: ReadonlyArray<string>) {
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    const memory = memoryIo({ argv });
    const code = await Effect.runPromise(runner.run(guarded, memory.io) as Effect.Effect<ExitCode>);
    return { code, out: memory.out(), err: memory.err() };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses a refused command with today's sentence and exit 1, before it runs", async () => {
    const result = await call(phaseWorktree, ["archive", "x"]);
    expect(result.code).toBe(1);
    expect(result.err).toBe(`${guardMessage("archive")}\n`);
    expect(result.out).toBe("");
  });

  it("writes one refused line under --json, its exit the guard's 1", async () => {
    const result = await call(phaseWorktree, ["archive", "x", "--json"]);
    expect(result.code).toBe(1);
    expect(result.err.endsWith("\n")).toBe(true);
    expect(result.err.split("\n")).toHaveLength(2);
    expect(JSON.parse(result.err)).toEqual({
      kind: "refused",
      source: "command",
      path: ["archive"],
      expected: "a command allowed inside a phase worktree",
      text: guardMessage("archive"),
      exit: 1,
    });
    expect(result.out).toBe("");
  });

  it("lets an allowed command and the root's --json-schema through", async () => {
    for (const argv of [["ls", "--json"], ["--json-schema"]]) {
      const result = await call(phaseWorktree, argv);
      expect(result.code, argv.join(" ")).toBe(0);
      expect(result.err, argv.join(" ")).toBe("");
    }
  });

  it("lets a refused command's --help, -h and --json-schema through", async () => {
    for (const argv of [
      ["archive", "--help"],
      ["archive", "x", "-h"],
      ["archive", "--json-schema"],
    ]) {
      const result = await call(phaseWorktree, argv);
      expect(result.code, argv.join(" ")).toBe(0);
      expect(result.err, argv.join(" ")).toBe("");
      expect(result.out, argv.join(" ")).not.toBe("");
    }
  });

  it("still refuses a --help given after `--`, as an operand", async () => {
    const result = await call(phaseWorktree, ["archive", "--", "--help"]);
    expect(result.code).toBe(1);
    expect(result.err).toBe(`${guardMessage("archive")}\n`);
  });

  it("reads the guard's refused options from the call's words", async () => {
    expect((await call(phaseWorktree, ["plans", "status", "--apply"])).code).toBe(1);
    expect((await call(phaseWorktree, ["plans", "status"])).code).toBe(0);
    expect((await call(phaseWorktree, ["plans", "status", "--", "--apply"])).code).not.toBe(1);
  });

  it("refuses nothing outside a phase worktree", async () => {
    for (const cwd of [mainRoot, plainWorktree]) {
      const result = await call(cwd, ["archive", "x"]);
      expect(result.code, cwd).toBe(0);
      expect(result.err, cwd).toBe("");
    }
  });
});

describe("phase guard — outside a phase worktree", () => {
  it("does not refuse phax archive from the main checkout", () => {
    const result = runCli(mainRoot, ["archive", "x"]);
    expect(result.stderr).not.toContain("not available inside a phase worktree");
  });

  it("does not refuse phax archive from a linked worktree without .phax-context/", () => {
    const result = runCli(plainWorktree, ["archive", "x"]);
    expect(result.stderr).not.toContain("not available inside a phase worktree");
  });
});
