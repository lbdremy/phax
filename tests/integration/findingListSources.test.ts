import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findingGroup } from "../../src/cli/definitions/finding.js";
import { complianceReviewFileText } from "../../src/schemas/complianceReview.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import {
  buildFindingRunRepo,
  CURRENT_COMPLIANCE_REVIEW,
  type FindingRunRepo,
  reviewOnce,
  writeOlderReviews,
} from "../fixtures/findings/findingRunRepo.js";
import { runnerCall } from "../helpers/runnerCall.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// `phax finding list <run>` over a run's other sources: a run that does not exist, a review
// document this phax cannot read, records that are off, and an archived run.

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
