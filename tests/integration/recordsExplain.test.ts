import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Either, Layer } from "effect";
import { registerRecordsCommand } from "../../src/cli/commands/records.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import {
  writeAuthoringRecord,
  type WriteAuthoringRecordInput,
} from "../../src/app/writeAuthoringRecord.js";
import { Git, type GitError } from "../../src/ports/git.js";
import { Shell, type ShellError } from "../../src/ports/shell.js";
import { decodeBranchName, type BranchName } from "../../src/domain/branded.js";
import { explainRecord, gateArtifactsInOrder } from "../../src/app/recordsExplain.js";
import { listRecords } from "../../src/app/recordsList.js";
import { encodeRunRecordManifest, type RunRecordManifest } from "../../src/schemas/runRecord.js";
import { currentSchemaUrl, withSchemaUrl } from "../../src/schemas/persisted.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

const RECORDS_BRANCH: BranchName = Either.getOrThrow(decodeBranchName("phax/records/v1"));
const LAYER = Layer.mergeAll(NodeGitLayer, NodeShellLayer);

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function execGit(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

function run<A>(effect: Effect.Effect<A, GitError | ShellError, Git | Shell>): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, LAYER));
}

function runGitOnly<A>(effect: Effect.Effect<A, GitError, Git>): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, NodeGitLayer));
}

const IN_REPO_CONFIG: ResolvedRecordsConfig = {
  enabled: true,
  transcript: true,
  destination: { kind: "in-repo" },
  autoPush: true,
};

function commitWithTrailers(repo: string, runId: string, phaseId: string): string {
  const body = [
    "Do the thing.",
    "",
    "---",
    "",
    `Run-Id: ${runId}`,
    "Short-Name: test-run",
    `Phase-Id: ${phaseId}`,
    "Phase-Title: Test phase",
    "Model: claude-sonnet-5",
    "Effort: high",
  ].join("\n");
  execGit(["commit", "--allow-empty", "-m", `feat: ${phaseId}`, "-m", body], repo);
  return execGit(["rev-parse", "HEAD"], repo).trim();
}

