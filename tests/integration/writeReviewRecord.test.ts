import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Either, Layer } from "effect";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { RECORDS_BRANCH_NAME } from "../../src/app/recordPlumbing.js";
import {
  reviewRecordKey,
  reviewRecordPushWarning,
  reviewRecordWarning,
  writeReviewRecord,
  type ReviewRecordStatus,
  type WriteReviewRecordInput,
} from "../../src/app/writeReviewRecord.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import {
  REVIEW_RECORD_FILES,
  decodeReviewRecordManifestFile,
  type ReviewRecordKind,
} from "../../src/schemas/reviewRecord.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Real-git acceptance for a review entry (spec headless-code-review §5.24,
// §5.25, §5.26): the review's file and a manifest under `<runId>/<review>/`,
// one shape for both reviews, a write that never fails its caller.

const fakeGitHub = makeFakeGitHub();
const LAYER = Layer.mergeAll(NodeFileSystemLayer, NodeGitLayer, fakeGitHub.layer);

const RUN_ID = "2610270900-example";

function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

function inRepoConfig(transcript = false): ResolvedRecordsConfig {
  return { enabled: true, transcript, destination: { kind: "in-repo" }, autoPush: false };
}

const COMPLIANCE_FILE = '{\n  "$schema": "https://example.test/x",\n  "verdict": "conformant"\n}\n';
const CODE_FILE = '{\n  "findings": [],\n  "note": "naïve — ünïcode ✓"\n}\n';

function written(status: ReviewRecordStatus) {
  if (status.kind !== "written") throw new Error(`expected written, got ${status.kind}`);
  return status;
}

