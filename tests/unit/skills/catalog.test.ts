import { describe, expect, it } from "vitest";
import {
  EXPOSED_SKILLS,
  EXPOSED_SKILL_NAMES,
  PHAX_CLI_SKILL,
  PHAX_DECIDE_PLAN_SKILL,
  PHAX_DECIDE_REVIEW_SKILL,
  PHAX_DECIDE_SPEC_SKILL,
  PHAX_PLANNING_SKILL,
  PHAX_SPEC_SKILL,
  findExposedSkill,
} from "../../../src/domain/skills/catalog.js";
import {
  SKILL_SCOPES,
  SKILL_TARGETS,
  parseSkillScope,
  parseSkillTarget,
} from "../../../src/domain/skills/types.js";

describe("EXPOSED_SKILLS", () => {
  it("lists the six skills in order, the three doctrine skills after phax-spec", () => {
    expect(EXPOSED_SKILLS).toHaveLength(6);
    expect(EXPOSED_SKILLS.map((s) => s.name)).toEqual([
      "phax-planning",
      "phax-cli",
      "phax-spec",
      "phax-decide-spec",
      "phax-decide-plan",
      "phax-decide-review",
    ]);
  });

  it("every skill's source directory is its name", () => {
    for (const skill of EXPOSED_SKILLS) {
      expect(skill.sourceDir).toBe(skill.name);
    }
  });

  it("every exposed skill ships SKILL.md as its required file", () => {
    for (const skill of EXPOSED_SKILLS) {
      expect(skill.files).toEqual(["SKILL.md"]);
      expect(skill.requiredFile).toBe("SKILL.md");
    }
  });

  it("PHAX constants match catalog entries", () => {
    expect(PHAX_PLANNING_SKILL).toBe("phax-planning");
    expect(PHAX_CLI_SKILL).toBe("phax-cli");
    expect(PHAX_SPEC_SKILL).toBe("phax-spec");
    expect(PHAX_DECIDE_SPEC_SKILL).toBe("phax-decide-spec");
    expect(PHAX_DECIDE_PLAN_SKILL).toBe("phax-decide-plan");
    expect(PHAX_DECIDE_REVIEW_SKILL).toBe("phax-decide-review");
    expect(EXPOSED_SKILL_NAMES).toEqual([
      PHAX_PLANNING_SKILL,
      PHAX_CLI_SKILL,
      PHAX_SPEC_SKILL,
      PHAX_DECIDE_SPEC_SKILL,
      PHAX_DECIDE_PLAN_SKILL,
      PHAX_DECIDE_REVIEW_SKILL,
    ]);
  });
});

describe("findExposedSkill", () => {
  it("returns the skill for 'phax-planning'", () => {
    const skill = findExposedSkill("phax-planning");
    expect(skill).not.toBeNull();
    expect(skill?.name).toBe("phax-planning");
  });

  it("returns the skill for 'phax-cli'", () => {
    const skill = findExposedSkill("phax-cli");
    expect(skill).not.toBeNull();
    expect(skill?.name).toBe("phax-cli");
  });

  it("returns the skill for 'phax-spec'", () => {
    const skill = findExposedSkill("phax-spec");
    expect(skill).not.toBeNull();
    expect(skill?.name).toBe("phax-spec");
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
