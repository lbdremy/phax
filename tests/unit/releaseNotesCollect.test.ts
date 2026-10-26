import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { Either } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  LOG_FORMAT,
  REPOSITORY,
  collectReleaseNotes,
  parseLog,
  releaseNotes,
} from "../../scripts/release-notes.js";
import { githubReleaseBody } from "../../scripts/releaseNotes.js";
import { readDocumentSidecar } from "../../src/schemas/persisted.js";
import { SURFACE_SUMMARY_PLACEHOLDER } from "../../src/schemas/specDocument.js";
import {
  OPENED,
  PREVIOUS,
  UPGRADING_TEXT,
  planPath,
  releasedRepo,
  writePlan,
  writeSpec,
  type FixtureRepo,
  type PlanFile,
  type SpecFile,
} from "./releaseNotes/repo.js";

const phaxRoot = join(import.meta.dirname, "../..");
const TSX = join(phaxRoot, "node_modules/.bin/tsx");

const repos: FixtureRepo[] = [];

function track(repo: FixtureRepo): FixtureRepo {
  repos.push(repo);
  return repo;
}

afterEach(() => {
  for (const repo of repos.splice(0)) repo.dispose();
});

const TABLE_SPEC: SpecFile = {
  path: "docs/specs/archive/2610010000-table.md",
  title: "Table — a table you can read",
  guidingRule: "Read it, never guess it.",
  surface: [
    {
      surface: "cli: tool table",
      summary: "You can list the table.",
      before: null,
      after: "a | b",
    },
    {
      surface: "file: table.json",
      summary: "You can load the table.",
      before: "{}",
      after: '{ "rows": [] }',
    },
  ],
};

const TABLE_SURFACE = [
  { surface: "cli: tool table", summary: "You can list the table.", before: null, after: "a | b" },
  {
    surface: "file: table.json",
    summary: "You can load the table.",
    before: "{}",
    after: '{ "rows": [] }',
  },
];

describe("parseLog", { timeout: 30_000 }, () => {
  it("reads the trailers git parses, one record per commit, oldest first", () => {
    const repo = track(releasedRepo());
    const plain = repo.commit("feat: no trailer");
    const run = repo.commit("feat: a run commit", {
      body: "The body.",
      runId: "run-1",
      shortName: "table",
    });
    const fix = repo.commit("fix: a review fix", { shortName: "table" });
    const prose = repo.commit("docs: prose", {
      message: [
        "docs: prose",
        "",
        "Some body.",
        "",
        "The Run-Id: field is described in the docs.",
        "It is not a trailer.",
        "",
      ].join("\n"),
    });
    const repeated = repo.commit("feat: a repeated key", {
      message: [
        "feat: a repeated key",
        "",
        "Body.",
        "",
        "---",
        "",
        "Run-Id: first",
        "Short-Name: one",
        "Short-Name: two",
        "",
      ].join("\n"),
    });

    const log = repo.git(
      "log",
      "--reverse",
      "--no-merges",
      `--format=${LOG_FORMAT}`,
      `v${PREVIOUS}..HEAD`,
    );

    expect(parseLog(log)).toEqual([
      { hash: plain, subject: "feat: no trailer", runId: null, shortName: null },
      { hash: run, subject: "feat: a run commit", runId: "run-1", shortName: "table" },
      { hash: fix, subject: "fix: a review fix", runId: null, shortName: "table" },
      { hash: prose, subject: "docs: prose", runId: null, shortName: null },
      { hash: repeated, subject: "feat: a repeated key", runId: "first", shortName: "one" },
    ]);
  });

  it("reads an empty log", () => {
    expect(parseLog("")).toEqual([]);
  });
});

const planOf = (slug: string, title: string, extra: Partial<PlanFile> = {}): PlanFile => ({
  stamp: "2610010001",
  slug,
  title,
  ...extra,
});

const refuses = (repo: FixtureRepo, message: string, version = OPENED): void => {
  expect(() => collectReleaseNotes(repo.root, version)).toThrow(new Error(message));
};