describe("writeReviewRecord (real git)", () => {
  let restoreGit: () => void;
  let repoDir: string;
  let runPath: string;

  beforeEach(async () => {
    restoreGit = isolateGit();
    repoDir = mkdtempSync(join(tmpdir(), "phax-review-record-repo-"));
    git(["init"], repoDir);
    disableGitAutoMaintenance(repoDir);
    git(["config", "--local", "user.email", "test@phax.test"], repoDir);
    git(["config", "--local", "user.name", "phax test"], repoDir);
    await writeFile(join(repoDir, "README.md"), "# test\n");
    git(["add", "."], repoDir);
    git(["commit", "-m", "chore: initial commit"], repoDir);
    runPath = mkdtempSync(join(tmpdir(), "phax-review-record-run-"));
    fakeGitHub.impl.setVisibility("private");
  });

  afterEach(() => {
    removeTempDir(repoDir);
    removeTempDir(runPath);
    restoreGit();
  });

  function input(
    review: ReviewRecordKind,
    overrides: Partial<WriteReviewRecordInput> = {},
  ): WriteReviewRecordInput {
    return {
      repoRoot: repoDir,
      records: inRepoConfig(),
      runId: RUN_ID,
      runPath,
      review,
      ...overrides,
    };
  }

  function write(review: ReviewRecordKind, overrides: Partial<WriteReviewRecordInput> = {}) {
    return Effect.runPromise(Effect.provide(writeReviewRecord(input(review, overrides)), LAYER));
  }

  async function seed(review: ReviewRecordKind, text: string): Promise<void> {
    await writeFile(join(runPath, REVIEW_RECORD_FILES[review]), text);
  }

  /** Every commit of the records branch, oldest first. */
  function recordCommits(): readonly string[] {
    const out = git(["rev-list", "--reverse", RECORDS_BRANCH_NAME], repoDir).trim();
    return out === "" ? [] : out.split("\n");
  }

  function treeOf(commit: string): readonly string[] {
    return git(["ls-tree", "-r", "--name-only", commit], repoDir).trim().split("\n");
  }

  it("commits the review's file byte for byte and a manifest, leaving the working tree and index alone", async () => {
    await seed("compliance-review", COMPLIANCE_FILE);
    const statusBefore = git(["status", "--porcelain"], repoDir);
    const headBefore = git(["rev-parse", "HEAD"], repoDir);

    const status = written(await write("compliance-review"));

    const key = `${RUN_ID}/compliance-review`;
    expect(status.key).toBe(key);
    expect(reviewRecordKey(RUN_ID, "compliance-review")).toBe(key);
    expect(status.branch).toBe(RECORDS_BRANCH_NAME);
    expect(status.fileCount).toBe(2);
    expect(recordCommits()).toEqual([status.commitSha]);
    expect(treeOf(status.commitSha)).toEqual([
      `${key}/compliance-review.json`,
      `${key}/record.json`,
    ]);

    // byte-identical to the run folder's file
    const committed = execFileSync(
      "git",
      ["show", `${status.commitSha}:${key}/compliance-review.json`],
      {
        cwd: repoDir,
      },
    );
    expect(committed.equals(await readFile(join(runPath, "compliance-review.json")))).toBe(true);
    expect(committed.toString("utf8")).toBe(COMPLIANCE_FILE);

    const manifest = JSON.parse(
      git(["show", `${status.commitSha}:${key}/record.json`], repoDir),
    ) as {
      readonly $schema: string;
    };
    expect(Object.keys(manifest)).toEqual(["$schema", "kind", "runId", "review"]);
    expect(manifest).toEqual({
      $schema: currentSchemaUrl("review-record-manifest"),
      kind: "review",
      runId: RUN_ID,
      review: "compliance-review",
    });
    expect(Either.isRight(decodeReviewRecordManifestFile(manifest))).toBe(true);

    expect(git(["log", "-1", "--format=%B", status.commitSha], repoDir).trim()).toBe(
      [
        "records(review): compliance-review",
        "",
        `Run-Id: ${RUN_ID}`,
        "Review: compliance-review",
      ].join("\n"),
    );

    expect(git(["status", "--porcelain"], repoDir)).toBe(statusBefore);
    expect(git(["diff", "--cached", "--name-only"], repoDir)).toBe("");
    expect(git(["rev-parse", "HEAD"], repoDir)).toBe(headBefore);
  });

  it("sits under the run's key prefix, beside its phase record across the branch's commits", async () => {
    await seed("compliance-review", COMPLIANCE_FILE);
    // A phase record is another commit on the branch under `<runId>/phase-01/`.
    const phaseKey = `${RUN_ID}/phase-01`;
    const phaseFolder = mkdtempSync(join(tmpdir(), "phax-review-record-phase-"));
    try {
      await mkdir(join(phaseFolder, "x"), { recursive: true });
      await writeFile(join(phaseFolder, "prompt.md"), "# prompt\n");
      const { commitRecordTree } = await import("../../src/app/recordPlumbing.js");
      await Effect.runPromise(
        Effect.provide(
          commitRecordTree({
            repo: repoDir,
            folder: phaseFolder,
            key: phaseKey,
            artifactPaths: ["prompt.md"],
            manifest: { kind: "phase" },
            message: `records(phase-01): committed\n\nRun-Id: ${RUN_ID}\nPhase-Id: phase-01`,
          }),
          LAYER,
        ),
      );
      const status = written(await write("compliance-review"));

      const prefixes = recordCommits().flatMap((commit) =>
        treeOf(commit).map((path) => path.split("/").slice(0, 2).join("/")),
      );
      expect(new Set(prefixes)).toEqual(new Set([phaseKey, status.key]));
      expect(
        recordCommits().every((commit) => treeOf(commit).every((p) => p.startsWith(`${RUN_ID}/`))),
      ).toBe(true);
    } finally {
      removeTempDir(phaseFolder);
    }
  });

  it("a second entry for the same run and review replaces the file at the key, and the first stays in history", async () => {
    await seed("compliance-review", COMPLIANCE_FILE);
    const first = written(await write("compliance-review"));
    const rerun = '{\n  "verdict": "deviations"\n}\n';
    await seed("compliance-review", rerun);
    const second = written(await write("compliance-review"));

    expect(second.key).toBe(first.key);
    expect(second.commitSha).not.toBe(first.commitSha);
    expect(recordCommits()).toEqual([first.commitSha, second.commitSha]);
    const path = `${first.key}/compliance-review.json`;
    expect(git(["show", `${first.commitSha}:${path}`], repoDir)).toBe(COMPLIANCE_FILE);
    expect(git(["show", `${second.commitSha}:${path}`], repoDir)).toBe(rerun);
    expect(git(["show", `${RECORDS_BRANCH_NAME}:${path}`], repoDir)).toBe(rerun);
  });

  it("gives a compliance-review entry and a code-review entry the same layout and manifest keys", async () => {
    await seed("compliance-review", COMPLIANCE_FILE);
    await seed("code-review", CODE_FILE);
    const compliance = written(await write("compliance-review"));
    const code = written(await write("code-review"));

    const shapeOf = (status: typeof compliance, review: ReviewRecordKind) => {
      const names = treeOf(status.commitSha).map((path) => path.slice(status.key.length + 1));
      const manifest = JSON.parse(
        git(["show", `${status.commitSha}:${status.key}/record.json`], repoDir),
      ) as Record<string, unknown>;
      return {
        names: names.map((name) => (name === REVIEW_RECORD_FILES[review] ? "<review file>" : name)),
        keys: Object.keys(manifest),
        manifest,
        fileCount: status.fileCount,
        message: git(["log", "-1", "--format=%B", status.commitSha], repoDir).replaceAll(
          review,
          "<review>",
        ),
      };
    };
    const a = shapeOf(compliance, "compliance-review");
    const b = shapeOf(code, "code-review");

    expect(a.names).toEqual(b.names);
    expect(a.keys).toEqual(b.keys);
    expect(a.fileCount).toBe(b.fileCount);
    expect(a.message).toBe(b.message);
    expect(a.manifest).toEqual({ ...b.manifest, review: "compliance-review" });
    expect(treeOf(code.commitSha)).toContain(`${RUN_ID}/code-review/code-review.json`);
    expect(git(["show", `${code.commitSha}:${code.key}/code-review.json`], repoDir)).toBe(
      CODE_FILE,
    );
  });

  it("returns write-failed, never raises, when the review's file is missing", async () => {
    const status = await write("compliance-review");

    expect(status.kind).toBe("write-failed");
    expect(git(["branch", "--list", RECORDS_BRANCH_NAME], repoDir).trim()).toBe("");
  });

  it("records off writes nothing", async () => {
    await seed("compliance-review", COMPLIANCE_FILE);

    const status = await write("compliance-review", {
      records: {
        enabled: false,
        transcript: false,
        destination: { kind: "in-repo" },
        autoPush: false,
      },
    });

    expect(status).toEqual({ kind: "records-off" });
    expect(
      reviewRecordWarning(status, "compliance-review", "phax review-compliance example-run"),
    ).toBeUndefined();
    expect(git(["branch", "--list", RECORDS_BRANCH_NAME], repoDir).trim()).toBe("");
  });

  it("returns a refused destination, never raises, and leaves the branch unchanged", async () => {
    await seed("compliance-review", COMPLIANCE_FILE);
    fakeGitHub.impl.setVisibility("public");

    const status = await write("compliance-review", { records: inRepoConfig(true) });

    expect(status.kind).toBe("refused");
    expect(
      reviewRecordWarning(status, "compliance-review", "phax review-compliance example-run"),
    ).toMatch(/^compliance-review entry refused: .+ \(remedy: .+\)$/);
    expect(git(["branch", "--list", RECORDS_BRANCH_NAME], repoDir).trim()).toBe("");
  });

  it("returns a deferred destination when the dedicated records clone is not configured", async () => {
    await seed("compliance-review", COMPLIANCE_FILE);

    const status = await write("compliance-review", {
      records: {
        enabled: true,
        transcript: false,
        destination: { kind: "repo", remote: "https://example.com/records.git" },
        autoPush: false,
      },
    });

    expect(status).toEqual({ kind: "deferred-destination", destination: "repo" });
    expect(
      reviewRecordWarning(status, "compliance-review", "phax review-compliance example-run"),
    ).toBe(
      "compliance-review entry not written — the dedicated records clone is missing: run `phax records sync`, then `phax review-compliance example-run` to record a new review",
    );
    expect(git(["branch", "--list", RECORDS_BRANCH_NAME], repoDir).trim()).toBe("");
  });

  it("returns a deferred destination, not a failure, when the dedicated records clone does not exist yet", async () => {
    await seed("compliance-review", COMPLIANCE_FILE);
    const missingClone = join(repoDir, "no-records-clone-here");

    const status = await write("compliance-review", {
      recordsClonePath: missingClone,
      records: {
        enabled: true,
        transcript: false,
        destination: { kind: "repo", remote: "https://example.com/records.git" },
        autoPush: false,
      },
    });

    expect(status).toEqual({ kind: "deferred-destination", destination: "repo" });
    expect(
      reviewRecordWarning(status, "compliance-review", "phax review-compliance example-run"),
    ).toContain("run `phax records sync`, then `phax review-compliance example-run`");
    expect(git(["branch", "--list", RECORDS_BRANCH_NAME], repoDir).trim()).toBe("");
  });
});

