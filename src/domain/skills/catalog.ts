export interface ExposedSkill {
  readonly name: string;
  readonly sourceDir: string;
  readonly files: readonly string[];
  readonly requiredFile: string;
}

export const PHAX_PLANNING_SKILL = "phax-planning";
export const PHAX_CLI_SKILL = "phax-cli";
export const PHAX_SPEC_SKILL = "phax-spec";
export const PHAX_REVIEW_SKILL = "phax-review";
export const PHAX_DECIDE_SPEC_SKILL = "phax-decide-spec";
export const PHAX_DECIDE_PLAN_SKILL = "phax-decide-plan";
export const PHAX_DECIDE_REVIEW_SKILL = "phax-decide-review";

export const EXPOSED_SKILLS: readonly ExposedSkill[] = [
  {
    name: PHAX_PLANNING_SKILL,
    sourceDir: "phax-planning",
    files: ["SKILL.md"],
    requiredFile: "SKILL.md",
  },
  {
    name: PHAX_CLI_SKILL,
    sourceDir: "phax-cli",
    files: ["SKILL.md"],
    requiredFile: "SKILL.md",
  },
  {
    name: PHAX_SPEC_SKILL,
    sourceDir: "phax-spec",
    files: ["SKILL.md"],
    requiredFile: "SKILL.md",
  },
  {
    name: PHAX_REVIEW_SKILL,
    sourceDir: "phax-review",
    files: ["SKILL.md"],
    requiredFile: "SKILL.md",
  },
  {
    name: PHAX_DECIDE_SPEC_SKILL,
    sourceDir: "phax-decide-spec",
    files: ["SKILL.md"],
    requiredFile: "SKILL.md",
  },
  {
    name: PHAX_DECIDE_PLAN_SKILL,
    sourceDir: "phax-decide-plan",
    files: ["SKILL.md"],
    requiredFile: "SKILL.md",
  },
  {
    name: PHAX_DECIDE_REVIEW_SKILL,
    sourceDir: "phax-decide-review",
    files: ["SKILL.md"],
    requiredFile: "SKILL.md",
  },
];

export const EXPOSED_SKILL_NAMES: readonly string[] = EXPOSED_SKILLS.map((s) => s.name);

export function findExposedSkill(name: string): ExposedSkill | null {
  return EXPOSED_SKILLS.find((s) => s.name === name) ?? null;
}
