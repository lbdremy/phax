/**
 * `phax artifact approve` in a process repository that links a code repository (spec
 * code-repository: ac-approve-records-code and the approve half of ac-root-not-repo). Each test
 * builds a temporary process repository with its code repository checked out at `code/` and
 * ignored. HOME is a temporary directory and git is isolated, so no real ~/.phax, credential store
 * or global git config is read.
 */
import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approvalRecordPathFor } from "../../src/domain/artifact/approvalRecordFile.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { phaxCall } from "../helpers/runnerCall.js";
import { removeTempDir } from "../helpers/tempGit.js";

const SPEC = "docs/specs/2611181000-garden-sync.md";
const PLAN = "docs/plans/2611181001-garden-sync-plan.md";
const OPERATOR = "Ada Example";

const SPEC_MD = `---
status: Draft
date: 2026-11-18
audience: test
scope: test
---
# Garden sync

## Overview

Body text.
`;

const PLAN_MD = `---
status: Draft
source-spec: ${SPEC}
completes-spec: true
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

const CONFIG = {
  version: 1,
  name: "process-repo",
  code: { root: "code" },
  gateProfiles: { standard: [{ command: "pnpm test", surface: "local", firing: "every-phase" }] },
};

let base: string;
let processRepo: string;
let restoreGit: () => void;
let savedCwd: string;
let savedHome: string | undefined;

function sh(cwd: string, args: readonly string[]): string {
  return boundedOutput("git", [...args], { cwd, boundMs: GIT_BOUND_MS }).trim();
}

function identify(cwd: string): void {
  sh(cwd, ["config", "--local", "user.name", OPERATOR]);
  sh(cwd, ["config", "--local", "user.email", "ada@example.test"]);
}

function write(rel: string, content: string): void {
  const abs = join(processRepo, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function read(rel: string): string {
  return readFileSync(join(processRepo, rel), "utf8");
}

function recordPath(): string {
  const path = approvalRecordPathFor("plan", PLAN);
  if (path === null) throw new Error("no record path");
  return path;
}

/** The process repository's seed commit, then its spec approved and recorded. */
async function seedProcessRepo(): Promise<void> {
  write("phax.json", JSON.stringify(CONFIG, null, 2));
  write(".gitignore", "/code/\n");
  write(SPEC, SPEC_MD);
  write(PLAN, PLAN_MD);
  sh(processRepo, ["add", "-A"]);
  sh(processRepo, ["commit", "-q", "-m", "seed"]);
  const spec = await phaxCall(["artifact", "approve", SPEC, "--by", "operator"]);
  expect(spec.code).toBe(0);
}

beforeEach(() => {
  restoreGit = isolateGit();
  savedCwd = process.cwd();
  savedHome = process.env["HOME"];
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-code-link-approval-")));
  process.env["HOME"] = join(base, "home");
  mkdirSync(process.env["HOME"]);
  processRepo = join(base, "process");
  mkdirSync(join(processRepo, "code"), { recursive: true });
  sh(processRepo, ["init", "-q", "-b", "main"]);
  sh(join(processRepo, "code"), ["init", "-q", "-b", "main"]);
  identify(processRepo);
  identify(join(processRepo, "code"));
  process.chdir(processRepo);
});

afterEach(() => {
  process.chdir(savedCwd);
  if (savedHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = savedHome;
  removeTempDir(base);
  restoreGit();
});

describe("approving a plan in a linked project", { timeout: 30_000 }, () => {
  it("records the code root and the full code HEAD under the current stamp (ac-approve-records-code)", async () => {
    const codeDir = join(processRepo, "code");
    writeFileSync(join(codeDir, "garden.ts"), "export const garden = 1;\n");
    sh(codeDir, ["add", "-A"]);
    sh(codeDir, ["commit", "-q", "-m", "code"]);
    const codeHead = sh(codeDir, ["rev-parse", "HEAD"]);
    await seedProcessRepo();

    const result = await phaxCall(["artifact", "approve", PLAN, "--by", "operator"]);
    expect(result.code).toBe(0);

    const record = JSON.parse(read(recordPath())) as Record<string, unknown>;
    expect(record["$schema"]).toBe(currentSchemaUrl("plan-approval-record"));
    expect(record["code"]).toEqual({ root: "code", baseline: codeHead });
    expect(codeHead).toMatch(/^[0-9a-f]{40}$/);

    const stamp = /approved:\n((?: {2}.+\n)+)/.exec(read(PLAN))?.[1] ?? "";
    const fields = Object.fromEntries(
      stamp
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => {
          const [key, ...rest] = line.trim().split(":");
          return [
            key,
            rest
              .join(":")
              .trim()
              .replace(/^['"]|['"]$/g, ""),
          ];
        }),
    );
    expect(fields["code"]).toBe(codeHead.slice(0, 7));
    // The plan's approval commit is HEAD; the baseline is the commit before it.
    expect(fields["baseline"]).toBe(sh(processRepo, ["rev-parse", "--short=7", "HEAD~1"]));
    expect(record["baseline"]).toBe(sh(processRepo, ["rev-parse", "HEAD~1"]));
  });

  it("stamps no code key on a spec approval", async () => {
    await seedProcessRepo();
    const stamp = /approved:\n((?: {2}.+\n)+)/.exec(read(SPEC))?.[1] ?? "";
    expect(stamp).toContain("baseline:");
    expect(stamp).not.toContain("code");
    expect(read("docs/specs/approvals/2611181000-garden-sync.json")).not.toContain('"code"');
  });
});

describe("a code root that fails its checks refuses the approval (ac-root-not-repo)", () => {
  const cases: ReadonlyArray<readonly [string, () => void, string]> = [
    ["is missing", () => rmSync(join(processRepo, "code"), { recursive: true }), "does not exist"],
    [
      "is a plain directory",
      () => {
        rmSync(join(processRepo, "code", ".git"), { recursive: true });
      },
      "not the top level of a git repository",
    ],
    [
      "is a subdirectory of another repository",
      () => {
        const other = join(base, "other");
        mkdirSync(join(other, "sub"), { recursive: true });
        sh(other, ["init", "-q", "-b", "main"]);
        rmSync(join(processRepo, "code"), { recursive: true });
        symlinkSync(join(other, "sub"), join(processRepo, "code"));
      },
      "not the top level of a git repository",
    ],
  ];

  for (const [label, arrange, reason] of cases) {
    it(`code/ ${label}`, async () => {
      await seedProcessRepo();
      const before = sh(processRepo, ["rev-parse", "HEAD"]);
      const planBefore = read(PLAN);
      arrange();

      const result = await phaxCall(["artifact", "approve", PLAN, "--by", "operator"]);
      expect(result.code).toBe(2);
      expect(result.err + result.out).toContain(`code.root "code": ${reason}`);
      expect(read(PLAN)).toBe(planBefore);
      expect(read(PLAN)).toContain("status: Draft");
      expect(existsSync(join(processRepo, recordPath()))).toBe(false);
      expect(sh(processRepo, ["rev-parse", "HEAD"])).toBe(before);
    });
  }
});

/** A commit in the code repository, so a plan approval has a code HEAD to record; its sha. */
function commitCode(): string {
  const codeDir = join(processRepo, "code");
  writeFileSync(join(codeDir, "garden.ts"), "export const garden = 1;\n");
  sh(codeDir, ["add", "-A"]);
  sh(codeDir, ["commit", "-q", "-m", "code"]);
  return sh(codeDir, ["rev-parse", "HEAD"]);
}

describe("an approval reads only the code key of phax.json (ac-approve-unlinked)", () => {
  it("approves a spec and a plan whose phax.local.json is malformed", async () => {
    const codeHead = commitCode();
    write("phax.local.json", "{ not json");
    await seedProcessRepo();

    const result = await phaxCall(["artifact", "approve", PLAN, "--by", "operator"]);
    expect(result.code).toBe(0);
    const record = JSON.parse(read(recordPath())) as Record<string, unknown>;
    expect(record["code"]).toEqual({ root: "code", baseline: codeHead });
  });

  it("approves a spec and a plan whose phax.json has a problem outside its code key", async () => {
    const codeHead = commitCode();
    write(
      "phax.json",
      JSON.stringify({ ...CONFIG, gateProfiles: "not a profile map", unknownKey: 1 }, null, 2),
    );
    write(".gitignore", "/code/\n");
    write(SPEC, SPEC_MD);
    write(PLAN, PLAN_MD);
    sh(processRepo, ["add", "-A"]);
    sh(processRepo, ["commit", "-q", "-m", "seed"]);
    const spec = await phaxCall(["artifact", "approve", SPEC, "--by", "operator"]);
    expect(spec.code).toBe(0);

    const result = await phaxCall(["artifact", "approve", PLAN, "--by", "operator"]);
    expect(result.code).toBe(0);
    const record = JSON.parse(read(recordPath())) as Record<string, unknown>;
    expect(record["code"]).toEqual({ root: "code", baseline: codeHead });
  });

  it.each([
    ["a root that is not a string", { root: 5 }, "code.root"],
    ["an unknown key beside the root", { root: "code", extra: true }, "extra"],
  ])(
    "refuses a plan approval whose code key has %s, but approves the spec",
    async (_label, code, named) => {
      commitCode();
      write("phax.json", JSON.stringify({ ...CONFIG, code }, null, 2));
      write(".gitignore", "/code/\n");
      write(SPEC, SPEC_MD);
      write(PLAN, PLAN_MD);
      sh(processRepo, ["add", "-A"]);
      sh(processRepo, ["commit", "-q", "-m", "seed"]);
      const spec = await phaxCall(["artifact", "approve", SPEC, "--by", "operator"]);
      expect(spec.code).toBe(0);
      const before = sh(processRepo, ["rev-parse", "HEAD"]);

      const result = await phaxCall(["artifact", "approve", PLAN, "--by", "operator"]);
      expect(result.code).toBe(2);
      expect(result.err + result.out).toContain(named);
      expect(result.err + result.out).toContain(join(processRepo, "phax.json"));
      expect(read(PLAN)).toContain("status: Draft");
      expect(existsSync(join(processRepo, recordPath()))).toBe(false);
      expect(sh(processRepo, ["rev-parse", "HEAD"])).toBe(before);
    },
  );
});

describe("an approval from a subdirectory reads the phax.json validate reads there", () => {
  it("records the code baseline of the link that sub/phax.json declares", async () => {
    const codeHead = commitCode();
    await seedProcessRepo();
    // The root phax.json declares no link; the one nearest the working directory does.
    write("phax.json", JSON.stringify({ ...CONFIG, code: undefined }, null, 2));
    write("sub/phax.json", JSON.stringify(CONFIG, null, 2));
    sh(processRepo, ["add", "-A"]);
    sh(processRepo, ["commit", "-q", "-m", "sub config"]);
    process.chdir(join(processRepo, "sub"));

    const validate = await phaxCall(["validate"]);
    expect(validate.code).toBe(0);
    const result = await phaxCall(["artifact", "approve", `../${PLAN}`, "--by", "operator"]);
    expect(result.code).toBe(0);
    const record = JSON.parse(read(recordPath())) as Record<string, unknown>;
    expect(record["code"]).toEqual({ root: "code", baseline: codeHead });
  });

  it("names the subdirectory's phax.json when its link refuses", async () => {
    commitCode();
    await seedProcessRepo();
    write("sub/phax.json", JSON.stringify({ ...CONFIG, code: { root: "gone" } }, null, 2));
    sh(processRepo, ["add", "-A"]);
    sh(processRepo, ["commit", "-q", "-m", "sub config"]);
    process.chdir(join(processRepo, "sub"));

    const result = await phaxCall(["artifact", "approve", `../${PLAN}`, "--by", "operator"]);
    expect(result.code).toBe(2);
    expect(result.err + result.out).toContain('code.root "gone": does not exist');
    expect(result.err + result.out).toContain(join(processRepo, "sub", "phax.json"));
  });
});
