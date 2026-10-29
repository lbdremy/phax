import { describe, expect, it } from "vitest";
import { protectedList } from "../../../src/domain/security/protectedPaths.js";
import {
  checkSkillEditConsent,
  formatSkillEditProtectedRefusal,
  resolveSkillEditGrants,
  skillEditProtectedConflicts,
} from "../../../src/domain/security/skillEditGrants.js";

function phase(id: string, edit: readonly string[], create: readonly string[] = []) {
  return { id, plannedFilesToCreate: create, plannedFilesToEdit: edit, optionalFilesToEdit: [] };
}

describe("checkSkillEditConsent", () => {
  const phases = [
    phase("phase-01", ["src/x.ts"]),
    phase("phase-02", [".claude/skills/foo/SKILL.md"], ["src/y.ts"]),
  ];

  it("names the phase and file that need consent when none was given", () => {
    expect(checkSkillEditConsent({ phases, allowSkillEdits: false })).toEqual([
      { phaseId: "phase-02", files: [".claude/skills/foo/SKILL.md"] },
    ]);
  });

  it("covers the create and optional lists too", () => {
    expect(
      checkSkillEditConsent({
        phases: [
          {
            id: "phase-01",
            plannedFilesToCreate: [".claude/skills/new/SKILL.md"],
            plannedFilesToEdit: [],
            optionalFilesToEdit: [".claude/skills/opt/SKILL.md"],
          },
        ],
        allowSkillEdits: false,
      }),
    ).toEqual([
      {
        phaseId: "phase-01",
        files: [".claude/skills/new/SKILL.md", ".claude/skills/opt/SKILL.md"],
      },
    ]);
  });

  it("returns [] with consent", () => {
    expect(checkSkillEditConsent({ phases, allowSkillEdits: true })).toEqual([]);
  });

  it("returns [] when no phase declares a skill file, with or without consent", () => {
    const plain = [phase("phase-01", ["src/x.ts", ".claude/settings.json"])];
    expect(checkSkillEditConsent({ phases: plain, allowSkillEdits: false })).toEqual([]);
    expect(checkSkillEditConsent({ phases: plain, allowSkillEdits: true })).toEqual([]);
  });
});

describe("resolveSkillEditGrants", () => {
  it("keeps a declared skill file", () => {
    expect(resolveSkillEditGrants([".claude/skills/foo/SKILL.md"])).toEqual([
      ".claude/skills/foo/SKILL.md",
    ]);
  });

  it("normalizes ./, repeated slashes and . segments, then de-duplicates", () => {
    expect(
      resolveSkillEditGrants([".claude/skills/foo/SKILL.md", "./.claude/skills//foo/./SKILL.md"]),
    ).toEqual([".claude/skills/foo/SKILL.md"]);
  });

  it("drops paths that are not files under .claude/skills/", () => {
    expect(
      resolveSkillEditGrants([
        ".claude/settings.json",
        ".claude/skills",
        ".claude/skills/",
        "src/x.ts",
        ".claude/skillsfoo/x.md",
      ]),
    ).toEqual([]);
  });

  it("drops absolute paths and paths with .. segments", () => {
    expect(
      resolveSkillEditGrants([
        "../.claude/skills/x.md",
        "/abs/.claude/skills/x.md",
        ".claude/skills/foo/../bar/SKILL.md",
      ]),
    ).toEqual([]);
  });

  it("drops paths containing permission-rule metacharacters", () => {
    expect(
      resolveSkillEditGrants([
        ".claude/skills/*/SKILL.md",
        ".claude/skills/foo/SKILL?.md",
        ".claude/skills/[a]/SKILL.md",
        ".claude/skills/foo/(x).md",
        ".claude/skills/{a,b}/SKILL.md",
      ]),
    ).toEqual([]);
  });

  it("preserves input order", () => {
    expect(
      resolveSkillEditGrants([
        ".claude/skills/zeta/SKILL.md",
        "src/x.ts",
        ".claude/skills/alpha/references/a.md",
        ".claude/skills/zeta/SKILL.md",
      ]),
    ).toEqual([".claude/skills/zeta/SKILL.md", ".claude/skills/alpha/references/a.md"]);
  });
});

describe("skillEditProtectedConflicts", () => {
  const list = protectedList([".claude/skills/release/**", "docs/*.md"], "phax.json") ?? [];
  const phases = [
    phase("phase-01", ["src/x.ts", ".claude/skills/foo/SKILL.md"]),
    phase("phase-02", [".claude/skills/release/SKILL.md"], [".claude/skills/release/ref/a.md"]),
  ];

  it("names each granted file a protected glob matches, with its entry and glob", () => {
    expect(skillEditProtectedConflicts(phases, list)).toEqual([
      {
        phaseId: "phase-02",
        file: ".claude/skills/release/ref/a.md",
        entry: "protectedPaths[0]",
        glob: ".claude/skills/release/**",
      },
      {
        phaseId: "phase-02",
        file: ".claude/skills/release/SKILL.md",
        entry: "protectedPaths[0]",
        glob: ".claude/skills/release/**",
      },
    ]);
  });

  it("matches case-folded, like the check", () => {
    const folded = protectedList([".CLAUDE/skills/foo/**"], "phax.json") ?? [];
    expect(skillEditProtectedConflicts(phases, folded).map((c) => c.file)).toEqual([
      ".claude/skills/foo/SKILL.md",
    ]);
  });

  it("is empty when no granted file is protected", () => {
    const other = protectedList(["docs/*.md"], "phax.json") ?? [];
    expect(skillEditProtectedConflicts(phases, other)).toEqual([]);
  });

  it("formats one line per conflict under the preflight header", () => {
    const conflicts = skillEditProtectedConflicts(phases.slice(1), list);
    expect(formatSkillEditProtectedRefusal(conflicts).split("\n").slice(0, 3)).toEqual([
      "Security preflight failed: a skill edit grant names a protected path.",
      "  phase-02: .claude/skills/release/ref/a.md (protectedPaths[0] .claude/skills/release/**)",
      "  phase-02: .claude/skills/release/SKILL.md (protectedPaths[0] .claude/skills/release/**)",
    ]);
  });
});
