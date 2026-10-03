// The pure pieces of scripts/schemas-smoke.ts. The smoke itself packs and
// installs from the registry, so it runs only in CI and the release workflow.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_SHAPES } from "../../packages/schemas/src/generated/index.js";
import { parsePhaseRecordManifest } from "../../packages/schemas/src/index.js";
import {
  CONSUMER_SCRIPT,
  SMOKE_RECORD_KEY,
  dependencyClosure,
  expectedConsumerOutput,
  recordCommitMessage,
  smokeRecordManifest,
  strayPackages,
} from "../../scripts/schemas-smoke.js";
import { PHAX_RELEASE } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { homePaths, strings } from "./schemasPackage/documents.js";

const repoRoot = join(import.meta.dirname, "../..");

describe("the smoke record manifest", () => {
  const manifest = smokeRecordManifest();

  it("is written as phax writes it: $schema first, at the running release, no version", () => {
    expect(Object.keys(manifest)[0]).toBe("$schema");
    expect(manifest.$schema).toBe(schemaUrl("phase-record-manifest", PHAX_RELEASE));
    expect(Object.hasOwn(manifest, "version")).toBe(false);
  });

  it("is read by the package at the current shape", () => {
    const parsed = parsePhaseRecordManifest(JSON.parse(JSON.stringify(manifest)));
    expect(parsed.ok && parsed.shape).toBe(CURRENT_SHAPES["phase-record-manifest"]);
  });

  it("is keyed <runId>/phase-01", () => {
    expect(SMOKE_RECORD_KEY).toBe(`${manifest.runId}/phase-01`);
    expect(manifest.phaseId).toBe("phase-01");
  });

  it("names no home directory and no phax home", () => {
    expect(strings(manifest).length).toBeGreaterThan(0);
    expect(homePaths(manifest)).toEqual([]);
  });

  it("makes the consumer print its runId, phaseId, outcome and provider", () => {
    expect(expectedConsumerOutput(manifest)).toBe(
      `${manifest.runId} phase-01 committed claude-code`,
    );
  });

  it("prints 'no usage' for a record without usage", () => {
    expect(expectedConsumerOutput({ ...manifest, usage: { available: false } })).toBe(
      `${manifest.runId} phase-01 committed no usage`,
    );
  });
});

describe("the consumer script", () => {
  it("imports only node:child_process and the schemas package", () => {
    const imports = [...CONSUMER_SCRIPT.matchAll(/^import .* from "([^"]+)";$/gm)].map(
      ([, from]) => from,
    );
    expect(imports).toEqual(["node:child_process", "@lbdremy/phax-schemas"]);
    expect(CONSUMER_SCRIPT).not.toMatch(/\brequire\(|\bimport\(/);
  });

  it("finds the record's commit by its trailers and reads the file at that commit", () => {
    expect(CONSUMER_SCRIPT).toContain('  "log",\n  "phax/records/v1",');
    expect(CONSUMER_SCRIPT).toContain('  "--fixed-strings",\n  "--all-match",');
    expect(CONSUMER_SCRIPT).toContain(
      "  `--grep=Run-Id: ${runId}`,\n  `--grep=Phase-Id: ${phaseId}`,",
    );
    expect(CONSUMER_SCRIPT).toContain('git("show", `${sha}:${runId}/${phaseId}/record.json`)');
    expect(CONSUMER_SCRIPT).not.toContain("phax/records/v1:");
    expect(CONSUMER_SCRIPT).toContain("parsePhaseRecordManifest(JSON.parse(raw))");
    expect(CONSUMER_SCRIPT).toContain("if (!parsed.ok) {");
  });
});

describe("the records branch the smoke builds", () => {
  const dirs: Array<string> = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const gitEnv = {
    ...process.env,
    GIT_DIR: undefined,
    GIT_WORK_TREE: undefined,
    GIT_INDEX_FILE: undefined,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: devNull,
    GIT_AUTHOR_NAME: "phax test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "phax test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
  };
  const git = (cwd: string, ...args: ReadonlyArray<string>): string =>
    execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" }).trim();

  it("carries the trailers phax writes on a record commit", () => {
    expect(recordCommitMessage(smokeRecordManifest()).split("\n")).toEqual([
      "records(phase-01): committed",
      "",
      "Run-Id: run-0001",
      "Phase-Id: phase-01",
      "Shape: full",
    ]);
  });

  it("holds one record per commit: the older record is found by its trailers, not at the tip", () => {
    const repo = mkdtempSync(join(tmpdir(), "phax-records-"));
    dirs.push(repo);
    git(repo, "init", "-q");
    git(repo, "symbolic-ref", "HEAD", "refs/heads/phax/records/v1");
    for (const record of [smokeRecordManifest(), smokeRecordManifest("phase-02")]) {
      git(repo, "rm", "-q", "-r", "--ignore-unmatch", "--", record.runId);
      const key = `${record.runId}/${record.phaseId}`;
      mkdirSync(join(repo, key), { recursive: true });
      writeFileSync(join(repo, key, "record.json"), `${JSON.stringify(record)}\n`);
      git(repo, "add", "--", `${key}/record.json`);
      git(repo, "-c", "commit.gpgsign=false", "commit", "-q", "-m", recordCommitMessage(record));
    }
    const path = `${SMOKE_RECORD_KEY}/record.json`;

    const atTip = spawnSync("git", ["show", `phax/records/v1:${path}`], {
      cwd: repo,
      env: gitEnv,
    });
    expect(atTip.status).not.toBe(0);

    const sha = git(
      repo,
      "log",
      "phax/records/v1",
      "--format=%H",
      "--fixed-strings",
      "--all-match",
      "--grep=Run-Id: run-0001",
      "--grep=Phase-Id: phase-01",
      "-1",
    );
    expect(JSON.parse(git(repo, "show", `${sha}:${path}`))).toEqual(smokeRecordManifest());
  });
});

describe("strayPackages", () => {
  const effectClosure = dependencyClosure(repoRoot, "effect");

  it("computes effect's closure from its installed manifests", () => {
    expect(effectClosure.has("effect")).toBe(true);
    expect(effectClosure.size).toBeGreaterThan(1);
  });

  it("passes the package, effect, effect's closure and npm's own entries", () => {
    const installed = [
      ".bin",
      ".package-lock.json",
      "@lbdremy/phax-schemas",
      "effect",
      ...effectClosure,
    ];
    expect(strayPackages(installed, effectClosure)).toEqual([]);
  });

  it("flags a foreign package, scoped or not", () => {
    const installed = ["@lbdremy/phax-schemas", ...effectClosure, "left-pad", "@acme/widget"];
    expect(strayPackages(installed, effectClosure)).toEqual(["left-pad", "@acme/widget"]);
  });

  it("does not let a scope stand for its packages", () => {
    expect(strayPackages(["@lbdremy/phax"], effectClosure)).toEqual(["@lbdremy/phax"]);
  });
});
