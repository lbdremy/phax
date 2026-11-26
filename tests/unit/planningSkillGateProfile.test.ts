// The planning skill names a plan's gate profile once, in the run-level
// `## Gate profile` declaration, and no longer in a phase's Verification.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const skill = readFileSync(
  join(import.meta.dirname, "../../.claude/skills/phax-planning/SKILL.md"),
  "utf8",
);

const flat = (text: string): string => text.replace(/\s+/g, " ");

describe("phax-planning skill — gate profile", () => {
  it("documents the run-level declaration, made before the first phase", () => {
    const start = skill.indexOf("\n## Gate profile declaration\n");
    const end = skill.indexOf("\n## Required commands declaration\n");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const section = skill.slice(start, end);

    expect(section).toContain("```markdown\n## Gate profile\n\n`standard`\n```");
    expect(flat(section)).toContain("Every plan declares, before its first phase, exactly one");
    expect(flat(section)).toContain("refuse a missing, doubled or undefined declaration");
    expect(flat(section)).toContain("A phase cannot have a profile of its own.");
  });

  it("tells no Verification to name the profile", () => {
    const row = skill.split("\n").find((line) => line.startsWith("| Verification ")) ?? "";
    // The template's section comes first, then the example phase's.
    const verifications = skill
      .split("\n### Verification\n")
      .slice(1)
      .map((rest) => rest.slice(0, rest.indexOf("\n### ")).trim());

    expect(row).toContain(
      "what proves the phase beyond the declared gate profile; never the profile's name",
    );
    expect(verifications).toHaveLength(2);
    expect(verifications[0]).toBe(
      "<what proves this phase beyond the declared gate profile — never the profile's name>",
    );
    for (const text of [row, ...verifications]) {
      expect(text).not.toContain("`standard`");
      expect(text).not.toMatch(/\(names the|names the configured/);
    }
    expect(skill).not.toContain("gate profile in `phax.json`");
    expect(flat(skill)).not.toContain("`### Verification` names");
  });
});