/** Commits `document` as `<key>/record.json`, as written, beside `extraFiles`. */
function writeRecordDocumentCommit(
  repo: string,
  key: string,
  document: unknown,
  message: string,
  extraFiles: Record<string, string>,
): Promise<string> {
  const files = Object.entries(extraFiles).map(([name, content]) => ({
    path: `${key}/${name}`,
    content: new TextEncoder().encode(content),
  }));
  files.push({
    path: `${key}/record.json`,
    content: new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`),
  });
  return runGitOnly(
    Effect.flatMap(Git, (g) =>
      g.writeTreeCommit({
        repo,
        branch: RECORDS_BRANCH,
        message,
        files,
      }),
    ),
  );
}

function phaseRecordMessage(runId: string, phaseId: string, outcome: string, shape: string) {
  return [
    `records(${phaseId}): ${outcome}`,
    "",
    `Run-Id: ${runId}`,
    `Phase-Id: ${phaseId}`,
    `Shape: ${shape}`,
  ].join("\n");
}

function writeFullRecordCommit(
  repo: string,
  manifest: RunRecordManifest,
  extraFiles: Record<string, string>,
): Promise<string> {
  return writeRecordDocumentCommit(
    repo,
    `${manifest.runId}/${manifest.phaseId}`,
    encodeRunRecordManifest(withSchemaUrl("phase-record-manifest", manifest)),
    phaseRecordMessage(manifest.runId, manifest.phaseId, manifest.outcome, manifest.shape),
    extraFiles,
  );
}

/** Runs `phax records <args>` in-process; returns its exit code and output lines. */
async function records(args: readonly string[]) {
  const logs: string[] = [];
  const errors: string[] = [];
  const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  const program = new Command().exitOverride();
  registerRecordsCommand(program, {
    log: (m) => logs.push(m),
    warn: (m) => errors.push(m),
    error: (m) => errors.push(m),
  });
  await program.parseAsync(["records", ...args], { from: "user" });
  const code = exit.mock.calls.at(-1)?.[0];
  exit.mockRestore();
  return { code, logs, errors, text: logs.join("\n") };
}

// A phase manifest as phax wrote it before `$schema`: version 2, no `$schema`.
function preSchemaPhaseManifest(runId: string, phaseId: string, sourceSha: string): object {
  return {
    version: 2,
    runId,
    phaseId,
    shape: "skeleton",
    sourceSha,
    model: "claude-sonnet-5",
    effort: "high",
    provider: "claude-code",
    outcome: "committed",
    usage: { available: false },
    verifiedSurfaces: ["local"],
  };
}

describe("records explain and list (real git)", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "phax-records-explain-repo-"));
    execGit(["init"], repoDir);
    disableGitAutoMaintenance(repoDir);
    execGit(["config", "--local", "user.email", "test@phax.test"], repoDir);
    execGit(["config", "--local", "user.name", "phax test"], repoDir);
    execGit(["commit", "--allow-empty", "-m", "chore: initial commit"], repoDir);
  });

  afterEach(async () => {
    removeTempDir(repoDir);
  });

  it("resolves a record through the commit's Run-Id/Phase-Id trailers, surviving a rebase", async () => {
    const runId = "run-rebase-1786800000000";
    const phaseId = "phase-01";
    const original = commitWithTrailers(repoDir, runId, phaseId);

    const manifest: RunRecordManifest = {
      runId,
      phaseId,
      shape: "full",
      sourceSha: original,
      model: "claude-sonnet-5",
      effort: "high",
      provider: "claude-code",
      outcome: "committed",
      usage: {
        available: true,
        usage: {
          provider: "claude-code",
          inputTokens: 41203,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          outputTokens: 8117,
          totalCostUsd: 1.23,
        },
      },
      verifiedSurfaces: ["local", "product"],
    };
    await writeFullRecordCommit(repoDir, manifest, {
      "prompt.md": "a".repeat(100),
      "diff.patch": [
        "diff --git a/x.ts b/x.ts",
        "--- a/x.ts",
        "+++ b/x.ts",
        "+added line",
        "-removed line",
      ].join("\n"),
      "phase-handoff.md": "handoff content",
      "checks-attempt-01.log": "gate log 1",
      "checks-attempt-02.log": "gate log 2",
      "output.jsonl": '{"type":"result"}\n',
    });

    // Simulate a rebase: a new commit with the same trailers, a different sha.
    const rebased = commitWithTrailers(repoDir, runId, phaseId);
    expect(rebased).not.toBe(original);

    const outcome = await run(
      explainRecord({
        sha: rebased,
        repoRoot: repoDir,
        records: IN_REPO_CONFIG,
        publishRemote: "origin",
      }),
    );

    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") throw new Error("expected found");
    expect(outcome.record.runId).toBe(runId);
    expect(outcome.record.phaseId).toBe(phaseId);
    expect(outcome.record.manifest.shape).toBe("full");
    expect(outcome.record.checksAttemptCount).toBe(2);
    expect(outcome.record.handoffPresent).toBe(true);
    expect(outcome.record.promptByteLength).toBe(100);
    expect(outcome.record.diffStat).toEqual({ files: 1, insertions: 1, deletions: 1 });
    // The manifest's own back-reference is the original commit, still reachable here.
    expect(outcome.record.sourceCommitReachable).toBe(true);
    expect(outcome.record.manifest.verifiedSurfaces).toEqual(["local", "product"]);
  });

  it("reports a hand-written commit with no trailers as not produced by a phax phase", async () => {
    execGit(["commit", "--allow-empty", "-m", "manual: hotfix, no trailers"], repoDir);
    const sha = execGit(["rev-parse", "HEAD"], repoDir).trim();

    const outcome = await run(
      explainRecord({
        sha,
        repoRoot: repoDir,
        records: IN_REPO_CONFIG,
        publishRemote: "origin",
      }),
    );

    expect(outcome.kind).toBe("not-phax-commit");
  });

  it("reports a local miss with an unreachable remote as offline, never as absence", async () => {
    const runId = "run-offline-1786800000001";
    const phaseId = "phase-02";
    const sha = commitWithTrailers(repoDir, runId, phaseId);
    // No record commit is ever written on this repo's own records branch.
    execGit(
      ["remote", "add", "origin", join(tmpdir(), "phax-records-explain-no-such-remote")],
      repoDir,
    );

    const outcome = await run(
      explainRecord({
        sha,
        repoRoot: repoDir,
        records: IN_REPO_CONFIG,
        publishRemote: "origin",
      }),
    );

    expect(outcome.kind).toBe("not-found");
    if (outcome.kind !== "not-found") throw new Error("expected not-found");
    expect(outcome.remoteConsulted).toBe(false);
  });

  it("reports a skeleton record's shape and a vibe phase's captured usage", async () => {
    const runId = "run-vibe-1786800000002";
    const phaseId = "phase-03";
    const sha = commitWithTrailers(repoDir, runId, phaseId);

    const manifest: RunRecordManifest = {
      runId,
      phaseId,
      shape: "skeleton",
      sourceSha: sha,
      model: "mistral-large",
      effort: "medium",
      provider: "mistral-vibe",
      outcome: "committed",
      usage: {
        available: true,
        usage: {
          provider: "mistral-vibe",
          inputTokens: 5000,
          outputTokens: 900,
          sessionCostUsd: 0.42,
          toolCallsAgreed: 3,
          toolCallsRejected: 0,
          toolCallsFailed: 0,
          toolCallsSucceeded: 3,
        },
      },
      verifiedSurfaces: [],
    };
    await writeFullRecordCommit(repoDir, manifest, {
      "prompt.md": "prompt",
      "diff.patch": "diff --git a/y.ts b/y.ts\n",
      "checks-attempt-01.log": "gate log",
    });

    const outcome = await run(
      explainRecord({
        sha,
        repoRoot: repoDir,
        records: IN_REPO_CONFIG,
        publishRemote: "origin",
      }),
    );

    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") throw new Error("expected found");
    expect(outcome.record.manifest.shape).toBe("skeleton");
    expect(outcome.record.artifacts.has("output.jsonl")).toBe(false);
    expect(outcome.record.manifest.usage).toEqual(manifest.usage);
  });

  it("records list shows a failed phase's record", async () => {
    const runId = "run-list-1786800000003";
    const failedManifest: RunRecordManifest = {
      runId,
      phaseId: "phase-04",
      shape: "skeleton",
      model: "claude-sonnet-5",
      effort: "high",
      provider: "claude-code",
      outcome: "failed",
      usage: { available: false },
      verifiedSurfaces: [],
    };
    await writeFullRecordCommit(repoDir, failedManifest, {
      "checks-attempt-01.log": "log",
      "checks-attempt-02.log": "log",
      "checks-attempt-03.log": "log",
    });

    const committedManifest: RunRecordManifest = {
      ...failedManifest,
      phaseId: "phase-05",
      outcome: "committed",
      sourceSha: commitWithTrailers(repoDir, runId, "phase-05"),
    };
    await writeFullRecordCommit(repoDir, committedManifest, { "checks-attempt-01.log": "log" });

    const result = await run(
      listRecords({
        records: IN_REPO_CONFIG,
        repoRoot: repoDir,
        publishRemote: "origin",
        runId,
      }),
    );

    expect(result.kind).toBe("listed");
    if (result.kind !== "listed") throw new Error("expected listed");
    const byPhase = new Map(
      result.records.flatMap((r) => (r.kind === "phase" ? [[r.phaseId, r] as const] : [])),
    );
    expect(byPhase.get("phase-04")?.outcome).toBe("failed");
    expect(byPhase.get("phase-05")?.outcome).toBe("committed");
    expect(byPhase.get("phase-04")?.verifiedSurfaces).toEqual([]);
  });

  it("explains and lists a phase manifest written before $schema", async () => {
    const runId = "run-legacy-1786800000005";
    const phaseId = "phase-01";
    const sha = commitWithTrailers(repoDir, runId, phaseId);
    await writeRecordDocumentCommit(
      repoDir,
      `${runId}/${phaseId}`,
      preSchemaPhaseManifest(runId, phaseId, sha),
      phaseRecordMessage(runId, phaseId, "committed", "skeleton"),
      { "prompt.md": "p" },
    );

    const outcome = await run(
      explainRecord({ sha, repoRoot: repoDir, records: IN_REPO_CONFIG, publishRemote: "origin" }),
    );
    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") throw new Error("expected found");
    expect(outcome.record.manifest).not.toHaveProperty("version");
    expect(outcome.record.manifest.sourceSha).toBe(sha);
    expect(outcome.record.manifest.verifiedSurfaces).toEqual(["local"]);

    const listed = await run(
      listRecords({ records: IN_REPO_CONFIG, repoRoot: repoDir, publishRemote: "origin", runId }),
    );
    if (listed.kind !== "listed") throw new Error("expected listed");
    expect(listed.records).toMatchObject([{ kind: "phase", phaseId, outcome: "committed" }]);
  });

  it("orders gate artifacts by attempt: a log, its request, then its reports in step order", () => {
    const artifacts = new Map<string, Uint8Array>([
      ["checks-attempt-10.log", bytes("ten")],
      ["checks-attempt-10.report-01.json", bytes("{}")],
      ["checks-attempt-02.report-03.json", bytes("{}")],
      ["checks-attempt-02.log", bytes("two")],
      ["checks-attempt-02.report-01.json", bytes("{}")],
      ["checks-attempt-02.request.json", bytes("{}")],
      ["checks-attempt-01.log", bytes("one")],
      ["checks-attempt-01.diagnostics.json", bytes("{}")],
      ["prompt.md", bytes("p")],
    ]);
    expect(gateArtifactsInOrder(artifacts).map(([name]) => name)).toEqual([
      "checks-attempt-01.log",
      "checks-attempt-02.log",
      "checks-attempt-02.request.json",
      "checks-attempt-02.report-01.json",
      "checks-attempt-02.report-03.json",
      "checks-attempt-10.log",
      "checks-attempt-10.report-01.json",
    ]);
  });

  describe("records commands on a record carrying a file this release never writes", () => {
    let tempHome: string;
    let originalHome: string | undefined;
    let originalCwd: string;

    beforeEach(() => {
      originalCwd = process.cwd();
      originalHome = process.env["HOME"];
      tempHome = mkdtempSync(join(tmpdir(), "phax-records-explain-home-"));
      process.env["HOME"] = tempHome;
      writeFileSync(
        join(repoDir, "phax.json"),
        JSON.stringify({
          version: 1,
          name: "test",
          gateProfiles: {
            fast: [{ command: "pnpm test", surface: "local", firing: "every-phase" }],
          },
          records: { transcript: false, destination: { kind: "in-repo" }, autoPush: false },
        }),
      );
      process.chdir(repoDir);
    });

    afterEach(() => {
      process.chdir(originalCwd);
      if (originalHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = originalHome;
      removeTempDir(tempHome);
      vi.restoreAllMocks();
    });

    it("prints brief records in number order under --briefs and counts them in the summary", async () => {
      const runId = "run-briefs-1786800000012";
      const phaseId = "phase-01";
      const sha = commitWithTrailers(repoDir, runId, phaseId);
      const manifest: RunRecordManifest = {
        runId,
        phaseId,
        shape: "skeleton",
        sourceSha: sha,
        model: "claude-sonnet-5",
        effort: "high",
        provider: "claude-code",
        outcome: "committed",
        usage: { available: false },
        verifiedSurfaces: ["local"],
      };
      await writeFullRecordCommit(repoDir, manifest, {
        "brief-10.json": '{"n":10}',
        "brief-02.json": '{"n":2}',
        "brief-00.json": '{"n":0}',
        "brief-01.json": '{"n":1}',
        "checks-attempt-01.request.json": '{"attempt":1}',
        "checks-attempt-01.log": "gate log one",
      });

      const plain = await records(["explain", sha]);
      expect(plain.logs.join("\n")).toContain("briefs   4 (--briefs prints them)");

      const withBriefs = await records(["explain", sha, "--briefs"]);
      expect(withBriefs.code).toBe(0);
      const briefLines = withBriefs.logs.slice(withBriefs.logs.indexOf("--- brief-00.json ---"));
      expect(briefLines).toEqual([
        "--- brief-00.json ---",
        '{"n":0}',
        "--- brief-01.json ---",
        '{"n":1}',
        "--- brief-02.json ---",
        '{"n":2}',
        "--- brief-10.json ---",
        '{"n":10}',
      ]);
    });

    it("shows no briefs line and a none-message for a record without brief files", async () => {
      const runId = "run-nobriefs-1786800000013";
      const phaseId = "phase-01";
      const sha = commitWithTrailers(repoDir, runId, phaseId);
      const manifest: RunRecordManifest = {
        runId,
        phaseId,
        shape: "skeleton",
        sourceSha: sha,
        model: "claude-sonnet-5",
        effort: "high",
        provider: "claude-code",
        outcome: "committed",
        usage: { available: false },
        verifiedSurfaces: ["local"],
      };
      await writeFullRecordCommit(repoDir, manifest, { "checks-attempt-01.log": "gate log one" });

      const plain = await records(["explain", sha]);
      expect(plain.logs.join("\n")).not.toContain("briefs ");
      const withBriefs = await records(["explain", sha, "--briefs"]);
      expect(withBriefs.logs).toContain("(no brief records in this record)");
    });

    it("prints each attempt's gate request directly after its log, in attempt order", async () => {
      const runId = "run-gates-1786800000011";
      const phaseId = "phase-01";
      const sha = commitWithTrailers(repoDir, runId, phaseId);
      const manifest: RunRecordManifest = {
        runId,
        phaseId,
        shape: "skeleton",
        sourceSha: sha,
        model: "claude-sonnet-5",
        effort: "high",
        provider: "claude-code",
        outcome: "committed",
        usage: { available: false },
        verifiedSurfaces: ["local"],
      };
      await writeFullRecordCommit(repoDir, manifest, {
        "checks-attempt-02.request.json": '{"attempt":2}',
        "checks-attempt-02.log": "gate log two",
        "checks-attempt-01.request.json": '{"attempt":1}',
        "checks-attempt-01.log": "gate log one",
        "checks-attempt-01.diagnostics.json": '{"diagnostics":[]}',
      });

      const withGates = await records(["explain", sha, "--gates"]);
      expect(withGates.code).toBe(0);
      const gateLines = withGates.logs.slice(
        withGates.logs.indexOf("--- checks-attempt-01.log ---"),
      );
      expect(gateLines).toEqual([
        "--- checks-attempt-01.log ---",
        "gate log one",
        "--- checks-attempt-01.request.json ---",
        '{"attempt":1}',
        "--- checks-attempt-02.log ---",
        "gate log two",
        "--- checks-attempt-02.request.json ---",
        '{"attempt":2}',
      ]);
    });

    it("prints each attempt's gate reports after its log and request, as stored", async () => {
      const runId = "run-reports-1786800000014";
      const phaseId = "phase-01";
      const sha = commitWithTrailers(repoDir, runId, phaseId);
      const manifest: RunRecordManifest = {
        runId,
        phaseId,
        shape: "skeleton",
        sourceSha: sha,
        model: "claude-sonnet-5",
        effort: "high",
        provider: "claude-code",
        outcome: "committed",
        usage: { available: false },
        verifiedSurfaces: ["local"],
      };
      // Made-up reports, pretty-printed with a trailing newline as a step
      // might print them; explain shows the stored bytes unchanged.
      const checked = `${JSON.stringify(
        {
          $schema: currentSchemaUrl("gate-report"),
          outcome: "checked",
          findings: [],
          review: [{ owner: "hw-maintainers", note: "whether the greeting reads well" }],
        },
        null,
        2,
      )}\n`;
      const refused = `${JSON.stringify(
        {
          $schema: currentSchemaUrl("gate-report"),
          outcome: "refused",
          reason: "the checks need hw-rules 2, and 1 is installed",
          remedy: "pnpm add -D hw-rules@2",
        },
        null,
        2,
      )}\n`;
      await writeFullRecordCommit(repoDir, manifest, {
        "checks-attempt-02.report-01.json": checked,
        "checks-attempt-02.log": "gate log two",
        "checks-attempt-01.report-01.json": refused,
        "checks-attempt-01.request.json": '{"attempt":1}',
        "checks-attempt-01.log": "gate log one",
      });

      const withGates = await records(["explain", sha, "--gates"]);
      expect(withGates.code).toBe(0);
      const gateLines = withGates.logs.slice(
        withGates.logs.indexOf("--- checks-attempt-01.log ---"),
      );
      expect(gateLines).toEqual([
        "--- checks-attempt-01.log ---",
        "gate log one",
        "--- checks-attempt-01.request.json ---",
        '{"attempt":1}',
        "--- checks-attempt-01.report-01.json ---",
        refused,
        "--- checks-attempt-02.log ---",
        "gate log two",
        "--- checks-attempt-02.report-01.json ---",
        checked,
      ]);
    });

    it("lists and explains the record, prints its prompt, diff and gates, and leaves the extra file intact", async () => {
      const runId = "run-extra-1786800000010";
      const phaseId = "phase-01";
      const sha = commitWithTrailers(repoDir, runId, phaseId);
      const legacyNote = '{\n  "note": "made-up file from another release"\n}\n';
      const prompt = "# Recorded prompt\n\nDo the made-up thing.";
      const diff = ["diff --git a/y.ts b/y.ts", "--- a/y.ts", "+++ b/y.ts", "+new line"].join("\n");
      const manifest: RunRecordManifest = {
        runId,
        phaseId,
        shape: "skeleton",
        sourceSha: sha,
        model: "claude-sonnet-5",
        effort: "high",
        provider: "claude-code",
        outcome: "committed",
        usage: { available: false },
        verifiedSurfaces: ["local"],
      };
      await writeFullRecordCommit(repoDir, manifest, {
        "prompt.md": prompt,
        "diff.patch": diff,
        "checks-attempt-01.log": "gate log one",
        "legacy-note.json": legacyNote,
      });
      const recordsTip = execGit(["rev-parse", RECORDS_BRANCH], repoDir).trim();

      const listed = await records(["list"]);
      expect(listed.code).toBe(0);
      expect(listed.errors).toEqual([]);
      expect(listed.text).toContain(`${runId}  ${phaseId}  skeleton  committed`);

      const plain = await records(["explain", sha]);
      expect(plain.code).toBe(0);
      expect(plain.errors).toEqual([]);
      expect(plain.text).toContain(`${phaseId} · claude-code (claude-sonnet-5, high)`);
      expect(plain.text).toContain("gates    committed after 1 attempt(s)   surfaces  local");
      expect(plain.text).toContain(`prompt   ${prompt.length} bytes   diff  1 files, +1 -0`);

      const withPrompt = await records(["explain", sha, "--prompt"]);
      expect(withPrompt.code).toBe(0);
      expect(withPrompt.logs).toContain(prompt);

      const withDiff = await records(["explain", sha, "--diff"]);
      expect(withDiff.code).toBe(0);
      expect(withDiff.logs).toContain(diff);

      const withGates = await records(["explain", sha, "--gates"]);
      expect(withGates.code).toBe(0);
      expect(withGates.logs).toContain("--- checks-attempt-01.log ---");
      expect(withGates.logs).toContain("gate log one");

      // Reading never rewrites the record: the tip and the extra file are unchanged.
      expect(execGit(["rev-parse", RECORDS_BRANCH], repoDir).trim()).toBe(recordsTip);
      expect(
        execGit(["show", `${RECORDS_BRANCH}:${runId}/${phaseId}/legacy-note.json`], repoDir),
      ).toBe(legacyNote);
    });
  });

  it("reports a version-1 phase manifest as unsupported and leaves it out of the list", async () => {
    const runId = "run-v1-1786800000006";
    const phaseId = "phase-01";
    const sha = commitWithTrailers(repoDir, runId, phaseId);
    const { verifiedSurfaces: _surfaces, ...versionOne } = preSchemaPhaseManifest(
      runId,
      phaseId,
      sha,
    ) as Record<string, unknown>;
    await writeRecordDocumentCommit(
      repoDir,
      `${runId}/${phaseId}`,
      { ...versionOne, version: 1 },
      phaseRecordMessage(runId, phaseId, "committed", "skeleton"),
      {},
    );

    const outcome = await run(
      Effect.either(
        explainRecord({ sha, repoRoot: repoDir, records: IN_REPO_CONFIG, publishRemote: "origin" }),
      ),
    );
    if (Either.isRight(outcome)) throw new Error("expected a failure");
    expect(outcome.left.message).toContain(`${runId}/${phaseId}/record.json`);
    expect(outcome.left.message).toContain(
      "phase record manifest without $schema is not in the pre-schema shape — older than the first release that writes $schema, or damaged",
    );

    const listed = await run(
      listRecords({ records: IN_REPO_CONFIG, repoRoot: repoDir, publishRemote: "origin", runId }),
    );
    if (listed.kind !== "listed") throw new Error("expected listed");
    expect(listed.records).toEqual([]);
  });

  describe("authoring records", () => {
    let sessionFolder: string;

    beforeEach(() => {
      sessionFolder = mkdtempSync(join(tmpdir(), "phax-records-explain-session-"));
    });

    afterEach(() => {
      removeTempDir(sessionFolder);
    });

    // An artifact commit as `artifact new --headless` makes it: the draft plus
    // its sidecar, with the Artifact and Authoring-Id trailers.
    function commitArtifact(authoringId: string, artifact: string): string {
      writeFileSync(join(repoDir, artifact.replaceAll("/", "_")), `${authoringId}\n`);
      execGit(["add", "."], repoDir);
      execGit(
        [
          "commit",
          "-m",
          `docs(specs): draft ${authoringId}`,
          "-m",
          `Authored headless.\n\nArtifact: ${artifact}\nAuthoring-Id: ${authoringId}`,
        ],
        repoDir,
      );
      return execGit(["rev-parse", "HEAD"], repoDir).trim();
    }

    async function recordSession(
      authoringId: string,
      artifact: string,
      overrides: Partial<WriteAuthoringRecordInput> = {},
    ): Promise<void> {
      writeFileSync(join(sessionFolder, "brief.md"), "the brief\n");
      writeFileSync(join(sessionFolder, "prompt.md"), "p".repeat(64));
      writeFileSync(join(sessionFolder, "document.json"), '{"kind":"spec"}\n');
      writeFileSync(join(sessionFolder, "output.jsonl"), '{"type":"result"}\n');
      const fakeGitHub = makeFakeGitHub();
      await Effect.runPromise(
        Effect.provide(
          writeAuthoringRecord({
            repoRoot: repoDir,
            sessionFolder,
            authoringId,
            artifact,
            artifactKind: "spec",
            provider: "claude-code",
            model: "claude-opus-5-5",
            effort: "high",
            outcome: "committed",
            records: IN_REPO_CONFIG,
            ...overrides,
          }),
          Layer.mergeAll(NodeFileSystemLayer, NodeGitLayer, fakeGitHub.layer),
        ),
      );
    }

    it("resolves an authoring record through the artifact commit's Authoring-Id trailer", async () => {
      const artifact = "docs/specs/2609230835-plan-prune.md";
      const sha = commitArtifact("2609230835-plan-prune", artifact);
      await recordSession("2609230835-plan-prune", artifact, { sourceSha: sha });

      const outcome = await run(
        explainRecord({ sha, repoRoot: repoDir, records: IN_REPO_CONFIG, publishRemote: "origin" }),
      );

      expect(outcome.kind).toBe("found-authoring");
      if (outcome.kind !== "found-authoring") throw new Error("expected found-authoring");
      expect(outcome.record.authoringId).toBe("2609230835-plan-prune");
      expect(outcome.record.manifest.artifact).toBe(artifact);
      expect(outcome.record.manifest.outcome).toBe("committed");
      expect(outcome.record.manifest.sourceSha).toBe(sha);
      expect(outcome.record.sourceCommitReachable).toBe(true);
      expect(outcome.record.foundVia).toBe("local");
      expect(outcome.record.briefByteLength).toBe("the brief\n".length);
      expect(outcome.record.promptByteLength).toBe(64);
      expect(outcome.record.documentPresent).toBe(true);
      expect(outcome.record.artifacts.has("output.jsonl")).toBe(true);
    });

    it("--briefs on an authoring record says it carries no provider briefs", async () => {
      const artifact = "docs/specs/2609230835-plan-prune.md";
      const sha = commitArtifact("2609230835-plan-prune", artifact);
      await recordSession("2609230835-plan-prune", artifact, { sourceSha: sha });
      writeFileSync(
        join(repoDir, "phax.json"),
        JSON.stringify({
          version: 1,
          name: "test",
          gateProfiles: {
            fast: [{ command: "pnpm test", surface: "local", firing: "every-phase" }],
          },
          records: { transcript: false, destination: { kind: "in-repo" }, autoPush: false },
        }),
      );
      const originalCwd = process.cwd();
      process.chdir(repoDir);
      try {
        const withBriefs = await records(["explain", sha, "--briefs"]);
        expect(withBriefs.code).toBe(0);
        expect(withBriefs.logs).toContain("(an authoring record carries no provider briefs)");
        // The authoring brief's size line stays: it is the person-written brief.
        expect(withBriefs.text).toContain(`brief    ${"the brief\n".length} bytes`);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("explains an authoring manifest written before $schema", async () => {
      const authoringId = "2609230835-legacy";
      const artifact = "docs/specs/2609230835-legacy.md";
      const sha = commitArtifact(authoringId, artifact);
      await writeRecordDocumentCommit(
        repoDir,
        `authoring/${authoringId}`,
        {
          version: 1,
          kind: "authoring",
          authoringId,
          artifact,
          artifactKind: "spec",
          shape: "skeleton",
          sourceSha: sha,
          provider: "claude-code",
          model: "claude-opus-5-5",
          effort: "high",
          outcome: "committed",
          usage: { available: false },
        },
        [`records(authoring): committed`, "", `Authoring-Id: ${authoringId}`].join("\n"),
        { "brief.md": "the brief\n" },
      );

      const outcome = await run(
        explainRecord({ sha, repoRoot: repoDir, records: IN_REPO_CONFIG, publishRemote: "origin" }),
      );

      expect(outcome.kind).toBe("found-authoring");
      if (outcome.kind !== "found-authoring") throw new Error("expected found-authoring");
      expect(outcome.record.manifest).not.toHaveProperty("version");
      expect(outcome.record.manifest.artifact).toBe(artifact);
      expect(outcome.record.manifest.sourceSha).toBe(sha);
    });

    it("an id that is a prefix of a newer record's id still resolves its own record", async () => {
      const shortSha = commitArtifact("2609230835-plan", "docs/specs/2609230835-plan.md");
      await recordSession("2609230835-plan", "docs/specs/2609230835-plan.md", {
        sourceSha: shortSha,
      });
      const longSha = commitArtifact(
        "2609230835-plan-prune",
        "docs/specs/2609230835-plan-prune.md",
      );
      await recordSession("2609230835-plan-prune", "docs/specs/2609230835-plan-prune.md", {
        sourceSha: longSha,
      });

      const outcome = await run(
        explainRecord({
          sha: shortSha,
          repoRoot: repoDir,
          records: IN_REPO_CONFIG,
          publishRemote: "origin",
        }),
      );

      expect(outcome.kind).toBe("found-authoring");
      if (outcome.kind !== "found-authoring") throw new Error("expected found-authoring");
      expect(outcome.record.manifest.artifact).toBe("docs/specs/2609230835-plan.md");
    });

    it("an artifact commit without a record is not found under its authoring key", async () => {
      const sha = commitArtifact("2609230835-orphan", "docs/specs/2609230835-orphan.md");
      execGit(
        ["remote", "add", "origin", join(tmpdir(), "phax-records-explain-no-such-remote")],
        repoDir,
      );

      const outcome = await run(
        explainRecord({ sha, repoRoot: repoDir, records: IN_REPO_CONFIG, publishRemote: "origin" }),
      );

      expect(outcome).toMatchObject({ kind: "not-found", key: "authoring/2609230835-orphan" });
    });

    it("records list shows an authoring record beside phase records", async () => {
      const runId = "run-mixed-1786800000004";
      await writeFullRecordCommit(
        repoDir,
        {
          runId,
          phaseId: "phase-01",
          shape: "skeleton",
          model: "claude-sonnet-5",
          effort: "high",
          provider: "claude-code",
          outcome: "committed",
          usage: { available: false },
          verifiedSurfaces: ["local"],
        },
        { "prompt.md": "p" },
      );
      await recordSession("2609230835-plan-prune", "docs/specs/2609230835-plan-prune.md", {
        outcome: "failed",
      });

      const all = await run(
        listRecords({ records: IN_REPO_CONFIG, repoRoot: repoDir, publishRemote: "origin" }),
      );

      if (all.kind !== "listed") throw new Error("expected listed");
      expect(all.records.map((r) => r.kind)).toEqual(["authoring", "phase"]);
      expect(all.records[0]).toMatchObject({
        kind: "authoring",
        authoringId: "2609230835-plan-prune",
        artifact: "docs/specs/2609230835-plan-prune.md",
        artifactKind: "spec",
        outcome: "failed",
        shape: "full",
      });

      // Filtering by run keeps only that run's phase records.
      const byRun = await run(
        listRecords({ records: IN_REPO_CONFIG, repoRoot: repoDir, publishRemote: "origin", runId }),
      );
      if (byRun.kind !== "listed") throw new Error("expected listed");
      expect(byRun.records.map((r) => r.kind)).toEqual(["phase"]);
    });
  });
});
