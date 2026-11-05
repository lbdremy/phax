import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { buildArgs, runClaudeAgent } from "../../src/infra/providers/claudeCode.js";
import { CLAUDE_PROJECT_ONLY_FLAGS } from "../../src/domain/session/claudeProjectOnly.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import type { AgentRunOptions } from "../../src/ports/backend.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import { probeProvider } from "./helpers/providers.js";
import { plantUserLayer, type UserLayer } from "./helpers/userLayer.js";

// ac-real-init: a headless Claude Code session launched the way phax launches
// it (`--setting-sources project`, auto-memory off) does not see the user
// layer, and still authenticates and answers.
//
// The user layer is planted in a dedicated Claude Code configuration directory,
// never in ~/.claude: PHAX_E2E_CLAUDE_CONFIG_DIR names it and is handed to
// Claude Code as CLAUDE_CONFIG_DIR for the case's duration. The case writes
// only there (a user skill, a rules file, a CLAUDE.md section, a SessionEnd
// hook and a local plugin marketplace in settings.json, an auto-memory index),
// under names unique to the run, and puts settings.json and CLAUDE.md back
// exactly as they were. It never reads or prints a credential file.
//
// Prepare the directory once, then run the case by name:
//
//   mkdir -p ~/.phax-e2e-claude
//   CLAUDE_CONFIG_DIR=~/.phax-e2e-claude claude /login   # or rely on ANTHROPIC_API_KEY
//   PHAX_E2E_RUN=1 PHAX_E2E_CLAUDE_CONFIG_DIR=~/.phax-e2e-claude \
//     pnpm test:e2e:real tests/e2e/projectOnlySession.test.ts
//
// (On macOS a fresh configuration directory has its own login.) With the
// variable unset the case is skipped. A control session first runs today's
// launch (the same argv without `--setting-sources project`, memory on): it
// must show every planted item, or the case fails naming the item that did not
// plant, so the exclusion is never proven against an empty layer.
//
// Neither the phase gate nor a phase agent runs this file; the operator runs it
// before merging and reports the result, including whether user CLAUDE.md
// stays out (spec §10).
const e2eRun = process.env["PHAX_E2E_RUN"] === "1";
const configDirEnv = process.env["PHAX_E2E_CLAUDE_CONFIG_DIR"];
const claudeInstalled = e2eRun && probeProvider("claude");
const shouldRun = claudeInstalled && configDirEnv !== undefined && configDirEnv !== "";

if (claudeInstalled && !shouldRun) {
  console.warn(
    "ac-real-init skipped: set PHAX_E2E_CLAUDE_CONFIG_DIR to a dedicated, logged-in Claude Code configuration directory.",
  );
}

const MODEL = "claude-haiku-5-5";
const EFFORT = "low";
const SESSION_TIMEOUT = 300_000;

const PROMPT = [
  "Do not use any tools. Answer in exactly one line of the form",
  "`rules=<word>; claudemd=<word>; memory=<word>`.",
  "For each name, the word is the canary word that an instruction in your loaded context",
  "tells you to give when asked for that name's canary (the rules canary, the claudemd canary,",
  "the memory canary). Write NONE for a name when no instruction tells you its canary.",
].join(" ");

interface InitEvent {
  readonly skills?: unknown;
  readonly plugins?: unknown;
}

interface SessionReading {
  readonly init: InitEvent | undefined;
  /** The init event as written, for substring checks. */
  readonly initText: string;
  readonly success: boolean;
  readonly answer: string;
}

// The init event and the result of a stream-json transcript.
function readSession(stdout: string): SessionReading {
  let init: InitEvent | undefined;
  let initText = "";
  let success = false;
  let answer = "";
  for (const raw of stdout.split("\n")) {
    let event: { type?: string; subtype?: string; is_error?: boolean; result?: unknown };
    try {
      event = JSON.parse(raw);
    } catch {
      continue;
    }
    if (event.type === "system" && event.subtype === "init" && init === undefined) {
      init = event as InitEvent;
      initText = raw;
    }
    if (event.type === "result") {
      success = event.subtype === "success" && event.is_error !== true;
      answer = typeof event.result === "string" ? event.result : "";
    }
  }
  return { init, initText, success, answer };
}

// Skill names of the init event, whatever the entry shape (a name or an object).
function skillNames(init: InitEvent | undefined): string[] {
  const skills = Array.isArray(init?.skills) ? (init.skills as unknown[]) : [];
  return skills.map((skill) => (typeof skill === "string" ? skill : JSON.stringify(skill ?? "")));
}

function pluginEntries(init: InitEvent | undefined): string[] {
  const plugins = Array.isArray(init?.plugins) ? (init.plugins as unknown[]) : [];
  return plugins.map((plugin) => JSON.stringify(plugin ?? ""));
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// A SessionEnd hook may finish just after the process exits: wait for it.
function appearsWithin(path: string, ms: number): boolean {
  const deadline = Date.now() + ms;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) return false;
    sleep(250);
  }
  return true;
}

