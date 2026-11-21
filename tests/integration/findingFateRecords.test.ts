// Fate records on phax/records/v1: one commit per record, keyed `<runId>/finding/<id>/<NN>`,
// read back oldest first. Real git in a temporary repository, records in-repo.
import { Effect, Layer } from "effect";
import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fateRecordDestination,
  fateRecordKey,
  FindingRecordsOffError,
  FindingRecordsUnavailableError,
  readRunFateRecords,
  writeFateRecord,
} from "../../src/app/findingFateRecords.js";
import type { ReviewRecordTarget } from "../../src/app/reviewEntry.js";
import { listRecords } from "../../src/app/recordsList.js";
import { writeReviewRecord } from "../../src/app/writeReviewRecord.js";
import type { RunReviewSource } from "../../src/app/runReviews.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import type { FindingFateEntry } from "../../src/schemas/findingFateRecord.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import { writeFileSync } from "node:fs";

const RUN_ID = "2610270900-by-hand";
const AT = "2026-11-01T10:00:00.000Z";
const OPERATOR = { kind: "operator", name: "Ada" } as const;

const RECORDS: ResolvedRecordsConfig = {
  enabled: true,
  transcript: false,
  destination: { kind: "in-repo" },
  autoPush: false,
};

const fixed = (sha: string): FindingFateEntry => ({
  fate: "fixed",
  commit: sha.repeat(40),
  pathClasses: ["code", "tests"],
  by: OPERATOR,
  at: AT,
});

const deferred: FindingFateEntry = {
  fate: "deferred",
  to: "docs/next.md",
  why: "Later.",
  by: OPERATOR,
  at: AT,
};

function runGit(args: readonly string[], cwd: string): string {
  return boundedOutput("git", [...args], { cwd, boundMs: GIT_BOUND_MS });
}

