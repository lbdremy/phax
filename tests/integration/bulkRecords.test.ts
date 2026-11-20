import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitRecordTree } from "../../src/app/recordPlumbing.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { BRANCH_REF, git, withGitTrace } from "../fixtures/records/branchTipRepos.js";
import {
  SEED_ARTIFACT_NAME,
  SEED_ARTIFACT_TEXT,
  seedRecordManifest,
  seedRecordMessage,
  writeRecordsInBulk,
  type BulkRecord,
} from "../fixtures/records/bulkRecords.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// The bulk record write (one `git fast-import`) against phax's own `commitRecordTree`: the same
// records give the same commits, byte for byte, hence the same ids. Real git, git isolated.

const LAYER = Layer.mergeAll(NodeFileSystemLayer, NodeGitLayer);
const IDENTITY = { name: "Rita Recorder", email: "rita@records.test" } as const;
const IDENTITY_VARIABLES = [
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
] as const;

let restoreGit: () => void;
let base: string;
let artifactFolder: string;
let savedIdentity: readonly (readonly [string, string | undefined])[];

beforeEach(() => {
  restoreGit = isolateGit();
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-bulk-records-test-")));
  artifactFolder = join(base, "artifacts");
  mkdirSync(artifactFolder);
  writeFileSync(join(artifactFolder, SEED_ARTIFACT_NAME), SEED_ARTIFACT_TEXT);
  savedIdentity = IDENTITY_VARIABLES.map((name) => [name, process.env[name]] as const);
  process.env["GIT_AUTHOR_NAME"] = process.env["GIT_COMMITTER_NAME"] = IDENTITY.name;
  process.env["GIT_AUTHOR_EMAIL"] = process.env["GIT_COMMITTER_EMAIL"] = IDENTITY.email;
});

afterEach(() => {
  for (const [name, value] of savedIdentity) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  removeTempDir(base);
  restoreGit();
});

/** A repository with the identity in its local config and an `origin` that is never fetched. */
function initRepo(name: string): string {
  const dir = join(base, name);
  git(["init", "-q", "-b", "main", dir], tmpdir());
  disableGitAutoMaintenance(dir);
  git(["config", "--local", "user.name", IDENTITY.name], dir);
  git(["config", "--local", "user.email", IDENTITY.email], dir);
  git(["remote", "add", "origin", `ssh://records.test${join(base, "nowhere.git")}`], dir);
  return dir;
}

/** `count` records over several keys and both origins, one second apart from the second given. */
function recordsOf(count: number, firstSecond = 1): readonly BulkRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `run-${String(Math.floor(i / 3) + 1).padStart(4, "0")}/phase-0${(i % 3) + 1}`,
    origin: i % 2 === 0 ? "upstream" : "local",
    date: new Date(Date.UTC(2026, 0, 1, 0, 0, firstSecond + i)),
  }));
}

