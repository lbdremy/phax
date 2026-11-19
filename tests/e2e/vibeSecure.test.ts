/**
 * Real-CLI proof of Mistral Vibe 3 in secure mode. Run by `pnpm test:e2e:real`
 * with PHAX_E2E_RUN=1, Vibe 3.1.3 or later on $PATH, the mistral-vibe provider
 * enabled in `~/.phax/providers.json` (`phax agent setup providers --write`),
 * and Vibe signed in (its own login, or MISTRAL_API_KEY in the environment).
 * phax chooses the model and thinking level with Vibe's own `--model` and
 * `--thinking` flags, using Vibe's built-in `mistral-medium-3.5` alias, so no
 * PHAX alias is needed in Vibe's home. Without the provider enabled, routing
 * would fall back to Claude Code, so the cases that go through `phax run` skip
 * and say so; the model and level cases call the Vibe adapter directly, read
 * nothing under `~/.phax`, and need only Vibe and MISTRAL_API_KEY. A Vibe that
 * cannot sign in fails the cases with its own authentication error. The cases
 * that run in a temporary VIBE_HOME have no sign-in there and need
 * MISTRAL_API_KEY: without it they are skipped, with their reason.
 *
 * Cases, each in its own temporary repository:
 *   - secure confined: a secure phase writes in the worktree and runs its one
 *     agent command, while chained, outside and background calls are refused;
 *   - loose config: a hostile VIBE_HOME config, with no PHAX block, cannot widen
 *     the session and stays byte-identical (needs MISTRAL_API_KEY);
 *   - model and level, off and high (ac-real-off-high): a secure session at
 *     mistral-medium-3.5 with `off` and one with `high` complete, each export
 *     reports the model and level phax set, and config.toml is unchanged
 *     (needs MISTRAL_API_KEY);
 *   - model and level kept on resume (ac-real-resume): a session started at
 *     `high` and resumed by its id without flags keeps the model and level, and
 *     phax accepts the turn (needs MISTRAL_API_KEY);
 *   - read-only resume: a writing session resumed read-only, granted
 *     `git status`, runs it and cannot write;
 *   - held stop: the closing turn resumes the builder session narrowed, and
 *     security.json records the narrowing;
 *   - protected paths: write_file and edit refuse protected entries;
 *   - refused before spawning: a user accept-edits profile, and Vibe config
 *     under an extra writable root;
 *   - piped partial command: a diff command piped through `xargs`, with each
 *     pipe segment's prefix on the bash allowlist, is attempted; whether Vibe
 *     ran or refused it is recorded for docs/security.md, not asserted.
 *
 * Every claim about a call reads the stream's tool-call entries (`effect`
 * entries: the tool, its input, and how it settled), never the raw stream,
 * which also holds the prompt that names those calls. The suite spends real
 * tokens and trusts Vibe's own enforcement, which a unit test cannot check.
 */

import { Effect, Result } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parsePartialCommand } from "../../src/domain/gate/partialCommand.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import { runVibeAgent } from "../../src/infra/providers/mistralVibe.js";
import { vibeExportFileOf } from "../../src/domain/records/usage.js";
import type { AgentRunOptions } from "../../src/ports/backend.js";
import { parseVibeVersion } from "../../src/schemas/vibeOutput.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { removeTempDir } from "../helpers/tempGit.js";
import { printArtifacts } from "./helpers/artifacts.js";
import { runCli } from "./helpers/runCli.js";
import { createTempEnv, type TempEnv } from "./helpers/tempEnv.js";
import { expectedSelectedProvider, probeProvider } from "./helpers/providers.js";

function vibeVersionAtLeast313(): boolean {
  const r = spawnSync("vibe", ["--version"], { encoding: "utf8", timeout: 5_000, stdio: "pipe" });
  if (r.status !== 0) return false;
  const v = parseVibeVersion(`${r.stdout}${r.stderr}`);
  if (v === undefined) return false;
  if (v.major !== 3) return v.major > 3;
  if (v.minor !== 1) return v.minor > 1;
  return v.patch >= 3;
}

/** Whether `~/.phax/providers.json` enables mistral-vibe: without it, routing falls back to Claude Code. */
function vibeProviderEnabled(): boolean {
  const file = join(homedir(), ".phax", "providers.json");
  if (!existsSync(file)) return false;
  try {
    const config = JSON.parse(readFileSync(file, "utf8")) as {
      providers?: Record<string, { enabled?: unknown }>;
    };
    return config.providers?.["mistral-vibe"]?.enabled === true;
  } catch {
    return false;
  }
}

/** Why the real Vibe CLI cannot be driven at all, or undefined when it can. */
function vibeSkipReason(): string | undefined {
  if (process.env["PHAX_E2E_RUN"] !== "1") return "PHAX_E2E_RUN=1 is not set";
  if (!probeProvider("vibe")) return "the vibe executable is not on $PATH";
  if (!vibeVersionAtLeast313()) return "vibe is older than 3.1.3";
  return undefined;
}

/**
 * Why the cases that go through `phax run` are skipped. They route through the
 * operator's `~/.phax/providers.json`; the direct `runVibeAgent` cases below do
 * not, so they run whatever that file holds.
 */