describe.skipIf(!shouldRun)("ac-real-init: project-only sources (real provider)", () => {
  let configDir: string;
  let repoDir: string;
  let scratchDir: string;
  let layer: UserLayer | undefined;

  beforeAll(() => {
    configDir = resolve(configDirEnv as string);
    mkdirSync(configDir, { recursive: true });
    // realpath: macOS tmpdir is a symlink, and Claude Code files its project
    // memory by the path it resolves.
    repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-project-only-e2e-")));
    scratchDir = mkdtempSync(join(tmpdir(), "phax-project-only-out-"));
    spawnSync("git", ["init", "-q"], { cwd: repoDir });
    disableGitAutoMaintenance(repoDir);
    spawnSync("git", ["config", "--local", "user.email", "e2e@phax.test"], { cwd: repoDir });
    spawnSync("git", ["config", "--local", "user.name", "phax E2E"], { cwd: repoDir });
    mkdirSync(join(repoDir, ".claude", "skills", "repo-skill"), { recursive: true });
    writeFileSync(
      join(repoDir, ".claude", "skills", "repo-skill", "SKILL.md"),
      "---\nname: repo-skill\ndescription: The repository's own skill.\n---\n\nA repository skill.\n",
    );
    spawnSync("git", ["add", "."], { cwd: repoDir });
    spawnSync("git", ["commit", "-q", "-m", "chore: initial commit"], { cwd: repoDir });

    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    layer = plantUserLayer({ configDir, repoDir });
  });

  afterAll(() => {
    layer?.remove();
    vi.unstubAllEnvs();
    removeTempDir(repoDir);
    removeTempDir(scratchDir);
  });

  it(
    "shows every planted item in a control session, and none in a project-only session that still answers",
    { timeout: 2 * SESSION_TIMEOUT + 60_000 },
    async () => {
      const planted = layer as UserLayer;
      const security: SecurityPolicy = {
        mode: "secure",
        filesystem: { allowRead: [repoDir], allowWrite: [repoDir] },
        network: { profile: "provider-only" },
        mcp: { mode: "disabled", allow: [] },
        agentCommands: [],
        failClosed: true,
      };
      const options: AgentRunOptions = {
        provider: "claude-code",
        model: MODEL,
        effort: EFFORT,
        cwd: repoDir,
        security,
        agentCommands: [],
        outputJsonlPath: join(scratchDir, "project-only.jsonl"),
      };

      // The launch under test carries the flag; the control is that argv
      // without it, in an environment without the memory switch.
      const launched = buildArgs(options);
      const flagAt = launched.findIndex(
        (arg, index) =>
          arg === CLAUDE_PROJECT_ONLY_FLAGS[0] &&
          launched[index + 1] === CLAUDE_PROJECT_ONLY_FLAGS[1],
      );
      expect(flagAt, "buildArgs must carry --setting-sources project").toBeGreaterThanOrEqual(0);
      const controlArgs = launched.filter(
        (_, index) => index !== flagAt && index !== flagAt + CLAUDE_PROJECT_ONLY_FLAGS.length - 1,
      );
      expect(controlArgs).not.toContain("--setting-sources");
      const controlEnv: Record<string, string | undefined> = { ...process.env };
      delete controlEnv["CLAUDE_CODE_DISABLE_AUTO_MEMORY"];

      // Control: today's launch. Every planted item must show.
      const control = spawnSync("claude", controlArgs, {
        cwd: repoDir,
        input: PROMPT,
        encoding: "utf8",
        timeout: SESSION_TIMEOUT,
        env: controlEnv,
      });
      const controlReading = readSession(control.stdout);
      expect(
        controlReading.success,
        `control session did not succeed (is ${configDir} logged in, or ANTHROPIC_API_KEY set?)\n${control.stderr}\n${control.stdout.slice(-2000)}`,
      ).toBe(true);
      const controlAnswer = controlReading.answer.toLowerCase();
      const missing: string[] = [];
      if (!skillNames(controlReading.init).some((name) => name.includes(planted.skillName))) {
        missing.push(`user skill ${planted.skillName} (not in the init event's skills)`);
      }
      if (!pluginEntries(controlReading.init).some((entry) => entry.includes(planted.pluginName))) {
        missing.push(`plugin ${planted.pluginName} (not in the init event's plugins)`);
      }
      if (!controlAnswer.includes(planted.canaries.rules)) {
        missing.push(`rules file canary ${planted.canaries.rules} (not in the answer)`);
      }
      if (!controlAnswer.includes(planted.canaries.claudeMd)) {
        missing.push(`CLAUDE.md canary ${planted.canaries.claudeMd} (not in the answer)`);
      }
      if (!controlAnswer.includes(planted.canaries.memory)) {
        missing.push(`auto-memory canary ${planted.canaries.memory} (not in the answer)`);
      }
      if (!appearsWithin(planted.hookMarker, 10_000)) {
        missing.push(`SessionEnd hook marker ${planted.hookMarker} (the hook did not run)`);
      }
      expect(
        missing,
        `the control session did not show these planted items, so the fixture proves nothing:\n${missing.join("\n")}\nanswer: ${controlReading.answer}`,
      ).toEqual([]);
      rmSync(planted.hookMarker, { force: true });

      // Project-only: the way phax launches it.
      const result = await Effect.runPromise(runClaudeAgent(PROMPT, options));
      const reading = readSession(readFileSync(options.outputJsonlPath as string, "utf8"));
      const answer = result.finalText.toLowerCase();

      expect(reading.success, "the project-only session did not succeed").toBe(true);
      expect(reading.init, "no init event in the project-only transcript").toBeDefined();
      const skills = skillNames(reading.init);
      expect(
        skills.some((name) => name.includes("repo-skill")),
        skills.join(", "),
      ).toBe(true);
      expect(skills.filter((name) => name.includes(planted.id))).toEqual([]);
      const plugins = pluginEntries(reading.init);
      expect(
        plugins.filter((entry) => entry.includes(planted.id) || entry.includes(configDir)),
      ).toEqual([]);
      expect(reading.initText).not.toContain(planted.id);
      expect(answer).not.toContain(planted.canaries.rules);
      expect(answer).not.toContain(planted.canaries.memory);
      expect(
        appearsWithin(planted.hookMarker, 3_000),
        "the SessionEnd user hook fired under project-only sources",
      ).toBe(false);
      expect(
        answer,
        "user CLAUDE.md still loads under project-only sources: report it (spec §10)",
      ).not.toContain(planted.canaries.claudeMd);
    },
  );
});
