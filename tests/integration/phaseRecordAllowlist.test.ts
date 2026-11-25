import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import {
  RECORDS_BRANCH_NAME,
  writeRecord,
  type WriteRecordInput,
} from "../../src/app/writeRecord.js";

// SEC-02: a phase record is built from a fixed allowlist of phase-folder
// files. `records.transcript` alone decides whether the transcript-class
// files are carried; `output.jsonl` alone decides the shape.

const fakeGitHub = makeFakeGitHub();
const LAYER = Layer.mergeAll(NodeFileSystemLayer, NodeGitLayer, fakeGitHub.layer);

function git(args: readonly string[], cwd: string): string {
  return boundedOutput("git", [...args], { boundMs: GIT_BOUND_MS, cwd });
}

// One file of every kind phax writes into a phase folder.
const PHAX_WRITTEN: Readonly<Record<string, string>> = {
  "agent-binding.json": "{}\n",
  "agent-error.failed-01.log": "earlier failure\n",
  "agent-error.log": "argv: claude\nstderr: boom\n",
  "brief-00.json": "{}\n",
  "brief-01.json": "{}\n",
  "checks-attempt-01.acceptance-request.json": "{}\n",
  "checks-attempt-01.attribution.json": "{}\n",
  "checks-attempt-01.log": "$ pnpm test\nexit 1\n",
  "checks-attempt-01.oracle-request.json": "{}\n",
  "checks-attempt-01.report-01.json": "{}\n",
  "checks-attempt-01.request.json": "{}\n",
  "claude-session-id.txt": "S1\n",
  "diff.patch": "diff --git a/x b/x\n",
  "file-reconciliation.json": "{}\n",
  "file-reconciliation.md": "# reconciliation\n",
  "fix-attempt-01.jsonl": '{"type":"result"}\n',
  "gate-attribution.json": "{}\n",
  "handoff-generation.jsonl": '{"type":"result"}\n',
  "model-resolution.json": "{}\n",
  "output.jsonl": '{"type":"result"}\n',
  "phase-handoff.md": "# handoff\n",
  "prompt.md": "the prompt\n",
  "security.json": "{}\n",
  "setup.log": "$ pnpm install\n",
  "status.json": "{}\n",
};

// Files phax writes into a phase folder that no phase record ever carries.
const NEVER_CARRIED: Readonly<Record<string, string>> = {
  "output.failed-01.jsonl": '{"type":"result"}\n',
  "output.vibe-export/export.json": "{}\n",
  "fix-attempt-01.vibe-export/export.json": "{}\n",
  "review-seed.md": "seed\n",
  "first-turn-01.jsonl": '{"type":"result"}\n',
  "interactive-transcripts/S1.jsonl": '{"type":"result"}\n',
  "review-stop.closing.json": "{}\n",
};

// Frozen from the pre-change writer: the full record of the folder above.
const FULL_RECORD = [
  "agent-binding.json",
  "agent-error.failed-01.log",
  "agent-error.log",
  "brief-00.json",
  "brief-01.json",
  "checks-attempt-01.acceptance-request.json",
  "checks-attempt-01.attribution.json",
  "checks-attempt-01.log",
  "checks-attempt-01.oracle-request.json",
  "checks-attempt-01.report-01.json",
  "checks-attempt-01.request.json",
  "claude-session-id.txt",
  "diff.patch",
  "file-reconciliation.json",
  "file-reconciliation.md",
  "fix-attempt-01.jsonl",
  "gate-attribution.json",
  "handoff-generation.jsonl",
  "model-resolution.json",
  "output.jsonl",
  "phase-handoff.md",
  "prompt.md",
  "record.json",
  "security.json",
  "setup.log",
  "status.json",
];

const TRANSCRIPT_CLASS = [
  "agent-error.failed-01.log",
  "agent-error.log",
  "checks-attempt-01.log",
  "fix-attempt-01.jsonl",
  "handoff-generation.jsonl",
  "output.jsonl",
  "setup.log",
];