/** One `commitRecordTree` call, run as the world builder runs it; answers the commit. */
async function commitThroughPlumbing(repo: string, record: BulkRecord): Promise<string> {
  const date = record.date.toISOString();
  const saved = [process.env["GIT_AUTHOR_DATE"], process.env["GIT_COMMITTER_DATE"]] as const;
  process.env["GIT_AUTHOR_DATE"] = date;
  process.env["GIT_COMMITTER_DATE"] = date;
  try {
    const { commitSha } = await Effect.runPromise(
      Effect.provide(
        commitRecordTree({
          repo,
          remote: "origin",
          folder: artifactFolder,
          key: record.key,
          artifactPaths: [SEED_ARTIFACT_NAME],
          manifest: seedRecordManifest(record.key, record.origin),
          message: seedRecordMessage(record.key, record.origin),
        }),
        LAYER,
      ),
    );
    return commitSha;
  } finally {
    for (const [name, value] of [
      ["GIT_AUTHOR_DATE", saved[0]],
      ["GIT_COMMITTER_DATE", saved[1]],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function throughPlumbing(repo: string, records: readonly BulkRecord[]): Promise<string[]> {
  const commits: string[] = [];
  for (const record of records) commits.push(await commitThroughPlumbing(repo, record));
  return commits;
}

function commitList(repo: string): string[] {
  return git(["rev-list", "--reverse", BRANCH_REF], repo).split("\n");
}

describe("the bulk record write", () => {
  it("writes the same records branch as one commitRecordTree call per record (ac-bulk-equal)", async () => {
    const bulk = initRepo("bulk");
    const plumbing = initRepo("plumbing");
    const records = recordsOf(7);

    const bulkCommits = await writeRecordsInBulk({
      repo: bulk,
      parent: null,
      identity: IDENTITY,
      records,
    });
    const plumbingCommits = await throughPlumbing(plumbing, records);

    expect(git(["rev-parse", BRANCH_REF], bulk)).toBe(git(["rev-parse", BRANCH_REF], plumbing));
    expect(commitList(bulk)).toEqual(commitList(plumbing));
    expect(bulkCommits).toEqual(plumbingCommits);
    expect(commitList(bulk)).toEqual(bulkCommits);
    // The commit body is not only equal by id: each commit holds its own record and nothing else.
    expect(
      bulkCommits.map((commit) => git(["ls-tree", "-r", "--name-only", commit], bulk).split("\n")),
    ).toEqual(
      records.map((record) => [`${record.key}/${SEED_ARTIFACT_NAME}`, `${record.key}/record.json`]),
    );
  });

  it("agrees with commitRecordTree for a single record", async () => {
    const bulk = initRepo("bulk");
    const plumbing = initRepo("plumbing");
    const records = recordsOf(1);

    await writeRecordsInBulk({ repo: bulk, parent: null, identity: IDENTITY, records });
    await throughPlumbing(plumbing, records);

    expect(git(["rev-parse", BRANCH_REF], bulk)).toBe(git(["rev-parse", BRANCH_REF], plumbing));
  });

  it("agrees with commitRecordTree on top of a given parent", async () => {
    const bulk = initRepo("bulk");
    const plumbing = initRepo("plumbing");
    const records = recordsOf(5);
    const firstRecord = records.slice(0, 1);
    const rest = records.slice(1);

    const bulkParent = (await throughPlumbing(bulk, firstRecord)).join("");
    await throughPlumbing(plumbing, firstRecord);
    const bulkRest = await writeRecordsInBulk({
      repo: bulk,
      parent: bulkParent,
      identity: IDENTITY,
      records: rest,
    });
    await throughPlumbing(plumbing, rest);

    expect(git(["rev-parse", BRANCH_REF], bulk)).toBe(git(["rev-parse", BRANCH_REF], plumbing));
    expect(commitList(bulk)).toEqual(commitList(plumbing));
    expect(bulkRest).toEqual(commitList(plumbing).slice(1));
    expect(commitList(bulk)).toEqual([bulkParent, ...bulkRest]);
  });

  it("writes into a bare repository", async () => {
    const bare = join(base, "bare.git");
    git(["init", "-q", "--bare", "-b", "main", bare], tmpdir());
    disableGitAutoMaintenance(bare);
    const plumbing = initRepo("plumbing");
    const records = recordsOf(3);

    await writeRecordsInBulk({ repo: bare, parent: null, identity: IDENTITY, records });
    await throughPlumbing(plumbing, records);

    expect(git(["rev-parse", BRANCH_REF], bare)).toBe(git(["rev-parse", BRANCH_REF], plumbing));
  });

  it("starts no git process and writes no ref for zero records", async () => {
    const repo = initRepo("bulk");

    const { value, commands } = await withGitTrace(() =>
      writeRecordsInBulk({ repo, parent: null, identity: IDENTITY, records: [] }),
    );

    expect(value).toEqual([]);
    expect(commands).toEqual([]);
    expect(() => git(["rev-parse", "--verify", "--quiet", BRANCH_REF], repo)).toThrow();
    expect(git(["for-each-ref", "refs/heads/"], repo)).toBe("");
  });

  it("writes 300 records with one git process", async () => {
    const repo = initRepo("bulk");

    const { value, commands } = await withGitTrace(() =>
      writeRecordsInBulk({ repo, parent: null, identity: IDENTITY, records: recordsOf(300) }),
    );

    expect(value).toHaveLength(300);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("fast-import");
    expect(git(["rev-list", "--count", BRANCH_REF], repo)).toBe("300");
    expect(git(["rev-parse", BRANCH_REF], repo)).toBe(value[299]);
  });
});
