import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findingGroup } from "../../src/cli/definitions/finding.js";
import { codeReviewFileText } from "../../src/schemas/codeReview.js";
import { complianceReviewFileText } from "../../src/schemas/complianceReview.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";
import type { Registry } from "../../src/schemas/registry.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { phaseStatusFile } from "../helpers/phaseStatusFixture.js";
import {
  buildFindingRunRepo,
  CURRENT_CODE_REVIEW,
  CURRENT_COMPLIANCE_REVIEW,
  type FindingRunRepo,
  reviewOnce,
  writeCurrentReviews,
  writeOlderReviews,
} from "../fixtures/findings/findingRunRepo.js";
import { runnerCall } from "../helpers/runnerCall.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// `phax finding list <run>` over a run's other sources: a run that does not exist, a review
// document this phax cannot read, records that are off, records that cannot be read, a review
// whose record write failed, and an archived run.

const NAMESPACE = "findings-test";

interface ListedDocument {
  run: { state: string; runId: string; shortName: string };
  records: string;
  findings: Array<{ id: string; fate: string; message: string }>;
}

describe("phax finding list: where the findings are read", () => {
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

  const list = (ref: string) => runnerCall([findingGroup], ["finding", "list", ref, "--json"]);

  /** Writes the state root's registry holding `runs`. */
  const writeRegistry = (runs: Registry["runs"]) => {
    mkdirSync(repo.stateRoot, { recursive: true });
    writeFileSync(
      join(repo.stateRoot, "registry.json"),
      JSON.stringify(withSchemaUrl("registry", { runs })),
    );
  };

  /** The fixture run's registry entry once archived, naming `archivePath` when given. */
  const archivedEntry = (archivePath: string | undefined): Registry["runs"][number] => ({
    namespace: NAMESPACE,
    shortName: repo.shortName,
    runId: repo.runId,
    state: "archived",
    branch: `feature/${repo.shortName}`,
    projectName: NAMESPACE,
    phasesCount: 1,
    createdAt: "2026-11-01T12:00:00.000Z",
    updatedAt: "2026-11-01T12:00:00.000Z",
    ...(archivePath === undefined ? {} : { archivePath }),
  });
  /** The text form, whose refusals are the plain sentence on stderr. */
  const listText = (ref: string) => runnerCall([findingGroup], ["finding", "list", ref]);

  it("refuses a run that does not exist with exit 1 and the resolver's sentence", async () => {
    const result = await listText("no-such-run");
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain(`Run "${NAMESPACE}.no-such-run" not found.`);
  });

  it("refuses a run folder holding a review stamped newer than this phax, naming the file", async () => {
    const file = join(repo.runFolder, "code-review.json");
    writeFileSync(
      file,
      JSON.stringify({ $schema: schemaUrl("code-review", "99.0.0"), findings: [] }),
    );

    const result = await listText(repo.shortName);
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain(file);
    expect(readFileSync(file, "utf8")).toContain("99.0.0");
  });

  it("with records off reads the run folder alone, says so on stderr and answers records off", async () => {
    // The same project with records left out of phax.json.
    const configPath = join(repo.repoDir, "phax.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    delete config["records"];
    writeFileSync(configPath, JSON.stringify(config));
    writeOlderReviews(repo);

    const result = await list(repo.shortName);
    expect(result.code).toBe(0);
    const document = JSON.parse(result.out) as ListedDocument;
    expect(document.records).toBe("off");
    expect(document.findings.map((f) => [f.id, f.fate])).toEqual([
      ["F1", "unrecorded"],
      ["F2", "unrecorded"],
      ["F3", "unrecorded"],
      ["C1", "unrecorded"],
      ["C2", "unrecorded"],
      ["C3", "unrecorded"],
    ]);
    expect(result.err).toContain(
      "records are off for this project: only the reviews in the run folder are listed",
    );
  });

  it("still lists a review whose record write failed after the next review, with its ids", async () => {
    await reviewOnce(repo, ["first", "second"]);
    // A lock on the records branch makes the next records commit fail.
    const lock = join(repo.repoDir, ".git", "refs", "heads", "phax", "records", "v1.lock");
    writeFileSync(lock, "");
    await reviewOnce(repo, ["third", "fourth"], "write-failed");
    rmSync(lock);
    await reviewOnce(repo, ["fifth"]);

    expect(existsSync(join(repo.runFolder, "code-review.unrecorded-01.json"))).toBe(true);
    const result = await list(repo.shortName);
    expect(result.code).toBe(0);
    const document = JSON.parse(result.out) as ListedDocument;
    expect(document.records).toBe("read");
    expect(document.findings.map((f) => [f.id, f.fate, f.message])).toEqual([
      ["F1", "open", "first"],
      ["F2", "open", "second"],
      ["F3", "open", "third"],
      ["F4", "open", "fourth"],
      ["F5", "open", "fifth"],
    ]);
  });

  it("answers records unavailable for a live run of another project that cannot be loaded, saying why on stderr", async () => {
    // A run of the project "elsewhere" under the same state root, whose final worktree is gone.
    const otherFolder = join(repo.stateRoot, "runs", `elsewhere.${repo.shortName}`);
    cpSync(repo.runFolder, otherFolder, { recursive: true });
    const statusPath = join(otherFolder, "run-status.json");
    const status = JSON.parse(readFileSync(statusPath, "utf8")) as Record<string, unknown>;
    writeFileSync(statusPath, JSON.stringify({ ...status, namespace: "elsewhere" }));
    const goneWorktree = join(repo.stateRoot, "worktrees", "elsewhere-gone", "phase-01");
    writeFileSync(
      join(otherFolder, "phase-01", "status.json"),
      JSON.stringify(
        phaseStatusFile({
          phaseId: "phase-01",
          phaseIndex: 0,
          state: "committed",
          model: "claude-sonnet-4-6",
          effort: "low",
          branchName: `feature/${repo.shortName}--phase-01`,
          base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
          createdAt: "2026-11-01T10:00:00.000Z",
          updatedAt: "2026-11-01T10:00:00.000Z",
          worktreePath: goneWorktree,
          claudeSessionId: "sess-abc",
        }),
      ),
    );
    writeFileSync(join(otherFolder, "code-review.json"), codeReviewFileText(CURRENT_CODE_REVIEW));
    writeRegistry([
      {
        namespace: "elsewhere",
        shortName: repo.shortName,
        runId: repo.runId,
        state: "review_open",
        branch: `feature/${repo.shortName}`,
        projectName: "elsewhere",
        phasesCount: 1,
        createdAt: "2026-11-01T10:00:00.000Z",
        updatedAt: "2026-11-01T10:00:00.000Z",
      },
    ]);

    const result = await list(`elsewhere.${repo.shortName}`);
    expect(result.code).toBe(0);
    const document = JSON.parse(result.out) as ListedDocument;
    expect(document.records).toBe("unavailable");
    expect(document.run).toMatchObject({ state: "review_open" });
    expect(document.findings.map((f) => f.id)).toEqual(["F1", "F2"]);
    expect(result.err).toContain("records unavailable");
    expect(result.err).toContain(goneWorktree);
  });

  it("lists an archived run whose entry names no archive path from <state root>/archive/<key>/runs", async () => {
    writeCurrentReviews(repo);
    const archiveRuns = join(repo.stateRoot, "archive", `${NAMESPACE}.${repo.shortName}`, "runs");
    mkdirSync(dirname(archiveRuns), { recursive: true });
    renameSync(repo.runFolder, archiveRuns);
    writeRegistry([archivedEntry(undefined)]);

    const result = await list(repo.shortName);
    expect(result.code).toBe(0);
    const document = JSON.parse(result.out) as ListedDocument;
    expect(document.run.state).toBe("archived");
    expect(document.findings.map((f) => f.id)).toEqual(["F1", "F2", "C1"]);
    expect(result.err).not.toContain("is gone");
  });

  it("lists an archived run whose archive folder is gone from its records, with a note", async () => {
    await reviewOnce(repo, ["recorded finding"]);
    const archivePath = join(repo.stateRoot, "archive", `${NAMESPACE}.${repo.shortName}`);
    rmSync(repo.runFolder, { recursive: true });
    writeRegistry([archivedEntry(archivePath)]);

    const result = await list(repo.shortName);
    expect(result.code).toBe(0);
    const document = JSON.parse(result.out) as ListedDocument;
    expect(document.records).toBe("read");
    expect(document.findings.map((f) => [f.id, f.message])).toEqual([["F1", "recorded finding"]]);
    expect(result.err).toContain(
      `the archive folder ${join(archivePath, "runs")} is gone: only the records are listed`,
    );
  });

  it("lists an archived run from its archive folder and its records, in state archived", async () => {
    await reviewOnce(repo, ["first finding", "second finding"]);
    // A compliance review only the run folder holds: the records branch has no entry for it.
    writeFileSync(
      join(repo.runFolder, "compliance-review.json"),
      complianceReviewFileText(CURRENT_COMPLIANCE_REVIEW),
    );

    // `phax archive` moves the run folder under <archivePath>/runs and records the entry.
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

    const result = await list(repo.shortName);
    expect(result.code).toBe(0);
    const document = JSON.parse(result.out) as ListedDocument;
    expect(document.run).toMatchObject({ state: "archived", runId: repo.runId });
    expect(document.records).toBe("read");
    expect(document.findings.map((f) => [f.id, f.fate, f.message])).toEqual([
      ["F1", "open", "first finding"],
      ["F2", "open", "second finding"],
      ["C1", "open", "No test."],
    ]);
  });
});
