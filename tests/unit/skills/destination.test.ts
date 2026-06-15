import { describe, expect, it } from "vitest";
import { resolveSkillDestination } from "../../../src/domain/skills/destination.js";

const projectRoot = "/my/project";
const homeDir = "/home/user";
const skillName = "phax-planning";

describe("resolveSkillDestination", () => {
  it("claude + project → .claude/skills in projectRoot", () => {
    const { baseDir, skillDir } = resolveSkillDestination({
      target: "claude",
      scope: "project",
      projectRoot,
      homeDir,
      skillName,
    });
    expect(baseDir).toBe("/my/project/.claude/skills");
    expect(skillDir).toBe("/my/project/.claude/skills/phax-planning");
  });

  it("claude + user → .claude/skills in homeDir", () => {
    const { baseDir, skillDir } = resolveSkillDestination({
      target: "claude",
      scope: "user",
      projectRoot,
      homeDir,
      skillName,
    });
    expect(baseDir).toBe("/home/user/.claude/skills");
    expect(skillDir).toBe("/home/user/.claude/skills/phax-planning");
  });

  it("codex + project → .agents/skills in projectRoot", () => {
    const { baseDir, skillDir } = resolveSkillDestination({
      target: "codex",
      scope: "project",
      projectRoot,
      homeDir,
      skillName,
    });
    expect(baseDir).toBe("/my/project/.agents/skills");
    expect(skillDir).toBe("/my/project/.agents/skills/phax-planning");
  });

  it("codex + user → .agents/skills in homeDir", () => {
    const { baseDir, skillDir } = resolveSkillDestination({
      target: "codex",
      scope: "user",
      projectRoot,
      homeDir,
      skillName,
    });
    expect(baseDir).toBe("/home/user/.agents/skills");
    expect(skillDir).toBe("/home/user/.agents/skills/phax-planning");
  });

  it("agent + project → .agents/skills in projectRoot", () => {
    const { baseDir, skillDir } = resolveSkillDestination({
      target: "agent",
      scope: "project",
      projectRoot,
      homeDir,
      skillName,
    });
    expect(baseDir).toBe("/my/project/.agents/skills");
    expect(skillDir).toBe("/my/project/.agents/skills/phax-planning");
  });

  it("agent + user → .agents/skills in homeDir", () => {
    const { baseDir, skillDir } = resolveSkillDestination({
      target: "agent",
      scope: "user",
      projectRoot,
      homeDir,
      skillName,
    });
    expect(baseDir).toBe("/home/user/.agents/skills");
    expect(skillDir).toBe("/home/user/.agents/skills/phax-planning");
  });

  it("skillDir ends with the skillName", () => {
    const targets = ["claude", "codex", "agent"] as const;
    const scopes = ["project", "user"] as const;
    for (const target of targets) {
      for (const scope of scopes) {
        const { skillDir } = resolveSkillDestination({
          target,
          scope,
          projectRoot,
          homeDir,
          skillName,
        });
        expect(skillDir.endsWith(`/${skillName}`)).toBe(true);
      }
    }
  });
});
