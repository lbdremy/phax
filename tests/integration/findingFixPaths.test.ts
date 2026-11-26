import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findingGroup } from "../../src/cli/definitions/finding.js";
import {
  buildFateRunRepo,
  commitMessage,
  commitPaths,
  type FateRunRepo,
  findingListJson,
  head,
  setRunState,
  writeInWorktree,
} from "../fixtures/findings/fateRunRepo.js";
import { reviewOnce } from "../fixtures/findings/findingRunRepo.js";
import { runnerCall } from "../helpers/runnerCall.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// The paths and the --commit form of `phax finding fix`, over the fixture of the acceptance
// tests (tests/fixtures/findings/fateRunRepo.ts), imported and never edited. The run's branch is
// read as the worktree's own HEAD: the fixture's `runBranch` names a branch no worktree holds.

const RECORDS_BRANCH = "phax/records/v1";

function git(args: readonly string[], cwd: string): string {
  return boundedOutput("git", [...args], { cwd, boundMs: GIT_BOUND_MS }).trim();
}

describe("phax finding fix: paths and --commit", () => {
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

  const fix = (argv: readonly string[]) =>
    runnerCall([findingGroup], ["finding", "fix", repo.shortName, ...argv]);
  const runTip = () => git(["rev-parse", "HEAD"], repo.worktreePath);
  const recordCount = () => Number(git(["rev-list", "--count", RECORDS_BRANCH], repo.repoDir));
  const entryOf = async (id: string) => {
    const { document } = await findingListJson(repo);
    const finding = document.findings.find((f) => f.id === id);
    if (finding === undefined) throw new Error(`${id} is not listed`);
    return finding;
  };
  /** A commit in the worktree made by hand, as an operator would before backfilling it. */
  const commitByHand = (path: string, content: string): string => {
    writeInWorktree(repo, path, content);
    git(["add", "--", path], repo.worktreePath);
    git(["commit", "-q", "-m", "fix: by hand"], repo.worktreePath);
    return runTip();
  };

  it("resolves a relative path from a subdirectory of the worktree", async () => {
    await reviewOnce(repo, ["one", "two"]);
    writeInWorktree(repo, "src/app/gate.ts", "export const gate = 10;\n");
    // The fixture keeps phax.json in the main checkout only: a command run from inside the
    // worktree finds its configuration there, as it does in a project that commits phax.json.
    copyFileSync(join(repo.repoDir, "phax.json"), join(repo.worktreePath, "phax.json"));
    process.chdir(join(repo.worktreePath, "src", "app"));

    const result = await fix(["F1", "--by", "operator", "--", "gate.ts"]);

    expect(result.code).toBe(0);
    expect(commitPaths(repo, runTip())).toEqual(["src/app/gate.ts"]);
    expect((await entryOf("F1")).history[0]).toMatchObject({
      fate: "fixed",
      pathClasses: ["code"],
    });
  });

  it("refuses a path that leaves the worktree, committing and recording nothing", async () => {
    await reviewOnce(repo, ["one"]);
    writeInWorktree(repo, "src/app/gate.ts", "export const gate = 11;\n");
    const before = runTip();
    const records = recordCount();

    const result = await fix([
      "F1",
      "--by",
      "operator",
      "--",
      "src/app/gate.ts",
      "../../outside.txt",
    ]);

    expect(result.code).toBe(1);
    expect(result.err).toContain("✗ fix refused:");
    expect(result.err).toContain("../../outside.txt");
    expect(result.err).toContain("leaves the worktree");
    expect(runTip()).toBe(before);
    expect(recordCount()).toBe(records);
  });

  it("puts -m as the subject and --body before the trailers, which stay last", async () => {
    await reviewOnce(repo, ["one", "two"]);
    writeInWorktree(repo, "src/app/gate.ts", "export const gate = 12;\n");

    const result = await fix([
      "F2",
      "F1",
      "-m",
      "fix(gate): keep the exit code",
      "--body",
      "The failed step's code was dropped.",
      "--by",
      "operator",
      "--",
      "src/app/gate.ts",
    ]);

    expect(result.code).toBe(0);
    const lines = commitMessage(repo, runTip()).split("\n");
    expect(lines[0]).toBe("fix(gate): keep the exit code");
    expect(lines).toContain("The failed step's code was dropped.");
    expect(lines.slice(-4)).toEqual([
      `Short-Name: ${repo.shortName}`,
      `Finding-Run: ${repo.runId}`,
      "Finding: F2",
      "Finding: F1",
    ]);
    expect(lines.join("\n")).not.toContain("Run-Id");
  });

  it("refuses --commit with an unknown sha", async () => {
    await reviewOnce(repo, ["one"]);
    const records = recordCount();

    const result = await fix(["F1", "--commit", "deadbeef", "--by", "operator"]);

    expect(result.code).toBe(1);
    expect(result.err).toContain("deadbeef");
    expect(recordCount()).toBe(records);
  });

  it("refuses --commit with a commit on neither the run branch nor the base branch", async () => {
    await reviewOnce(repo, ["one"]);
    git(["switch", "-q", "-c", "side"], repo.repoDir);
    writeFileSync(join(repo.repoDir, "side.txt"), "side\n");
    git(["add", "side.txt"], repo.repoDir);
    git(["commit", "-q", "-m", "feat: side"], repo.repoDir);
    const side = git(["rev-parse", "HEAD"], repo.repoDir);
    git(["switch", "-q", "main"], repo.repoDir);
    const records = recordCount();

    const result = await fix(["F1", "--commit", side, "--by", "operator"]);

    expect(result.code).toBe(1);
    expect(result.err).toContain(side.slice(0, 7));
    expect(result.err).toContain("--phase-01");
    expect(result.err).toContain("main");
    expect(recordCount()).toBe(records);
  });

  it("accepts --commit on a run that is not review_open", async () => {
    await reviewOnce(repo, ["one", "two"]);
    const sha = commitByHand("tests/gate.test.ts", "export const gateTest = 13;\n");
    setRunState(repo, "running");

    const result = await fix(["F2", "--commit", sha, "--by", "operator"]);

    expect(result.code).toBe(0);
    expect(runTip()).toBe(sha);
    expect((await entryOf("F2")).history[0]).toMatchObject({
      fate: "fixed",
      commit: sha,
      pathClasses: ["tests"],
    });
  });

  it("accepts --commit for a commit on the base branch", async () => {
    await reviewOnce(repo, ["one"]);
    const onMain = head(repo, "main") as string;

    const result = await fix(["F1", "--commit", onMain, "--by", "operator"]);

    expect(result.code).toBe(0);
    expect((await entryOf("F1")).history[0]).toMatchObject({
      fate: "fixed",
      commit: onMain,
      pathClasses: ["docs"],
    });
  });

  it("refuses --commit together with a path", async () => {
    await reviewOnce(repo, ["one"]);
    const sha = commitByHand("src/app/gate.ts", "export const gate = 14;\n");
    const records = recordCount();

    const result = await fix(["F1", "--commit", sha, "--by", "operator", "--", "src/app/gate.ts"]);

    expect(result.code).toBe(1);
    expect(result.err).toContain("--commit");
    expect(recordCount()).toBe(records);
  });

  it("commits every change under a named directory", async () => {
    await reviewOnce(repo, ["one"]);
    writeInWorktree(repo, "src/app/gate.ts", "export const gate = 15;\n");
    writeInWorktree(repo, "src/app/retry.ts", "export const retry = 1;\n");
    writeInWorktree(repo, "docs/gates.md", "# Gates\n\nNot this one.\n");

    const result = await fix(["F1", "--by", "operator", "--", "src/app"]);

    expect(result.code).toBe(0);
    expect(commitPaths(repo, runTip())).toEqual(["src/app/gate.ts", "src/app/retry.ts"]);
    expect(git(["status", "--porcelain=v1"], repo.worktreePath)).toMatch(/M docs\/gates\.md$/);
  });

  it("writes one record and one trailer for an id named twice", async () => {
    await reviewOnce(repo, ["one", "two"]);
    writeInWorktree(repo, "src/app/gate.ts", "export const gate = 16;\n");
    const records = recordCount();

    const result = await fix(["F2", "F2", "--by", "operator", "--", "src/app/gate.ts"]);

    expect(result.code).toBe(0);
    expect(recordCount()).toBe(records + 1);
    const trailers = commitMessage(repo, runTip())
      .split("\n")
      .filter((line) => line.startsWith("Finding:"));
    expect(trailers).toEqual(["Finding: F2"]);
    expect((await entryOf("F2")).history).toHaveLength(1);
  });

  it("answers a contract object under --json, with the named findings read again", async () => {
    await reviewOnce(repo, ["one", "two"]);
    writeInWorktree(repo, "tests/gate.test.ts", "export const gateTest = 17;\n");

    const result = await fix(["F2", "--by", "operator", "--json", "--", "tests/gate.test.ts"]);

    expect(result.code).toBe(0);
    const answer = JSON.parse(result.out) as {
      run: { shortName: string; state: string };
      commit: { sha: string; made: boolean; subject: string; paths: unknown };
      recorded: { finding: string; key: string; recordCommit: string }[];
      findings: { id: string; fate: string; history: unknown[] }[];
    };
    expect(Object.keys(answer)).toEqual(["run", "commit", "recorded", "findings", "pullRequest"]);
    expect(answer.run).toMatchObject({ shortName: repo.shortName, state: "review_open" });
    expect(answer.commit).toEqual({
      sha: runTip(),
      made: true,
      subject: `fix(review): F2 of ${repo.shortName}`,
      paths: [{ path: "tests/gate.test.ts", pathClass: "tests" }],
    });
    expect(answer.recorded.map((r) => r.finding)).toEqual(["F2"]);
    expect(answer.recorded[0]?.key.endsWith("/finding/F2/01")).toBe(true);
    expect(answer.findings.map((f) => [f.id, f.fate, f.history.length])).toEqual([
      ["F2", "fixed", 1],
    ]);
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
    writeInWorktree(repo, "src/app/gate.ts", "export const gate = 18;\n");
    const before = runTip();

    const result = await fix(["F1", "--by", "operator", "--", "src/app/gate.ts"]);

    expect(result.code).toBe(1);
    expect(result.err).toContain("phax records sync");
    expect(runTip()).toBe(before);
  });
});
