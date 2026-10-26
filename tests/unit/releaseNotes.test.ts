// Layout tests of the release notes builder (scripts/releaseNotes.ts), one per
// rule of the layout, written with the code. The letters in the names of the
// tests tell which rule of the plan each one pins.
import { describe, expect, it } from "vitest";

import { githubReleaseBody, renderReleaseNotes } from "../../scripts/releaseNotes.js";
import { SURFACE_SUMMARY_PLACEHOLDER } from "../../src/schemas/specDocument.js";
import {
  COMMITS,
  DUPLICATE_SECOND_PLAN,
  GITHUB_BODY_LIMIT,
  HEAD,
  LAST_ENTRY_UPGRADING,
  LEAVING_UPGRADING,
  LEAVING_WARNING,
  LOOSE_PLAN,
  NO_ENTRY_WARNING,
  commitLines,
  commitPlaces,
  completingPlan,
  documentOfShortLength,
  duplicateMessage,
  escapeCommit,
  escapeExpected,
  fencedCloserDocument,
  fencedCloserShort,
  fullExpected,
  fullExpectedShort,
  fullExpectedWarnings,
  fullInput,
  highlightsExpected,
  highlightsInput,
  inputWith,
  joinedFinal,
  lastEntryExpected,
  leavingExpected,
  limitMessage,
  loosePlanSection,
  minimalExpected,
  nameRows,
  noDetailsDocument,
  noDetailsShort,
  onlyFixCommit,
  onlyFixExpected,
  placeholderMessage,
  placeholderSpec,
  specLinkRows,
  specNamed,
  surfaceRows,
  titleRows,
  upgradingNowDocument,
  upgradingNowShort,
} from "./releaseNotes/inputs.js";

