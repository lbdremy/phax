import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Result, Layer } from "effect";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { RECORDS_BRANCH_NAME } from "../../src/app/recordPlumbing.js";
import {
  revisionRecordKey,
  revisionRecordWarning,
  writeRevisionRecord,
  type WriteRevisionRecordInput,
} from "../../src/app/writeRevisionRecord.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import { decodeRevisionRecordManifestFile } from "../../src/schemas/revisionRecord.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Real-git check of a revise writer session's record: the revision folder's
// recordable files, the transcripts per records.transcript, a manifest at the
// revision-record-manifest stamp, and no session id.

const fakeGitHub = makeFakeGitHub();
const LAYER = Layer.mergeAll(NodeFileSystemLayer, NodeGitLayer, fakeGitHub.layer);

const REVISION_ID = "2611130900-log-rotation/01";
const KEY = revisionRecordKey(REVISION_ID);
const ARTIFACT = "docs/specs/2611130900-log-rotation.md";
const FIRST_SESSION = "5f0c2a71-1b9e-4c55-9a43-6a2d1f6e8b10";
const RETRY_SESSION = "9a8b7c6d-1111-4222-8333-444455556666";

function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

function inRepoConfig(transcript: boolean): ResolvedRecordsConfig {
  return { enabled: true, transcript, destination: { kind: "in-repo" }, autoPush: false };
}

function claudeTranscript(sessionId: string, input: number, output: number, cost: number): string {
  return [
    JSON.stringify({ type: "system", subtype: "init", session_id: sessionId }),
    JSON.stringify({
      type: "result",
      session_id: sessionId,
      result: "{}",
      usage: {
        input_tokens: input,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 100,
        output_tokens: output,
      },
      total_cost_usd: cost,
    }),
    "",
  ].join("\n");
}

