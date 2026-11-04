import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { runner } from "../../src/cli/commandLibrary/commander/index.js";
import {
  defineGroup,
  defineProgram,
  type ExitCode,
} from "../../src/cli/commandLibrary/contract/index.js";
import { makeSkillsInstallCommand } from "../../src/cli/definitions/skills.js";
import { EXPOSED_SKILLS } from "../../src/domain/skills/catalog.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";
import { encodeRegistryFile, type RegistryEntry } from "../../src/schemas/registry.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import { memoryIo } from "../unit/commandLibrary/commander/support/memoryIo.js";

// `cost backfill`, `schema upgrade`, `security status` and `skills install` through the command
// runner, spawned as `tsx src/cli/main.ts` in temporary repositories with a temporary HOME and git
// configuration: no real ~/.phax, ~/.claude, ~/.codex or ~/.vibe and no global git config is
// touched.
//   ac-json-every-command, ac-written, ac-error-sentence, ac-written-on-failure and ac-groups.

const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");
const bundleRoot = join(fileURLToPath(import.meta.url), "../../..", ".claude", "skills");

const NAMESPACE = "made-up";
const MESSAGE_KINDS = ["note", "written", "error", "refused", "defect"];
const DIGEST = /^sha256:[0-9a-f]{64}$/;

interface WrittenFile {
  readonly path: string;
  readonly format: string | null;
  readonly digest: string;
}

let base: string;
let repo: string;
let bare: string;
let state: string;
let restoreGit: () => void;

function runCli(args: readonly string[], cwd = repo): SpawnSyncReturns<string> {
  return spawnSync("tsx", [mainTs, ...args], { cwd, encoding: "utf8", env: phaxHomeEnv() });
}

function messageLines(stderr: string): ReadonlyArray<{ kind: string }> {
  return stderr
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { kind: string });
}

function sha256(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function initRepo(root: string, config: Record<string, unknown>): void {
  mkdirSync(root);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root, stdio: "ignore" });
  disableGitAutoMaintenance(root);
  writeFileSync(join(root, "phax.json"), JSON.stringify(config));
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: root, stdio: "ignore" });
}

/** A made-up Claude stream with one result. */
function writeStream(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const events = [
    { type: "system", subtype: "init", session_id: "s-1", claude_code_version: "2.1.280" },
    {
      type: "result",
      subtype: "success",
      session_id: "s-1",
      duration_ms: 1500,
      modelUsage: {
        "example-model": {
          inputTokens: 10,
          outputTokens: 1000,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUSD: 1,
        },
      },
    },
  ];
  writeFileSync(path, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
}

beforeAll(() => {
  restoreGit = isolateGit();
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-group-commands-")));
  state = join(base, "state");
  mkdirSync(state);
  repo = join(base, "repo");
  initRepo(repo, {
    version: 1,
    name: NAMESPACE,
    state: { root: state },
    gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
  });
  // A directory with no phax.json, for the commands that refuse without one.
  bare = join(base, "bare");
  mkdirSync(bare);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: bare, stdio: "ignore" });

  // A kept run with no cost ledger.
  const entry: RegistryEntry = {
    namespace: NAMESPACE,
    shortName: "spent",
    runId: "spent-2026-10-01",
    state: "completed",
    branch: "phax/spent",
    projectName: "phax",
    phasesCount: 1,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
  const runFolder = join(state, "runs", `${NAMESPACE}.spent`);
  writeStream(join(runFolder, "phase-01", "output.jsonl"));
  writeFileSync(join(runFolder, "run-status.json"), "{}");
  writeFileSync(
    join(state, "registry.json"),
    JSON.stringify(encodeRegistryFile(withSchemaUrl("registry", { runs: [entry] })), null, 2),
  );
});

afterAll(() => {
  restoreGit();
  removeTempDir(base);
});

