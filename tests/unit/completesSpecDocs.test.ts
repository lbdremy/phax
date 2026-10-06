// The planning skill and the README teach the plan's completes-spec key
// (spec completes-spec §8: the planning skill teaches the key).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

const skill = read(".claude/skills/phax-planning/SKILL.md");
const readme = read("README.md");

// The skill's "Plan frontmatter block" section, up to the next level-2 heading.
function frontmatterSection(): string {
  const start = skill.indexOf("## Plan frontmatter block");
  if (start === -1) throw new Error("SKILL.md has no Plan frontmatter block section");
  const next = skill.indexOf("\n## ", start + 1);
  return skill.slice(start, next === -1 ? undefined : next);
}

describe("completes-spec docs", () => {
  const section = frontmatterSection();

  it("the skill's plan frontmatter section defines completes-spec as true or false", () => {
    expect(section).toContain("**`completes-spec`**");
    expect(section).toContain("completes-spec: false");
    expect(section).toMatch(/`true`/);
    expect(section).toMatch(/`false`/);
  });

  it("the skill says the key is absent when source-spec is null", () => {
    expect(section).toContain("absent");
    expect(section).toContain("`null`");
  });

  it("the skill says every plan except the last carries false", () => {
    const flat = section.replace(/\s+/g, " ").toLowerCase();
    expect(flat).toContain("every plan of a spec except the last says `false`");
  });

  it("the skill teaches the creation flags", () => {
    expect(section).toContain("--last|--not-last");
  });

  it("the README shows --not-last", () => {
    expect(readme).toContain("--not-last");
  });
});