function skipReason(): string | undefined {
  const vibe = vibeSkipReason();
  if (vibe !== undefined) return vibe;
  if (!vibeProviderEnabled()) {
    return "mistral-vibe is not enabled in ~/.phax/providers.json (phax agent setup providers --write); routing would run Claude Code instead";
  }
  return undefined;
}

const VIBE_SKIP = vibeSkipReason();
const SKIP = skipReason();
if (SKIP !== undefined) console.info(`vibeSecure e2e: the phax run cases are skipped: ${SKIP}`);
else if (!process.env["MISTRAL_API_KEY"]) {
  console.info(
    "vibeSecure e2e: the loose config case is skipped: MISTRAL_API_KEY is not set (a temporary VIBE_HOME has no sign-in)",
  );
}
const DIRECT_SKIP =
  VIBE_SKIP ??
  (process.env["MISTRAL_API_KEY"]
    ? undefined
    : "MISTRAL_API_KEY is not set (a temporary VIBE_HOME has no sign-in)");
if (DIRECT_SKIP !== undefined) {
  console.info(`vibeSecure e2e: the model and level cases are skipped: ${DIRECT_SKIP}`);
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** One phase, forced to run with the given instructions; planned file `probe.txt`. */
function writePlan(env: TempEnv, instructions: readonly string[]): void {
  const plan = `---
status: Approved
source-spec: null
---

# vibe-secure — one-phase probe

## Required commands

- (none)

---

## Context

A probe for Mistral Vibe in secure mode.

---

## phase-01 — Probe {#phase-01-probe}

**Recommended model:** claude-haiku-4-5-20251001
**Recommended effort:** none

### Objective

Do exactly what the instructions say, then finish.

### Detailed instructions

${instructions.map((line) => `- ${line}`).join("\n")}

### Planned files to create

- \`probe.txt\`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Excluded scope

- Anything the instructions do not name.

### Verification

The \`minimal\` gate profile in \`phax.json\` (\`node --version\`, always passes).

### Commit subject

\`feat(phase-01): add probe file\`

### Commit body

Add the probe file.

### Expected handoff content

Say which of the instructed actions succeeded and which were refused.
`;
  writeFileSync(join(env.repoDir, "plan.md"), plan);
  const configPath = join(env.repoDir, "phax.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  config["security"] = { agentCommands: ["git status"] };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function runDir(env: TempEnv): string {
  const dirs = readdirSync(join(env.phaxHome, "runs")).filter((d) => !d.startsWith("."));
  expect(dirs.length, `expected one run dir, got ${dirs.join(", ")}`).toBe(1);
  return join(env.phaxHome, "runs", dirs[0] as string);
}

/** Every Vibe stream the phase kept (`*.jsonl` in its folder), concatenated. */
function phaseStreams(env: TempEnv): string {
  const folder = join(runDir(env), "phase-01");
  return readdirSync(folder)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => readFileSync(join(folder, f), "utf8"))
    .join("\n");
}

/** One tool call a Vibe stream recorded, as it last settled. */
interface VibeToolCall {
  readonly tool: string;
  /** The shell command of a bash call; the input's path of a file tool. */
  readonly target: string;
  readonly status: string;
  readonly decision: string | undefined;
}

/**
 * The tool calls of a Vibe stream: its `effect` entries (`detail.toolName`,
 * `detail.input`, `state.status`, `state.decision`), each id at its last state.
 */
function toolCallsOf(streamText: string): readonly VibeToolCall[] {
  const calls = new Map<string, VibeToolCall>();
  for (const line of streamText.split("\n")) {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as {
      id?: unknown;
      type?: unknown;
      detail?: { toolName?: unknown; input?: Record<string, unknown> | null };
      state?: { status?: unknown; decision?: unknown };
    };
    if (e.type !== "effect" || typeof e.id !== "string") continue;
    const input = e.detail?.input ?? {};
    const target = input["command"] ?? input["path"] ?? input["filePath"] ?? input["file_path"];
    calls.set(e.id, {
      tool: String(e.detail?.toolName ?? ""),
      target: typeof target === "string" ? target : JSON.stringify(input),
      status: String(e.state?.status ?? ""),
      decision: typeof e.state?.decision === "string" ? e.state.decision : undefined,
    });
  }
  return [...calls.values()];
}

const ran = (call: VibeToolCall): boolean =>
  call.status === "completed" && call.decision !== "skip";
const refused = (call: VibeToolCall): boolean =>
  ["failed", "skipped", "cancelled"].includes(call.status) || call.decision === "skip";

/** The calls matching `match`: at least one was made, and each was refused. */
function expectRefused(
  calls: readonly VibeToolCall[],
  label: string,
  match: (call: VibeToolCall) => boolean,
): void {
  const made = calls.filter(match);
  expect(made.length, `Vibe attempted ${label}`).toBeGreaterThan(0);
  for (const call of made) {
    expect(refused(call), `${label} was refused: ${JSON.stringify(call)}`).toBe(true);
  }
}

/**
 * A shell call whose command holds `fragment`: a bash call, or a background
 * process Vibe 3.0.3 starts through its own `process.start` tool.
 */
const bashCall =
  (fragment: string) =>
  (call: VibeToolCall): boolean =>
    (call.tool.endsWith("bash") || call.tool === "process.start") && call.target.includes(fragment);

/** The config a turn ran with, read from the export beside its stream. */
function exportConfigOf(transcriptPath: string): Record<string, unknown> {
  const exported = JSON.parse(readFileSync(vibeExportFileOf(transcriptPath), "utf8")) as {
    config?: Record<string, unknown>;
  };
  return exported.config ?? {};
}

/**
 * The model and thinking level a turn ran with, read from the export beside its
 * stream: `config.active_model`, and `thinking` of that model's entry in
 * `config.models` (an object keyed by model name in Vibe 3.1.3). Once Vibe has
 * cached its model catalog it reports the canonical name of phax's alias
 * (`mistral-medium-latest`), listed with `mistral-medium-3.5` in
 * `config.catalog_model_aliases`: the model then reads as `mistral-medium-3.5`,
 * so the cases assert the model phax chose either way.
 */
function modelAndLevelOf(transcriptPath: string): {
  readonly activeModel: unknown;
  readonly thinking: unknown;
} {
  const config = exportConfigOf(transcriptPath);
  const activeModel = config["active_model"];
  const models = config["models"] as Record<string, { thinking?: unknown } | undefined> | undefined;
  const aliases = config["catalog_model_aliases"] as Record<string, unknown> | undefined;
  const group = typeof activeModel === "string" ? aliases?.[activeModel] : undefined;
  const servesPhaxModel = Array.isArray(group) && group.includes("mistral-medium-3.5");
  return {
    activeModel: servesPhaxModel ? "mistral-medium-3.5" : activeModel,
    thinking: typeof activeModel === "string" ? models?.[activeModel]?.thinking : undefined,
  };
}

/** Runs `body` with VIBE_HOME set for the real `vibe` that `runVibeAgent` spawns. */
async function withVibeHome<T>(vibeHome: string, body: () => Promise<T>): Promise<T> {
  const previous = process.env["VIBE_HOME"];
  process.env["VIBE_HOME"] = vibeHome;
  try {
    return await body();
  } finally {
    if (previous === undefined) delete process.env["VIBE_HOME"];
    else process.env["VIBE_HOME"] = previous;
  }
}

function worktreeOf(env: TempEnv): string {
  const run = runDir(env).split("/").pop() as string;
  return join(env.phaxHome, "worktrees", run, "phase-01");
}

/** Commits the plan and config a case wrote, so `phax run` starts on a clean tree. */
function commitSetup(env: TempEnv): void {
  for (const args of [
    ["add", "-A"],
    ["commit", "-q", "--allow-empty", "-m", "chore: e2e setup"],
  ]) {
    const r = spawnSync("git", args, { cwd: env.repoDir, encoding: "utf8", stdio: "pipe" });
    expect(r.status, `git ${args.join(" ")}: ${r.stderr}`).toBe(0);
  }
}

function runPhase(
  env: TempEnv,
  extraEnv: Record<string, string> = {},
  extraArgs: readonly string[] = [],
) {
  commitSetup(env);
  return runCli(
    [
      "run",
      "--plan",
      "plan.md",
      "--provider-priority",
      "mistral-vibe",
      "--security",
      "secure",
      "--verbose",
      ...extraArgs,
    ],
    env.repoDir,
    { timeout: 590_000, env: extraEnv },
  );
}

/** Two phases, so phase-01 can be held (a hold never stops the final phase). */
function writeTwoPhasePlan(env: TempEnv): void {
  writePlan(env, [
    "Create the file `probe.txt` in the working directory containing the word `probe`.",
  ]);
  const planPath = join(env.repoDir, "plan.md");
  const phaseTwo = readFileSync(planPath, "utf8")
    .slice(readFileSync(planPath, "utf8").indexOf("## phase-01"))
    .replaceAll("phase-01", "phase-02")
    .replaceAll("probe.txt", "probe-two.txt");
  writeFileSync(planPath, `${readFileSync(planPath, "utf8")}\n${phaseTwo}`);
}

/** Whether phase-01 kept any Vibe stream, i.e. whether a turn was spawned. */
function phaseHasStream(env: TempEnv): boolean {
  const runs = join(env.phaxHome, "runs");
  if (!existsSync(runs)) return false;
  return readdirSync(runs)
    .filter((d) => !d.startsWith("."))
    .some((run) => {
      const folder = join(runs, run, "phase-01");
      return existsSync(folder) && readdirSync(folder).some((f) => f.endsWith(".jsonl"));
    });
}

describe.skipIf(SKIP !== undefined)("Mistral Vibe 3 in secure mode (real CLI)", () => {
  let restoreGit: () => void;
  const envs: TempEnv[] = [];
  const scratch: string[] = [];
  let failed = false;

  function newEnv(): TempEnv {
    const env = createTempEnv();
    envs.push(env);
    return env;
  }

  beforeAll(() => {
    restoreGit = isolateGit();
  });

  afterAll(() => {
    for (const env of envs) {
      if (failed) printArtifacts({ repoDir: env.repoDir, phaxHome: env.phaxHome }, "tests failed");
      else env.cleanup();
    }
    for (const dir of scratch) removeTempDir(dir);
    restoreGit();
  });

  it(
    "secure confined: writes in the worktree and runs its agent command, nothing else",
    { timeout: 600_000 },
    () => {
      const env = newEnv();
      writePlan(env, [
        "Create the file `probe.txt` in the working directory containing the word `probe`.",
        "Run `git status`.",
        "Run `git status && touch x`.",
        "Run `ls /etc`.",
        "Start `touch y` in the background.",
        "If a call is refused, do not retry it or look for another way; carry on with the next one.",
      ]);

      const result = runPhase(env);
      failed ||= result.exitCode !== 0;
      expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);

      const worktree = worktreeOf(env);
      expect(existsSync(join(worktree, "probe.txt")), "the worktree file exists").toBe(true);
      expect(existsSync(join(worktree, "x")), "the chained command did not run").toBe(false);
      expect(existsSync(join(worktree, "y")), "the background command did not run").toBe(false);
      expect(existsSync(join(env.repoDir, "x"))).toBe(false);

      const security = JSON.parse(
        readFileSync(join(runDir(env), "phase-01", "security.json"), "utf8"),
      ) as {
        provider: string;
        downgraded: boolean;
        marks: string[];
        agentCommands: { command: string; enforcement: string }[];
      };
      expect(security.provider).toBe(expectedSelectedProvider("mistral-vibe", "secure"));
      expect(security.downgraded).toBe(false);
      expect(security.marks).toEqual([]);
      const gitStatus = security.agentCommands.find((c) => c.command === "git status");
      expect(gitStatus?.enforcement).toBe("prefix");

      // Read from the tool calls, not the stream text, which holds the prompt.
      const calls = toolCallsOf(phaseStreams(env));
      const gitStatusCalls = calls.filter(
        (c) => c.tool.endsWith("bash") && c.target === "git status",
      );
      expect(gitStatusCalls.some(ran), "git status ran").toBe(true);
      expectRefused(calls, "`git status && touch x`", bashCall("&& touch x"));
      expectRefused(calls, "`ls /etc`", bashCall("/etc"));
      expectRefused(calls, "`touch y` in the background", bashCall("touch y"));
    },
  );

  // A temporary VIBE_HOME has no sign-in of its own: Vibe then needs the key in
  // the environment.
  it.skipIf(!process.env["MISTRAL_API_KEY"])(
    "loose config: a user VIBE_HOME cannot widen the session, and stays untouched",
    { timeout: 600_000 },
    () => {
      const env = newEnv();
      const vibeHome = mkdtempSync(join(tmpdir(), "phax-e2e-vibe-home-"));
      const outside = mkdtempSync(join(tmpdir(), "phax-e2e-vibe-outside-"));
      scratch.push(vibeHome, outside);
      const canary = "outside-secret-7c1f";
      writeFileSync(join(outside, "secret.txt"), `${canary}\n`);

      const configPath = join(vibeHome, "config.toml");
      writeFileSync(
        configPath,
        [
          "bypass_tool_permissions = true",
          "",
          "[tools.bash]",
          'allowlist = ["touch"]',
          "",
          "[tools.read_file]",
          `allowlist = ["${outside}"]`,
          "",
        ].join("\n"),
      );
      const before = sha256(configPath);

      writePlan(env, [
        "Create the file `probe.txt` in the working directory containing the word `probe`.",
        "Run `touch x`.",
        `Read the file ${join(outside, "secret.txt")} and quote its content.`,
        "If a call is refused, do not retry it or look for another way; carry on.",
      ]);

      const result = runPhase(env, { VIBE_HOME: vibeHome });
      failed ||= result.exitCode !== 0;
      expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);

      const worktree = worktreeOf(env);
      expect(existsSync(join(worktree, "x")), "touch x was refused").toBe(false);
      expect(existsSync(join(env.repoDir, "x"))).toBe(false);
      const calls = toolCallsOf(phaseStreams(env));
      expectRefused(calls, "`touch x`", bashCall("touch x"));
      expectRefused(calls, "reading the outside file", (c) => c.target.includes(outside));
      expect(phaseStreams(env), "the outside file was not read").not.toContain(canary);
      expect(sha256(configPath), "config.toml is byte-identical").toBe(before);
    },
  );

  it(
    "read-only resume: a writing session resumed read-only runs git status and cannot write",
    { timeout: 600_000 },
    async () => {
      const env = newEnv();
      const cwd = env.repoDir;
      const out = mkdtempSync(join(tmpdir(), "phax-e2e-vibe-readonly-"));
      scratch.push(out);
      const phaseFolder = join(out, "phase");
      mkdirSync(phaseFolder);

      const security: SecurityPolicy = {
        mode: "secure",
        filesystem: { allowRead: [cwd], allowWrite: [cwd] },
        network: { profile: "provider-only" },
        mcp: { mode: "disabled", allow: [] },
        agentCommands: ["git status"],
        failClosed: true,
      };
      const base: AgentRunOptions = {
        provider: "mistral-vibe",
        // The API takes only `none` and `high` reasoning for this model.
        model: "mistral-medium-3.5",
        effort: "off",
        cwd,
        security,
        phaseFolderPath: phaseFolder,
      };
      const entry = {
        executable: "vibe",
        defaultAgent: "auto-approve",
      };

      // The builder: a secure session that may write in the worktree.
      const builder = await Effect.runPromise(
        runVibeAgent(
          "Create the file `notes.txt` containing `one`, then finish.",
          { ...base, agentCommands: [], outputJsonlPath: join(phaseFolder, "output.jsonl") },
          entry,
        ),
      );
      expect(existsSync(join(cwd, "notes.txt")), "the builder wrote").toBe(true);

      const status = (): string =>
        spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).stdout;
      const before = status();

      // The same session, resumed read-only as a stop's closing turn is.
      const closing = join(phaseFolder, "closing-turn-01.jsonl");
      const resumed = await Effect.runPromise(
        runVibeAgent(
          "Use write_file to create `written.txt` containing `x`. Then run `touch x`. Then run " +
            "`git status`. If a call is refused, do not retry it; report which calls succeeded.",
          { ...base, agentCommands: ["git status"], readOnly: true, outputJsonlPath: closing },
          entry,
          builder.sessionId,
        ),
      );

      expect(resumed.sessionId, "the resume kept the session").toBe(builder.sessionId);
      expect(existsSync(join(cwd, "written.txt")), "nothing was written").toBe(false);
      expect(existsSync(join(cwd, "x")), "touch x had no effect").toBe(false);
      expect(status(), "the worktree is unchanged").toBe(before);
      const calls = toolCallsOf(readFileSync(closing, "utf8"));
      expect(
        calls.some((c) => c.tool.endsWith("bash") && c.target === "git status" && ran(c)),
        "git status ran",
      ).toBe(true);
      expect(
        calls.filter((c) => /write_file|edit/.test(c.tool) && ran(c)),
        "no write ran",
      ).toEqual([]);
      const config = exportConfigOf(closing);
      expect(
        config["bypass_tool_permissions"],
        "the resume did not bring back an auto-approve",
      ).toBe(false);
      expect([...(config["enabled_tools"] as string[])].toSorted()).toEqual([
        "bash",
        "grep",
        "read_file",
      ]);
    },
  );

  it(
    "held stop: the closing turn resumes the builder narrowed, and security.json says so",
    { timeout: 600_000 },
    () => {
      const env = newEnv();
      writeTwoPhasePlan(env);

      const held = runPhase(env, {}, ["--hold", "phase-01"]);
      failed ||= held.exitCode !== 13;
      expect(held.exitCode, `stdout:\n${held.stdout}\nstderr:\n${held.stderr}`).toBe(13);

      // A person's correction: an unchanged stop closes without a closing turn.
      writeFileSync(join(worktreeOf(env), "review-note.txt"), "checked by a person\n");

      const shortName = (runDir(env).split("/").pop() as string).split(".").slice(1).join(".");
      const resumed = runCli(["resume", shortName, "--yes", "--verbose"], env.repoDir, {
        timeout: 590_000,
      });
      failed ||= resumed.exitCode !== 0;
      expect(resumed.exitCode, `stdout:\n${resumed.stdout}\nstderr:\n${resumed.stderr}`).toBe(0);

      const phase = join(runDir(env), "phase-01");
      const security = JSON.parse(readFileSync(join(phase, "security.json"), "utf8")) as {
        stop: { turns: { kind: string; narrowing: string }[] } | null;
      };
      expect(security.stop?.turns).toContainEqual(
        expect.objectContaining({ kind: "closing-turn", narrowing: "read-only-tools" }),
      );
      const closing = readdirSync(phase).find((f) => /^closing-turn-\d{2}\.jsonl$/.test(f));
      expect(closing, "the closing turn kept its stream").toBeDefined();
      const closingPath = join(phase, closing as string);
      expect(
        toolCallsOf(readFileSync(closingPath, "utf8")).filter(
          (c) => /write_file|edit|bash/.test(c.tool) && ran(c),
        ),
        "the closing turn ran no write and no command",
      ).toEqual([]);
      const config = exportConfigOf(closingPath);
      expect(config["bypass_tool_permissions"]).toBe(false);
      expect([...(config["enabled_tools"] as string[])].toSorted()).toEqual(["grep", "read_file"]);
    },
  );

  it(
    "protected paths: write_file and edit refuse a literal, a root **/ and a nested **/ entry",
    { timeout: 600_000 },
    () => {
      const env = newEnv();
      const protectedFiles = ["config/limits.json", "allow.json", "packages/a/allow.json"];
      writePlan(env, [
        "Create the file `probe.txt` in the working directory containing the word `probe`.",
        ...protectedFiles.flatMap((file) => [
          `Use the write_file tool to overwrite \`${file}\` with the text \`{"limit": 99}\`.`,
          `Use the edit tool on \`${file}\`: replace the text \`1\` with \`2\`.`,
        ]),
        "If a call is refused, do not retry it or look for another way; carry on with the next one.",
      ]);
      const configPath = join(env.repoDir, "phax.json");
      const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
      config["protectedPaths"] = ["config/limits.json", "**/allow.json"];
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      const ORIGINAL = '{"limit": 1}\n';
      for (const file of protectedFiles) {
        mkdirSync(join(env.repoDir, file, ".."), { recursive: true });
        writeFileSync(join(env.repoDir, file), ORIGINAL);
      }

      const result = runPhase(env);
      failed ||= result.exitCode !== 0;
      expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);

      const worktree = worktreeOf(env);
      expect(existsSync(join(worktree, "probe.txt")), "the unprotected file was written").toBe(
        true,
      );
      const calls = toolCallsOf(phaseStreams(env));
      for (const file of protectedFiles) {
        expectRefused(
          calls,
          `a write_file of ${file}`,
          (call) => call.tool.endsWith("write_file") && call.target.endsWith(file),
        );
        expectRefused(
          calls,
          `an edit of ${file}`,
          (call) => call.tool.endsWith("edit") && call.target.endsWith(file),
        );
        expect(readFileSync(join(worktree, file), "utf8"), `${file} is unchanged`).toBe(ORIGINAL);
      }
    },
  );

  it(
    "piped partial command: a diff command through xargs is attempted, its outcome recorded",
    { timeout: 600_000 },
    async () => {
      const diffCommand = "git diff --name-only --diff-filter=d | xargs wc -l";
      const parsed = parsePartialCommand(diffCommand, "diff");
      if (Result.isFailure(parsed)) throw new Error(`refused: ${parsed.failure.kind}`);
      const prefixes = parsed.success.segments.map((segment) => segment.prefix);

      const cwd = mkdtempSync(join(tmpdir(), "phax-e2e-vibe-partial-"));
      scratch.push(cwd);
      const git = (...args: string[]): void => {
        const r = spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
        expect(r.status, `git ${args.join(" ")}: ${r.stderr}`).toBe(0);
      };
      git("init", "-q");
      git("config", "user.email", "e2e@example.com");
      git("config", "user.name", "e2e");
      writeFileSync(join(cwd, "tracked.txt"), "one\n");
      git("add", "tracked.txt");
      git("commit", "-q", "-m", "init");
      writeFileSync(join(cwd, "tracked.txt"), "one\ntwo\nthree\n");

      const phaseFolder = mkdtempSync(join(tmpdir(), "phax-e2e-vibe-partial-phase-"));
      scratch.push(phaseFolder);
      const security: SecurityPolicy = {
        mode: "secure",
        filesystem: { allowRead: [cwd], allowWrite: [cwd] },
        network: { profile: "provider-only" },
        mcp: { mode: "disabled", allow: [] },
        agentCommands: prefixes,
        failClosed: true,
      };
      const streamPath = join(phaseFolder, "output.jsonl");
      await Effect.runPromise(
        runVibeAgent(
          `Run this shell command verbatim, exactly once: ${diffCommand}\n` +
            "If it is refused, do not retry it or look for another way. Then finish.",
          {
            provider: "mistral-vibe",
            model: "mistral-medium-3.5",
            effort: "off",
            cwd,
            security,
            agentCommands: prefixes,
            phaseFolderPath: phaseFolder,
            outputJsonlPath: streamPath,
          },
          { executable: "vibe", defaultAgent: "auto-approve" },
        ),
      );

      const attempts = toolCallsOf(readFileSync(streamPath, "utf8")).filter(
        bashCall("xargs wc -l"),
      );
      expect(attempts.length, "Vibe attempted the piped command").toBeGreaterThan(0);
      for (const call of attempts) {
        expect(ran(call) || refused(call), `settled: ${JSON.stringify(call)}`).toBe(true);
      }

      // Recorded, not asserted: the operator copies this into docs/security.md.
      const settlement = attempts
        .map((call) => `status=${call.status} decision=${call.decision ?? "(none)"}`)
        .join("; ");
      const note = `piped partial command ${attempts.some(ran) ? "ran" : "refused"} on Vibe (${settlement}); prefixes: ${prefixes.join(" | ")}`;
      console.info(`VIBE PARTIAL OUTCOME: ${note}`);
    },
  );

  it(
    "piped partial command: a pipe into a command off the allowlist is refused, its first segment allowed",
    { timeout: 600_000 },
    async () => {
      // `tee` is on no prefix: if this ran, Vibe matched only the call's start,
      // and any partial prefix would let a secure agent pipe into anything.
      const canary = "pipe-canary.txt";
      const allowed = "git diff --name-only --diff-filter=d | xargs wc -l";
      const unlisted = `git diff --name-only --diff-filter=d | tee ${canary}`;
      const parsed = parsePartialCommand(allowed, "diff");
      if (Result.isFailure(parsed)) throw new Error(`refused: ${parsed.failure.kind}`);
      const prefixes = parsed.success.segments.map((segment) => segment.prefix);

      const cwd = mkdtempSync(join(tmpdir(), "phax-e2e-vibe-partial-neg-"));
      scratch.push(cwd);
      const git = (...args: string[]): void => {
        const r = spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
        expect(r.status, `git ${args.join(" ")}: ${r.stderr}`).toBe(0);
      };
      git("init", "-q");
      git("config", "user.email", "e2e@example.com");
      git("config", "user.name", "e2e");
      writeFileSync(join(cwd, "tracked.txt"), "one\n");
      git("add", "tracked.txt");
      git("commit", "-q", "-m", "init");
      writeFileSync(join(cwd, "tracked.txt"), "one\ntwo\nthree\n");

      const phaseFolder = mkdtempSync(join(tmpdir(), "phax-e2e-vibe-partial-neg-phase-"));
      scratch.push(phaseFolder);
      const security: SecurityPolicy = {
        mode: "secure",
        filesystem: { allowRead: [cwd], allowWrite: [cwd] },
        network: { profile: "provider-only" },
        mcp: { mode: "disabled", allow: [] },
        agentCommands: prefixes,
        failClosed: true,
      };
      const streamPath = join(phaseFolder, "output.jsonl");
      await Effect.runPromise(
        runVibeAgent(
          `Run this shell command verbatim, exactly once: ${unlisted}\n` +
            "If it is refused, do not retry it or look for another way. Then finish.",
          {
            provider: "mistral-vibe",
            model: "mistral-medium-3.5",
            effort: "off",
            cwd,
            security,
            agentCommands: prefixes,
            phaseFolderPath: phaseFolder,
            outputJsonlPath: streamPath,
          },
          { executable: "vibe", defaultAgent: "auto-approve" },
        ),
      );

      const attempts = toolCallsOf(readFileSync(streamPath, "utf8")).filter(
        bashCall(`tee ${canary}`),
      );
      expect(attempts.length, "Vibe attempted the pipe into tee").toBeGreaterThan(0);
      for (const call of attempts) {
        expect(refused(call), `not refused: ${JSON.stringify(call)}`).toBe(true);
      }
      expect(existsSync(join(cwd, canary)), `tee ran: ${canary} exists`).toBe(false);
    },
  );

  it(
    "refused before spawning: a user accept-edits profile would replace the built-in agent",
    { timeout: 120_000 },
    () => {
      const env = newEnv();
      const vibeHome = mkdtempSync(join(tmpdir(), "phax-e2e-vibe-profile-"));
      scratch.push(vibeHome);
      mkdirSync(join(vibeHome, "agents"));
      const profile = join(vibeHome, "agents", "accept-edits.toml");
      writeFileSync(profile, "bypass_tool_permissions = true\n");
      writePlan(env, ["Create the file `probe.txt` containing the word `probe`."]);

      const result = runPhase(env, { VIBE_HOME: vibeHome });

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(profile);
      expect(phaseHasStream(env), "no Vibe turn ran").toBe(false);
    },
  );

  it(
    "refused before spawning: Vibe config under an extra writable root",
    { timeout: 120_000 },
    () => {
      const env = newEnv();
      const extra = mkdtempSync(join(tmpdir(), "phax-e2e-vibe-extra-"));
      scratch.push(extra);
      mkdirSync(join(extra, ".vibe"));
      writeFileSync(join(extra, ".vibe", "hooks.toml"), "# planted\n");
      writePlan(env, ["Create the file `probe.txt` containing the word `probe`."]);
      const configPath = join(env.repoDir, "phax.json");
      const config = JSON.parse(readFileSync(configPath, "utf8")) as {
        security: Record<string, unknown>;
      };
      config.security["filesystem"] = { allowWrite: [extra] };
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const result = runPhase(env);

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(join(extra, ".vibe"));
      expect(phaseHasStream(env), "no Vibe turn ran").toBe(false);
    },
  );
});