describe("writeReviewRecord when the records commit fails", () => {
  it("returns write-failed and never raises, the run folder's file is untouched, and the warning names the pending entry", async () => {
    const fs = makeFakeFileSystem();
    const fakeGit = makeFakeGit();
    const github = makeFakeGitHub();
    fs.impl.setFile("/runs/example/compliance-review.json", COMPLIANCE_FILE);
    fakeGit.impl.failNextWriteTreeCommit(
      "fatal: unable to write the object\nhint: a second line git adds\n",
    );

    const status = await Effect.runPromise(
      Effect.provide(
        writeReviewRecord({
          repoRoot: "/repo",
          records: inRepoConfig(),
          runId: RUN_ID,
          runPath: "/runs/example",
          review: "compliance-review",
        }),
        Layer.mergeAll(fs.layer, fakeGit.layer, github.layer),
      ),
    );

    expect(status.kind).toBe("write-failed");
    expect(fakeGit.impl.calls.filter((call) => call.method === "writeTreeCommit")).toHaveLength(1);
    expect(fakeGit.impl.fakeCommits.size).toBe(0);
    expect(fs.impl.files.get("/runs/example/compliance-review.json")).toBe(COMPLIANCE_FILE);

    const warning = reviewRecordWarning(
      status,
      "compliance-review",
      "phax review-compliance example-run",
    );
    expect(warning).toContain("the compliance-review entry was not committed to phax/records/v1");
    expect(warning).toContain("(fatal: unable to write the object)");
    expect(warning).not.toContain("hint:");
    expect(warning).toContain("pending");
    expect(warning).toContain("compliance-review.json stays in the run folder");
    expect(warning).toContain("rerun `phax review-compliance example-run`");
    expect(warning).not.toContain("phax records status");
  });
});

