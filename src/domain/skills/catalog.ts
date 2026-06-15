export interface ExposedSkill {
  readonly name: string;
  readonly sourceDir: string;
  readonly files: readonly string[];
  readonly requiredFile: string;
}

export const PHAX_PLANNING_SKILL = "phax-planning";

export const EXPOSED_SKILLS: readonly ExposedSkill[] = [
  {
    name: PHAX_PLANNING_SKILL,
    sourceDir: "phax-planning",
    files: ["SKILL.md"],
    requiredFile: "SKILL.md",
  },
];

export function findExposedSkill(name: string): ExposedSkill | null {
  return EXPOSED_SKILLS.find((s) => s.name === name) ?? null;
}
