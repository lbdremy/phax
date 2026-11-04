import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import {
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
import { answerJsonSchema } from "../../src/schemas/answerSchemas.js";
import { getDecideVerdictsFileJsonSchema } from "../../src/schemas/decideVerdicts.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// The lifecycle commands on the command runner (spec command-contracts: ac-written,
// ac-json-every-command, ac-error-sentence, ac-no-person, ac-versioned-stable): each spawns
// `tsx src/cli/main.ts` in a temporary repository with its own git identity, a temporary PHAX
// home and an isolated git configuration, so no real ~/.phax or global git config is read.

const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");

const SPEC = "docs/specs/2611011200-garden-sync.md";
const SPEC_RECORD = "docs/specs/approvals/2611011200-garden-sync.json";
const SPEC_ARCHIVED = "docs/specs/archive/2611011200-garden-sync.md";
const SPEC_UNTOUCHED = "docs/specs/2611011201-orchard-care.md";
const PLAN = "docs/plans/2611011202-garden-sync-plan.md";
const PLAN_ARCHIVED = "docs/plans/archive/2611011202-garden-sync-plan.md";
const OPERATOR = "Ada Example";
const DIGEST = /^sha256:[0-9a-f]{64}$/;

let base: string;
let repo: string;
let restoreGit: () => void;

function git(args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runCli(args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync("tsx", [mainTs, ...args], { cwd: repo, encoding: "utf8", env: phaxHomeEnv() });
}

function write(rel: string, content: string): void {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), content);
}

const specMd = (title: string): string =>
  `---\nstatus: Draft\ndate: 2026-11-01\naudience: test\nscope: test\n---\n# ${title}\n\n## Overview\n\nBody text.\n`;

// A plan phax reads deterministically, bound to no spec.
const PLAN_MD = `---
status: Draft
source-spec: null
---
# Garden sync plan

## Overview

Sync the garden.

## Required commands

- pnpm check:full

## phase-01 — Sync {#phase-01-sync}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

### Planned files to create

- (none)

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Commit subject

feat: sync the garden

### Commit body

Sync it.
`;

beforeAll(() => {
  restoreGit = isolateGit();
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-artifact-transitions-")));
  repo = join(base, "repo");
  mkdirSync(repo);
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.name", OPERATOR]);
  git(["config", "user.email", "ada@example.test"]);
  disableGitAutoMaintenance(repo);
  write(
    "phax.json",
    JSON.stringify({ version: 1, name: "made-up", state: { root: join(base, "state") } }),
  );
  write(SPEC, specMd("Garden sync"));
  write(SPEC_UNTOUCHED, specMd("Orchard care"));
  write(PLAN, PLAN_MD);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "seed"]);
});

afterAll(() => {
  restoreGit();
  removeTempDir(base);
});

interface WrittenRecord {
  readonly path: string;
  readonly format: string | null;
  readonly digest: string;
}

/** The lines of a stream, each parsed: every line of stderr under `--json` is a message. */
function messageLines(stderr: string): Array<{ kind: string }> {
  return stderr
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { kind: string });
}

function answer(args: readonly string[]): Record<string, unknown> & { written: WrittenRecord[] } {
  const result = runCli([...args, "--json"]);
  expect(result.status, result.stderr).toBe(0);
  // One indented JSON value, a trailing newline.
  expect(result.stdout.endsWith("}\n")).toBe(true);
  expect(result.stdout).toContain('\n  "');
  for (const line of messageLines(result.stderr)) expect(line.kind).toBe("note");
  return JSON.parse(result.stdout) as Record<string, unknown> & { written: WrittenRecord[] };
}

const sha256 = (bytes: Buffer): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** The bytes a path holds in the last commit. */
function committed(path: string): Buffer {
  return execFileSync("git", ["show", `HEAD:${path}`], { cwd: repo });
}

