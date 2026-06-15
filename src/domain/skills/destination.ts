import { join } from "node:path";
import type { SkillScope, SkillTarget } from "./types.js";

export interface SkillDestinationInput {
  target: SkillTarget;
  scope: SkillScope;
  projectRoot: string;
  homeDir: string;
  skillName: string;
}

export function resolveSkillDestination(input: SkillDestinationInput): {
  baseDir: string;
  skillDir: string;
} {
  const { target, scope, projectRoot, homeDir, skillName } = input;
  const root = scope === "project" ? projectRoot : homeDir;
  const relativeBase = target === "claude" ? ".claude/skills" : ".agents/skills";
  const baseDir = join(root, relativeBase);
  const skillDir = join(baseDir, skillName);
  return { baseDir, skillDir };
}
