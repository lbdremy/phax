// A run's reviews, read from the records branch (oldest first), then the
// unrecorded reviews kept in the run folder, then the run folder's file (only
// when it differs from the newest record of its kind). Real git in a temporary
// repository, records written by writeReviewRecord.
import { Effect, Layer } from "effect";
import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  keepUnrecordedReview,
  readRunReviews,
  reviewSourceOf,
  type RunReviewSource,
} from "../../src/app/runReviews.js";
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
  return boundedOutput("git", [...args], { boundMs: GIT_BOUND_MS, cwd });
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
    expect(result.notes).toEqual([]);
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

  it("with a records branch git cannot read, is unavailable with a note and reads the run folder", async () => {
    await writeFile(join(runFolder, "code-review.json"), codeReviewText(["one"]));
    // phax/records/v1 names an object the repository does not hold.
    mkdirSync(join(repoDir, ".git", "refs", "heads", "phax", "records"), { recursive: true });
    await writeFile(
      join(repoDir, ".git", "refs", "heads", "phax", "records", "v1"),
      `${"1234567890".repeat(4)}\n`,
    );
    const result = await read();
    expect(result.records).toBe("unavailable");
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatch(/^records unavailable \(.+\): reading the run folder alone$/);
    expect(messagesOf(result)).toEqual([["one"]]);
    expect(result.reviews[0]?.from).toBe("run-folder");
  });

  it("reads the kept unrecorded reviews oldest first, between the records and the run folder's file", async () => {
    await record(codeReviewText(["one"]));
    await writeFile(
      join(runFolder, "code-review.unrecorded-02.json"),
      codeReviewText(["three"], 3),
    );
    await writeFile(join(runFolder, "code-review.unrecorded-01.json"), codeReviewText(["two"], 2));
    await writeFile(join(runFolder, "code-review.json"), codeReviewText(["four"], 4));
    const result = await read();
    expect(messagesOf(result)).toEqual([["one"], ["two"], ["three"], ["four"]]);
    expect(result.reviews.map((r) => r.from)).toEqual([
      "records",
      "run-folder",
      "run-folder",
      "run-folder",
    ]);
  });

  it("reads a run folder file once when a kept review holds the same bytes", async () => {
    await record(codeReviewText(["one"]));
    await writeFile(join(runFolder, "code-review.unrecorded-01.json"), codeReviewText(["two"], 2));
    await writeFile(join(runFolder, "code-review.json"), codeReviewText(["two"], 2));
    const result = await read();
    expect(messagesOf(result)).toEqual([["one"], ["two"]]);
  });

  it("keeps an unrecorded run folder file under the next free number, and nothing else", async () => {
    await record(codeReviewText(["one"]));
    const keep = async () =>
      Effect.runPromise(
        keepUnrecordedReview({ runFolder, review: "code-review", read: await read() }).pipe(
          Effect.provide(layers),
        ),
      );
    const kept = () =>
      readdirSync(runFolder)
        .filter((n) => n.includes(".unrecorded-"))
        .toSorted();

    // Recorded: nothing to keep.
    expect(await keep()).toBeUndefined();
    expect(kept()).toEqual([]);

    // Unrecorded: kept as -01, byte for byte; a second call finds it already kept.
    const unrecorded = codeReviewText(["two"], 2);
    await writeFile(join(runFolder, "code-review.json"), unrecorded);
    expect(await keep()).toBeUndefined();
    expect(kept()).toEqual(["code-review.unrecorded-01.json"]);
    expect(await readFile(join(runFolder, "code-review.unrecorded-01.json"), "utf8")).toBe(
      unrecorded,
    );
    await keep();
    expect(kept()).toEqual(["code-review.unrecorded-01.json"]);

    // Another unrecorded review takes -02.
    await writeFile(join(runFolder, "code-review.json"), codeReviewText(["three"], 3));
    await keep();
    expect(kept()).toEqual(["code-review.unrecorded-01.json", "code-review.unrecorded-02.json"]);
  });

  it("keeps nothing with records off", async () => {
    await writeFile(join(runFolder, "code-review.json"), codeReviewText(["one"]));
    const off: RunReviewSource = { kind: "off" };
    const result = await read(runFolder, off);
    await Effect.runPromise(
      keepUnrecordedReview({ runFolder, review: "code-review", read: result }).pipe(
        Effect.provide(layers),
      ),
    );
    expect(readdirSync(runFolder)).toEqual(["code-review.json"]);
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