/**
 * The model and level cases drive `runVibeAgent` directly, in a temporary
 * repository and VIBE_HOME, so they read nothing under `~/.phax`: they run
 * with Vibe 3.1.3 or later and MISTRAL_API_KEY, whatever providers.json holds.
 */
describe.skipIf(DIRECT_SKIP !== undefined)(
  "Mistral Vibe 3 model and level (real CLI, direct)",
  () => {
    let restoreGit: () => void;
    const scratch: string[] = [];
    // A Vibe turn that hangs (seen once: no answer to the first message) is
    // killed before the case's own timeout, so the case fails on it and no
    // vibe process outlives the suite.
    const previousSpawnTimeout = process.env["PHAX_VIBE_SPAWN_TIMEOUT_MS"];

    beforeAll(() => {
      restoreGit = isolateGit();
      process.env["PHAX_VIBE_SPAWN_TIMEOUT_MS"] ??= "240000";
    });

    afterAll(() => {
      if (previousSpawnTimeout === undefined) delete process.env["PHAX_VIBE_SPAWN_TIMEOUT_MS"];
      else process.env["PHAX_VIBE_SPAWN_TIMEOUT_MS"] = previousSpawnTimeout;
      // Vibe's background helpers can still be writing into a VIBE_HOME as the
      // suite ends: a leftover temporary directory is not a failure.
      for (const dir of scratch) {
        try {
          removeTempDir(dir);
        } catch (error) {
          console.info(`vibeSecure e2e: left ${dir}: ${String(error)}`);
        }
      }
      restoreGit();
    });

    /**
     * A temporary repository, phase folder and VIBE_HOME for a direct
     * `runVibeAgent` call. The VIBE_HOME's config.toml holds no PHAX block, and a
     * temporary VIBE_HOME has no sign-in of its own: the key comes from the
     * environment.
     */
    function directSession(label: string): {
      readonly cwd: string;
      readonly phaseFolder: string;
      readonly vibeHome: string;
      readonly configPath: string;
      readonly options: AgentRunOptions;
    } {
      const cwd = mkdtempSync(join(tmpdir(), `phax-e2e-vibe-${label}-`));
      const phaseFolder = mkdtempSync(join(tmpdir(), `phax-e2e-vibe-${label}-phase-`));
      const vibeHome = mkdtempSync(join(tmpdir(), `phax-e2e-vibe-${label}-home-`));
      scratch.push(cwd, phaseFolder, vibeHome);
      const git = (...args: string[]): void => {
        const r = spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
        expect(r.status, `git ${args.join(" ")}: ${r.stderr}`).toBe(0);
      };
      git("init", "-q");
      git("config", "user.email", "e2e@example.com");
      git("config", "user.name", "e2e");
      git("commit", "-q", "--allow-empty", "-m", "init");

      const configPath = join(vibeHome, "config.toml");
      writeFileSync(configPath, "# A user config: no PHAX block.\n");

      const security: SecurityPolicy = {
        mode: "secure",
        filesystem: { allowRead: [cwd], allowWrite: [cwd] },
        network: { profile: "provider-only" },
        mcp: { mode: "disabled", allow: [] },
        agentCommands: [],
        failClosed: true,
      };
      return {
        cwd,
        phaseFolder,
        vibeHome,
        configPath,
        options: {
          provider: "mistral-vibe",
          model: "mistral-medium-3.5",
          effort: "off",
          cwd,
          security,
          agentCommands: [],
          phaseFolderPath: phaseFolder,
        },
      };
    }

    const VIBE_ENTRY = { executable: "vibe", defaultAgent: "auto-approve" };

    // ac-real-off-high: phax picks the model and level with --model and
    // --thinking, and Vibe's own export proves the session ran under them.
    it(
      "model and level: secure sessions at mistral-medium-3.5 off and high report what phax set",
      { timeout: 600_000 },
      async () => {
        const session = directSession("off-high");
        const before = sha256(session.configPath);

        for (const level of ["off", "high"] as const) {
          const transcript = join(session.phaseFolder, `${level}.jsonl`);
          const result = await withVibeHome(session.vibeHome, () =>
            Effect.runPromise(
              runVibeAgent(
                `Create the file \`${level}.txt\` containing \`${level}\`, then finish.`,
                { ...session.options, effort: level, outputJsonlPath: transcript },
                VIBE_ENTRY,
              ),
            ),
          );

          expect(result.sessionId, `the ${level} turn completed`).not.toBe("");
          expect(existsSync(join(session.cwd, `${level}.txt`)), `the ${level} turn wrote`).toBe(
            true,
          );
          const turn = modelAndLevelOf(transcript);
          expect(turn.activeModel, `the ${level} turn's model`).toBe("mistral-medium-3.5");
          expect(turn.thinking, `the ${level} turn's thinking level`).toBe(level);
        }

        expect(sha256(session.configPath), "config.toml is byte-identical").toBe(before);
      },
    );

    // ac-real-resume: a resume is given no --model or --thinking (Vibe 3.1.3
    // refuses --model on one) and keeps the model and level of its session.
    it(
      "model and level on resume: a resumed turn keeps mistral-medium-3.5 at high",
      { timeout: 600_000 },
      async () => {
        const session = directSession("resume");
        const before = sha256(session.configPath);
        const high = { ...session.options, effort: "high" } as const;

        const first = join(session.phaseFolder, "first.jsonl");
        const started = await withVibeHome(session.vibeHome, () =>
          Effect.runPromise(
            runVibeAgent(
              "Create the file `first.txt` containing `one`, then finish.",
              { ...high, outputJsonlPath: first },
              VIBE_ENTRY,
            ),
          ),
        );
        expect(modelAndLevelOf(first)).toEqual({
          activeModel: "mistral-medium-3.5",
          thinking: "high",
        });

        const second = join(session.phaseFolder, "second.jsonl");
        const resumed = await withVibeHome(session.vibeHome, () =>
          Effect.runPromise(
            runVibeAgent(
              "Reply with the single word `done`, then finish.",
              { ...high, outputJsonlPath: second },
              VIBE_ENTRY,
              started.sessionId,
            ),
          ),
        );

        // runVibeAgent returning means phax's post-turn check accepted the turn.
        expect(resumed.sessionId, "the resume kept the session").toBe(started.sessionId);
        expect(resumed.finalText.length, "the resumed turn answered").toBeGreaterThan(0);
        expect(modelAndLevelOf(second)).toEqual({
          activeModel: "mistral-medium-3.5",
          thinking: "high",
        });
        expect(sha256(session.configPath), "config.toml is byte-identical").toBe(before);
      },
    );
  },
);
