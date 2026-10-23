import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BEGIN_POLICY_MARKER,
  END_POLICY_MARKER,
  renderPhaseModelPolicy,
} from "../../scripts/generate-model-catalog.js";
import { PHASE_MODEL_POLICY } from "../../src/domain/routing/phaseModelPolicy.js";

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
    expect(content).toContain("claude-sonnet-5-5");
    expect(content).toContain("claude-opus-4-8");
    expect(content).toContain("claude-haiku-5-5");
    expect(content).toContain("claude-haiku-4-5-20251001");
    expect(content).toContain("claude-fable-5-1");
    expect(content).toContain("claude-opus-5-5");
    expect(content).toContain("`claude-opus-5`");
    expect(content).toContain("gpt-6-astra");
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

  describe("choosing a model and effort", () => {
    const section = sectionOf(content, "### Choosing a model and effort");

    it("writes every phase first and assigns its model last", () => {
      expect(section).toContain(
        "Cut and write every phase first. Choose its model and effort last, from what the written phase asks for.",
      );
    });

    it("carries the generated policy block", () => {
      const begin = section.indexOf(BEGIN_POLICY_MARKER);
      const end = section.indexOf(END_POLICY_MARKER);
      expect(begin).toBeGreaterThan(-1);
      expect(section.slice(begin + BEGIN_POLICY_MARKER.length, end)).toBe(
        `\n${renderPhaseModelPolicy(PHASE_MODEL_POLICY)}\n`,
      );
    });

    it("no longer makes Opus 5.5 the default phase model", () => {
      expect(content).not.toContain("The default phase model is `claude-opus-5-5`");
    });

    it("names when to go stronger and when to go lighter", () => {
      expect(section).toContain("a new state machine");
      expect(section).toContain("an adapter to a system the code does not reach yet");
      expect(section).toContain("a choice that crosses several parts of the architecture");
      expect(section).toMatch(/Lighter \(`claude-haiku-5-5`\).*a configured gate checks it/);
    });

    it("reads the bounds through phax architecture, even on its no-provider exit", () => {
      expect(section).toContain("Read the assignment bounds before assigning");
      expect(section).toContain("`phax architecture` prints them after the parts");
      expect(section).toContain("also when it exits 1 with its no-provider line");
    });

    it("lets the first matching bound govern, with the default as the fallback", () => {
      expect(section).toContain("The first bound that matches any file the phase plans to");
      expect(section).toContain("With no match, the default above stands in.");
    });

    it("defines conformity and when a reason is due", () => {
      expect(section).toContain(
        "takes the governing bound's model at an effort inside the bound's range; with no governing bound, when it takes the default's model and effort exactly",
      );
      expect(section).toContain(
        "A conforming phase has `assignmentReason: null` and no `**Assignment reason:**` line",
      );
      expect(section).toContain("fail an unstated departure from a bound");
      expect(section).toContain("An unstated departure from the default is a warning");
    });
  });

  it("directs headless reasons into assignmentReason, never the arbitrations", () => {
    const section = sectionOf(content, "## Headless authoring");
    expect(section).toContain("assignmentReason");
    expect(section).toContain("`assignmentReason: null`");
    expect(section).toContain("preamble.technicalArbitrations");
  });

  it("no longer names the old model reason", () => {
    expect(content).not.toContain("modelReason");
    expect(content).not.toContain("**Model reason:**");
  });

  it("never lets a security loss be accepted silently", () => {
    const section = sectionOf(content, "## Technical arbitrations");
    expect(section).toContain("Never accept a security loss silently");
    expect(section).toContain("always a question for the human");
    expect(section).toContain("`openQuestions`");
  });

  it("names no layer in the planning doctrine bullets", () => {
    const doctrine = sectionOf(content, "## Planning doctrine");
    const bullets = doctrine.slice(0, doctrine.indexOf("\n### "));
    expect(bullets).toContain("Plan outside-in");
    for (const word of ["view-model", "port", "adapter", "domain"]) {
      expect(bullets).not.toMatch(new RegExp(`\\b${word}\\b`, "i"));
    }
  });

  it("presents the layer chain and boundary list as the example architecture", () => {
    const example = sectionOf(content, "### One example architecture");
    expect(example).toContain("page → view-model → command → domain → port → adapter");
    expect(example).toContain("Use it only where the repository is built this way.");

    const boundaries = sectionOf(content, "## Boundary contracts (informational)");
    expect(boundaries).toMatch(/in the example\s+architecture: page\/cli\/surface → view-model/);
  });

  it("keys test defaults on the kind of code, one line per guarantee on four coordinates", () => {
    const tests = sectionOf(content, "## Test strategy (informational)");
    expect(tests).toContain("Read the kind from the repository's architecture");
    expect(tests).toMatch(/\| Kind of code\s+\|/);
    expect(tests).not.toMatch(/\| Layer\s+\|/);
    expect(tests).toContain(
      "- <guarantee> — <size> · <technique> · <oracle> · <oracle | in-phase>[ · <acceptance criterion id>]",
    );
  });

  it("holds oracles to the acceptance loop", () => {
    const section = sectionOf(content, "### What makes a good oracle");
    expect(section).toContain("the acceptance loop, not test-driven development");
    expect(section).toContain("**It fails for the reason it states.**");
    expect(section).toContain("**Not every test is an oracle.**");
  });

  it("reads the repository's architecture from `phax architecture`, or from its code and documentation", () => {
    const section = sectionOf(content, "### The repository's architecture");
    expect(section).toContain("`phax architecture`");
    expect(section).toContain("exits 1");
    expect(section).toContain("README");
    expect(section).toContain("CLAUDE.md");
    expect(section).toContain("carry on");
    expect(section).toContain("not a failure of the repository");
  });

  it("keeps the comprehensive-instructions constraint", () => {
    expect(content).toContain(
      "**Comprehensive instructions.** Make sure each phase has enough detail for the\n  model and effort you picked to execute it successfully.",
    );
  });
});

// The text from `heading` up to the next heading of the same or a higher level.
function sectionOf(content: string, heading: string): string {
  const start = content.indexOf(`\n${heading}\n`);
  if (start === -1) throw new Error(`SKILL.md has no ${heading} section`);
  const level = heading.indexOf(" ");
  const rest = content.slice(start + heading.length + 2);
  const next = rest.search(new RegExp(`\\n#{1,${level}} `));
  return next === -1 ? rest : rest.slice(0, next);
}
