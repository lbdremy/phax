// A run's reviews, read from the records branch (oldest first) and the run
// folder (only when it differs from the newest record of its kind). Real git in
// a temporary repository, records written by writeReviewRecord.
import { Effect, Layer } from "effect";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readRunReviews, reviewSourceOf, type RunReviewSource } from "../../src/app/runReviews.js";
import { writeReviewRecord } from "../../src/app/writeReviewRecord.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

const RUN_ID = "2610270900-by-hand";

const RECORDS: ResolvedRecordsConfig = {
  enabled: true,
  transcript: false,
  destination: { kind: "in-repo" },
  autoPush: false,
};

function runGit(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

function finding(message: string, id?: string) {
  return {
    ...(id === undefined ? {} : { id }),
    severity: "concern",
    file: "src/example.ts",
    line: 1,
    message,
    lens: "core",
    escape: "omission",
    criterion: null,
    suggestion: "Cover it with a test.",
  };
}

/** A current-shape code-review.json whose findings carry ids F<from>... */
function codeReviewText(messages: readonly string[], from = 1): string {
  return JSON.stringify({
    $schema: currentSchemaUrl("code-review"),
    findings: messages.map((m, i) => finding(m, `F${from + i}`)),
  });
}

describe("readRunReviews (real git)", () => {
  let restoreGit: () => void;
  let repoDir: string;
  let runFolder: string;
  const fakeGitHub = makeFakeGitHub();
  const layers = Layer.mergeAll(NodeFileSystemLayer, NodeGitLayer, fakeGitHub.layer);
  const source: RunReviewSource = {
    kind: "repo",
    path: "",
    remoteRef: "refs/remotes/origin/phax/records/v1",
  };

  beforeEach(() => {
    restoreGit = isolateGit();
    fakeGitHub.impl.setVisibility("private");
    repoDir = mkdtempSync(join(tmpdir(), "phax-run-reviews-repo-"));
    runGit(["init"], repoDir);
    disableGitAutoMaintenance(repoDir);
    runGit(["config", "--local", "user.email", "test@phax.test"], repoDir);
    runGit(["config", "--local", "user.name", "phax test"], repoDir);
    runGit(["commit", "--allow-empty", "-m", "chore: initial commit"], repoDir);
    runFolder = mkdtempSync(join(tmpdir(), "phax-run-reviews-run-"));
  });

  afterEach(() => {
    for (const dir of [repoDir, runFolder]) removeTempDir(dir);
    restoreGit();
  });

  /** Put `text` in the run folder and record it as a code review. */
  async function record(text: string, review: "code-review" | "compliance-review" = "code-review") {
    await writeFile(join(runFolder, `${review}.json`), text);
    await Effect.runPromise(
      writeReviewRecord({
        repoRoot: repoDir,
        records: RECORDS,
        publishRemote: "origin",
        runId: RUN_ID,
        runPath: runFolder,
        review,
      }).pipe(Effect.provide(layers)),
    );
  }

  function read(runFolderArg: string | null = runFolder, src: RunReviewSource = source) {
    const withPath: RunReviewSource =
      src.kind === "repo" && src.path === "" ? { ...src, path: repoDir } : src;
    return Effect.runPromise(
      readRunReviews({ runId: RUN_ID, runFolder: runFolderArg, source: withPath }).pipe(
        Effect.provide(layers),
      ),
    );
  }

  const messagesOf = (result: Awaited<ReturnType<typeof read>>) =>
    result.reviews.map((r) =>
      r.review.source === "code-review" ? r.review.review.findings.map((f) => f.message) : [],
    );

  it("reads two recorded code reviews oldest first", async () => {
    await record(codeReviewText(["one", "two"]));
    await record(codeReviewText(["three"], 3));
    const result = await read(null);
    expect(result.records).toBe("read");
    expect(messagesOf(result)).toEqual([["one", "two"], ["three"]]);
    expect(result.reviews.every((r) => r.from === "records" && r.recordCommit !== null)).toBe(true);
  });

  it("reads a run folder file equal to the newest record once", async () => {
    await record(codeReviewText(["one"]));
    const result = await read();
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]?.from).toBe("records");
  });

  it("appends a run folder file that differs from the newest record, last", async () => {
    await record(codeReviewText(["one"]));
    await writeFile(join(runFolder, "code-review.json"), codeReviewText(["two"], 2));
    const result = await read();
    expect(messagesOf(result)).toEqual([["one"], ["two"]]);
    expect(result.reviews.map((r) => r.from)).toEqual(["records", "run-folder"]);
    expect(result.reviews[1]?.recordCommit).toBeNull();
  });

  it("reads a 0.32.0-stamped recorded file with ids absent", async () => {
    await record(
      JSON.stringify({
        $schema: schemaUrl("code-review", "0.32.0"),
        findings: [finding("older")],
      }),
    );
    const result = await read(null);
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]?.review.ids).toBe("absent");
  });

  it("with records off, reads the run folder alone", async () => {
    await writeFile(join(runFolder, "code-review.json"), codeReviewText(["one"]));
    const off = reviewSourceOf({
      kind: "project",
      records: { ...RECORDS, enabled: false },
      repoRoot: repoDir,
      publishRemote: "origin",
      push: null,
    });
    const result = await read(runFolder, off);
    expect(result.records).toBe("off");
    expect(result.notes).toEqual(["records are off: reading the run folder alone"]);
    expect(messagesOf(result)).toEqual([["one"]]);
    expect(result.reviews[0]?.from).toBe("run-folder");
  });

  it("with a missing records clone, is unavailable with a note and reads the run folder", async () => {
    await writeFile(join(runFolder, "code-review.json"), codeReviewText(["one"]));
    const clone = join(tmpdir(), "phax-run-reviews-no-such-clone");
    const result = await read(
      runFolder,
      reviewSourceOf({
        kind: "project",
        records: {
          ...RECORDS,
          destination: { kind: "repo", remote: "https://example.test/r.git" },
        },
        repoRoot: repoDir,
        recordsClonePath: clone,
        publishRemote: "origin",
        push: null,
      }),
    );
    expect(result.records).toBe("unavailable");
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain("records unavailable");
    expect(messagesOf(result)).toEqual([["one"]]);
  });

  it("puts an undecodable recorded file in unreadable", async () => {
    await record("{ not json");
    await record(codeReviewText(["good"]));
    const result = await read(null);
    expect(result.unreadable).toHaveLength(1);
    expect(result.unreadable[0]?.where).toContain(`${RUN_ID}/code-review/code-review.json`);
    expect(messagesOf(result)).toEqual([["good"]]);
  });

  it("reports an unresolved target as unavailable", () => {
    expect(reviewSourceOf({ kind: "unresolved", reason: "no worktree" })).toEqual({
      kind: "unavailable",
      reason: "no worktree",
    });
  });
});
