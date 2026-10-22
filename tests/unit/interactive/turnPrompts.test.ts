import { describe, expect, it } from "vitest";
import { renderFirstReading } from "../../../src/domain/interactive/firstReading.js";
import {
  CLOSING_DIFF_LIMIT_BYTES,
  closingTurnPrompt,
  correctivePrompt,
  cutDiff,
  firstTurnPrompt,
  freshStartPrompt,
} from "../../../src/domain/interactive/turnPrompts.js";

const schemaJson = '{"type":"object","title":"schema-marker"}';
const STOPPING =
  /phax stop|abort|interrupt|ctrl-?c|SIGINT|kill |exit 13|stop the run|stop this run/i;

describe("firstTurnPrompt", () => {
  const prompt = firstTurnPrompt({
    seedPath: "/wt/phase-03/.phax-context/interactive-review.md",
    schemaJson,
  });

  it("points at the seed, says to change nothing and answer only the schema", () => {
    expect(prompt).toContain("Read /wt/phase-03/.phax-context/interactive-review.md");
    expect(prompt).toContain("Change nothing");
    expect(prompt).toContain("Answer only with a first-reading document");
    expect(prompt).toContain(schemaJson);
  });

  it("never mentions stopping a run", () => {
    expect(prompt).not.toMatch(STOPPING);
  });
});

describe("correctivePrompt", () => {
  const prompt = correctivePrompt("the final message is not JSON");

  it("names the defect and allows one retry with nothing changed", () => {
    expect(prompt).toContain("Refusal: the final message is not JSON");
    expect(prompt).toContain("Change nothing");
    expect(prompt).toContain("This is your only retry");
    expect(prompt).not.toMatch(STOPPING);
  });
});

describe("cutDiff", () => {
  const paths = ["src/a.ts", "src/b.ts"];

  it("keeps a diff within the limit whole", () => {
    expect(cutDiff("diff text", paths)).toEqual({ text: "diff text", truncated: false, paths });
    const exact = "x".repeat(CLOSING_DIFF_LIMIT_BYTES);
    expect(cutDiff(exact, paths).truncated).toBe(false);
  });

  it("cuts a diff over the limit to the limit, marks it and keeps every path", () => {
    const cut = cutDiff("x".repeat(CLOSING_DIFF_LIMIT_BYTES + 5), paths);
    expect(cut.truncated).toBe(true);
    expect(cut.text).toHaveLength(CLOSING_DIFF_LIMIT_BYTES);
    expect(cut.paths).toEqual(paths);
  });

  it("cuts on a character boundary", () => {
    const cut = cutDiff("é".repeat(CLOSING_DIFF_LIMIT_BYTES), paths);
    expect(cut.truncated).toBe(true);
    expect(new TextEncoder().encode(cut.text).length).toBeLessThanOrEqual(CLOSING_DIFF_LIMIT_BYTES);
    expect(cut.text).not.toContain("�");
  });
});

describe("closingTurnPrompt", () => {
  const diff = cutDiff("diff --git a/src/a.ts b/src/a.ts\n+changed\n", ["src/a.ts"]);

  it("embeds the diff, says to change nothing and answer only the schema", () => {
    const prompt = closingTurnPrompt({ diff, seedPath: null, schemaJson });
    expect(prompt).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(prompt).toContain("Change nothing");
    expect(prompt).toContain("Answer only with an interactive-handoff document");
    expect(prompt).toContain(schemaJson);
    expect(prompt).not.toContain("Read /");
    expect(prompt).not.toMatch(STOPPING);
  });

  it("points a new session at the seed", () => {
    const prompt = closingTurnPrompt({
      diff,
      seedPath: "/wt/.phax-context/interactive-review.md",
      schemaJson,
    });
    expect(prompt).toContain("Read /wt/.phax-context/interactive-review.md");
  });

  it("lists every path and says the diff was cut when it is over the limit", () => {
    const paths = ["src/a.ts", "src/z.ts"];
    const cut = cutDiff("y".repeat(CLOSING_DIFF_LIMIT_BYTES + 1), paths);
    const prompt = closingTurnPrompt({ diff: cut, seedPath: null, schemaJson });
    expect(prompt).toContain(`cut after ${CLOSING_DIFF_LIMIT_BYTES} bytes`);
    expect(prompt).toContain("- src/a.ts");
    expect(prompt).toContain("- src/z.ts");
    expect(prompt).toContain("(diff cut)");
  });

  it("does not mark an uncut diff as cut", () => {
    const prompt = closingTurnPrompt({ diff, seedPath: null, schemaJson });
    expect(prompt).not.toContain("(diff cut)");
    expect(prompt).not.toContain("These are all the changed paths");
  });

  it("fences a diff that itself holds backtick fences with a longer fence", () => {
    const withFence = cutDiff("+```ts\n+code\n+```\n", ["README.md"]);
    const prompt = closingTurnPrompt({ diff: withFence, seedPath: null, schemaJson });
    expect(prompt).toContain("````diff\n+```ts");
  });
});

describe("freshStartPrompt", () => {
  it("points at the seed and the phase", () => {
    expect(freshStartPrompt("phase-03")).toBe(
      "Read .phax-context/interactive-review.md, then review phase-03 with me.",
    );
  });
});

describe("renderFirstReading", () => {
  it("renders the pattern, what each phase copies and what to check", () => {
    const md = renderFirstReading({
      pattern: ["InvoiceRow column order", "skip-and-warn on a missing tax id"],
      copiedBy: [
        { phase: "phase-04", what: "all three" },
        { phase: "phase-06", what: "the header wording" },
      ],
      toCheck: ["Is skipping a row acceptable to the accountant?"],
    });
    expect(md).toContain("## The pattern at stake\n- InvoiceRow column order\n- skip-and-warn");
    expect(md).toContain("- phase-04: all three\n- phase-06: the header wording");
    expect(md).toContain("## What to check\n- Is skipping a row acceptable to the accountant?");
  });

  it("says so plainly when nothing is copied or flagged", () => {
    const md = renderFirstReading({ pattern: ["p"], copiedBy: [], toCheck: [] });
    expect(md).toContain("None of the upcoming phases copies it.");
    expect(md).toContain("Nothing flagged.");
  });
});
