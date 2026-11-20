export type SkillTarget = "claude" | "codex" | "agent";
export type SkillScope = "project" | "user";

export const SKILL_TARGETS: readonly SkillTarget[] = ["claude", "codex", "agent"];
export const SKILL_SCOPES: readonly SkillScope[] = ["project", "user"];

export function parseSkillTarget(value: string): SkillTarget | null {
  return SKILL_TARGETS.find((target) => target === value) ?? null;
}

export function parseSkillScope(value: string): SkillScope | null {
  return SKILL_SCOPES.find((scope) => scope === value) ?? null;
}