// Each test spawns `tsx` one to three times: under the full suite's parallel load that is slow.
describe("phax artifact approve|reopen|stale|abandon|complete --json", { timeout: 120_000 }, () => {
  it("approve lists the spec and its approval record, with the digests of the committed bytes", () => {
    const value = answer(["artifact", "approve", SPEC, "--by", "operator"]);

    expect(value).toMatchObject({
      status: "Approved",
      previousStatus: "Draft",
      path: SPEC,
      approvedBy: { kind: "operator", name: OPERATOR },
      reopenedBy: null,
      deletedRecord: null,
      boundPlans: [],
    });
    expect(value["commit"]).toMatchObject({ subject: expect.stringContaining("approve") });
    expect(value.written.map((each) => each.path)).toEqual([SPEC, SPEC_RECORD]);
    for (const each of value.written) {
      expect(each.digest).toMatch(DIGEST);
      expect(each.digest).toBe(sha256(committed(each.path)));
      // A record file from the repository's root, never an absolute path.
      expect(each.path.startsWith("/")).toBe(false);
    }
    expect(value.written[1]?.format).not.toBeNull();
    expect(git(["status", "--porcelain"])).toBe("");
  });

  it("approve without --by is refused under --json with 64, leaving the spec and the index alone", () => {
    const before = readFileSync(join(repo, SPEC_UNTOUCHED), "utf8");
    const head = git(["rev-parse", "HEAD"]);

    const result = runCli(["artifact", "approve", SPEC_UNTOUCHED, "--json"]);

    expect(result.status).toBe(64);
    expect(result.stdout).toBe("");
    const lines = messageLines(result.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe("refused");
    expect(readFileSync(join(repo, SPEC_UNTOUCHED), "utf8")).toBe(before);
    expect(git(["rev-parse", "HEAD"])).toBe(head);
    expect(git(["status", "--porcelain"])).toBe("");
    expect(git(["diff", "--cached", "--name-only"])).toBe("");
  });

  it("reopen without --by is refused under --json with 64", () => {
    const result = runCli(["artifact", "reopen", SPEC, "--json"]);

    expect(result.status).toBe(64);
    expect(messageLines(result.stderr).map((line) => line.kind)).toEqual(["refused"]);
    expect(existsSync(join(repo, SPEC_RECORD))).toBe(true);
  });

  it("reopen names the record it deleted and lists the spec alone as written", () => {
    const value = answer(["artifact", "reopen", SPEC, "--by", "operator"]);

    expect(value).toMatchObject({
      status: "Draft",
      previousStatus: "Approved",
      path: SPEC,
      approvedBy: null,
      reopenedBy: { kind: "operator", name: OPERATOR },
      deletedRecord: SPEC_RECORD,
    });
    expect(value.written.map((each) => each.path)).toEqual([SPEC]);
    expect(value.written[0]?.digest).toBe(sha256(committed(SPEC)));
    expect(existsSync(join(repo, SPEC_RECORD))).toBe(false);
  });

  it("an illegal transition keeps today's sentence and exit 12, and is one error line under --json", () => {
    const text = runCli(["artifact", "reopen", SPEC, "--by", "operator"]);
    const json = runCli(["artifact", "reopen", SPEC, "--by", "operator", "--json"]);

    expect(text.status).toBe(12);
    expect(text.stdout).toBe("");
    expect(json.status).toBe(12);
    expect(json.stdout).toBe("");
    const lines = json.stderr.split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"exit":12');
    const line = JSON.parse(lines[0] ?? "") as {
      kind: string;
      error: string;
      fields: { message: string };
    };
    expect(line.kind).toBe("error");
    expect(line.error).toBe("InvalidArtifactTransitionError");
    expect(text.stderr.trimEnd()).toBe(line.fields.message);
  });

  it("stale lists the plan it rewrote", () => {
    const approved = runCli(["artifact", "approve", PLAN, "--by", "machine:garden-loop"]);
    expect(approved.status, approved.stderr).toBe(0);
    expect(approved.stdout).toContain("Status: Approved");
    expect(approved.stdout).toContain("Approver: machine (garden-loop)");

    const value = answer(["artifact", "stale", PLAN]);

    expect(value).toMatchObject({ status: "Stale", previousStatus: "Approved", path: PLAN });
    expect(value.written.map((each) => each.path)).toEqual([PLAN]);
    expect(value.written[0]?.digest).toBe(sha256(committed(PLAN)));
  });

  it("abandon lists the archived plan, not the path it left", () => {
    const value = answer(["artifact", "abandon", PLAN]);

    expect(value).toMatchObject({ status: "Abandoned", path: PLAN_ARCHIVED });
    expect(value.written.map((each) => each.path)).toEqual([PLAN_ARCHIVED]);
    expect(value.written[0]?.digest).toBe(sha256(committed(PLAN_ARCHIVED)));
    expect(existsSync(join(repo, PLAN))).toBe(false);
  });

  it("complete lists the archived spec", () => {
    const approved = runCli(["artifact", "approve", SPEC, "--by", "operator"]);
    expect(approved.status, approved.stderr).toBe(0);

    const value = answer(["artifact", "complete", SPEC]);

    expect(value).toMatchObject({
      status: "Completed",
      previousStatus: "Approved",
      path: SPEC_ARCHIVED,
    });
    expect(value.written.map((each) => each.path)).toEqual([SPEC_ARCHIVED]);
    expect(value.written[0]?.digest).toBe(sha256(committed(SPEC_ARCHIVED)));
  });

  it("prints today's lines without --json", () => {
    const result = runCli(["artifact", "abandon", SPEC_UNTOUCHED]);

    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.split("\n");
    expect(lines[0]).toBe("Status: Abandoned");
    expect(lines).toContain("Path:   docs/specs/archive/2611011201-orchard-care.md");
    expect(lines.some((line) => line.startsWith("Commit: "))).toBe(true);
  });
});

describe("phax artifact schema", { timeout: 120_000 }, () => {
  const schemas = {
    spec: () => answerJsonSchema("spec-document"),
    plan: () => answerJsonSchema("plan-document"),
    verdicts: getDecideVerdictsFileJsonSchema,
  } as const;

  it.each(["spec", "plan", "verdicts"] as const)(
    "%s prints the same bytes with and without --json",
    (kind) => {
      const bare = runCli(["artifact", "schema", kind]);
      const json = runCli(["artifact", "schema", kind, "--json"]);

      expect(bare.status, bare.stderr).toBe(0);
      expect(json.status, json.stderr).toBe(0);
      expect(bare.stdout).toBe(`${JSON.stringify(schemas[kind](), null, 2)}\n`);
      expect(json.stdout).toBe(bare.stdout);
      expect(json.stderr).toBe("");
    },
  );

  it("refuses a kind it does not know with 64", () => {
    const result = runCli(["artifact", "schema", "idea"]);

    expect(result.status).toBe(64);
    expect(result.stdout).toBe("");
  });
});

describe("phax artifact migrate-approvals --json", { timeout: 120_000 }, () => {
  it("with nothing to migrate answers its report and exits 0", () => {
    const value = answer(["artifact", "migrate-approvals"]);

    expect(value).toEqual({ kind: "nothing-to-migrate", written: [] });
  });

  it("prints today's line without --json", () => {
    const result = runCli(["artifact", "migrate-approvals"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      "nothing to migrate: no docs/plans/approvals.json or docs/specs/approvals.json\n",
    );
  });
});
