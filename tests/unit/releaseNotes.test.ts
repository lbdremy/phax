// Oracles of the release notes builder (scripts/releaseNotes.ts). Every test is
// an expected failure until the builder is written; the discharging phase
// removes the markers and changes nothing else.
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
  inputWith,
  joinedFinal,
  joinedFirst,
  joinedFirstAfterExpected,
  joinedFirstBeforeExpected,
  lastEntryExpected,
  leavingExpected,
  limitMessage,
  loosePlanSection,
  minimalExpected,
  noDetailsDocument,
  noDetailsShort,
  onlyFixCommit,
  onlyFixExpected,
  placeholderMessage,
  placeholderSpec,
  specNamed,
  surfaceRows,
  titleRows,
} from "./releaseNotes/inputs.js";

describe("renderReleaseNotes", () => {
  it.fails("writes the full document from a release with every kind of content", () => {
    const notes = renderReleaseNotes(fullInput);
    expect(notes.markdown).toBe(fullExpected);
    expect(notes.warnings).toEqual(fullExpectedWarnings);
  });

  it.fails.each(surfaceRows)("shows only cli, config and file elements: $name", (row) => {
    const plan = completingPlan("Surface plan", specNamed("Surfaces", [row.element]));
    expect(renderReleaseNotes(inputWith({ plans: [plan] })).markdown).toBe(row.expected);
  });

  it.fails.each(titleRows)("splits the spec title into heading and lede: $title", (row) => {
    const plan = completingPlan("Titled plan", specNamed(row.title, []));
    expect(renderReleaseNotes(inputWith({ plans: [plan] })).markdown).toBe(row.expected);
  });

  it.fails.each(commitPlaces.map((row, index) => ({ ...row, index })))(
    "sorts the commit subject $subject",
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

  it.fails("escapes every character the commit subject could turn into Markdown", () => {
    expect(renderReleaseNotes(inputWith({ commits: [escapeCommit] })).markdown).toBe(
      escapeExpected,
    );
  });

  it.fails("drops the Upgrading section and warns when the version has no entry", () => {
    const notes = renderReleaseNotes(inputWith({}));
    expect(notes.markdown).toBe(minimalExpected);
    expect(notes.warnings).toEqual([NO_ENTRY_WARNING]);
  });

  it.fails("runs an Upgrading entry that is last in the file to the end of the file", () => {
    const notes = renderReleaseNotes(inputWith({ upgrading: LAST_ENTRY_UPGRADING }));
    expect(notes.markdown).toBe(lastEntryExpected);
    expect(notes.warnings).toEqual([]);
  });

  it.fails("keeps a link that leaves the repository and warns once", () => {
    const notes = renderReleaseNotes(inputWith({ upgrading: LEAVING_UPGRADING }));
    expect(notes.markdown).toBe(leavingExpected);
    expect(notes.warnings).toEqual([LEAVING_WARNING]);
  });

  it.fails("joins an intermediate plan listed before its completing plan to the Plans line", () => {
    const notes = renderReleaseNotes(inputWith({ plans: [joinedFirst, joinedFinal] }));
    expect(notes.markdown).toBe(joinedFirstBeforeExpected);
  });

  it.fails("joins an intermediate plan listed after its completing plan to the Plans line", () => {
    const notes = renderReleaseNotes(inputWith({ plans: [joinedFinal, joinedFirst] }));
    expect(notes.markdown).toBe(joinedFirstAfterExpected);
  });

  it.fails("makes the links of a plan without a spec absolute at the tag", () => {
    const notes = renderReleaseNotes(inputWith({ plans: [LOOSE_PLAN] }));
    expect(notes.markdown).toBe(
      [...HEAD, "## Plans", "", "### Loose plan", "", loosePlanSection, ""].join("\n"),
    );
  });

  it.fails("writes only the title and the Changes line for a release with nothing to list", () => {
    expect(renderReleaseNotes(inputWith({})).markdown).toBe(minimalExpected);
  });

  it.fails("writes only Fixes after the Changes line for a single fix commit", () => {
    const notes = renderReleaseNotes(inputWith({ commits: [onlyFixCommit] }));
    expect(notes.markdown).toBe(onlyFixExpected);
    expect(notes.warnings).toEqual([NO_ENTRY_WARNING]);
  });

  it.fails("refuses a spec announced in full by two plans", () => {
    expect(() =>
      renderReleaseNotes(inputWith({ plans: [joinedFinal, DUPLICATE_SECOND_PLAN] })),
    ).toThrow(new Error(duplicateMessage));
  });

  it.fails("refuses a kept surface element that holds the placeholder summary", () => {
    const spec = placeholderSpec("cli: tool run", SURFACE_SUMMARY_PLACEHOLDER);
    expect(() =>
      renderReleaseNotes(inputWith({ plans: [completingPlan("Placeholder plan", spec)] })),
    ).toThrow(new Error(placeholderMessage));
  });

  it.fails("accepts the placeholder summary on an element the notes leave out", () => {
    const spec = placeholderSpec("internal: src/run.ts", SURFACE_SUMMARY_PLACEHOLDER);
    expect(() =>
      renderReleaseNotes(inputWith({ plans: [completingPlan("Placeholder plan", spec)] })),
    ).not.toThrow();
  });
});

describe("githubReleaseBody", () => {
  it.fails("drops the folded blocks of the full document and links the site page", () => {
    expect(githubReleaseBody(fullExpected, "4.2.0")).toBe(fullExpectedShort);
  });

  it.fails("only adds the link paragraph to a document without a folded block", () => {
    expect(githubReleaseBody(noDetailsDocument, "4.2.0")).toBe(noDetailsShort);
  });

  it.fails("removes a folded block whose fenced content holds a closing details line", () => {
    expect(githubReleaseBody(fencedCloserDocument, "4.2.0")).toBe(fencedCloserShort);
  });

  it.fails("returns a body of exactly the limit, counted in code points", () => {
    const body = githubReleaseBody(documentOfShortLength(GITHUB_BODY_LIMIT), "4.2.0");
    expect([...body].length).toBe(GITHUB_BODY_LIMIT);
  });

  it.fails("refuses a body one code point over the limit with its exact message", () => {
    expect(() => githubReleaseBody(documentOfShortLength(GITHUB_BODY_LIMIT + 1), "4.2.0")).toThrow(
      new Error(limitMessage),
    );
  });
});
