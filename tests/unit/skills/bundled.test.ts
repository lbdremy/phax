import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPOSED_SKILLS } from "../../../src/domain/skills/catalog.js";

// Resolve bundle root the same way the CLI does:
// tests/unit/skills/ is 3 levels deep, so ../../.. reaches the package root.
const bundleRoot = join(import.meta.dirname, "../../..", ".claude", "skills");

describe("bundled phax-planning skill", () => {
  it("SKILL.md exists and is non-empty", () => {
    const skillMd = join(bundleRoot, "phax-planning", "SKILL.md");
    expect(existsSync(skillMd), `${skillMd} must exist`).toBe(true);
    const content = readFileSync(skillMd, "utf8");
    expect(content.length).toBeGreaterThan(0);
  });

  it("all manifest files for phax-planning exist under bundle root", () => {
    const skill = EXPOSED_SKILLS.find((s) => s.name === "phax-planning");
    expect(skill).toBeDefined();
    for (const file of skill!.files) {
      const filePath = join(bundleRoot, skill!.sourceDir, file);
      expect(existsSync(filePath), `${filePath} must exist`).toBe(true);
    }
  });

  it("package.json files whitelist includes .claude/skills/phax-planning", () => {
    const pkgPath = join(import.meta.dirname, "../../..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      files?: string[];
    };
    expect(pkg.files).toBeDefined();
    expect(pkg.files).toContain(".claude/skills/phax-planning");
  });
});
