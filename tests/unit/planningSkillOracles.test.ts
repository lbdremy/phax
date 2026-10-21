import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SKILLS_DIR = join(import.meta.dirname, "../../.claude/skills");

function section(content: string, heading: string): string {
  const start = content.indexOf(`\n${heading}\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = content.slice(start + heading.length + 2);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("phax-planning skill — oracle phases", () => {
  const content = readFileSync(join(SKILLS_DIR, "phax-planning/SKILL.md"), "utf-8");
  const oracles = section(content, "## Oracle phases");

  it("puts the section after the planned-files section", () => {
    expect(content.indexOf("## Oracle phases")).toBeGreaterThan(
      content.indexOf("## Planned files and end-of-phase reconciliation"),
    );
  });

  it("states the provider rule", () => {
    expect(oracles).toContain("only when an `oracles` provider is configured");
    expect(oracles).toContain("keep tests and code in one phase");
  });

  it("names the two header lines", () => {
    expect(oracles).toContain("`**Oracle phase:** yes`");
    expect(oracles).toContain("`**Oracle phase:** discharged by phase-NN`");
    expect(oracles).toContain("`**Oracle files:** <paths>`");
  });

  it("makes the oracle files a subset of the planned files", () => {
    expect(oracles).toContain("subset of the oracle phase's planned files");
  });

  it("makes marker removal the discharge's only change", () => {
    expect(oracles).toContain("Removing the markers is its only change to the oracle files");
  });

  it("no longer says oracle phases are refused", () => {
    expect(content).not.toContain("until a later\nrelease runs them");
    expect(content).not.toContain('write `mode: "headless"` and `oracle: null` on every phase');
  });
});

describe("phax-decide-plan skill — oracle first", () => {
  const content = readFileSync(join(SKILLS_DIR, "phax-decide-plan/SKILL.md"), "utf-8");

  it("no longer calls the oracle files read-only", () => {
    expect(content).not.toContain("read-only for the implementing phase");
    expect(content).toContain("only by removing the markers, judged by the oracles provider");
  });
});