describe("fate records on the records branch (real git)", () => {
  let restoreGit: () => void;
  let repoDir: string;
  const fakeGitHub = makeFakeGitHub();
  const layers = Layer.mergeAll(
    NodeFileSystemLayer,
    NodeGitLayer,
    NodeShellLayer,
    fakeGitHub.layer,
  );
  const destination = () => ({ repo: repoDir, remote: "origin" });
  const source = (): RunReviewSource => ({
    kind: "repo",
    path: repoDir,
    remoteRef: "refs/remotes/origin/phax/records/v1",
  });

  beforeEach(() => {
    restoreGit = isolateGit();
    repoDir = mkdtempSync(join(tmpdir(), "phax-fate-records-"));
    runGit(["init"], repoDir);
    disableGitAutoMaintenance(repoDir);
    runGit(["config", "--local", "user.email", "test@phax.test"], repoDir);
    runGit(["config", "--local", "user.name", "phax test"], repoDir);
    runGit(["commit", "--allow-empty", "-m", "chore: initial commit"], repoDir);
  });

  afterEach(() => {
    removeTempDir(repoDir);
    restoreGit();
  });

  const write = (finding: string, entry: FindingFateEntry) =>
    Effect.runPromise(
      writeFateRecord({ destination: destination(), runId: RUN_ID, finding, entry }).pipe(
        Effect.provide(layers),
      ),
    );

  it("keys records per finding with two digits, one commit each holding only its record.json", async () => {
    expect(fateRecordKey("r", "F3", 1)).toBe("r/finding/F3/01");
    expect(fateRecordKey("r", "F3", 100)).toBe("r/finding/F3/100");

    const first = await write("F3", fixed("a"));
    const second = await write("F3", deferred);
    const third = await write("F1", fixed("b"));
    expect([first.key, second.key, third.key]).toEqual([
      `${RUN_ID}/finding/F3/01`,
      `${RUN_ID}/finding/F3/02`,
      `${RUN_ID}/finding/F1/01`,
    ]);

    for (const [written, finding, fate] of [
      [first, "F3", "fixed"],
      [second, "F3", "deferred"],
      [third, "F1", "fixed"],
    ] as const) {
      const files = runGit(["ls-tree", "-r", "--name-only", written.recordCommit], repoDir).trim();
      expect(files).toBe(`${written.key}/record.json`);
      const message = runGit(["log", "-1", "--format=%B", written.recordCommit], repoDir);
      expect(message.split("\n")[0]).toBe(`records(finding): ${finding} ${fate}`);
      expect(message).toContain(`Run-Id: ${RUN_ID}`);
      expect(message).toContain(`Finding: ${finding}`);
      expect(message).toContain(`Fate: ${fate}`);
    }
    expect(runGit(["rev-list", "--count", "phax/records/v1"], repoDir).trim()).toBe("3");
    const blob = JSON.parse(
      runGit(["show", `${first.recordCommit}:${first.key}/record.json`], repoDir),
    ) as Record<string, unknown>;
    expect(blob["$schema"]).toBe(currentSchemaUrl("finding-fate-record-manifest"));
    expect(blob).toMatchObject({ kind: "finding-fate", runId: RUN_ID, finding: "F3" });
  });

  it("reads the records oldest first with their entries", async () => {
    const a = fixed("a");
    const b = fixed("b");
    await write("F3", a);
    await write("F3", deferred);
    await write("F1", b);
    const read = await Effect.runPromise(
      readRunFateRecords({ runId: RUN_ID, source: source() }).pipe(Effect.provide(layers)),
    );
    expect(read.unreadable).toEqual([]);
    expect(read.notes).toEqual([]);
    expect(read.records.map((r) => [r.key, r.entry])).toEqual([
      [`${RUN_ID}/finding/F3/01`, a],
      [`${RUN_ID}/finding/F3/02`, deferred],
      [`${RUN_ID}/finding/F1/01`, b],
    ]);
    const other = await Effect.runPromise(
      readRunFateRecords({ runId: "another", source: source() }).pipe(Effect.provide(layers)),
    );
    expect(other.records).toEqual([]);
    const off = await Effect.runPromise(
      readRunFateRecords({ runId: RUN_ID, source: { kind: "off" } }).pipe(Effect.provide(layers)),
    );
    expect(off.records).toEqual([]);
  });

  it("refuses records off, a missing records clone and an unresolved target", async () => {
    const project = (over: Partial<ReviewRecordTarget>): ReviewRecordTarget => ({
      kind: "project",
      records: RECORDS,
      repoRoot: repoDir,
      publishRemote: "origin",
      push: null,
      ...over,
    });
    const destinationOf = (target: Parameters<typeof fateRecordDestination>[0]) =>
      Effect.runPromise(fateRecordDestination(target).pipe(Effect.provide(layers), Effect.flip));

    const off = await destinationOf(project({ records: { ...RECORDS, enabled: false } }));
    expect(off).toBeInstanceOf(FindingRecordsOffError);
    expect(off.message).toContain("records key");

    const missing = join(repoDir, "no-such-clone");
    for (const recordsClonePath of [undefined, missing]) {
      const error = await destinationOf(
        project({
          records: {
            ...RECORDS,
            destination: { kind: "repo", remote: "git@example.com:x/y.git" } as never,
          },
          recordsClonePath,
        }),
      );
      expect(error).toBeInstanceOf(FindingRecordsUnavailableError);
      expect(error.message).toContain("phax records sync");
    }

    const unresolved = await destinationOf({ kind: "unresolved", reason: "the project is gone" });
    expect(unresolved).toBeInstanceOf(FindingRecordsUnavailableError);
    expect(unresolved.message).toBe("the project is gone");

    const ok = await Effect.runPromise(
      fateRecordDestination(project({})).pipe(Effect.provide(layers)),
    );
    expect(ok).toEqual({ repo: repoDir, remote: "origin" });
  });

  it("leaves listRecords answering the run's review records beside fate records", async () => {
    const runFolder = join(repoDir, "run-folder");
    mkdirSync(runFolder);
    writeFileSync(
      join(runFolder, "code-review.json"),
      JSON.stringify({ $schema: currentSchemaUrl("code-review"), findings: [] }),
    );
    await Effect.runPromise(
      writeReviewRecord({
        repoRoot: repoDir,
        records: RECORDS,
        publishRemote: "origin",
        runId: RUN_ID,
        runPath: runFolder,
        review: "code-review",
      }).pipe(Effect.provide(layers)),
    );
    await write("F1", fixed("a"));
    const listed = await Effect.runPromise(
      listRecords({
        records: RECORDS,
        repoRoot: repoDir,
        publishRemote: "origin",
        runId: RUN_ID,
      }).pipe(Effect.provide(layers)),
    );
    expect(listed.kind).toBe("listed");
    if (listed.kind !== "listed") return;
    expect(listed.records.map((r) => r.kind)).toEqual(["review"]);
  });
});
