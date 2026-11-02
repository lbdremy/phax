import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installSkill } from "../../src/app/skills/installSkill.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";

const REPO_ROOT = join(import.meta.dirname, "../..");
const SKILLS_DIR = join(REPO_ROOT, ".claude/skills");

function section(content: string, heading: string): string {
  const start = content.indexOf(`\n${heading}\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = content.slice(start + heading.length + 2);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

const flat = (text: string): string => text.replace(/\s+/g, " ");

describe("phax-planning skill — acceptance phases", () => {
  const content = readFileSync(join(SKILLS_DIR, "phax-planning/SKILL.md"), "utf-8");
  const acceptance = section(content, "## Acceptance phases");

  it("puts the section after the planned-files section", () => {
    expect(content.indexOf("## Acceptance phases")).toBeGreaterThan(
      content.indexOf("## Planned files and end-of-phase reconciliation"),
    );
  });

  it("states the provider rule", () => {
    expect(acceptance).toContain("only when an `acceptance` provider is configured");
    expect(acceptance).toContain("keep tests and code in one phase");
  });

  it("names the three header lines", () => {
    expect(acceptance).toContain("`**Acceptance phase:** yes`");
    expect(acceptance).toContain("`**Acceptance phase:** passed by phase-NN`");
    expect(acceptance).toContain("`**Acceptance test files:** <paths>`");
  });

  it("makes the acceptance test files a subset of the planned files", () => {
    expect(acceptance).toContain("subset of the acceptance phase's planned files");
  });

  it("makes marker removal the passing phase's only change", () => {
    expect(acceptance).toContain(
      "Removing the markers is its only change to the acceptance test files",
    );
  });

  it("has lint exit 1 and only run and resume exit 11", () => {
    expect(acceptance).toContain("`phax plans lint` reports an `acceptance` error\n  and exits 1");
    expect(acceptance).toContain("`phax run` and `phax resume` refuse the plan with exit 11");
  });

  it("no longer says acceptance phases are refused", () => {
    expect(content).not.toContain("until a later\nrelease runs them");
    expect(content).not.toContain('write `mode: "headless"` and `acceptance: null` on every phase');
  });

  it("names the phase key, its passedBy form and the key order", () => {
    expect(content).toContain('`acceptance: { passedBy: "phase-NN", files: [...] }`');
    expect(content).toContain("`optionalFilesToEdit`, `mode`, `acceptance`, `boundaryContracts`");
  });

  it("adds the Acceptance candidate column", () => {
    const tests = section(content, "## Test strategy");
    expect(tests).toMatch(/\| Acceptance candidate\s+\|/);
  });

  it("states that acceptance names a test's purpose, not its size", () => {
    const tests = flat(section(content, "## Test strategy"));
    expect(tests).toContain(
      "`acceptance` names a test's purpose, checking a specified acceptance criterion, not its size: an acceptance test may be `small`.",
    );
  });

  it("describes boundary directly after example in the technique list", () => {
    const tests = flat(section(content, "## Test strategy"));
    expect(tests).toContain(
      "`example` (hand-picked cases), `boundary` (equivalence partitions and boundary values: the empty case, each limit, just outside it; not the code review's `boundary` lens), `table`",
    );
  });

  it("writes the loop as acceptance | in-phase", () => {
    const tests = section(content, "## Test strategy");
    expect(tests).toContain(
      "- <guarantee> — <size> · <technique> · <oracle> · <acceptance | in-phase>[ · <acceptance criterion id>]",
    );
    expect(tests).toContain("· acceptance · AC-3");
  });
});

describe("phax-decide-plan skill — acceptance first", () => {
  const content = readFileSync(join(SKILLS_DIR, "phax-decide-plan/SKILL.md"), "utf-8");

  it("no longer calls the acceptance test files read-only", () => {
    expect(content).not.toContain("read-only for the implementing phase");
    expect(content).toContain("only by removing the markers, judged by\n  the acceptance provider");
  });

  it("puts acceptance first only when an acceptance provider is configured", () => {
    const p3 = content.slice(content.indexOf("- `P3`"), content.indexOf("- `P4`"));
    expect(p3).toContain(
      "**Acceptance first, when the surface is shown and a provider is configured.**",
    );
    expect(p3).toContain("With no `acceptance` provider, or when the surface is only described");
    expect(p3).toContain("An acceptance test is the acceptance loop, never the inner");
    expect(flat(p3)).toContain('the planning skill\'s "What makes a good acceptance test"');
  });

  it("names no disposition matrix", () => {
    expect(content).not.toContain("disposition matri");
  });
});

describe("phax-decide-review and phax-review skills", () => {
  it("decide-review says acceptance tests are not fix targets", () => {
    const content = readFileSync(join(SKILLS_DIR, "phax-decide-review/SKILL.md"), "utf-8");
    expect(content).toContain("**Acceptance tests are not fix targets.**");
    expect(content).toContain("no acceptance test files (`R4`)");
  });

  it("review says acceptance pairs and keeps the wrong-oracle escape", () => {
    const content = readFileSync(join(SKILLS_DIR, "phax-review/SKILL.md"), "utf-8");
    expect(content).toContain("**the acceptance pairs**");
    expect(content).toContain("loop (`acceptance` or `in-phase`)");
    expect(content).toContain("| `wrong-oracle` |");
    expect(content).toContain(
      "A frozen acceptance test whose oracle is wrong passes the whole run.",
    );
    expect(content).toContain("Review the acceptance tests first.");
  });
});

describe("phax-planning skill — as `phax skills install` writes it", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "phax-skill-acceptance-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("is byte-identical to the copy under .claude/skills and holds the acceptance section", async () => {
    const projectRoot = join(tmpRoot, "project");
    const homeDir = join(tmpRoot, "home");
    const result = await Effect.runPromise(
      installSkill({
        skillName: "phax-planning",
        target: "claude",
        scope: "project",
        projectRoot,
        homeDir,
        // The bundle root `phax skills install` uses: the folder holding each skill's directory.
        bundleRoot: SKILLS_DIR,
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );
    const installed = readFileSync(join(result.destination, "SKILL.md"));
    const source = readFileSync(join(SKILLS_DIR, "phax-planning/SKILL.md"));
    expect(installed.equals(source)).toBe(true);
    expect(installed.toString("utf-8")).toContain("## Acceptance phases");
  });
});