describe("writeRevisionRecord (real git)", () => {
  let repoDir: string;
  let folder: string;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "phax-revision-record-repo-"));
    git(["init"], repoDir);
    disableGitAutoMaintenance(repoDir);
    git(["config", "--local", "user.email", "test@phax.test"], repoDir);
    git(["config", "--local", "user.name", "phax test"], repoDir);
    await writeFile(join(repoDir, "README.md"), "# test\n");
    git(["add", "."], repoDir);
    git(["commit", "-m", "chore: initial commit"], repoDir);
    folder = mkdtempSync(join(tmpdir(), "phax-revision-record-folder-"));
    fakeGitHub.impl.setVisibility("private");
  });

  afterEach(() => {
    removeTempDir(repoDir);
    removeTempDir(folder);
  });

  async function seedFolder(files: Record<string, string>): Promise<void> {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(folder, name), content);
    }
  }

  function baseInput(overrides: Partial<WriteRevisionRecordInput> = {}): WriteRevisionRecordInput {
    return {
      repoRoot: repoDir,
      records: inRepoConfig(true),
      publishRemote: "origin",
      folder,
      revisionId: REVISION_ID,
      artifact: ARTIFACT,
      artifactKind: "spec",
      session: "resumed-authoring",
      requester: { kind: "operator", name: "Example Operator" },
      newQuestions: ["Q3"],
      sourceSha: "abc1234",
      provider: "claude-code",
      model: "claude-sonnet-5-5",
      requestedModel: "claude-sonnet-5-5",
      effort: "medium",
      end: { outcome: "committed", commit: "def5678" },
      retried: false,
      turnSessionIds: [FIRST_SESSION],
      sessionIds: [FIRST_SESSION],
      ...overrides,
    };
  }

  function run(input: WriteRevisionRecordInput) {
    return Effect.runPromise(Effect.provide(writeRevisionRecord(input), LAYER));
  }

  function lsRecords(): readonly string[] {
    const out = git(["ls-tree", "-r", "--name-only", RECORDS_BRANCH_NAME], repoDir).trim();
    return out === "" ? [] : out.split("\n");
  }

  function show(name: string): string {
    return git(["show", `${RECORDS_BRANCH_NAME}:${KEY}/${name}`], repoDir);
  }

  const FULL_FOLDER = {
    "amendment.md": "Rotate daily, not weekly.\n",
    "prompt.md": "the revise prompt\n",
    "document.json": '{"kind":"spec"}\n',
    "before.md": "the artifact before\n",
    "after.md": "the artifact after\n",
    "body.diff": "-before\n+after\n",
    "claude-session-id.txt": `${FIRST_SESSION}\n`,
    "output.jsonl": claudeTranscript(FIRST_SESSION, 1200, 450, 0.12),
  };

  it("a committed revision: its key, files, manifest and records commit message", async () => {
    await seedFolder(FULL_FOLDER);

    const result = await run(baseInput());

    expect(result).toMatchObject({ kind: "written", key: KEY, shape: "full", fileCount: 6 });
    expect(lsRecords().toSorted()).toEqual(
      [
        "amendment.md",
        "body.diff",
        "document.json",
        "output.jsonl",
        "prompt.md",
        "record.json",
      ].map((name) => `${KEY}/${name}`),
    );
    const manifest = JSON.parse(show("record.json")) as Record<string, unknown>;
    expect(Object.keys(manifest)[0]).toBe("$schema");
    expect(manifest["$schema"]).toBe(currentSchemaUrl("revision-record-manifest"));
    expect(manifest["$schema"]).toContain("0.38.0");
    expect(Result.isSuccess(decodeRevisionRecordManifestFile(manifest))).toBe(true);
    expect(manifest).toMatchObject({
      kind: "revision",
      revisionId: REVISION_ID,
      artifact: ARTIFACT,
      session: "resumed-authoring",
      requester: { kind: "operator", name: "Example Operator" },
      newQuestions: ["Q3"],
      outcome: "committed",
      commit: "def5678",
      shape: "full",
      usage: {
        available: true,
        usage: { provider: "claude-code", inputTokens: 1200, outputTokens: 450 },
      },
    });
    const message = git(["log", "-1", "--format=%B", RECORDS_BRANCH_NAME], repoDir);
    expect(message).toContain("records(revision): committed");
    expect(message).toContain(`Revision-Id: ${REVISION_ID}`);
    expect(message).toContain(`Artifact: ${ARTIFACT}`);
    expect(message).toContain("Shape: full");
  });

  it("an unchanged revision records commit null", async () => {
    await seedFolder({ ...FULL_FOLDER, "body.diff": "" });

    await run(baseInput({ end: { outcome: "unchanged", commit: null }, newQuestions: [] }));

    const manifest = JSON.parse(show("record.json")) as Record<string, unknown>;
    expect(Result.isSuccess(decodeRevisionRecordManifestFile(manifest))).toBe(true);
    expect(manifest).toMatchObject({ outcome: "unchanged", commit: null });
  });

  it("a failed revision whose writer never answered: prompt only, usage unavailable", async () => {
    await seedFolder({ "amendment.md": "x\n", "prompt.md": "the revise prompt\n" });

    const result = await run(
      baseInput({
        end: { outcome: "failed", commit: null, failure: "provider-error" },
        newQuestions: [],
        turnSessionIds: [],
      }),
    );

    expect(result).toMatchObject({ kind: "written", shape: "skeleton", fileCount: 3 });
    const manifest = JSON.parse(show("record.json")) as Record<string, unknown>;
    expect(Result.isSuccess(decodeRevisionRecordManifestFile(manifest))).toBe(true);
    expect(manifest).toMatchObject({
      outcome: "failed",
      commit: null,
      failure: "provider-error",
      usage: { available: false },
    });
  });

  it("transcripts off: a skeleton record without output.jsonl", async () => {
    await seedFolder({ ...FULL_FOLDER, "retry-output.jsonl": "{}\n" });

    const result = await run(baseInput({ records: inRepoConfig(false) }));

    expect(result).toMatchObject({ kind: "written", shape: "skeleton" });
    const files = lsRecords();
    expect(files).not.toContain(`${KEY}/output.jsonl`);
    expect(files).not.toContain(`${KEY}/retry-output.jsonl`);
    expect(JSON.parse(show("record.json"))).toMatchObject({ shape: "skeleton" });
  });

  it("withholds every session id from every recorded file and counts both turns", async () => {
    await seedFolder({
      ...FULL_FOLDER,
      "prompt.md": `resumed ${FIRST_SESSION}\n`,
      "retry-prompt.md": `resume ${RETRY_SESSION} once\n`,
      "retry-output.jsonl": claudeTranscript(RETRY_SESSION, 800, 600, 0.05),
    });

    await run(
      baseInput({
        retried: true,
        turnSessionIds: [FIRST_SESSION, RETRY_SESSION],
        sessionIds: [FIRST_SESSION, RETRY_SESSION],
      }),
    );

    for (const path of lsRecords()) {
      const blob = git(["show", `${RECORDS_BRANCH_NAME}:${path}`], repoDir);
      expect(blob).not.toContain(FIRST_SESSION);
      expect(blob).not.toContain(RETRY_SESSION);
    }
    expect(lsRecords()).toContain(`${KEY}/retry-prompt.md`);
    const manifest = JSON.parse(show("record.json")) as {
      usage: { usage: { inputTokens: number } };
    };
    expect(manifest.usage.usage.inputTokens).toBe(2000);
  });

  it("records off is a total no-op", async () => {
    await seedFolder(FULL_FOLDER);

    const result = await run(
      baseInput({
        records: {
          enabled: false,
          transcript: false,
          destination: { kind: "in-repo" },
          autoPush: false,
        },
      }),
    );

    expect(result).toEqual({ kind: "records-off" });
    expect(git(["branch", "--list", RECORDS_BRANCH_NAME], repoDir).trim()).toBe("");
  });

  it("a refused destination writes nothing and is reported with its remedy", async () => {
    await seedFolder(FULL_FOLDER);
    fakeGitHub.impl.setVisibility("public");

    const result = await run(baseInput());

    expect(result.kind).toBe("refused");
    expect(revisionRecordWarning(result)).toMatch(/^revision record refused: .+ \(remedy: .+\)$/);
    expect(git(["branch", "--list", RECORDS_BRANCH_NAME], repoDir).trim()).toBe("");
  });
});
