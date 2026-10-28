/**
 * Real-CLI proof of Mistral Vibe 3 in secure mode. Run by `pnpm test:e2e:real`
 * with PHAX_E2E_RUN=1, Vibe 3.0.3 or later on $PATH, phax's model aliases in
 * Vibe's home (`phax agent setup mistral-vibe --install-model-aliases`), the
 * mistral-vibe provider enabled in `~/.phax/providers.json`
 * (`phax agent setup providers --write`), and the provider credential in the
 * environment (MISTRAL_API_KEY). Without the provider enabled, routing would
 * fall back to Claude Code, so the suite skips and says so.
 *
 * Cases, each in its own temporary repository:
 *   - secure confined: a secure phase writes in the worktree and runs its one
 *     agent command, while chained, outside and background calls are refused;
 *   - loose config: a hostile VIBE_HOME config cannot widen the session;
 *   - read-only resume: a writing session resumed read-only, granted
 *     `git status`, runs it and cannot write;
 *   - held stop: the closing turn resumes the builder session narrowed, and
 *     security.json records the narrowing;
 *   - refused before spawning: a user accept-edits profile, and Vibe config
 *     under an extra writable root.
 *
 * Every claim about a call reads the stream's tool-call entries (`effect`
 * entries: the tool, its input, and how it settled), never the raw stream,
 * which also holds the prompt that names those calls. The suite spends real
 * tokens and trusts Vibe's own enforcement, which a unit test cannot check.
 */

import { Effect } from "effect";
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
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import { runVibeAgent } from "../../src/infra/providers/mistralVibe.js";
import { vibeExportFileOf } from "../../src/domain/records/usage.js";
import type { AgentRunOptions } from "../../src/ports/backend.js";
import { parseVibeVersion } from "../../src/schemas/vibeOutput.js";
import {
  PHAX_ALIAS_LEVELS,
  renderPhaxAliasBlocks,
  type VibeBaseModel,
} from "../../src/schemas/vibeConfig.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { removeTempDir } from "../helpers/tempGit.js";
import { printArtifacts } from "./helpers/artifacts.js";
import { runCli } from "./helpers/runCli.js";
import { createTempEnv, type TempEnv } from "./helpers/tempEnv.js";
import { expectedSelectedProvider, probeProvider } from "./helpers/providers.js";

const CREDENTIAL = "MISTRAL_API_KEY";

function vibeVersionAtLeast303(): boolean {
  const r = spawnSync("vibe", ["--version"], { encoding: "utf8", timeout: 5_000, stdio: "pipe" });
  if (r.status !== 0) return false;
  const v = parseVibeVersion(`${r.stdout}${r.stderr}`);
  if (v === undefined) return false;
  if (v.major !== 3) return v.major > 3;
  if (v.minor !== 0) return v.minor > 0;
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

function skipReason(): string | undefined {
  if (process.env["PHAX_E2E_RUN"] !== "1") return "PHAX_E2E_RUN=1 is not set";
  if (!probeProvider("vibe")) return "the vibe executable is not on $PATH";
  if (!vibeVersionAtLeast303()) return "vibe is older than 3.0.3";
  if (!process.env[CREDENTIAL]) return `${CREDENTIAL} is not set (the provider credential)`;
  if (!vibeProviderEnabled()) {
    return "mistral-vibe is not enabled in ~/.phax/providers.json (phax agent setup providers --write); routing would run Claude Code instead";
  }
  return undefined;
}

const SKIP = skipReason();
if (SKIP !== undefined) console.info(`vibeSecure e2e skipped: ${SKIP}`);

const BASE_MODEL: VibeBaseModel = {
  name: "mistral-medium-3.5",
  provider: "mistral",
  temperature: 0.2,
  input_price: 1.5,
  output_price: 7.5,
  auto_compact_threshold: 200_000,
};

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

/** A bash call whose command holds `fragment`. */
const bashCall =
  (fragment: string) =>
  (call: VibeToolCall): boolean =>
    call.tool.endsWith("bash") && call.target.includes(fragment);

/** The config a turn ran with, read from the export beside its stream. */
function exportConfigOf(transcriptPath: string): Record<string, unknown> {
  const exported = JSON.parse(readFileSync(vibeExportFileOf(transcriptPath), "utf8")) as {
    config?: Record<string, unknown>;
  };
  return exported.config ?? {};
}

function worktreeOf(env: TempEnv): string {
  const run = runDir(env).split("/").pop() as string;
  return join(env.phaxHome, "worktrees", run, "phase-01");
}

function runPhase(
  env: TempEnv,
  extraEnv: Record<string, string> = {},
  extraArgs: readonly string[] = [],
) {
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

  it(
    "loose config: a user VIBE_HOME cannot widen the session, and stays untouched",
    { timeout: 600_000 },
    () => {
      const env = newEnv();
      const vibeHome = mkdtempSync(join(tmpdir(), "phax-e2e-vibe-home-"));
      const outside = mkdtempSync(join(tmpdir(), "phax-e2e-vibe-outside-"));
      scratch.push(vibeHome, outside);
      const secret = "outside-secret-7c1f";
      writeFileSync(join(outside, "secret.txt"), `${secret}\n`);

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
          '[[models]]\nalias = "mistral-medium-3.5"',
          `name = "${BASE_MODEL.name}"`,
          `provider = "${BASE_MODEL.provider}"`,
          `temperature = ${BASE_MODEL.temperature}`,
          `input_price = ${BASE_MODEL.input_price}`,
          `output_price = ${BASE_MODEL.output_price}`,
          `auto_compact_threshold = ${BASE_MODEL.auto_compact_threshold}`,
          "",
          renderPhaxAliasBlocks(BASE_MODEL, PHAX_ALIAS_LEVELS),
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
      expect(phaseStreams(env), "the outside file was not read").not.toContain(secret);
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
        model: "phax-mistral-medium-3.5-low",
        effort: "low",
        cwd,
        security,
        phaseFolderPath: phaseFolder,
      };
      const entry = {
        executable: "vibe",
        modelEnvVar: "VIBE_ACTIVE_MODEL",
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
