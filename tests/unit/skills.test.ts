import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SKILLS_DIR = join(import.meta.dirname, "../../.skills");

function readSkill(name: string): string {
  return readFileSync(join(SKILLS_DIR, name), "utf-8");
}

describe("phax-planning.md skill", () => {
  const content = readSkill("phax-planning.md");

  it("exists and is non-empty", () => {
    expect(content.length).toBeGreaterThan(0);
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
    expect(content).toContain("claude-opus-4-7");
    expect(content).toContain("claude-haiku-4-5-20251001");
  });

  it("lists all valid effort values", () => {
    expect(content).toContain("low");
    expect(content).toContain("medium");
    expect(content).toContain("high");
  });
});

describe("phax-phase-handoff.md skill", () => {
  const content = readSkill("phax-phase-handoff.md");

  it("exists and is non-empty", () => {
    expect(content.length).toBeGreaterThan(0);
  });

  it("has required structural headings", () => {
    expect(content).toContain("## Required sections");
    expect(content).toContain("## What to write in each section");
    expect(content).toContain("## Tone and length");
    expect(content).toContain("## Anti-patterns");
  });

  it("declares all four required section headings", () => {
    expect(content).toContain("## What was delivered");
    expect(content).toContain("## Key decisions and why");
    expect(content).toContain("## Exact locations (file paths and exported names)");
    expect(content).toContain("## What the next phase needs to know");
  });

  it("mentions handoff_failed consequence", () => {
    expect(content).toContain("handoff_failed");
  });
});
