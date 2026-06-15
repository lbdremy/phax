import { describe, expect, it } from "vitest";
import {
  EXPOSED_SKILLS,
  PHAX_PLANNING_SKILL,
  findExposedSkill,
} from "../../../src/domain/skills/catalog.js";
import {
  SKILL_SCOPES,
  SKILL_TARGETS,
  parseSkillScope,
  parseSkillTarget,
} from "../../../src/domain/skills/types.js";

describe("EXPOSED_SKILLS", () => {
  it("contains exactly phax-planning", () => {
    expect(EXPOSED_SKILLS).toHaveLength(1);
    expect(EXPOSED_SKILLS[0]?.name).toBe("phax-planning");
  });

  it("phax-planning has files: ['SKILL.md']", () => {
    expect(EXPOSED_SKILLS[0]?.files).toEqual(["SKILL.md"]);
  });

  it("PHAX_PLANNING_SKILL constant matches the catalog entry", () => {
    expect(PHAX_PLANNING_SKILL).toBe("phax-planning");
    expect(EXPOSED_SKILLS[0]?.name).toBe(PHAX_PLANNING_SKILL);
  });
});

describe("findExposedSkill", () => {
  it("returns the skill for 'phax-planning'", () => {
    const skill = findExposedSkill("phax-planning");
    expect(skill).not.toBeNull();
    expect(skill?.name).toBe("phax-planning");
  });

  it("returns null for an unknown name", () => {
    expect(findExposedSkill("unknown-skill")).toBeNull();
    expect(findExposedSkill("")).toBeNull();
  });
});

describe("parseSkillTarget", () => {
  it("accepts all valid targets", () => {
    for (const t of SKILL_TARGETS) {
      expect(parseSkillTarget(t)).toBe(t);
    }
  });

  it("rejects invalid values", () => {
    expect(parseSkillTarget("all")).toBeNull();
    expect(parseSkillTarget("")).toBeNull();
    expect(parseSkillTarget("vscode")).toBeNull();
  });
});

describe("parseSkillScope", () => {
  it("accepts all valid scopes", () => {
    for (const s of SKILL_SCOPES) {
      expect(parseSkillScope(s)).toBe(s);
    }
  });

  it("rejects invalid values", () => {
    expect(parseSkillScope("global")).toBeNull();
    expect(parseSkillScope("")).toBeNull();
  });
});
