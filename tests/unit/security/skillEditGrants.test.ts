import { describe, expect, it } from "vitest";
import { resolveSkillEditGrants } from "../../../src/domain/security/skillEditGrants.js";

describe("resolveSkillEditGrants", () => {
  it("keeps a declared skill file", () => {
    expect(resolveSkillEditGrants([".claude/skills/foo/SKILL.md"])).toEqual([
      ".claude/skills/foo/SKILL.md",
    ]);
  });

  it("normalizes ./, repeated slashes and . segments, then de-duplicates", () => {
    expect(
      resolveSkillEditGrants([".claude/skills/foo/SKILL.md", "./.claude/skills//foo/./SKILL.md"]),
    ).toEqual([".claude/skills/foo/SKILL.md"]);
  });

  it("drops paths that are not files under .claude/skills/", () => {
    expect(
      resolveSkillEditGrants([
        ".claude/settings.json",
        ".claude/skills",
        ".claude/skills/",
        "src/x.ts",
        ".claude/skillsfoo/x.md",
      ]),
    ).toEqual([]);
  });

  it("drops absolute paths and paths with .. segments", () => {
    expect(
      resolveSkillEditGrants([
        "../.claude/skills/x.md",
        "/abs/.claude/skills/x.md",
        ".claude/skills/foo/../bar/SKILL.md",
      ]),
    ).toEqual([]);
  });

  it("drops paths containing permission-rule metacharacters", () => {
    expect(
      resolveSkillEditGrants([
        ".claude/skills/*/SKILL.md",
        ".claude/skills/foo/SKILL?.md",
        ".claude/skills/[a]/SKILL.md",
        ".claude/skills/foo/(x).md",
        ".claude/skills/{a,b}/SKILL.md",
      ]),
    ).toEqual([]);
  });

  it("preserves input order", () => {
    expect(
      resolveSkillEditGrants([
        ".claude/skills/zeta/SKILL.md",
        "src/x.ts",
        ".claude/skills/alpha/references/a.md",
        ".claude/skills/zeta/SKILL.md",
      ]),
    ).toEqual([".claude/skills/zeta/SKILL.md", ".claude/skills/alpha/references/a.md"]);
  });
});
