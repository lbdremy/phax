import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isolateGit } from "../helpers/isolateGit.js";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import {
  buildJsonContractsRepo,
  PROMPT_TEXT,
  type JsonContractsRepo,
} from "../fixtures/records/jsonContractsRepo.js";

// Acceptance tests of spec command-contracts, frozen until the phase that moves
// the `records` group onto the command runner: every test carries `.fails`,
// because `--json` and `--json-schema` are still refused (exit 64) by Commander
// and the bridge. Each spawns `tsx src/cli/main.ts` in a temporary repository
// with a temporary HOME and git configuration, so no real ~/.phax, ~/.claude,
// ~/.codex, ~/.vibe or global git config is read.
//   ac-json-every-command, ac-text-unchanged, ac-error-sentence, ac-no-person,
//   ac-json-schema-command and ac-unknown-option.

const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");

const MESSAGE_KINDS = ["note", "written", "error", "refused", "defect"];

let restoreGit: () => void;
let fixture: JsonContractsRepo;

function runCli(args: readonly string[]): SpawnSyncReturns<string> {
  // stdin is closed: a command that prompts would find nobody to answer.
  return spawnSync("tsx", [mainTs, ...args], {
    cwd: fixture.repo,
    encoding: "utf8",
    env: phaxHomeEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function stderrLines(result: SpawnSyncReturns<string>): Record<string, unknown>[] {
  return result.stderr
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function containsString(value: unknown, text: string): boolean {
  if (typeof value === "string") return value === text;
  if (Array.isArray(value)) return value.some((each) => containsString(each, text));
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some((each) => containsString(each, text));
  }
  return false;
}

interface CatalogueEntry {
  readonly name: string[];
}

beforeAll(async () => {
  restoreGit = isolateGit();
  fixture = await buildJsonContractsRepo();
});

afterAll(() => {
  restoreGit();
  fixture.cleanup();
});

describe("phax records status, list and sync under --json", () => {
  for (const command of ["status", "list", "sync"] as const) {
    // ac-json-every-command
    it.fails(`records ${command} --json writes one indented value, message lines on stderr`, () => {
      const result = runCli(["records", command, "--json"]);

      expect(result.status, result.stderr).toBe(0);
      const value: unknown = JSON.parse(result.stdout);
      expect(result.stdout).toBe(JSON.stringify(value, null, 2) + "\n");
      const lines = stderrLines(result);
      for (const line of lines) expect(MESSAGE_KINDS).toContain(line["kind"]);
      if (command === "sync") {
        expect(lines.map((line) => line["kind"])).not.toContain("written");
      }
    });
  }
});

describe("phax records explain", () => {
  // ac-text-unchanged
  it.fails("--json --prompt answers the prompt text the text answer prints", () => {
    const text = runCli(["records", "explain", fixture.phaseSha, "--prompt"]);
    const json = runCli(["records", "explain", fixture.phaseSha, "--json", "--prompt"]);

    expect(text.status, text.stderr).toBe(0);
    expect(text.stdout.endsWith(PROMPT_TEXT + "\n")).toBe(true);
    expect(json.status, json.stderr).toBe(0);
    const value: unknown = JSON.parse(json.stdout);
    expect(json.stdout).toBe(JSON.stringify(value, null, 2) + "\n");
    expect(containsString(value, PROMPT_TEXT)).toBe(true);
  });

  // ac-error-sentence
  it.fails("an unknown sha keeps today's sentence and exit 1, and is one error line under --json", () => {
    const unknown = "no-such-commit";
    const text = runCli(["records", "explain", unknown]);
    const json = runCli(["records", "explain", unknown, "--json"]);

    expect(text.status).toBe(1);
    expect(text.stdout).toBe("");
    expect(text.stderr).toBe('Commit "' + unknown + '" was not found in this repository.\n');
    expect(json.status).toBe(1);
    expect(json.stdout).toBe("");
    const lines = stderrLines(json);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.["kind"]).toBe("error");
    expect(lines[0]?.["exit"]).toBe(1);
  });

  // ac-error-sentence
  it.fails("a commit no phax phase produced is one error line with exit 1 under --json", () => {
    const json = runCli(["records", "explain", fixture.plainSha, "--json"]);

    expect(json.status).toBe(1);
    expect(json.stdout).toBe("");
    const lines = stderrLines(json);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.["kind"]).toBe("error");
    expect(lines[0]?.["exit"]).toBe(1);
  });

  // ac-json-schema-command
  it.fails("--json-schema prints its entry, equal to the one in phax --json-schema", () => {
    const alone = runCli(["records", "explain", "--json-schema"]);
    const all = runCli(["--json-schema"]);

    expect(alone.status, alone.stderr).toBe(0);
    expect(alone.stderr).toBe("");
    const entry = JSON.parse(alone.stdout) as CatalogueEntry;
    expect(entry.name).toEqual(["records", "explain"]);
    expect(all.status, all.stderr).toBe(0);
    const inCatalogue = (JSON.parse(all.stdout) as { commands: CatalogueEntry[] }).commands.find(
      ({ name }) => name.join(" ") === "records explain",
    );
    expect(entry).toEqual(inCatalogue);
  });

  // ac-unknown-option
  it.fails("an undeclared option under --json is one refused line from flags, exit 64", () => {
    const result = runCli(["records", "explain", fixture.phaseSha, "--colour", "--json"]);

    expect(result.status).toBe(64);
    expect(result.stdout).toBe("");
    const lines = stderrLines(result);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.["kind"]).toBe("refused");
    expect(lines[0]?.["source"]).toBe("flags");
  });
});

describe("phax records init --json", () => {
  // ac-no-person
  it.fails("is refused with 64 before any prompt and leaves phax.json untouched", () => {
    const before = readFileSync(fixture.configPath);
    const result = runCli(["records", "init", "--json"]);

    expect(result.stdout).toBe("");
    const lines = stderrLines(result);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.["kind"]).toBe("refused");
    expect(result.status).toBe(64);
    expect(readFileSync(fixture.configPath).equals(before)).toBe(true);
  });
});
