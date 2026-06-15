export type SkillTarget = "claude" | "codex" | "agent";
export type SkillScope = "project" | "user";

export const SKILL_TARGETS: readonly SkillTarget[] = ["claude", "codex", "agent"];
export const SKILL_SCOPES: readonly SkillScope[] = ["project", "user"];

export function parseSkillTarget(value: string): SkillTarget | null {
  return (SKILL_TARGETS as readonly string[]).includes(value) ? (value as SkillTarget) : null;
}

export function parseSkillScope(value: string): SkillScope | null {
  return (SKILL_SCOPES as readonly string[]).includes(value) ? (value as SkillScope) : null;
}
