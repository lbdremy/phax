import { describe, expect, it } from "vitest";
import { buildSkillEditGrantSettings } from "../../../src/infra/providers/claudeSkillEditSettings.js";

const ALLOW_ECHO = `echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}'`;

describe("buildSkillEditGrantSettings", () => {
  it("returns undefined when nothing is granted", () => {
    expect(buildSkillEditGrantSettings("/wt", [])).toBeUndefined();
  });

  it("emits one PermissionRequest handler per grant and edit tool", () => {
    const settings = buildSkillEditGrantSettings("/wt", [
      ".claude/skills/foo/SKILL.md",
      ".claude/skills/bar/SKILL.md",
    ]);
    expect(settings).toEqual({
      hooks: {
        PermissionRequest: [
          {
            matcher: "Edit|Write|MultiEdit",
            hooks: [
              {
                type: "command",
                if: "Edit(//wt/.claude/skills/foo/SKILL.md)",
                command: ALLOW_ECHO,
              },
              {
                type: "command",
                if: "Write(//wt/.claude/skills/foo/SKILL.md)",
                command: ALLOW_ECHO,
              },
              {
                type: "command",
                if: "MultiEdit(//wt/.claude/skills/foo/SKILL.md)",
                command: ALLOW_ECHO,
              },
              {
                type: "command",
                if: "Edit(//wt/.claude/skills/bar/SKILL.md)",
                command: ALLOW_ECHO,
              },
              {
                type: "command",
                if: "Write(//wt/.claude/skills/bar/SKILL.md)",
                command: ALLOW_ECHO,
              },
              {
                type: "command",
                if: "MultiEdit(//wt/.claude/skills/bar/SKILL.md)",
                command: ALLOW_ECHO,
              },
            ],
          },
        ],
      },
    });
  });

  it("tolerates a trailing slash on the worktree root", () => {
    const settings = buildSkillEditGrantSettings("/wt/", [".claude/skills/foo/SKILL.md"]);
    expect(JSON.stringify(settings)).toContain('"Edit(//wt/.claude/skills/foo/SKILL.md)"');
  });

  it("round-trips through JSON", () => {
    const settings = buildSkillEditGrantSettings("/wt", [".claude/skills/foo/SKILL.md"]);
    expect(JSON.parse(JSON.stringify(settings))).toEqual(settings);
  });
});
