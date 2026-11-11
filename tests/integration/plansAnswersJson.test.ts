import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Result } from "effect";
import { decodePlanLintFile } from "../../src/schemas/planLint.js";
import { decodePlanOverviewFile } from "../../src/schemas/planOverview.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import {
  BAD_PLAN_REL,
  LS_REGISTRY,
  PLANS_LINT_CLEAN_JSON_BEFORE,
  PLANS_LINT_CLEAN_TEXT_BEFORE,
  PLANS_LINT_JSON_BEFORE,
  PLANS_LINT_TEXT_BEFORE,
  PLANS_OVERVIEW_JSON_BEFORE,
  WIDGET_PLAN_REL,
  widgetPlanMd,
} from "../fixtures/commandAnswers/before.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Acceptance tests of spec command-contracts, frozen until the phase that moves
// `phax plans overview`, `phax plans lint` (and `ls` and `artifact status`) onto
// the command runner: every test carries `.fails`, because the commands are
// still Commander commands. Each spawns `tsx src/cli/main.ts` in a temporary
// repository with a temporary HOME and git configuration, so no real ~/.phax,
// ~/.claude, ~/.codex, ~/.vibe or global git config is read.
//   ac-overview, ac-lint-verdict, ac-json-schema-command, ac-catalogue and
//   ac-json-every-command.

const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");

const SPEC_REL = "docs/specs/2611011202-simple-spec.md";
const SPEC_MD =
  "---\nstatus: Draft\ndate: 2026-11-01\naudience: test\nscope: test\n---\n# Simple spec\n\n## Overview\n\nBody text.\n";

const MESSAGE_KINDS = ["note", "written", "error", "refused", "defect"];

let base: string;
let repo: string;
let restoreGit: () => void;

function runCli(args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync("tsx", [mainTs, ...args], { cwd: repo, encoding: "utf8", env: phaxHomeEnv() });
}

function write(rel: string, content: string): void {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), content);
}

interface CatalogueEntry {
  readonly name: string[];
  readonly input: unknown;
  readonly stdin: unknown;
  readonly output: unknown;
  readonly errors: unknown;
}

function catalogue(): { commands: CatalogueEntry[] } {
  const result = runCli(["--json-schema"]);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as { commands: CatalogueEntry[] };
}

beforeAll(() => {
  restoreGit = isolateGit();
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-plans-answers-")));
  repo = join(base, "repo");
  const state = join(base, "state");
  mkdirSync(repo);
  mkdirSync(state);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  disableGitAutoMaintenance(repo);
  write(
    "phax.json",
    JSON.stringify({
      version: 1,
      name: "made-up",
      state: { root: state },
      gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
    }),
  );
  writeFileSync(join(state, "registry.json"), JSON.stringify(LS_REGISTRY));
  write(WIDGET_PLAN_REL, widgetPlanMd());
  write(BAD_PLAN_REL, widgetPlanMd(""));
  write(SPEC_REL, SPEC_MD);
});

afterAll(() => {
  restoreGit();
  removeTempDir(base);
});

describe("phax plans overview --json", () => {
  // ac-overview
  it("starts with the plan-overview 0.34.0 $schema and is today's output after it", () => {
    const result = runCli(["plans", "overview", WIDGET_PLAN_REL, "--json"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.startsWith("{\n")).toBe(true);
    const stamp = `  "$schema": "${schemaUrl("plan-overview", "0.34.0")}",\n`;
    expect(result.stdout.slice(2)).toBe(stamp + PLANS_OVERVIEW_JSON_BEFORE.slice(2));
    expect(Result.isSuccess(decodePlanOverviewFile(JSON.parse(result.stdout)))).toBe(true);
  });
});

describe("phax plans lint", () => {
  // ac-lint-verdict
  it("answers a plan-lint document with --json and today's text without, exiting 1", () => {
    const json = runCli(["plans", "lint", BAD_PLAN_REL, "--json"]);
    const text = runCli(["plans", "lint", BAD_PLAN_REL]);

    expect(json.status, json.stderr).toBe(1);
    expect(text.status, text.stderr).toBe(1);
    expect(text.stdout).toBe(PLANS_LINT_TEXT_BEFORE);
    const document = JSON.parse(json.stdout) as Record<string, unknown>;
    expect(Object.keys(document)[0]).toBe("$schema");
    expect(document["$schema"]).toBe(schemaUrl("plan-lint", "0.34.0"));
    expect(Result.isSuccess(decodePlanLintFile(document))).toBe(true);
    const stamp = `  "$schema": "${schemaUrl("plan-lint", "0.34.0")}",\n`;
    expect(json.stdout.slice(2)).toBe(stamp + PLANS_LINT_JSON_BEFORE.slice(2));
  });

  // ac-lint-verdict
  it("exits 0 on a clean plan, with today's text and a stamped document", () => {
    const json = runCli(["plans", "lint", WIDGET_PLAN_REL, "--json"]);
    const text = runCli(["plans", "lint", WIDGET_PLAN_REL]);

    expect(json.status, json.stderr).toBe(0);
    expect(text.status, text.stderr).toBe(0);
    expect(text.stdout).toBe(PLANS_LINT_CLEAN_TEXT_BEFORE);
    const stamp = `  "$schema": "${schemaUrl("plan-lint", "0.34.0")}",\n`;
    expect(json.stdout.slice(2)).toBe(stamp + PLANS_LINT_CLEAN_JSON_BEFORE.slice(2));
  });

  // ac-json-schema-command
  it("prints its entry with --json-schema, runs no lint and equals the catalogue's", () => {
    // A plan the lint would refuse is not read: the entry is printed alone.
    const result = runCli(["plans", "lint", "--json-schema"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    const entry = JSON.parse(result.stdout) as CatalogueEntry;
    expect(entry.name).toEqual(["plans", "lint"]);
    expect(entry.input).toBeTypeOf("object");
    expect(entry.stdin).toBeNull();
    expect(entry.output).toEqual({ $ref: schemaUrl("plan-lint", "0.34.0") });
    expect(Array.isArray(entry.errors)).toBe(true);
    const inCatalogue = catalogue().commands.find(({ name }) => name.join(" ") === "plans lint");
    expect(entry).toEqual(inCatalogue);
  });
});

describe("the contracts catalogue", () => {
  // ac-catalogue
  it("holds an entry for artifact status, plans overview, plans lint and ls", () => {
    const names = catalogue().commands.map(({ name }) => name.join(" "));

    for (const expected of ["artifact status", "plans overview", "plans lint", "ls"]) {
      expect(names, expected).toContain(expected);
    }
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("the four commands under --json", () => {
  const CALLS: ReadonlyArray<readonly string[]> = [
    ["artifact", "status", SPEC_REL, "--json"],
    ["plans", "overview", WIDGET_PLAN_REL, "--json"],
    ["plans", "lint", WIDGET_PLAN_REL, "--json"],
    ["ls", "--json"],
  ];

  // ac-json-every-command
  it("writes one indented value on stdout, $schema first, and only message lines on stderr", () => {
    for (const args of CALLS) {
      const result = runCli(args);
      const call = args.join(" ");

      expect(result.status, `${call}: ${result.stderr}`).toBe(0);
      const value = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(result.stdout, call).toBe(`${JSON.stringify(value, null, 2)}\n`);
      expect(Object.keys(value)[0], call).toBe("$schema");
      for (const line of result.stderr.split("\n").filter((each) => each !== "")) {
        const message = JSON.parse(line) as { kind: string };
        expect(MESSAGE_KINDS, `${call}: ${line}`).toContain(message.kind);
      }
    }
  });
});
