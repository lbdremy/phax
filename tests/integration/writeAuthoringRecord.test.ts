import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
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
import { decodeAuthoringRecordManifestFile } from "../../src/schemas/authoringRecord.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import {
  VIBE3_EXPORT_LONG,
  VIBE3_EXPORT_SHORT,
  VIBE3_SESSION_ID,
  vibe3ExportText,
} from "../helpers/vibe3Fixtures.js";

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

// The retry's own invocation: Claude reports each invocation's usage on its own.
const CLAUDE_RETRY_TRANSCRIPT = `${JSON.stringify({
  type: "result",
  result: "{}",
  usage: {
    input_tokens: 800,
    cache_creation_input_tokens: 50,
    cache_read_input_tokens: 2000,
    output_tokens: 600,
  },
  total_cost_usd: 0.05,
})}\n`;

function codexTranscript(input: number, cached: number, output: number, reasoning: number): string {
  return `${JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: input,
      cached_input_tokens: cached,
      output_tokens: output,
      reasoning_output_tokens: reasoning,
    },
  })}\n`;
}

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
      retry: "none",
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

    const written = readManifest() as Record<string, unknown>;
    expect(Object.keys(written)[0]).toBe("$schema");
    expect(written).not.toHaveProperty("version");
    const decoded = decodeAuthoringRecordManifestFile(written);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isLeft(decoded)) return;
    expect(decoded.right).toEqual({
      $schema: currentSchemaUrl("authoring-record-manifest"),
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
      retry: "none",
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

  it("a retried committed session carries both transcripts and the retry prompt, and sums both turns", async () => {
    await seedSession({
      "brief.md": "b\n",
      "prompt.md": "p\n",
      "document.json": '{"kind":"spec"}\n',
      "output.jsonl": CLAUDE_TRANSCRIPT,
      "retry-prompt.md": "Your final message was refused, and phax wrote nothing.\n",
      "retry-output.jsonl": CLAUDE_RETRY_TRANSCRIPT,
    });

    const result = await run(baseInput({ retry: "retried" }));

    expect(result).toMatchObject({ kind: "written", shape: "full", fileCount: 7 });
    expect(lsRecords()).toEqual([
      `${KEY}/brief.md`,
      `${KEY}/document.json`,
      `${KEY}/output.jsonl`,
      `${KEY}/prompt.md`,
      `${KEY}/record.json`,
      `${KEY}/retry-output.jsonl`,
      `${KEY}/retry-prompt.md`,
    ]);
    const manifest = readManifest() as Record<string, unknown>;
    expect(manifest["retry"]).toBe("retried");
    expect(manifest["usage"]).toEqual({
      available: true,
      usage: {
        provider: "claude-code",
        inputTokens: 1200 + 800,
        cacheCreationInputTokens: 0 + 50,
        cacheReadInputTokens: 300 + 2000,
        outputTokens: 450 + 600,
        totalCostUsd: 0.12 + 0.05,
      },
    });
  });

  it("with transcripts on, no recorded file carries the session ids decide resumes", async () => {
    const sessionId = "0f6c2a1e-authoring-session";
    const retrySessionId = "7d1b9e44-retry-session";
    await seedSession({
      "brief.md": "b\n",
      "prompt.md": "p\n",
      "document.json": '{"kind":"spec"}\n',
      "output.jsonl": `{"type":"system","subtype":"init","session_id":"${sessionId}"}\n${CLAUDE_TRANSCRIPT}`,
      "retry-prompt.md": "r\n",
      "retry-output.jsonl": `{"type":"system","subtype":"init","session_id":"${retrySessionId}"}\n${CLAUDE_RETRY_TRANSCRIPT}`,
    });

    await run(baseInput({ retry: "retried", sessionId, retrySessionId }));

    for (const path of lsRecords()) {
      const text = git(["show", `${RECORDS_BRANCH_NAME}:${path}`], repoDir);
      expect(text).not.toContain(sessionId);
      expect(text).not.toContain(retrySessionId);
    }
    expect(git(["show", `${RECORDS_BRANCH_NAME}:${KEY}/output.jsonl`], repoDir)).toContain(
      '"session_id":"[session id withheld]"',
    );
  });

  it("with transcripts off, neither transcript is carried; the retry prompt still is", async () => {
    await seedSession({
      "brief.md": "b\n",
      "prompt.md": "p\n",
      "output.jsonl": CLAUDE_TRANSCRIPT,
      "retry-prompt.md": "r\n",
      "retry-output.jsonl": CLAUDE_RETRY_TRANSCRIPT,
    });

    await run(baseInput({ retry: "retried", records: inRepoConfig(false) }));

    expect(lsRecords()).toEqual([
      `${KEY}/brief.md`,
      `${KEY}/prompt.md`,
      `${KEY}/record.json`,
      `${KEY}/retry-prompt.md`,
    ]);
    const manifest = readManifest() as Record<string, unknown>;
    expect(manifest["shape"]).toBe("skeleton");
    // Usage is read from the transcripts whether or not the record carries them.
    expect(manifest["usage"]).toMatchObject({ available: true });
  });

  it("a retried session whose retry left no usage reports usage unavailable, not the first turn's", async () => {
    await seedSession({
      "brief.md": "b\n",
      "prompt.md": "p\n",
      "output.jsonl": CLAUDE_TRANSCRIPT,
      "retry-prompt.md": "r\n",
    });

    await run(baseInput({ outcome: "failed", retry: "retried" }));

    const manifest = readManifest() as Record<string, unknown>;
    expect(manifest["retry"]).toBe("retried");
    expect(manifest["usage"]).toEqual({ available: false });
  });

  it("codex: both turns' usage is summed field by field", async () => {
    await seedSession({
      "brief.md": "b\n",
      "prompt.md": "p\n",
      "output.jsonl": codexTranscript(1000, 100, 200, 50),
      "retry-prompt.md": "r\n",
      "retry-output.jsonl": codexTranscript(500, 400, 300, 20),
    });

    await run(baseInput({ provider: "codex-cli", retry: "retried" }));

    expect((readManifest() as Record<string, unknown>)["usage"]).toEqual({
      available: true,
      usage: {
        provider: "codex-cli",
        inputTokens: 1500,
        cachedInputTokens: 500,
        outputTokens: 500,
        reasoningOutputTokens: 70,
      },
    });
  });

  describe("vibe: every turn's export is counted", () => {
    // Each turn wrote an export.json into the directory named after its transcript.
    async function seedVibeExport(exportDir: string, exported: string): Promise<void> {
      await mkdir(join(sessionFolder, exportDir), { recursive: true });
      await writeFile(join(sessionFolder, exportDir, "export.json"), exported);
    }

    it("a resume that kept the session id adds the retry's own usage", async () => {
      await seedSession({ "brief.md": "b\n", "prompt.md": "p\n", "retry-prompt.md": "r\n" });
      await seedVibeExport("output.vibe-export", vibe3ExportText(VIBE3_EXPORT_SHORT));
      await seedVibeExport("retry-output.vibe-export", vibe3ExportText(VIBE3_EXPORT_LONG));

      await run(
        baseInput({
          provider: "mistral-vibe",
          retry: "retried",
          sessionId: VIBE3_SESSION_ID,
          retrySessionId: VIBE3_SESSION_ID,
        }),
      );

      const manifest = readManifest() as Record<string, unknown>;
      expect(Either.isRight(decodeAuthoringRecordManifestFile(manifest))).toBe(true);
      expect(manifest["usage"]).toEqual({
        available: true,
        usage: {
          provider: "mistral-vibe",
          inputTokens: 45575,
          cachedInputTokens: 12800,
          outputTokens: 291,
          costUsd: 0.070545,
        },
      });
    });

    it("a first answer alone is counted from its own export", async () => {
      await seedSession({ "brief.md": "b\n", "prompt.md": "p\n" });
      await seedVibeExport("output.vibe-export", vibe3ExportText(VIBE3_EXPORT_SHORT));

      await run(baseInput({ provider: "mistral-vibe", sessionId: VIBE3_SESSION_ID }));

      expect((readManifest() as Record<string, unknown>)["usage"]).toEqual({
        available: true,
        usage: {
          provider: "mistral-vibe",
          inputTokens: 10987,
          cachedInputTokens: 3200,
          outputTokens: 3,
          costUsd: 0.016503,
        },
      });
    });

    it("a retry with no export makes the whole usage unavailable", async () => {
      await seedSession({ "brief.md": "b\n", "prompt.md": "p\n", "retry-prompt.md": "r\n" });
      await seedVibeExport("output.vibe-export", vibe3ExportText(VIBE3_EXPORT_SHORT));

      await run(
        baseInput({
          provider: "mistral-vibe",
          retry: "retried",
          sessionId: VIBE3_SESSION_ID,
          retrySessionId: VIBE3_SESSION_ID,
        }),
      );

      expect((readManifest() as Record<string, unknown>)["usage"]).toEqual({ available: false });
    });

    it("an export that does not decode makes the usage unavailable", async () => {
      await seedSession({ "brief.md": "b\n", "prompt.md": "p\n" });
      await seedVibeExport("output.vibe-export", '{"schema_version":2}\n');

      await run(baseInput({ provider: "mistral-vibe", sessionId: VIBE3_SESSION_ID }));

      expect((readManifest() as Record<string, unknown>)["usage"]).toEqual({ available: false });
    });
  });

  it("leaves the source repo's working tree and index unchanged", async () => {
    await seedSession({ "brief.md": "b\n", "prompt.md": "p\n" });
    await writeFile(join(repoDir, "README.md"), "# changed\n");
    const statusBefore = git(["status", "--porcelain"], repoDir);

    await run(baseInput());

    expect(git(["status", "--porcelain"], repoDir)).toBe(statusBefore);
  });
});