describe("phase record allowlist (SEC-02)", () => {
  let restoreGit: () => void;
  let repoDir: string;
  let phaseFolder: string;

  beforeEach(async () => {
    restoreGit = isolateGit();
    repoDir = mkdtempSync(join(tmpdir(), "phax-record-allowlist-repo-"));
    git(["init"], repoDir);
    disableGitAutoMaintenance(repoDir);
    git(["config", "--local", "user.email", "test@phax.test"], repoDir);
    git(["config", "--local", "user.name", "phax test"], repoDir);
    await writeFile(join(repoDir, "README.md"), "# test\n");
    git(["add", "."], repoDir);
    git(["commit", "-m", "chore: initial commit"], repoDir);
    phaseFolder = mkdtempSync(join(tmpdir(), "phax-record-allowlist-phase-"));
    fakeGitHub.impl.setVisibility("private");
  });

  afterEach(() => {
    removeTempDir(repoDir);
    removeTempDir(phaseFolder);
    restoreGit();
  });

  async function seed(files: Readonly<Record<string, string>>): Promise<void> {
    for (const [name, content] of Object.entries(files)) {
      const target = join(phaseFolder, name);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, content);
    }
  }

  function input(transcript: boolean): WriteRecordInput {
    return {
      repoRoot: repoDir,
      phaseFolderPath: phaseFolder,
      runId: "run-1",
      phaseId: "phase-01",
      provider: "claude-code",
      model: "claude-opus-4-8",
      effort: "high",
      gateProfile: "standard",
      outcome: "committed",
      acceptance: null,
      mode: "headless",
      stop: null,
      usage: { kind: "none" },
      records: { enabled: true, transcript, destination: { kind: "in-repo" }, autoPush: false },
      publishRemote: "origin",
    };
  }

  async function record(transcript: boolean): Promise<{
    readonly files: readonly string[];
    readonly shape: unknown;
  }> {
    const result = await Effect.runPromise(Effect.provide(writeRecord(input(transcript)), LAYER));
    expect(result.kind).toBe("written");
    const prefix = "run-1/phase-01/";
    const files = git(["ls-tree", "-r", "--name-only", RECORDS_BRANCH_NAME], repoDir)
      .trim()
      .split("\n")
      .map((path) => (path.startsWith(prefix) ? path.slice(prefix.length) : path));
    const manifest: unknown = JSON.parse(
      git(["show", `${RECORDS_BRANCH_NAME}:run-1/phase-01/record.json`], repoDir),
    );
    const shape =
      typeof manifest === "object" && manifest !== null && "shape" in manifest
        ? manifest.shape
        : undefined;
    return { files, shape };
  }

  it("with transcripts on, carries the same files the pre-change writer carried, shape full", async () => {
    await seed({ ...PHAX_WRITTEN, ...NEVER_CARRIED });

    const { files, shape } = await record(true);

    expect(files).toEqual(FULL_RECORD);
    expect(shape).toBe("full");
  });

  it("with transcripts off, carries exactly the non-transcript allowlisted files, shape skeleton", async () => {
    await seed({ ...PHAX_WRITTEN, ...NEVER_CARRIED });

    const { files, shape } = await record(false);

    expect(files).toEqual([
      "agent-binding.json",
      "brief-00.json",
      "brief-01.json",
      "checks-attempt-01.acceptance-request.json",
      "checks-attempt-01.attribution.json",
      "checks-attempt-01.oracle-request.json",
      "checks-attempt-01.report-01.json",
      "checks-attempt-01.request.json",
      "claude-session-id.txt",
      "diff.patch",
      "file-reconciliation.json",
      "file-reconciliation.md",
      "gate-attribution.json",
      "model-resolution.json",
      "phase-handoff.md",
      "prompt.md",
      "record.json",
      "security.json",
      "status.json",
    ]);
    for (const name of TRANSCRIPT_CLASS) expect(files).not.toContain(name);
    expect(shape).toBe("skeleton");
  });

  it("with transcripts on and no output.jsonl, still carries the agent error and gate logs, shape skeleton", async () => {
    await seed({
      "agent-binding.json": "{}\n",
      "agent-error.log": "argv: claude\nstderr: boom\n",
      "checks-attempt-01.log": "$ pnpm test\nexit 1\n",
      "prompt.md": "the prompt\n",
      "security.json": "{}\n",
      "status.json": "{}\n",
    });

    const { files, shape } = await record(true);

    expect(files).toEqual([
      "agent-binding.json",
      "agent-error.log",
      "checks-attempt-01.log",
      "prompt.md",
      "record.json",
      "security.json",
      "status.json",
    ]);
    expect(shape).toBe("skeleton");
  });

  it.each([true, false])(
    "with transcripts %s, carries no file outside the allowlist",
    async (transcript) => {
      await seed({ ...PHAX_WRITTEN, "notes.txt": "a note\n" });

      const { files } = await record(transcript);

      expect(files).not.toContain("notes.txt");
      expect(files).toContain("prompt.md");
    },
  );
});
