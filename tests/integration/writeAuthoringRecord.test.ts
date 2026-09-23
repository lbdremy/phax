import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Either, Layer } from "effect";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { RECORDS_BRANCH_NAME } from "../../src/app/writeRecord.js";
import {
  writeAuthoringRecord,
  type WriteAuthoringRecordInput,
} from "../../src/app/writeAuthoringRecord.js";
import { decodeAuthoringRecordManifest } from "../../src/schemas/authoringRecord.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

const fakeGitHub = makeFakeGitHub();
const LAYER = Layer.mergeAll(NodeFileSystemLayer, NodeGitLayer, fakeGitHub.layer);

function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

function inRepoConfig(transcript: boolean): ResolvedRecordsConfig {
  return { enabled: true, transcript, destination: { kind: "in-repo" }, autoPush: false };
}

const AUTHORING_ID = "2609230835-plan-prune";
const KEY = `authoring/${AUTHORING_ID}`;
const ARTIFACT = "docs/specs/2609230835-plan-prune.md";

const CLAUDE_TRANSCRIPT = `${JSON.stringify({
  type: "result",
  result: "{}",
  usage: {
    input_tokens: 1200,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 300,
    output_tokens: 450,
  },
  total_cost_usd: 0.12,
})}\n`;

describe("writeAuthoringRecord (real git)", () => {
  let repoDir: string;
  let sessionFolder: string;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "phax-authoring-record-repo-"));
    git(["init"], repoDir);
    disableGitAutoMaintenance(repoDir);
    git(["config", "--local", "user.email", "test@phax.test"], repoDir);
    git(["config", "--local", "user.name", "phax test"], repoDir);
    await writeFile(join(repoDir, "README.md"), "# test\n");
    git(["add", "."], repoDir);
    git(["commit", "-m", "chore: initial commit"], repoDir);

    sessionFolder = mkdtempSync(join(tmpdir(), "phax-authoring-record-session-"));
    fakeGitHub.impl.setVisibility("private");
  });

  afterEach(() => {
    removeTempDir(repoDir);
    removeTempDir(sessionFolder);
  });

  async function seedSession(files: Record<string, string>): Promise<void> {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(sessionFolder, name), content);
    }
  }

  function baseInput(
    overrides: Partial<WriteAuthoringRecordInput> = {},
  ): WriteAuthoringRecordInput {
    return {
      repoRoot: repoDir,
      sessionFolder,
      authoringId: AUTHORING_ID,
      artifact: ARTIFACT,
      artifactKind: "spec",
      provider: "claude-code",
      model: "claude-opus-5-5",
      effort: "high",
      outcome: "committed",
      records: inRepoConfig(true),
      ...overrides,
    };
  }

  function run(input: WriteAuthoringRecordInput) {
    return Effect.runPromise(Effect.provide(writeAuthoringRecord(input), LAYER));
  }

  function lsRecords(): readonly string[] {
    const out = git(["ls-tree", "-r", "--name-only", RECORDS_BRANCH_NAME], repoDir).trim();
    return out === "" ? [] : out.split("\n");
  }

  function readManifest(): unknown {
    return JSON.parse(git(["show", `${RECORDS_BRANCH_NAME}:${KEY}/record.json`], repoDir));
  }

  it("a committed session: one commit holding the four files and a committed manifest", async () => {
    await seedSession({
      "brief.md": "Prune archived runs.\n",
      "prompt.md": "the prompt\n",
      "document.json": '{"kind":"spec"}\n',
      "output.jsonl": CLAUDE_TRANSCRIPT,
    });
    const sourceSha = git(["rev-parse", "HEAD"], repoDir).trim();

    const result = await run(baseInput({ sourceSha }));

    expect(result).toMatchObject({ kind: "written", key: KEY, shape: "full", fileCount: 5 });
    expect(git(["rev-list", "--count", RECORDS_BRANCH_NAME], repoDir).trim()).toBe("1");
    expect(lsRecords()).toEqual([
      `${KEY}/brief.md`,
      `${KEY}/document.json`,
      `${KEY}/output.jsonl`,
      `${KEY}/prompt.md`,
      `${KEY}/record.json`,
    ]);

    const decoded = decodeAuthoringRecordManifest(readManifest());
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isLeft(decoded)) return;
    expect(decoded.right).toEqual({
      version: 1,
      kind: "authoring",
      authoringId: AUTHORING_ID,
      artifact: ARTIFACT,
      artifactKind: "spec",
      shape: "full",
      sourceSha,
      provider: "claude-code",
      model: "claude-opus-5-5",
      effort: "high",
      outcome: "committed",
      usage: {
        available: true,
        usage: {
          provider: "claude-code",
          inputTokens: 1200,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 300,
          outputTokens: 450,
          totalCostUsd: 0.12,
        },
      },
    });

    const message = git(["log", "-1", "--format=%B", RECORDS_BRANCH_NAME], repoDir);
    expect(message).toMatch(/^records\(authoring\): committed\n/);
    expect(message).toContain(`Authoring-Id: ${AUTHORING_ID}\n`);
    expect(message).toContain(`Artifact: ${ARTIFACT}\n`);
  });

  it("a failed session: a failed manifest without sourceSha, and no document.json", async () => {
    await seedSession({ "brief.md": "b\n", "prompt.md": "p\n", "output.jsonl": "not json\n" });

    const result = await run(baseInput({ outcome: "failed" }));

    expect(result.kind).toBe("written");
    expect(lsRecords()).toEqual([
      `${KEY}/brief.md`,
      `${KEY}/output.jsonl`,
      `${KEY}/prompt.md`,
      `${KEY}/record.json`,
    ]);
    const manifest = readManifest() as Record<string, unknown>;
    expect(manifest["outcome"]).toBe("failed");
    expect("sourceSha" in manifest).toBe(false);
    // Usage is unavailable, never zero, when the transcript carries none.
    expect(manifest["usage"]).toEqual({ available: false });
  });

  it("the transcript toggle off keeps output.jsonl out (skeleton)", async () => {
    await seedSession({ "brief.md": "b\n", "prompt.md": "p\n", "output.jsonl": CLAUDE_TRANSCRIPT });

    await run(baseInput({ records: inRepoConfig(false) }));

    expect(lsRecords()).toEqual([`${KEY}/brief.md`, `${KEY}/prompt.md`, `${KEY}/record.json`]);
    expect((readManifest() as Record<string, unknown>)["shape"]).toBe("skeleton");
  });

  it("carries only the session's own files, nothing else the folder holds", async () => {
    await seedSession({ "brief.md": "b\n", "prompt.md": "p\n", "stray.log": "x\n" });

    await run(baseInput());

    expect(lsRecords()).toEqual([`${KEY}/brief.md`, `${KEY}/prompt.md`, `${KEY}/record.json`]);
  });

  it("records off writes nothing and creates no branch", async () => {
    await seedSession({ "brief.md": "b\n", "prompt.md": "p\n" });

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
    expect(git(["show-ref"], repoDir)).not.toContain(RECORDS_BRANCH_NAME);
  });

  it("a public source repo with transcripts in-repo is refused, as for phase records", async () => {
    fakeGitHub.impl.setVisibility("public");
    await seedSession({ "brief.md": "b\n", "prompt.md": "p\n" });

    const result = await run(baseInput());

    expect(result).toMatchObject({ kind: "refused", reason: "public-source-in-repo" });
    expect(git(["show-ref"], repoDir)).not.toContain(RECORDS_BRANCH_NAME);
  });

  it("leaves the source repo's working tree and index unchanged", async () => {
    await seedSession({ "brief.md": "b\n", "prompt.md": "p\n" });
    await writeFile(join(repoDir, "README.md"), "# changed\n");
    const statusBefore = git(["status", "--porcelain"], repoDir);

    await run(baseInput());

    expect(git(["status", "--porcelain"], repoDir)).toBe(statusBefore);
  });
});