describe("reviewRecordPushWarning", () => {
  it("says something only for a failed push, which stays pending and lists it in records status", () => {
    expect(reviewRecordPushWarning({ kind: "no-record" })).toBeUndefined();
    expect(reviewRecordPushWarning({ kind: "left-to-publish" })).toBeUndefined();
    expect(reviewRecordPushWarning({ kind: "not-configured" })).toBeUndefined();
    const warning = reviewRecordPushWarning({
      kind: "failed",
      remote: "origin",
      path: "/repo",
      message: "rejected",
    });
    expect(warning).toBe(
      `review entry not pushed to origin (rejected) — it stays pending (\`phax records status\` lists it); share it with \`git -C /repo push origin ${RECORDS_BRANCH_NAME}\``,
    );
  });

  it("keeps one line of git's push output, skipping its `To <remote>` preamble", () => {
    const warning = reviewRecordPushWarning({
      kind: "failed",
      remote: "origin",
      path: "/repo",
      message:
        "To ../remote.git\n ! [remote rejected] phax/records/v1 -> phax/records/v1 (pre-receive hook declined)\nerror: failed to push some refs to '../remote.git'\n",
    });
    expect(warning).toContain(
      "(! [remote rejected] phax/records/v1 -> phax/records/v1 (pre-receive hook declined))",
    );
    expect(warning).not.toContain("To ../remote.git");
    expect(warning).not.toContain("error: failed to push");
  });
});
