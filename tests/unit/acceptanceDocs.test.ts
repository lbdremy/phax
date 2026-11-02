// The spec acceptance-tests' ac-upgrading, and the site half of the docs rename:
// the 0.33.0 upgrading entry names every step an operator takes (§5.23), and the
// docs site publishes docs/acceptance-phases.md at /guide/acceptance-phases with
// no page left under the old name (§10, §11).
//
// Reads files only: no phax process, no network, no HOME.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listSources } from "../../site/build/sources.js";
import { isFilePage } from "../../site/build/pageMap.js";
import pageMap from "../../site/pages.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), "utf8");
}

/** The `### 0.33.0` entry of the upgrading guide, up to the next `### ` heading. */
function upgradingEntry(): string {
  const lines = read("docs/upgrading.md").split("\n");
  const start = lines.indexOf("### 0.33.0");
  expect(start).toBeGreaterThanOrEqual(0);
  const next = lines.findIndex((line, index) => index > start && line.startsWith("### "));
  return lines.slice(start, next === -1 ? lines.length : next).join("\n");
}

describe("the 0.33.0 upgrading entry (ac-upgrading)", () => {
  const entry = upgradingEntry();

  it("names every operator step the spec's §5.23 lists", () => {
    for (const needle of [
      // the migration, then hand-written plans: header lines and loop
      "phax artifact migrate-documents",
      "**Acceptance phase:**",
      "**Acceptance test files:**",
      "loop `oracle` is `acceptance`",
      // the phax.json key and its overlays
      '"acceptance"',
      "phax.local.json",
      "~/.phax/config.json",
      // the --hold and --skip spellings
      "--hold acceptance",
      "--skip-acceptance",
      // the request an acceptance provider reads
      "acceptance-request",
      "passed",
      "acceptancePhase",
      "acceptanceCommit",
      // renamed status, record and overview names, and the schemas package's exports
      "acceptanceStep",
      "acceptanceRole",
      "parseAcceptanceRequest",
      // runs in flight
      "phax archive <run> --force",
    ]) {
      expect(entry, needle).toContain(needle);
    }
  });

  it("names the telemetry event, the moved example and the skills", () => {
    expect(entry).toContain("acceptance.edits.unjudged");
    expect(entry).toContain("phax·acceptance.edits.unjudged");
    expect(entry).toContain("`examples/vitest-oracles/`");
    expect(entry).toContain("`examples/vitest-acceptance/`");
    expect(entry).toContain("phax skills install");
    // Code spans, not links: the old folder no longer exists once the example moves.
    expect(entry).not.toMatch(/\]\([^)]*examples\/vitest-(oracles|acceptance)/);
  });

  it("no longer defers the provider steps", () => {
    expect(entry).not.toContain("when they ship");
  });

  it("leaves the entries of earlier releases in place", () => {
    const guide = read("docs/upgrading.md");
    for (const heading of ["### 0.32.0", "### 0.31.0", "### 0.30.0"]) {
      expect(guide).toContain(heading);
    }
  });
});

describe("the docs site registers the acceptance page (renamed from the oracle one)", () => {
  const pages = pageMap.files.filter(isFilePage);

  it("publishes docs/acceptance-phases.md at /guide/acceptance-phases as Acceptance phases", () => {
    const page = pages.find((entry) => entry.route === "/guide/acceptance-phases");
    expect(page).toBeDefined();
    expect(page?.title).toBe("Acceptance phases");
    expect(page?.source).toBe("docs/acceptance-phases.md");
  });

  it("registers no page whose route or source says oracle, and no redirect to one", () => {
    expect(pages.filter((page) => /oracle/i.test(`${page.route} ${page.source}`))).toEqual([]);
    expect(JSON.stringify(pageMap)).not.toMatch(/oracle-phases/);
  });

  it("describes the plan overview with acceptance pairs", () => {
    const overview = pages.find((page) => page.source === "docs/plan-overview.md");
    expect(overview?.description).toContain("acceptance pairs");
  });

  it("lists the renamed page among the sources and not the old one", () => {
    const sources = listSources(REPO_ROOT);
    expect(sources).toContain("docs/acceptance-phases.md");
    expect(sources).not.toContain("docs/oracle-phases.md");
  });
});
