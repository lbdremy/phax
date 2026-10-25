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
import { RECORDS_BRANCH_NAME } from "../../src/app/recordPlumbing.js";
import {
  decisionRecordWarning,
  writeDecisionRecord,
  type WriteDecisionRecordInput,
} from "../../src/app/writeDecisionRecord.js";
import { decodeDecisionRecordManifestFile } from "../../src/schemas/decisionRecord.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Real-git acceptance for a decide session's record (spec artifact-decide
// §5.30): the decision folder's files, the transcripts per records.transcript,
// a manifest at the decision-record-manifest stamp, and no session id.

const fakeGitHub = makeFakeGitHub();
const LAYER = Layer.mergeAll(NodeFileSystemLayer, NodeGitLayer, fakeGitHub.layer);

const DECISION_ID = "2610160930-log-rotation/01";
const KEY = `decision/${DECISION_ID}`;
const ARTIFACT = "docs/specs/2610160930-log-rotation.md";
const KEPT_SESSION = "5f0c2a71-1b9e-4c55-9a43-6a2d1f6e8b10";
const RETRY_SESSION = "9a8b7c6d-1111-4222-8333-444455556666";

function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

function inRepoConfig(transcript: boolean): ResolvedRecordsConfig {
  return { enabled: true, transcript, destination: { kind: "in-repo" }, autoPush: false };
}

// A Claude handback turn's stream: every event names the session it ran in.
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

