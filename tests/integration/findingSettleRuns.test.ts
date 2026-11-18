import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findingGroup } from "../../src/cli/definitions/finding.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";
import {
  buildFateRunRepo,
  type FateRunRepo,
  findingListJson,
  head,
} from "../fixtures/findings/fateRunRepo.js";
import { reviewOnce, writeCurrentReviews } from "../fixtures/findings/findingRunRepo.js";
import { runnerCall } from "../helpers/runnerCall.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// `phax finding dismiss` and `defer` over runs and calls the acceptance tests do not reach: an
// archived run, a compliance finding, a pointer given from a subdirectory, and refusals that come
// before any record. The fixtures are imported and never edited.

const RECORDS_BRANCH = "phax/records/v1";
const NAMESPACE = "findings-test";

function git(repo: FateRunRepo, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: repo.repoDir, encoding: "utf8", stdio: "pipe" });
}

describe("phax finding dismiss and defer: runs and refusals", () => {
  let repo: FateRunRepo;
  let origCwd: string;

  beforeEach(() => {
    repo = buildFateRunRepo();
    origCwd = process.cwd();
    process.chdir(repo.repoDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    repo.cleanup();
  });

  const dismiss = (argv: readonly string[]) =>
    runnerCall([findingGroup], ["finding", "dismiss", repo.shortName, ...argv]);
  const defer = (argv: readonly string[]) =>
    runnerCall([findingGroup], ["finding", "defer", repo.shortName, ...argv]);
  const recordText = (id: string) =>
    JSON.parse(
      git(repo, ["show", `${RECORDS_BRANCH}:${repo.runId}/finding/${id}/01/record.json`]),
    ) as { verdict?: { advocate: string }; to?: string };

  it("dismisses a finding of an archived run and lists it dismissed", async () => {
    await reviewOnce(repo, ["first finding"]);
    const archivePath = join(repo.stateRoot, "archive", `${NAMESPACE}.${repo.shortName}`);
    mkdirSync(archivePath, { recursive: true });
    renameSync(repo.runFolder, join(archivePath, "runs"));
    const now = "2026-11-01T12:00:00.000Z";
    mkdirSync(dirname(join(repo.stateRoot, "registry.json")), { recursive: true });
    writeFileSync(
      join(repo.stateRoot, "registry.json"),
      JSON.stringify(
        withSchemaUrl("registry", {
          runs: [
            {
              namespace: NAMESPACE,
              shortName: repo.shortName,
              runId: repo.runId,
              state: "archived",
              branch: `feature/${repo.shortName}`,
              projectName: NAMESPACE,
              phasesCount: 1,
              createdAt: now,
              updatedAt: now,
              archivePath,
            },
          ],
        }),
      ),
    );

    const result = await dismiss(["F1", "--by", "operator", "--why", "obsolete"]);
    expect(result.code).toBe(0);

    const { document } = await findingListJson(repo);
    expect(document.run.state).toBe("archived");
    expect(document.findings.map((f) => [f.id, f.fate])).toEqual([["F1", "dismissed"]]);
  });

  it("advocates a compliance finding's dismissal with its message", async () => {
    writeCurrentReviews(repo);

    const result = await dismiss(["C1", "--by", "operator", "--why", "covered elsewhere"]);
    expect(result.code).toBe(0);
    expect(recordText("C1").verdict?.advocate).toBe("No test.");
  });

  it("records a pointer given from a subdirectory as the repository-relative path", async () => {
    await reviewOnce(repo, ["one"]);
    process.chdir(join(repo.repoDir, "docs"));

    const result = await defer([
      "F1",
      "--by",
      "operator",
      "--to",
      "briefs/gate-retry-docs.md",
      "--why",
      "later",
    ]);
    expect(result.code).toBe(0);
    expect(recordText("F1").to).toBe("docs/briefs/gate-retry-docs.md");
  });

  it("refuses an operand that is not a finding id, naming it, before any record", async () => {
    await reviewOnce(repo, ["one"]);
    const before = head(repo, RECORDS_BRANCH);

    const result = await dismiss(["F1", "src/app/gate.ts", "--by", "operator", "--why", "no"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("src/app/gate.ts");
    expect(head(repo, RECORDS_BRANCH)).toBe(before);
  });

  it("refuses a malformed --by with exit 1", async () => {
    await reviewOnce(repo, ["one"]);
    const before = head(repo, RECORDS_BRANCH);

    const result = await dismiss(["F1", "--by", "somebody", "--why", "no"]);
    expect(result.code).toBe(1);
    expect(head(repo, RECORDS_BRANCH)).toBe(before);
  });

  it("refuses every finding while one fate record is unreadable, naming its path, commit and remedy", async () => {
    await reviewOnce(repo, ["one", "two"]);
    expect((await dismiss(["F1", "--by", "operator", "--why", "obsolete"])).code).toBe(0);
    // A fate record this phax cannot read, as a later phax with a new fate would write it.
    const path = `${repo.runId}/finding/F1/02/record.json`;
    const text = JSON.stringify({ kind: "finding-fate", runId: repo.runId, finding: "F1" });
    const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: repo.repoDir,
      input: text,
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], {
      cwd: repo.repoDir,
      env: { ...process.env, GIT_INDEX_FILE: join(repo.repoDir, ".git", "fate-test-index") },
    });
    const tree = execFileSync("git", ["write-tree"], {
      cwd: repo.repoDir,
      encoding: "utf8",
      env: { ...process.env, GIT_INDEX_FILE: join(repo.repoDir, ".git", "fate-test-index") },
    }).trim();
    const tip = head(repo, RECORDS_BRANCH) ?? "";
    const commit = git(repo, [
      "commit-tree",
      tree,
      "-p",
      tip,
      "-m",
      "records(finding): F1 later",
    ]).trim();
    git(repo, ["update-ref", `refs/heads/${RECORDS_BRANCH}`, commit, tip]);

    const listed = await runnerCall([findingGroup], ["finding", "list", repo.shortName]);
    const result = await dismiss(["F2", "--by", "operator", "--why", "covered"]);

    for (const refused of [listed, result]) {
      expect(refused.code).toBe(1);
      expect(refused.err).toContain(`the fate record ${path} on ${RECORDS_BRANCH}`);
      expect(refused.err).toContain(`records commit ${commit.slice(0, 8)}`);
      expect(refused.err).toContain("if a later phax wrote it, upgrade phax");
    }
    expect(head(repo, RECORDS_BRANCH)).toBe(commit);
  });

  it("refuses a dedicated records destination whose clone is missing, naming phax records sync", async () => {
    await reviewOnce(repo, ["one"]);
    const file = join(repo.repoDir, "phax.json");
    const config = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    config["records"] = {
      transcript: false,
      destination: { kind: "repo", remote: "https://example.invalid/records.git" },
      autoPush: false,
    };
    writeFileSync(file, JSON.stringify(config, null, 2));
    const before = head(repo, RECORDS_BRANCH);

    const result = await dismiss(["F1", "--by", "operator", "--why", "no"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("phax records sync");
    expect(head(repo, RECORDS_BRANCH)).toBe(before);
  });
});
