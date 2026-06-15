import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SKILLS_DIR = join(import.meta.dirname, "../../.claude/skills");

function readSkill(name: string): string {
  return readFileSync(join(SKILLS_DIR, name), "utf-8");
}

describe("phax-planning skill", () => {
  const content = readSkill("phax-planning/SKILL.md");

  it("exists and is non-empty", () => {
    expect(content.length).toBeGreaterThan(0);
  });

  it("has YAML frontmatter with name and description", () => {
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("name: phax-planning");
    expect(content).toMatch(/description: .+/);
  });

  it("has required headings", () => {
    expect(content).toContain("## What phax expects");
    expect(content).toContain("## Per-phase field set");
    expect(content).toContain("## Heading format");
    expect(content).toContain("## Planning constraints");
    expect(content).toContain("## Anti-patterns to avoid");
  });

  it("documents extracted fields", () => {
    expect(content).toContain("planMarkdownAnchor");
    expect(content).toContain("commit.subject");
    expect(content).toContain("commit.body");
  });

  it("lists all valid model IDs", () => {
    expect(content).toContain("claude-sonnet-4-6");
    expect(content).toContain("claude-opus-4-8");
    expect(content).toContain("claude-haiku-4-5-20251001");
  });

  it("lists per-family effort values", () => {
    expect(content).toContain("claude-haiku");
    expect(content).toContain("none");
    expect(content).toContain("claude-sonnet");
    expect(content).toContain("low");
    expect(content).toContain("medium");
    expect(content).toContain("high");
    expect(content).toContain("max");
    expect(content).toContain("claude-opus");
    expect(content).toContain("xhigh");
    expect(content).toContain("ultracode");
    expect(content).toContain("mistral-medium");
    expect(content).toContain("off");
    expect(content).toContain("openai-gpt");
  });
});
