import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePublishPrCommand } from "../../src/cli/definitions/publishPr.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { writeCurrentReviews } from "../fixtures/findings/findingRunRepo.js";
import {
  buildPrRunRepo,
  findingsSection,
  type PrRunRepo,
  publishPr,
} from "../fixtures/findings/prRunRepo.js";
import { runnerCall } from "../helpers/runnerCall.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// Publishing a run with findings: open findings never stop it (AC-never-blocks), and a pull
// request that already exists keeps its description (AC-pr-description-not-rewritten, publication
// side).

describe("publishing a run with findings", () => {
  const repos: PrRunRepo[] = [];
  let origCwd: string;

  beforeEach(() => {
    origCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(origCwd);
    for (const repo of repos.splice(0)) repo.cleanup();
  });

  const build = (): PrRunRepo => {
    const repo = buildPrRunRepo();
    repos.push(repo);
    return repo;
  };

  // AC-never-blocks
  it("publishes a run with open findings as it publishes one with none", async () => {
    const withFindings = build();
    writeCurrentReviews(withFindings);
    process.chdir(withFindings.repoDir);
    const published = await publishPr(withFindings);
    expect(published.code).toBe(0);
    expect(published.prUrl).toMatch(/^https:\/\//);
    const section = findingsSection(published.body as string);
    expect(section).not.toBeNull();
    const open = (section as string).split("\n").filter((line) => line.startsWith("- F1 bug "));
    expect(open).toHaveLength(1);
    expect(section).toContain("Open (3)");

    const without = build();
    process.chdir(without.repoDir);
    const clean = await publishPr(without);
    expect(clean.code).toBe(0);
    expect(clean.prUrl).toMatch(/^https:\/\//);
    expect(findingsSection(clean.body as string)).toBe("## Review findings\n\nNo findings.");
  });

  // AC-pr-description-not-rewritten (the publication side)
  it("keeps the description of a pull request that already exists", async () => {
    const repo = build();
    writeCurrentReviews(repo);
    process.chdir(repo.repoDir);
    const fake = makeFakeGitHub();
    const publish = () =>
      runnerCall(
        [makePublishPrCommand({ githubLayer: fake.layer })],
        ["publish-pr", repo.shortName, "--json"],
      );
    const created = () => fake.impl.calls.filter((call) => call.method === "createPullRequest");

    expect((await publish()).code).toBe(0);
    expect(created()).toHaveLength(1);
    const first = created()[0];
    const bodyFile = first?.method === "createPullRequest" ? first.bodyFile : "";
    const body = readFileSync(bodyFile, "utf8");

    fake.impl.seedExistingPr(repo.runBranch, "https://github.com/owner/repo/pull/1");
    expect((await publish()).code).toBe(0);
    expect(created()).toHaveLength(1);
    expect(readFileSync(bodyFile, "utf8")).toBe(body);
  });
});