describe("collectReleaseNotes", { timeout: 30_000 }, () => {
  it("follows a run to the plan completed in the range and to its spec in the archive", () => {
    const repo = track(releasedRepo());
    writeSpec(repo, TABLE_SPEC);
    const plan = planOf("table-data", "Table data", {
      lede: "A table, read by tools.",
      spec: { path: "docs/specs/2610010000-table.md", completes: true },
    });
    writePlan(repo, plan);
    repo.commit("feat: table", { runId: "run-1", shortName: "table-data" });

    expect(collectReleaseNotes(repo.root, OPENED)).toEqual({
      input: {
        version: OPENED,
        previous: PREVIOUS,
        repository: REPOSITORY,
        upgrading: UPGRADING_TEXT,
        plans: [
          {
            path: planPath(plan),
            title: "Table data",
            firstParagraph: "A table, read by tools.",
            spec: {
              path: TABLE_SPEC.path,
              title: "Table — a table you can read",
              guidingRule: "Read it, never guess it.",
              surface: TABLE_SURFACE,
            },
            completesSpec: true,
          },
        ],
        commits: [],
      },
      warnings: [],
    });
  });

  it("finds a spec at its live path", () => {
    const repo = track(releasedRepo());
    const spec = { ...TABLE_SPEC, path: "docs/specs/2610010000-table.md" };
    writeSpec(repo, spec);
    writePlan(
      repo,
      planOf("table-data", "Table data", { spec: { path: spec.path, completes: true } }),
    );
    repo.commit("feat: table", { runId: "run-1", shortName: "table-data" });

    const { input, warnings } = collectReleaseNotes(repo.root, OPENED);

    expect(input.plans.map((plan) => plan.spec?.path)).toEqual([spec.path]);
    expect(warnings).toEqual([]);
  });

  it("announces an intermediate plan, which completes none of its spec", () => {
    const repo = track(releasedRepo());
    writeSpec(repo, TABLE_SPEC);
    writePlan(
      repo,
      planOf("table-first", "First of the table", {
        spec: { path: TABLE_SPEC.path, completes: false },
      }),
    );
    repo.commit("feat: first", { runId: "run-1", shortName: "table-first" });

    const { input } = collectReleaseNotes(repo.root, OPENED);

    expect(input.plans).toMatchObject([
      { title: "First of the table", completesSpec: false, spec: { path: TABLE_SPEC.path } },
    ]);
  });

  it("announces a plan without a spec by its title and first paragraph", () => {
    const repo = track(releasedRepo());
    const plan = planOf("loose", "Loose plan", { lede: "It *does* a thing." });
    writePlan(repo, plan);
    repo.commit("feat: loose", { runId: "run-1", shortName: "loose" });

    expect(collectReleaseNotes(repo.root, OPENED).input.plans).toEqual([
      {
        path: planPath(plan),
        title: "Loose plan",
        firstParagraph: "It *does* a thing.",
        spec: null,
        completesSpec: false,
      },
    ]);
  });

  it("takes a plan's run short name from its sidecar, falling back to its title without one", () => {
    const repo = track(releasedRepo());
    writePlan(
      repo,
      planOf("file-name", "Title of plan", { run: { shortName: "From Sidecar!", title: "x" } }),
    );
    writePlan(repo, planOf("no-sidecar", "Hand Written Plan", { run: null }));
    repo.commit("feat: one", { runId: "run-1", shortName: "from-sidecar" });
    repo.commit("feat: two", { runId: "run-2", shortName: "hand-written-plan" });

    const { input, warnings } = collectReleaseNotes(repo.root, OPENED);

    expect(input.plans.map((plan) => plan.title)).toEqual(["Title of plan", "Hand Written Plan"]);
    expect(input.commits).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("lists run plans in the order of their first commit", () => {
    const repo = track(releasedRepo());
    writePlan(repo, planOf("alpha", "Alpha"));
    writePlan(repo, planOf("beta", "Beta"));
    repo.commit("feat: beta first", { runId: "run-b", shortName: "beta" });
    repo.commit("feat: alpha", { runId: "run-a", shortName: "alpha" });
    repo.commit("feat: beta again", { runId: "run-b", shortName: "beta" });

    const { input } = collectReleaseNotes(repo.root, OPENED);

    expect(input.plans.map((plan) => plan.title)).toEqual(["Beta", "Alpha"]);
    expect(input.commits).toEqual([]);
  });

  describe("review fixes carrying a Short-Name trailer alone", () => {
    it("joins its run and is listed nowhere", () => {
      const repo = track(releasedRepo());
      writePlan(repo, planOf("alpha", "Alpha"));
      repo.commit("feat: alpha", { runId: "run-a", shortName: "alpha" });
      repo.commit("fix: review fix of alpha", { shortName: "alpha" });

      const { input, warnings } = collectReleaseNotes(repo.root, OPENED);

      expect(input.plans).toHaveLength(1);
      expect(input.commits).toEqual([]);
      expect(warnings).toEqual([]);
    });

    it("naming no run is a commit without a run, with one warning", () => {
      const repo = track(releasedRepo());
      writePlan(repo, planOf("alpha", "Alpha"));
      repo.commit("feat: alpha", { runId: "run-a", shortName: "alpha" });
      const stray = repo.commit("fix: review fix of an older run", { shortName: "older" });

      const { input, warnings } = collectReleaseNotes(repo.root, OPENED);

      expect(input.commits).toEqual([{ hash: stray, subject: "fix: review fix of an older run" }]);
      expect(warnings).toEqual([
        `${stray.slice(0, 7)}: Short-Name older names no run since v${PREVIOUS}: it is listed as a commit without a run`,
      ]);
    });

    it("naming an unmatched run is listed with that run's commits, with no warning of its own", () => {
      const repo = track(releasedRepo());
      const run = repo.commit("feat: ghost", { runId: "run-g", shortName: "ghost" });
      const fix = repo.commit("fix: review fix of ghost", { shortName: "ghost" });

      const { input, warnings } = collectReleaseNotes(repo.root, OPENED);

      expect(input.commits.map((commit) => commit.hash)).toEqual([run, fix]);
      expect(warnings).toEqual([
        `run ghost names no plan completed since v${PREVIOUS}: its commits are listed as commits without a run`,
      ]);
    });
  });

  it("warns once for a run that names no plan and once for a plan no run names", () => {
    const repo = track(releasedRepo());
    const run = repo.commit("feat: ghost work", { runId: "run-g", shortName: "ghost" });
    const plain = repo.commit("chore: tidy");
    const plan = planOf("lonely", "Lonely plan");
    writePlan(repo, plan);
    const archive = repo.commit("docs: archive a plan by hand");

    const { input, warnings } = collectReleaseNotes(repo.root, OPENED);

    expect(input.plans).toEqual([]);
    expect(input.commits).toEqual([
      { hash: run, subject: "feat: ghost work" },
      { hash: plain, subject: "chore: tidy" },
      { hash: archive, subject: "docs: archive a plan by hand" },
    ]);
    expect(warnings).toEqual([
      `run ghost names no plan completed since v${PREVIOUS}: its commits are listed as commits without a run`,
      `${planPath(plan)} was completed since v${PREVIOUS}, but no run commit names lonely: it is not announced`,
    ]);
  });

  it("warns once for a spec without a sidecar and announces it by its title", () => {
    const repo = track(releasedRepo());
    const spec = { ...TABLE_SPEC, noSidecar: true };
    writeSpec(repo, spec);
    writePlan(repo, planOf("a", "A", { spec: { path: spec.path, completes: true } }));
    writePlan(repo, planOf("b", "B", { spec: { path: spec.path, completes: false } }));
    repo.commit("feat: a", { runId: "run-a", shortName: "a" });
    repo.commit("feat: b", { runId: "run-b", shortName: "b" });

    const { input, warnings } = collectReleaseNotes(repo.root, OPENED);

    expect(input.plans.map((plan) => plan.spec)).toEqual([
      { path: spec.path, title: spec.title, guidingRule: null, surface: [] },
      { path: spec.path, title: spec.title, guidingRule: null, surface: [] },
    ]);
    expect(warnings).toEqual([`${spec.path} has no sidecar: it is announced by its title alone`]);
  });

  it("leaves out an abandoned plan, a plan archived before the tag and a merge commit", () => {
    const repo = track(
      releasedRepo((fixture) =>
        writePlan(fixture, planOf("older", "Older plan", { stamp: "2609010000" })),
      ),
    );
    writePlan(repo, planOf("dropped", "Dropped plan", { status: "Abandoned" }));
    writePlan(repo, planOf("kept", "Kept plan"));
    repo.git("switch", "-q", "-c", "feature");
    repo.commit("feat: kept", { runId: "run-k", shortName: "kept" });
    repo.git("switch", "-q", "main");
    repo.commit("chore: on main");
    repo.git(
      "merge",
      "--no-ff",
      "-q",
      "-m",
      "Merge pull request #1\n\nRun-Id: run-k\nShort-Name: kept",
      "feature",
    );

    const { input, warnings } = collectReleaseNotes(repo.root, OPENED);

    expect(input.plans.map((plan) => plan.title)).toEqual(["Kept plan"]);
    expect(input.commits.map((commit) => commit.subject)).toEqual(["chore: on main"]);
    expect(warnings).toEqual([]);
  });

  describe("refuses", () => {
    /** A repo whose one run commit names the plan written by `write`. */
    function withPlan(write: (repo: FixtureRepo) => void, shortName = "p"): FixtureRepo {
      const repo = track(releasedRepo());
      write(repo);
      repo.commit("feat: p", { runId: "run-p", shortName });
      return repo;
    }

    const plan = planOf("p", "P");
    const path = planPath(plan);

    it("a version with no release below it", () => {
      refuses(
        track(releasedRepo()),
        "no release below 4.0.0 in packages/schemas/releases.json — no release notes",
        "4.0.0",
      );
    });

    it("a previous release with no tag", () => {
      const repo = track(releasedRepo());
      repo.git("tag", "-d", `v${PREVIOUS}`);
      refuses(
        repo,
        `v${PREVIOUS} is not a tag in ${repo.root} — fetch the tags (git fetch --tags), or clone with the full history`,
      );
    });

    it("a missing release ledger", () => {
      const repo = track(releasedRepo());
      rmSync(join(repo.root, "packages/schemas/releases.json"));
      refuses(repo, "packages/schemas/releases.json is missing — no release notes");
    });

    it("a plan with no frontmatter", () => {
      refuses(
        withPlan((repo) => repo.write(path, "# P\n\nNo block.\n")),
        `${path}: no frontmatter`,
      );
    });

    it("a plan whose frontmatter does not decode", () => {
      refuses(
        withPlan((repo) =>
          repo.write(path, "---\nstatus: Finished\nsource-spec: null\n---\n\n# P\n\nText.\n"),
        ),
        `${path}: status: Expected "Draft", actual "Finished"`,
      );
    });

    it("a completed plan with no title", () => {
      refuses(
        withPlan((repo) =>
          repo.write(path, "---\nstatus: Completed\nsource-spec: null\n---\n\nNo title.\n"),
        ),
        `${path}: no "# " title`,
      );
    });

    it("a plan sidecar that is not JSON", () => {
      refuses(
        withPlan((repo) => {
          writePlan(repo, plan);
          repo.write(path.replace(/\.md$/, ".json"), "{");
        }),
        `${path.replace(/\.md$/, ".json")}: not JSON`,
      );
    });

    it("a plan sidecar that does not decode", () => {
      const sidecar = path.replace(/\.md$/, ".json");
      const read = readDocumentSidecar("plan", sidecar, {});
      if (!Either.isLeft(read)) throw new Error("an empty object must not decode");
      refuses(
        withPlan((repo) => {
          writePlan(repo, plan);
          repo.write(sidecar, "{}\n");
        }),
        read.left.message,
      );
    });

    it("a spec sidecar that is not JSON", () => {
      refuses(
        withPlan((repo) => {
          writePlan(repo, { ...plan, spec: { path: TABLE_SPEC.path, completes: true } });
          writeSpec(repo, TABLE_SPEC);
          repo.write(TABLE_SPEC.path.replace(/\.md$/, ".json"), "nope");
        }),
        `${TABLE_SPEC.path.replace(/\.md$/, ".json")}: not JSON`,
      );
    });

    it("a spec sidecar that does not decode", () => {
      const sidecar = TABLE_SPEC.path.replace(/\.md$/, ".json");
      const read = readDocumentSidecar("spec", sidecar, {});
      if (!Either.isLeft(read)) throw new Error("an empty object must not decode");
      refuses(
        withPlan((repo) => {
          writePlan(repo, { ...plan, spec: { path: TABLE_SPEC.path, completes: true } });
          writeSpec(repo, TABLE_SPEC);
          repo.write(sidecar, "{}\n");
        }),
        read.left.message,
      );
    });

    it("a source spec found at neither of its paths", () => {
      refuses(
        withPlan((repo) =>
          writePlan(repo, {
            ...plan,
            spec: { path: "docs/specs/2610019999-gone.md", completes: true },
          }),
        ),
        `${path}: its source spec docs/specs/2610019999-gone.md is in neither docs/specs/ nor docs/specs/archive/`,
      );
    });

    it("a source spec path that is not a spec path", () => {
      refuses(
        withPlan((repo) =>
          writePlan(repo, {
            ...plan,
            spec: { path: "docs/specs/../../outside.md", completes: true },
          }),
        ),
        `${path}: source-spec docs/specs/../../outside.md is not a spec path`,
      );
    });

    it("two completed plans with the same run short name", () => {
      const other = planOf("q", "Q", { run: { shortName: "p", title: "Q" } });
      refuses(
        withPlan((repo) => {
          writePlan(repo, plan);
          writePlan(repo, other);
        }),
        `${path} and ${planPath(other)} both have the run short name p`,
      );
    });

    it("a missing docs/upgrading.md", () => {
      refuses(
        withPlan((repo) => {
          writePlan(repo, plan);
          rmSync(join(repo.root, "docs/upgrading.md"));
        }),
        "docs/upgrading.md is missing",
      );
    });

    it("a kept surface element that still holds the placeholder summary", () => {
      const repo = withPlan((fixture) => {
        const spec = {
          ...TABLE_SPEC,
          surface: [
            {
              surface: "cli: tool table",
              summary: SURFACE_SUMMARY_PLACEHOLDER,
              before: null,
              after: "a",
            },
          ],
        };
        writeSpec(fixture, spec);
        writePlan(fixture, { ...plan, spec: { path: spec.path, completes: true } });
      });
      expect(() => releaseNotes(repo.root, OPENED)).toThrow(
        new Error(
          `${TABLE_SPEC.path}: the surface element "cli: tool table" still has the placeholder summary — write it before the release`,
        ),
      );
    });

    it("a spec announced in full twice", () => {
      const repo = track(releasedRepo());
      writeSpec(repo, TABLE_SPEC);
      const one = planOf("one", "One", { spec: { path: TABLE_SPEC.path, completes: true } });
      const two = planOf("two", "Two", { spec: { path: TABLE_SPEC.path, completes: true } });
      writePlan(repo, one);
      writePlan(repo, two);
      repo.commit("feat: one", { runId: "run-1", shortName: "one" });
      repo.commit("feat: two", { runId: "run-2", shortName: "two" });
      expect(() => releaseNotes(repo.root, OPENED)).toThrow(
        new Error(
          `${TABLE_SPEC.path} is announced in full twice: ${planPath(one)} and ${planPath(two)} both say completes-spec: true`,
        ),
      );
    });
  });
});

describe("the preview entry", { timeout: 60_000 }, () => {
  function run(args: ReadonlyArray<string>) {
    return spawnSync(TSX, ["scripts/release-notes.ts", ...args], {
      cwd: phaxRoot,
      encoding: "utf8",
      timeout: 30_000,
    });
  }

  function previewRepo(): FixtureRepo {
    const repo = track(releasedRepo());
    writePlan(repo, { stamp: "2610010001", slug: "loose", title: "Loose plan" });
    repo.commit("feat: loose", { runId: "run-1", shortName: "loose" });
    repo.commit("feat: ghost", { runId: "run-2", shortName: "ghost" });
    repo.commit("fix: a fix outside any run");
    return repo;
  }

  it("prints the notes on stdout and the warnings on stderr, and changes nothing", () => {
    const repo = previewRepo();
    const before = repo.git("status", "--porcelain");
    const headBefore = repo.git("rev-parse", "HEAD");

    const result = run(["--root", repo.root]);

    expect(result.status).toBe(0);
    const expected = releaseNotes(repo.root, OPENED);
    expect(result.stdout).toBe(expected.markdown);
    expect(expected.warnings).toHaveLength(1);
    for (const warning of expected.warnings) expect(result.stderr).toContain(`! ${warning}`);
    expect(repo.git("status", "--porcelain")).toBe(before);
    expect(repo.git("rev-parse", "HEAD")).toBe(headBefore);
  });

  it("refuses a repository with no tag for the previous release", () => {
    const repo = previewRepo();
    repo.git("tag", "-d", `v${PREVIOUS}`);

    const result = run(["--root", repo.root]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`✗ v${PREVIOUS} is not a tag in ${repo.root}`);
  });

  it("prints the GitHub release body of a notes file", () => {
    const repo = previewRepo();
    const { markdown } = releaseNotes(repo.root, OPENED);
    repo.write(`docs/releases/${OPENED}.md`, markdown);

    const result = run(["--root", repo.root, "--github-body", `docs/releases/${OPENED}.md`]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(githubReleaseBody(markdown, OPENED));
    expect(result.stdout).toContain("Read the full notes, with each surface's before and after");
  });

  it.each([
    [
      "a misnamed file",
      "docs/releases/notes.md",
      "✗ docs/releases/notes.md: a release notes file is named X.Y.Z.md",
    ],
    ["a missing file", "docs/releases/4.3.0.md", "✗ docs/releases/4.3.0.md is missing"],
  ])("refuses --github-body of %s", (_label, file, message) => {
    const repo = previewRepo();

    const result = run(["--root", repo.root, "--github-body", file]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(message);
  });
});
