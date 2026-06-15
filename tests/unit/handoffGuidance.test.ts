import { describe, expect, it } from "vitest";
import {
  HANDOFF_GUIDANCE_LINES,
  REQUIRED_HANDOFF_SECTIONS,
  buildHandoffGuidanceBlock,
} from "../../src/app/handoffGuidance.js";

describe("REQUIRED_HANDOFF_SECTIONS", () => {
  it("has exactly four headings", () => {
    expect(REQUIRED_HANDOFF_SECTIONS).toHaveLength(4);
  });

  it("contains the four required headings in order", () => {
    expect(REQUIRED_HANDOFF_SECTIONS[0]).toBe("## What was delivered");
    expect(REQUIRED_HANDOFF_SECTIONS[1]).toBe("## Key decisions and why");
    expect(REQUIRED_HANDOFF_SECTIONS[2]).toBe("## Exact locations (file paths and exported names)");
    expect(REQUIRED_HANDOFF_SECTIONS[3]).toBe("## What the next phase needs to know");
  });
});

describe("HANDOFF_GUIDANCE_LINES", () => {
  it("is non-empty", () => {
    expect(HANDOFF_GUIDANCE_LINES.length).toBeGreaterThan(0);
  });

  it("mentions the 150–400 word bound", () => {
    const joined = HANDOFF_GUIDANCE_LINES.join("\n");
    expect(joined).toContain("150");
    expect(joined).toContain("400");
  });

  it("discourages transcript summaries", () => {
    const joined = HANDOFF_GUIDANCE_LINES.join("\n");
    expect(joined).toContain("transcript");
  });
});

describe("buildHandoffGuidanceBlock", () => {
  it("includes all four section headings", () => {
    const block = buildHandoffGuidanceBlock();
    for (const section of REQUIRED_HANDOFF_SECTIONS) {
      expect(block).toContain(section);
    }
  });
});
