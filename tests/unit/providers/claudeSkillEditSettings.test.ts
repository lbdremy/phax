import { describe, expect, it } from "vitest";
import {
  buildClaudeSessionSettings,
  buildSkillEditGrantSettings,
} from "../../../src/infra/providers/claudeSkillEditSettings.js";

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

describe("buildClaudeSessionSettings", () => {
  const DENY = ["Edit(//wt/**/steme.baseline.json)", "Edit(//wt/phax.json)"];
  const GRANTS = [".claude/skills/foo/SKILL.md"];

  it("is undefined with no grant and no deny rule", () => {
    expect(buildClaudeSessionSettings("/wt", [], [])).toBeUndefined();
  });

  it("is exactly the deny rules when there is no grant", () => {
    const settings = buildClaudeSessionSettings("/wt", [], DENY);
    expect(JSON.stringify(settings)).toBe(
      '{"permissions":{"deny":["Edit(//wt/**/steme.baseline.json)","Edit(//wt/phax.json)"]}}',
    );
  });

  it("is the grant hooks alone when there is no deny rule", () => {
    expect(buildClaudeSessionSettings("/wt", GRANTS, [])).toEqual(
      buildSkillEditGrantSettings("/wt", GRANTS),
    );
  });

  it("merges the grant hooks with the deny rules", () => {
    expect(buildClaudeSessionSettings("/wt", GRANTS, DENY)).toEqual({
      ...buildSkillEditGrantSettings("/wt", GRANTS),
      permissions: { deny: DENY },
    });
  });
});
