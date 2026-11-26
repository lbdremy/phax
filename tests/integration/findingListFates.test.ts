import { Effect, Layer, Result } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFateRecord } from "../../src/app/findingFateRecords.js";
import { findingGroup } from "../../src/cli/definitions/finding.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { decodeBranchName } from "../../src/domain/branded.js";
import { Git } from "../../src/ports/git.js";
import type { FindingFateEntry } from "../../src/schemas/findingFateRecord.js";
import { decodeFindingListFile } from "../../src/schemas/findingList.js";
import {
  buildFindingRunRepo,
  type FindingRunRepo,
  reviewOnce,
  writeOlderReviews,
} from "../fixtures/findings/findingRunRepo.js";
import { runnerCall } from "../helpers/runnerCall.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// `phax finding list` reading fate records, written with `writeFateRecord`, over the fixture of
// plan 1 (never edited here).

const AT = "2026-11-02T10:00:00.000Z";
const OPERATOR = { kind: "operator", name: "Ada" } as const;

const fixed = (
  sha: string,
  pathClasses: FindingFateEntry & { fate: "fixed" } extends infer F
    ? F extends { pathClasses: infer P }
      ? P
      : never
    : never,
): FindingFateEntry => ({
  fate: "fixed",
  commit: sha.repeat(40),
  pathClasses,
  by: OPERATOR,
  at: AT,
});

const dismissed = (why: string): FindingFateEntry => ({
  fate: "dismissed",
  verdict: {
    kind: "decided",
    chosen: "dismiss",
    abandoned: ["fix", "defer"],
    why,
    advocate: "Cover it with a test.",
    principles: [],
    reversibility: "cheap",
    by: OPERATOR,
    at: AT,
    revised: [],
  },
});

const deferred: FindingFateEntry = {
  fate: "deferred",
  to: "docs/next.md",
  why: "Later.",
  by: OPERATOR,
  at: AT,
};

interface Listed {
  readonly id: string;
  readonly fate: string;
  readonly history: readonly unknown[];
}

describe("phax finding list with fate records", () => {
  let repo: FindingRunRepo;
  let origCwd: string;

  beforeEach(() => {
    repo = buildFindingRunRepo();
    origCwd = process.cwd();
    process.chdir(repo.repoDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    repo.cleanup();
  });

  const write = (finding: string, entry: FindingFateEntry) =>
    Effect.runPromise(
      writeFateRecord({
        destination: { repo: repo.repoDir, remote: "origin" },
        runId: repo.runId,
        finding,
        entry,
      }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystemLayer, NodeGitLayer))),
    );

  const listJson = async () => {
    const result = await runnerCall([findingGroup], ["finding", "list", repo.shortName, "--json"]);
    expect(result.code).toBe(0);
    expect(Result.isSuccess(decodeFindingListFile(JSON.parse(result.out) as unknown))).toBe(true);
    return {
      result,
      findings: (JSON.parse(result.out) as { findings: Listed[] }).findings,
    };
  };

  it("lists each finding with the fate of its latest record and its history", async () => {
    await reviewOnce(repo, ["one", "two", "three", "four"]);
    const f1 = fixed("a", ["code", "tests"]);
    const f2 = dismissed("Not worth it.");
    await write("F1", f1);
    await write("F2", f2);
    await write("F3", deferred);

    const { findings } = await listJson();
    expect(findings.map((f) => [f.id, f.fate, f.history])).toEqual([
      ["F1", "fixed", [f1]],
      ["F2", "dismissed", [f2]],
      ["F3", "deferred", [deferred]],
      ["F4", "open", []],
    ]);

    const text = await runnerCall([findingGroup], ["finding", "list", repo.shortName]);
    expect(text.code).toBe(0);
    // The recorded sha names no commit of the repository: the fix is found on no branch.
    expect(text.outLines).toContain(
      `             ${"a".repeat(7)} (code, tests) → not found on main or feature/${repo.shortName}--phase-01`,
    );
    expect(text.outLines).toContain("             Ada: Not worth it.");
    expect(text.outLines).toContain("             → docs/next.md");
  });

  it("lists a finding dismissed then fixed as fixed, with both records in order", async () => {
    await reviewOnce(repo, ["one", "two", "three"]);
    const dismissal = dismissed("Not now.");
    const fix = fixed("b", ["code"]);
    await write("F3", dismissal);
    await write("F3", fix);
    const { findings } = await listJson();
    const f3 = findings.find((f) => f.id === "F3");
    expect(f3?.fate).toBe("fixed");
    expect(f3?.history).toEqual([dismissal, fix]);
  });

  it("lets a dismissal settle a finding lifted as unrecorded", async () => {
    writeOlderReviews(repo);
    await write("F2", dismissed("Known."));
    const { findings } = await listJson();
    expect(findings.filter((f) => f.id.startsWith("F")).map((f) => [f.id, f.fate])).toEqual([
      ["F1", "unrecorded"],
      ["F2", "dismissed"],
      ["F3", "unrecorded"],
    ]);
  });

  it("refuses a damaged fate record, naming it", async () => {
    await reviewOnce(repo, ["one"]);
    const key = `${repo.runId}/finding/F1/01/record.json`;
    await Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* Git;
        const tip = yield* git.resolveRef(repo.repoDir, "refs/heads/phax/records/v1");
        const branch = decodeBranchName("phax/records/v1");
        if (Result.isFailure(branch)) throw new Error("bad branch");
        yield* git.writeTreeCommit({
          repo: repo.repoDir,
          branch: branch.success,
          message: "records(finding): F1 fixed",
          files: [{ path: key, content: new TextEncoder().encode("not json {") }],
          parent: tip,
          expectedTip: tip,
        });
      }).pipe(Effect.provide(NodeGitLayer)),
    );
    const result = await runnerCall([findingGroup], ["finding", "list", repo.shortName]);
    expect(result.code).toBe(1);
    expect(result.err).toContain(key);
  });

  it("notes a fate record of an unknown finding and still lists", async () => {
    await reviewOnce(repo, ["one"]);
    await write("F9", deferred);
    const { result, findings } = await listJson();
    expect(result.err).toContain(
      "fate records name F9, which no review of the run holds: not listed",
    );
    expect(findings.map((f) => f.id)).toEqual(["F1"]);
  });
});