describe("the four small-group commands under --json", () => {
  interface Call {
    readonly args: readonly string[];
    readonly cwd: () => string;
    readonly keys: readonly string[];
  }
  const CALLS: ReadonlyArray<Call> = [
    {
      args: ["cost", "backfill"],
      cwd: () => repo,
      keys: ["ledgers", "locked", "missing", "invocations", "costUsd", "written"],
    },
    {
      args: ["schema", "upgrade"],
      cwd: () => repo,
      keys: ["kind", "schemaPath", "userSchemaPath", "written"],
    },
    { args: ["security", "status"], cwd: () => repo, keys: ["providers"] },
    {
      args: ["skills", "install", "--target", "claude"],
      cwd: () => repo,
      keys: ["target", "scope", "skills", "written"],
    },
  ];

  // ac-json-every-command
  it("each writes one indented JSON value on stdout and only message lines on stderr", () => {
    for (const call of CALLS) {
      const result = runCli([...call.args, "--json"], call.cwd());
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
    // Four spawned CLIs: under a loaded machine each takes several seconds.
  }, 120_000);

  // ac-written
  it("schema upgrade lists both schema files as written-file records, and none the second time", () => {
    // The repository was upgraded above; start from a clean one.
    const fresh = join(base, "schema-repo");
    initRepo(fresh, { version: 1, name: NAMESPACE });
    const first = JSON.parse(runCli(["schema", "upgrade", "--json"], fresh).stdout) as {
      kind: string;
      written: WrittenFile[];
    };
    expect(first.kind).toBe("updated");
    expect(first.written.map((file) => file.path)).toEqual([
      "phax.schema.json",
      "phax.user.schema.json",
    ]);
    for (const file of first.written) {
      expect(file.digest).toMatch(DIGEST);
      expect(file.digest).toBe(sha256(join(fresh, file.path)));
    }
    const second = JSON.parse(runCli(["schema", "upgrade", "--json"], fresh).stdout) as {
      kind: string;
      written: WrittenFile[];
    };
    expect(second.kind).toBe("current");
    expect(second.written).toEqual([]);
  });

  it("schema upgrade prints today's text", () => {
    const fresh = join(base, "schema-text-repo");
    initRepo(fresh, { version: 1, name: NAMESPACE });
    const first = runCli(["schema", "upgrade"], fresh);
    expect(first.status).toBe(0);
    expect(first.stdout).toBe(
      `Updated ${join(fresh, "phax.schema.json")}\nUpdated ${join(fresh, "phax.user.schema.json")}\n`,
    );
    const second = runCli(["schema", "upgrade"], fresh);
    expect(second.stdout).toContain("already up to date");
  });

  it("skills install lists the installed files, and none the second time", () => {
    const fresh = join(base, "skills-repo");
    initRepo(fresh, { version: 1, name: NAMESPACE });
    const first = JSON.parse(
      runCli(["skills", "install", "--target", "claude", "--json"], fresh).stdout,
    ) as { skills: { name: string; status: string }[]; written: WrittenFile[] };
    const files = EXPOSED_SKILLS.flatMap((skill) => skill.files.map((file) => [skill, file]));
    expect(first.skills.every((skill) => skill.status === "created")).toBe(true);
    expect(first.written).toHaveLength(files.length);
    for (const file of first.written) {
      expect(file.path.startsWith(".claude/skills/")).toBe(true);
      expect(existsSync(join(fresh, file.path))).toBe(true);
      expect(file.digest).toMatch(DIGEST);
      expect(file.digest).toBe(sha256(join(fresh, file.path)));
    }
    const second = JSON.parse(
      runCli(["skills", "install", "--target", "claude", "--json"], fresh).stdout,
    ) as { skills: { status: string }[]; written: WrittenFile[] };
    expect(second.skills.every((skill) => skill.status === "already-present")).toBe(true);
    expect(second.written).toEqual([]);
  });

  it("cost backfill lists its ledger by absolute path, and none the second time", () => {
    // The table above has already backfilled the run: take its ledger away.
    rmSync(join(state, "runs", `${NAMESPACE}.spent`, "cost-ledger.json"));
    const first = JSON.parse(runCli(["cost", "backfill", "--json"]).stdout) as {
      ledgers: { qualifiedName: string }[];
      invocations: number;
      written: WrittenFile[];
    };
    const ledger = join(state, "runs", `${NAMESPACE}.spent`, "cost-ledger.json");
    expect(first.ledgers.map((run) => run.qualifiedName)).toEqual([`${NAMESPACE}.spent`]);
    expect(first.invocations).toBe(1);
    expect(first.written).toHaveLength(1);
    expect(first.written[0]?.path).toBe(ledger);
    expect(first.written[0]?.digest).toMatch(DIGEST);
    expect(first.written[0]?.digest).toBe(sha256(ledger));
    const second = JSON.parse(runCli(["cost", "backfill", "--json"]).stdout) as {
      written: WrittenFile[];
    };
    expect(second.written).toEqual([]);
    expect(runCli(["cost", "backfill"]).stdout).toBe("nothing to backfill\n");
  });

  // ac-error-sentence
  it("schema upgrade without phax.json exits 1 with today's sentence, and one error line under --json", () => {
    const plain = runCli(["schema", "upgrade"], bare);
    expect(plain.status).toBe(1);
    expect(plain.stderr).toBe("No phax.json found. Run `phax init` first.\n");
    expect(plain.stdout).toBe("");

    const json = runCli(["schema", "upgrade", "--json"], bare);
    expect(json.status).toBe(1);
    expect(json.stdout).toBe("");
    const lines = messageLines(json.stderr) as { kind: string; exit?: number; message?: string }[];
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe("error");
    expect(lines[0]?.exit).toBe(1);
  });

  it("skills install with an invalid target exits 2 with today's sentence", () => {
    const result = runCli(["skills", "install", "--target", "nope"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe(`Invalid --target "nope". Valid values: claude, codex, agent\n`);
    const json = runCli(["skills", "install", "--target", "nope", "--json"]);
    expect(json.status).toBe(2);
    const lines = messageLines(json.stderr) as { kind: string; exit?: number }[];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "error", exit: 2 });
  });

  // ac-groups
  it("each group alone writes its help on stderr and exits 64", () => {
    for (const group of ["cost", "schema", "security", "skills"]) {
      const result = runCli([group]);
      expect(result.status, group).toBe(64);
      expect(result.stdout, group).toBe("");
      expect(result.stderr, group).toContain(`phax ${group}`);
    }
  });

  it("security accepts --verbose and --trace as the program's options", () => {
    const result = runCli(["security", "status", "--verbose"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Provider Security Status");
  });
});

// ac-written-on-failure
describe("skills install failing part way", () => {
  it("names the lines reached and the files already installed in its error", async () => {
    // A bundle holding only the first exposed skill: the second one's file is missing.
    const first = EXPOSED_SKILLS[0];
    if (first === undefined) throw new Error("no exposed skill");
    const partial = join(base, "partial-bundle");
    cpSync(join(bundleRoot, first.sourceDir), join(partial, first.sourceDir), { recursive: true });
    const project = join(base, "partial-project");
    mkdirSync(project);

    const program = defineProgram({
      name: "phax",
      version: "0.0.0",
      exits: { refused: 64, defect: 70 },
      commands: [
        defineGroup({
          name: "skills",
          summary: "Manage PHAX skills",
          commands: [
            makeSkillsInstallCommand(() => ({
              projectRoot: project,
              homeDir: project,
              bundleRoot: partial,
            })),
          ],
        }),
      ],
    });
    const memory = memoryIo({ argv: ["skills", "install", "--target", "claude", "--json"] });
    const code = await Effect.runPromise(runner.run(program, memory.io) as Effect.Effect<ExitCode>);
    expect(code).toBe(2);
    const lines = memory.err
      .join("")
      .split("\n")
      .filter((line) => line !== "")
      .map(
        (line) =>
          JSON.parse(line) as {
            kind: string;
            exit?: number;
            fields?: { message?: string; reached?: string[] };
            written?: WrittenFile[];
          },
      );
    const error = lines.find((line) => line.kind === "error");
    expect(error?.exit).toBe(2);
    expect(error?.fields?.message).toContain("Bundled skill file missing");
    expect(error?.fields?.reached?.[0]).toBe("Target: claude");
    expect(error?.written?.map((file) => file.path)).toEqual(
      first.files.map((file) => `.claude/skills/${first.name}/${file}`),
    );
    for (const file of error?.written ?? []) {
      expect(file.digest).toMatch(DIGEST);
    }

    // Without --json the sentence is the lines already reached, then the failure.
    const text = memoryIo({ argv: ["skills", "install", "--target", "claude"] });
    const textCode = await Effect.runPromise(
      runner.run(program, text.io) as Effect.Effect<ExitCode>,
    );
    expect(textCode).toBe(2);
    const sentence = text.err.join("");
    expect(sentence).toContain("Target: claude\nScope: project\n\n");
    expect(sentence).toContain(`${first.name}: already present`);
    expect(sentence).toContain("Bundled skill file missing");
  });
});