describe("renderReleaseNotes", () => {
  it("(a) writes the full document, sections in order, with no warning", () => {
    const notes = renderReleaseNotes(fullInput);
    expect(notes.markdown).toBe(fullExpected);
    expect(notes.warnings).toEqual(fullExpectedWarnings);
  });

  it("(b) lists a Highlights line per spec in plan order: lede, else folded rule, else name", () => {
    expect(renderReleaseNotes(highlightsInput).markdown).toBe(highlightsExpected);
  });

  it.each(titleRows)("(c) splits the spec title into heading and lede: $title", (row) => {
    const plan = completingPlan("Titled plan", specNamed(row.title, []));
    const { markdown } = renderReleaseNotes(inputWith({ plans: [plan] }));
    expect(markdown).toBe(row.expected);
    expect(markdown).not.toContain("Plans:");
  });

  it.each(surfaceRows)("(d) shows only cli, config and file surfaces: $name", (row) => {
    const plan = completingPlan("Surface plan", specNamed("Surfaces", [row.element]));
    expect(renderReleaseNotes(inputWith({ plans: [plan] })).markdown).toBe(row.expected);
  });

  it.each(nameRows)("(e) shows the name as one code span without backticks: $name", (row) => {
    const element = {
      surface: row.surface,
      summary: "You can run it.",
      before: null,
      after: "ran",
    };
    const plan = completingPlan("Surface plan", specNamed("Surfaces", [element]));
    expect(renderReleaseNotes(inputWith({ plans: [plan] })).markdown).toBe(row.expected);
  });

  it("(f) folds a before under Before, leaves no fold without one, and never writes After", () => {
    const { markdown } = renderReleaseNotes(fullInput);
    expect(markdown).toContain("  <details>\n  <summary>Before</summary>\n\n");
    expect(markdown.match(/<details>/g)).toHaveLength(2);
    expect(markdown.match(/<\/details>/g)).toHaveLength(2);
    expect(markdown.match(/^ {2}Now:$/gm)).toHaveLength(3);
    expect(markdown).not.toContain("<summary>After");
    expect(markdown).not.toMatch(/^\s*(?:After|Before):/m);
  });

  it("(g) fences an after holding three backticks with four, inside the item", () => {
    expect(renderReleaseNotes(fullInput).markdown).toContain(
      "  ````text\n  ```sh\n  tool ship\n  ```\n  ````\n",
    );
  });

  it("(h) lists a plan without a spec under Also in this release, with absolute links", () => {
    const notes = renderReleaseNotes(inputWith({ plans: [LOOSE_PLAN] }));
    expect(notes.markdown).toBe(
      [...HEAD, "## Also in this release", "", "### Loose plan", "", loosePlanSection, ""].join(
        "\n",
      ),
    );
  });

  it("(i) writes no Specs, Specs in progress or Plans heading", () => {
    for (const input of [fullInput, highlightsInput, inputWith({ plans: [LOOSE_PLAN] })]) {
      const { markdown } = renderReleaseNotes(input);
      expect(markdown).not.toMatch(/^## (?:Specs|Specs in progress|Plans)$/m);
      expect(markdown).not.toContain("Plans:");
    }
  });

  it.each(specLinkRows)("(j) makes the links of $name absolute at the tag", (row) => {
    const notes = renderReleaseNotes(
      inputWith({ plans: [completingPlan("Titled plan", row.spec)] }),
    );
    expect(notes.markdown).toBe(row.expected);
    expect(notes.warnings).toEqual([NO_ENTRY_WARNING, ...row.warnings]);
  });

  it.each(commitPlaces.map((row, index) => ({ ...row, index })))(
    "(k) sorts the commit subject $subject",
    ({ index, place }) => {
      const commit = COMMITS[index];
      const line = commitLines[index];
      if (commit === undefined || line === undefined) throw new Error("table out of step");
      const expected = {
        fixes: [...HEAD, "## Fixes", "", line, ""].join("\n"),
        other: [...HEAD, "## Other", "", line, ""].join("\n"),
        neither: HEAD.join("\n"),
      }[place];
      expect(renderReleaseNotes(inputWith({ commits: [commit] })).markdown).toBe(expected);
    },
  );

  it("(k) escapes every character the commit subject could turn into Markdown", () => {
    expect(renderReleaseNotes(inputWith({ commits: [escapeCommit] })).markdown).toBe(
      escapeExpected,
    );
  });

  it("(k) drops the Upgrading section and warns when the version has no entry", () => {
    const notes = renderReleaseNotes(inputWith({}));
    expect(notes.markdown).toBe(minimalExpected);
    expect(notes.warnings).toEqual([NO_ENTRY_WARNING]);
  });

  it("(k) runs an Upgrading entry that is last in the file to the end of the file", () => {
    const notes = renderReleaseNotes(inputWith({ upgrading: LAST_ENTRY_UPGRADING }));
    expect(notes.markdown).toBe(lastEntryExpected);
    expect(notes.warnings).toEqual([]);
  });

  it("(k) keeps a link that leaves the repository and warns once", () => {
    const notes = renderReleaseNotes(inputWith({ upgrading: LEAVING_UPGRADING }));
    expect(notes.markdown).toBe(leavingExpected);
    expect(notes.warnings).toEqual([LEAVING_WARNING]);
  });

  it("(k) writes only Fixes after the Changes line for a single fix commit", () => {
    const notes = renderReleaseNotes(inputWith({ commits: [onlyFixCommit] }));
    expect(notes.markdown).toBe(onlyFixExpected);
    expect(notes.warnings).toEqual([NO_ENTRY_WARNING]);
  });

  it("(k) refuses a spec announced in full by two plans", () => {
    expect(() =>
      renderReleaseNotes(inputWith({ plans: [joinedFinal, DUPLICATE_SECOND_PLAN] })),
    ).toThrow(new Error(duplicateMessage));
  });

  it("(k) refuses a kept surface element that holds the placeholder summary", () => {
    const spec = placeholderSpec("cli: tool run", SURFACE_SUMMARY_PLACEHOLDER);
    expect(() =>
      renderReleaseNotes(inputWith({ plans: [completingPlan("Placeholder plan", spec)] })),
    ).toThrow(new Error(placeholderMessage));
  });

  it("(k) accepts the placeholder summary on an element the notes leave out", () => {
    const spec = placeholderSpec("internal: src/run.ts", SURFACE_SUMMARY_PLACEHOLDER);
    expect(() =>
      renderReleaseNotes(inputWith({ plans: [completingPlan("Placeholder plan", spec)] })),
    ).not.toThrow();
  });
});

describe("githubReleaseBody", () => {
  it("(l) keeps every section, heading and sentence of the full document, and cuts the examples", () => {
    expect(githubReleaseBody(fullExpected, "4.2.0")).toBe(fullExpectedShort);
  });

  it("(m) only adds the link paragraph to a document without a What's new section", () => {
    expect(githubReleaseBody(noDetailsDocument, "4.2.0")).toBe(noDetailsShort);
  });

  it("(n) drops a Before fold whose fenced content holds a closing details line, whole", () => {
    expect(githubReleaseBody(fencedCloserDocument, "4.2.0")).toBe(fencedCloserShort);
  });

  it("(o) keeps an Upgrading entry holding a Now paragraph and a fence, byte for byte", () => {
    expect(githubReleaseBody(upgradingNowDocument, "4.2.0")).toBe(upgradingNowShort);
  });

  it("(p) returns a body of exactly the limit, counted in code points", () => {
    const body = githubReleaseBody(documentOfShortLength(GITHUB_BODY_LIMIT), "4.2.0");
    expect([...body].length).toBe(GITHUB_BODY_LIMIT);
  });

  it("(p) refuses a body one code point over the limit with its exact message", () => {
    expect(() => githubReleaseBody(documentOfShortLength(GITHUB_BODY_LIMIT + 1), "4.2.0")).toThrow(
      new Error(limitMessage),
    );
  });
});
