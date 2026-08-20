import { mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { Git, type GitError } from "../../src/ports/git.js";
import { FileSystem, type FsError } from "../../src/ports/fs.js";
import { GitHub } from "../../src/ports/github.js";
import {
  writeRecord,
  RECORDS_BRANCH_NAME,
  type WriteRecordInput,
  type WriteRecordResult,
} from "../../src/app/writeRecord.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";

// Defaults to "private" visibility, matching the fake's happy-path default,
// so every existing test in this file (none of which exercise the
// destination policy) keeps writing as before.
const fakeGitHub = makeFakeGitHub();
const LAYER = Layer.mergeAll(NodeFileSystemLayer, NodeGitLayer, fakeGitHub.layer);

function run(
  effect: Effect.Effect<WriteRecordResult, GitError | FsError, Git | FileSystem | GitHub>,
): Promise<WriteRecordResult> {
  return Effect.runPromise(Effect.provide(effect, LAYER));
}

function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

function inRepoConfig(transcript: boolean): ResolvedRecordsConfig {
  return { enabled: true, transcript, destination: { kind: "in-repo" }, autoPush: false };
}

const OFF_CONFIG: ResolvedRecordsConfig = {
  enabled: false,
  transcript: false,
  destination: { kind: "in-repo" },
  autoPush: false,
};

const REPO_CONFIG: ResolvedRecordsConfig = {
  enabled: true,
  transcript: true,
  destination: { kind: "repo", remote: "https://example.com/records.git" },
  autoPush: false,
};

describe("writeRecord", () => {
  let repoDir: string;
  let phaseFolder: string;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "phax-write-record-repo-"));
    git(["init"], repoDir);
    git(["config", "--local", "user.email", "test@phax.test"], repoDir);
    git(["config", "--local", "user.name", "phax test"], repoDir);
    await writeFile(join(repoDir, "README.md"), "# test\n");
    git(["add", "."], repoDir);
    git(["commit", "-m", "chore: initial commit"], repoDir);

    phaseFolder = mkdtempSync(join(tmpdir(), "phax-write-record-phase-"));
    fakeGitHub.impl.setVisibility("private");
    fakeGitHub.impl.calls.length = 0;
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
    await rm(phaseFolder, { recursive: true, force: true });
  });

  async function seedPhaseFolder(files: Record<string, string>): Promise<void> {
    for (const [name, content] of Object.entries(files)) {
      const target = join(phaseFolder, name);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, content);
    }
  }

  function baseInput(overrides: Partial<WriteRecordInput> = {}): WriteRecordInput {
    return {
      repoRoot: repoDir,
      phaseFolderPath: phaseFolder,
      runId: "run-1",
      phaseId: "phase-01",
      provider: "claude-code",
      model: "claude-opus-4-8",
      effort: "high",
      outcome: "committed",
      records: inRepoConfig(true),
      ...overrides,
    };
  }

  function lsRecords(): readonly string[] {
    const out = git(["ls-tree", "-r", "--name-only", RECORDS_BRANCH_NAME], repoDir).trim();
    return out === "" ? [] : out.split("\n");
  }

  function readManifest(key: string): Record<string, unknown> {
    const text = git(["show", `${RECORDS_BRANCH_NAME}:${key}/record.json`], repoDir);
    return JSON.parse(text) as Record<string, unknown>;
  }

  it("writes exactly one record holding every checks-attempt log, whatever the attempt count", async () => {
    await seedPhaseFolder({
      "prompt.md": "the prompt\n",
      "checks-attempt-01.log": "attempt one\n",
      "checks-attempt-02.log": "attempt two\n",
      "output.jsonl": '{"type":"result"}\n',
    });

    const result = await run(writeRecord(baseInput()));

    expect(result.kind).toBe("written");
    // One phase, one record commit — not one per attempt.
    expect(git(["rev-list", "--count", RECORDS_BRANCH_NAME], repoDir).trim()).toBe("1");
    expect(lsRecords()).toEqual([
      "run-1/phase-01/checks-attempt-01.log",
      "run-1/phase-01/checks-attempt-02.log",
      "run-1/phase-01/output.jsonl",
      "run-1/phase-01/prompt.md",
      "run-1/phase-01/record.json",
    ]);
    // transcript on + output.jsonl present → full record.
    expect(readManifest("run-1/phase-01")["shape"]).toBe("full");
  });

  it("records a source sha back-reference when the phase committed", async () => {
    await seedPhaseFolder({ "prompt.md": "p\n" });
    const sourceSha = git(["rev-parse", "HEAD"], repoDir).trim();

    await run(writeRecord(baseInput({ sourceSha })));

    expect(readManifest("run-1/phase-01")["sourceSha"]).toBe(sourceSha);
  });

  it("still produces a record for a phase that never committed, with no source sha", async () => {
    await seedPhaseFolder({
      "prompt.md": "p\n",
      "checks-attempt-01.log": "gate failed\n",
    });

    const result = await run(writeRecord(baseInput({ outcome: "failed" })));

    expect(result.kind).toBe("written");
    const manifest = readManifest("run-1/phase-01");
    expect(manifest["outcome"]).toBe("failed");
    expect(manifest["sourceSha"]).toBeUndefined();
    expect("sourceSha" in manifest).toBe(false);
  });

  it("assembles a skeleton when the transcript toggle is off, keeping output.jsonl out", async () => {
    await seedPhaseFolder({
      "prompt.md": "p\n",
      "output.jsonl": '{"type":"result"}\n',
    });

    await run(writeRecord(baseInput({ records: inRepoConfig(false) })));

    expect(lsRecords()).toEqual(["run-1/phase-01/prompt.md", "run-1/phase-01/record.json"]);
    expect(readManifest("run-1/phase-01")["shape"]).toBe("skeleton");
  });

  it("writes nothing and creates no branch when records are off", async () => {
    await seedPhaseFolder({ "prompt.md": "p\n" });

    const result = await run(writeRecord(baseInput({ records: OFF_CONFIG })));

    expect(result).toEqual({ kind: "records-off" });
    expect(git(["show-ref"], repoDir)).not.toContain(RECORDS_BRANCH_NAME);
  });

  it("defers to phase-06 without writing when the destination is a dedicated repo", async () => {
    await seedPhaseFolder({ "prompt.md": "p\n" });

    const result = await run(writeRecord(baseInput({ records: REPO_CONFIG })));

    expect(result).toEqual({ kind: "deferred-destination", destination: "repo" });
    expect(git(["show-ref"], repoDir)).not.toContain(RECORDS_BRANCH_NAME);
  });

  it("leaves the source repo's working tree and index byte-for-byte unchanged", async () => {
    await seedPhaseFolder({ "prompt.md": "p\n", "output.jsonl": '{"type":"result"}\n' });
    // Dirty the working tree so a stray add/checkout would show up.
    await writeFile(join(repoDir, "README.md"), "# changed\n");
    await writeFile(join(repoDir, "untracked.txt"), "new\n");
    const statusBefore = git(["status", "--porcelain"], repoDir);

    await run(writeRecord(baseInput()));

    expect(git(["status", "--porcelain"], repoDir)).toBe(statusBefore);
  });

  it("reports usage as unavailable rather than zero when no transcript usage exists", async () => {
    // A skeleton phase (no output.jsonl) has no Claude usage to read.
    await seedPhaseFolder({ "prompt.md": "p\n" });

    await run(writeRecord(baseInput()));

    expect(readManifest("run-1/phase-01")["usage"]).toEqual({ available: false });
  });

  it("writes one commit per phase, the second parented onto the first, keyed by phase", async () => {
    await seedPhaseFolder({ "prompt.md": "p1\n" });
    await run(writeRecord(baseInput({ phaseId: "phase-01" })));

    await rm(phaseFolder, { recursive: true, force: true });
    await mkdir(phaseFolder, { recursive: true });
    await seedPhaseFolder({ "prompt.md": "p2\n" });
    await run(writeRecord(baseInput({ phaseId: "phase-02" })));

    // Two phases → two commits on the one branch; the second parents onto the first.
    expect(git(["rev-list", "--count", RECORDS_BRANCH_NAME], repoDir).trim()).toBe("2");
    const parentOfTip = git(["rev-parse", `${RECORDS_BRANCH_NAME}^`], repoDir).trim();
    const firstCommit = git(["rev-parse", `${RECORDS_BRANCH_NAME}~1`], repoDir).trim();
    expect(parentOfTip).toBe(firstCommit);
    // Each commit's tree holds its own phase's record, keyed by runId/phaseId; the
    // commit is the record's address (found later by its Run-Id/Phase-Id trailers).
    expect(readManifest("run-1/phase-02")["phaseId"]).toBe("phase-02");
    expect(git(["show", `${RECORDS_BRANCH_NAME}~1:run-1/phase-01/record.json`], repoDir)).toContain(
      '"phaseId": "phase-01"',
    );
  });

  it("refuses a public source repo with transcripts on and an in-repo destination, writing nothing", async () => {
    fakeGitHub.impl.setVisibility("public");
    await seedPhaseFolder({ "prompt.md": "p\n" });

    const result = await run(writeRecord(baseInput()));

    expect(result).toMatchObject({ kind: "refused", reason: "public-source-in-repo" });
    expect(git(["show-ref"], repoDir)).not.toContain(RECORDS_BRANCH_NAME);
  });

  it("writes a skeleton for a public source repo when transcripts are off", async () => {
    fakeGitHub.impl.setVisibility("public");
    await seedPhaseFolder({ "prompt.md": "p\n", "output.jsonl": '{"type":"result"}\n' });

    const result = await run(writeRecord(baseInput({ records: inRepoConfig(false) })));

    expect(result.kind).toBe("written");
    expect(readManifest("run-1/phase-01")["shape"]).toBe("skeleton");
  });

  it("refuses an unacknowledged unknown-visibility source repo, but writes once acknowledged", async () => {
    fakeGitHub.impl.setVisibility("unknown");
    await seedPhaseFolder({ "prompt.md": "p\n" });

    const refused = await run(writeRecord(baseInput()));
    expect(refused).toMatchObject({ kind: "refused", reason: "unacknowledged-unknown-visibility" });

    const acknowledgedConfig: ResolvedRecordsConfig = {
      enabled: true,
      transcript: true,
      destination: { kind: "in-repo", acknowledgedUnknownVisibility: true },
      autoPush: false,
    };
    const written = await run(writeRecord(baseInput({ records: acknowledgedConfig })));
    expect(written.kind).toBe("written");
  });

  it("never consults visibility for a dedicated repo destination, whatever it is", async () => {
    fakeGitHub.impl.setVisibility("public");
    await seedPhaseFolder({ "prompt.md": "p\n" });

    const result = await run(writeRecord(baseInput({ records: REPO_CONFIG })));

    expect(result).toEqual({ kind: "deferred-destination", destination: "repo" });
    expect(fakeGitHub.impl.calls.some((call) => call.method === "visibility")).toBe(false);
  });
});