describe("writeDecisionRecord (real git)", () => {
  let repoDir: string;
  let folder: string;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "phax-decision-record-repo-"));
    git(["init"], repoDir);
    disableGitAutoMaintenance(repoDir);
    git(["config", "--local", "user.email", "test@phax.test"], repoDir);
    git(["config", "--local", "user.name", "phax test"], repoDir);
    await writeFile(join(repoDir, "README.md"), "# test\n");
    git(["add", "."], repoDir);
    git(["commit", "-m", "chore: initial commit"], repoDir);
    folder = mkdtempSync(join(tmpdir(), "phax-decision-record-folder-"));
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

  type InteractiveInput = Extract<WriteDecisionRecordInput, { mode: "interactive" }>;
  type VerdictsInput = Extract<WriteDecisionRecordInput, { mode: "verdicts" }>;

  function baseInput(overrides: Partial<InteractiveInput> = {}): InteractiveInput {
    return {
      mode: "interactive",
      repoRoot: repoDir,
      records: inRepoConfig(true),
      folder,
      decisionId: DECISION_ID,
      artifact: ARTIFACT,
      artifactKind: "spec",
      session: "resumed-authoring",
      doctrine: [
        { kind: "skill", name: "phax-decide-spec", source: "bundled", fingerprint: "a".repeat(64) },
        { kind: "file", path: "docs/doctrine/spec.md", fingerprint: "b".repeat(64) },
      ],
      questions: ["Q1", "Q2"],
      arbitrated: 1,
      departed: 0,
      sourceSha: "abc1234",
      provider: "claude-code",
      model: "claude-opus-5-5",
      effort: "high",
      end: { outcome: "committed", commit: "def5678" },
      retried: false,
      sessionIds: [KEPT_SESSION],
      ...overrides,
    };
  }

  function run(input: WriteDecisionRecordInput) {
    return Effect.runPromise(Effect.provide(writeDecisionRecord(input), LAYER));
  }

  function lsRecords(): readonly string[] {
    const out = git(["ls-tree", "-r", "--name-only", RECORDS_BRANCH_NAME], repoDir).trim();
    return out === "" ? [] : out.split("\n");
  }

  function show(name: string): string {
    return git(["show", `${RECORDS_BRANCH_NAME}:${KEY}/${name}`], repoDir);
  }

  const FULL_FOLDER = {
    "prompt.md": "the decide prompt\n",
    "handback-prompt.md": "return the document\n",
    "document.json": '{"kind":"spec"}\n',
    "before.md": "the artifact before\n",
    "after.md": "the artifact after\n",
    "body.diff": "-before\n+after\n",
    "claude-session-id.txt": `${KEPT_SESSION}\n`,
    "output.jsonl": claudeTranscript(KEPT_SESSION, 1200, 450, 0.12),
  };

  it("a committed decide with transcripts on: the recorded files and a full manifest", async () => {
    await seedFolder(FULL_FOLDER);

    const result = await run(baseInput());

    expect(result).toMatchObject({ kind: "written", key: KEY, shape: "full", fileCount: 6 });
    expect(lsRecords().toSorted()).toEqual(
      [
        "body.diff",
        "document.json",
        "handback-prompt.md",
        "output.jsonl",
        "prompt.md",
        "record.json",
      ].map((name) => `${KEY}/${name}`),
    );
    const manifest = JSON.parse(show("record.json")) as Record<string, unknown>;
    expect(Object.keys(manifest)[0]).toBe("$schema");
    expect(manifest["$schema"]).toBe(currentSchemaUrl("decision-record-manifest"));
    expect(Either.isRight(decodeDecisionRecordManifestFile(manifest))).toBe(true);
    expect(manifest).toMatchObject({
      kind: "decision",
      decisionId: DECISION_ID,
      mode: "interactive",
      session: "resumed-authoring",
      questions: ["Q1", "Q2"],
      arbitrated: 1,
      departed: 0,
      outcome: "committed",
      commit: "def5678",
      shape: "full",
      usage: {
        available: true,
        usage: { provider: "claude-code", inputTokens: 1200, outputTokens: 450 },
      },
    });
    const message = git(["log", "-1", "--format=%B", RECORDS_BRANCH_NAME], repoDir);
    expect(message).toContain("records(decision): committed");
    expect(message).toContain(`Decision-Id: ${DECISION_ID}`);
    expect(message).toContain(`Artifact: ${ARTIFACT}`);
  });

  it("withholds every session id it was told from every recorded file", async () => {
    await seedFolder({
      ...FULL_FOLDER,
      "retry-prompt.md": `resume ${RETRY_SESSION} once\n`,
      "retry-output.jsonl": claudeTranscript(RETRY_SESSION, 800, 600, 0.05),
    });

    await run(baseInput({ retried: true, sessionIds: [KEPT_SESSION, RETRY_SESSION] }));

    const blobs = lsRecords().map((path) =>
      git(["show", `${RECORDS_BRANCH_NAME}:${path}`], repoDir),
    );
    for (const blob of blobs) {
      expect(blob).not.toContain(KEPT_SESSION);
      expect(blob).not.toContain(RETRY_SESSION);
    }
    expect(show("output.jsonl")).toContain('"session_id":"[session id withheld]"');
    // Usage is read before the ids are withheld, over both handback turns.
    const manifest = JSON.parse(show("record.json")) as {
      usage: { usage: { inputTokens: number } };
    };
    expect(manifest.usage.usage.inputTokens).toBe(2000);
  });

  it("transcripts off: a skeleton record without output.jsonl", async () => {
    await seedFolder(FULL_FOLDER);

    const result = await run(baseInput({ records: inRepoConfig(false) }));

    expect(result).toMatchObject({ kind: "written", shape: "skeleton" });
    expect(lsRecords()).not.toContain(`${KEY}/output.jsonl`);
    expect(JSON.parse(show("record.json"))).toMatchObject({ shape: "skeleton" });
  });

  it("a failed decide whose handback never answered: prompt only, usage unavailable, no commit", async () => {
    await seedFolder({ "prompt.md": "the decide prompt\n" });

    const result = await run(
      baseInput({ end: { outcome: "failed", commit: null }, arbitrated: 0, departed: 0 }),
    );

    expect(result).toMatchObject({ kind: "written", shape: "skeleton", fileCount: 2 });
    expect(JSON.parse(show("record.json"))).toMatchObject({
      outcome: "failed",
      commit: null,
      usage: { available: false },
    });
  });

  describe("mode verdicts", () => {
    function verdictsInput(overrides: Partial<VerdictsInput> = {}): VerdictsInput {
      const { end: _end, mode: _mode, ...rest } = baseInput();
      return {
        ...rest,
        mode: "verdicts",
        model: "claude-sonnet-5-5",
        requestedModel: "claude-sonnet-5-5",
        effort: "medium",
        end: { outcome: "committed", commit: "def5678" },
        turnSessionIds: [KEPT_SESSION],
        ...overrides,
      };
    }

    const VERDICTS_FOLDER = {
      "verdicts.json": '{"verdicts":[]}\n',
      "prompt.md": "the writer prompt\n",
      "document.json": '{"kind":"spec"}\n',
      "before.md": "the artifact before\n",
      "after.md": "the artifact after\n",
      "body.diff": "-before\n+after\n",
      "output.jsonl": claudeTranscript(KEPT_SESSION, 900, 300, 0.04),
    };

    it("records the verdicts file, the prompt, the document and the diff, with no handback prompt", async () => {
      await seedFolder(VERDICTS_FOLDER);

      const result = await run(verdictsInput());

      expect(result).toMatchObject({ kind: "written", key: KEY, shape: "full" });
      expect(lsRecords().toSorted()).toEqual(
        [
          "body.diff",
          "document.json",
          "output.jsonl",
          "prompt.md",
          "record.json",
          "verdicts.json",
        ].map((name) => `${KEY}/${name}`),
      );
      expect(show("verdicts.json")).toBe('{"verdicts":[]}\n');
      const manifest = JSON.parse(show("record.json")) as Record<string, unknown>;
      expect(Either.isRight(decodeDecisionRecordManifestFile(manifest))).toBe(true);
      expect(manifest).toMatchObject({
        mode: "verdicts",
        outcome: "committed",
        commit: "def5678",
        model: "claude-sonnet-5-5",
        requestedModel: "claude-sonnet-5-5",
        effort: "medium",
        questions: ["Q1", "Q2"],
        usage: { available: true, usage: { inputTokens: 900, outputTokens: 300 } },
      });
    });

    it("keeps the concrete model and the model asked for apart", async () => {
      await seedFolder(VERDICTS_FOLDER);

      await run(verdictsInput({ model: "claude-sonnet-5-5", requestedModel: "mystery-1" }));

      expect(JSON.parse(show("record.json"))).toMatchObject({
        model: "claude-sonnet-5-5",
        requestedModel: "mystery-1",
      });
    });

    it("a failed decide records outcome failed with commit null", async () => {
      await seedFolder({ ...VERDICTS_FOLDER, "retry-prompt.md": "again\n" });

      await run(verdictsInput({ end: { outcome: "failed", commit: null }, arbitrated: 0 }));

      expect(JSON.parse(show("record.json"))).toMatchObject({
        mode: "verdicts",
        outcome: "failed",
        commit: null,
      });
      expect(lsRecords()).toContain(`${KEY}/retry-prompt.md`);
    });

    it("withholds every session id from the verdicts file and the transcripts", async () => {
      await seedFolder({
        ...VERDICTS_FOLDER,
        "verdicts.json": `{"note":"see ${KEPT_SESSION}"}\n`,
        "retry-output.jsonl": claudeTranscript(RETRY_SESSION, 100, 50, 0.01),
      });

      await run(verdictsInput({ retried: true, sessionIds: [KEPT_SESSION, RETRY_SESSION] }));

      for (const path of lsRecords()) {
        const blob = git(["show", `${RECORDS_BRANCH_NAME}:${path}`], repoDir);
        expect(blob).not.toContain(KEPT_SESSION);
        expect(blob).not.toContain(RETRY_SESSION);
      }
    });
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
    expect(decisionRecordWarning(result)).toMatch(/^decision record refused: .+ \(remedy: .+\)$/);
    expect(git(["branch", "--list", RECORDS_BRANCH_NAME], repoDir).trim()).toBe("");
  });
});
