import { describe, expect, it } from "vitest";
import { gatherReviewNotes, renderReviewNotes } from "../../src/domain/review/reviewNotes.js";

const SHARED = "src/greet.ts now prints a farewell; check the wording";

describe("gatherReviewNotes", () => {
  it("groups by owner in first-seen order and lists a shared note once with its phases", () => {
    const groups = gatherReviewNotes([
      { phaseId: "phase-01", notes: [{ owner: "hw-maintainers", note: SHARED }] },
      { phaseId: "phase-02", notes: [{ owner: "docs-team", note: "README mentions greet()" }] },
      { phaseId: "phase-03", notes: [{ owner: "hw-maintainers", note: SHARED }] },
    ]);

    expect(groups).toEqual([
      { owner: "hw-maintainers", notes: [{ note: SHARED, phaseIds: ["phase-01", "phase-03"] }] },
      { owner: "docs-team", notes: [{ note: "README mentions greet()", phaseIds: ["phase-02"] }] },
    ]);
  });

  it("keeps the report's order within a phase, for owners and notes", () => {
    const groups = gatherReviewNotes([
      {
        phaseId: "phase-01",
        notes: [
          { owner: "b-team", note: "second" },
          { owner: "a-team", note: "first" },
          { owner: "b-team", note: "third" },
        ],
      },
    ]);

    expect(groups.map((g) => g.owner)).toEqual(["b-team", "a-team"]);
    expect(groups[0]?.notes.map((n) => n.note)).toEqual(["second", "third"]);
  });

  it("dedups by owner and text: the same text under two owners stays two notes", () => {
    const groups = gatherReviewNotes([
      {
        phaseId: "phase-01",
        notes: [
          { owner: "a-team", note: SHARED },
          { owner: "b-team", note: SHARED },
        ],
      },
    ]);

    expect(groups).toHaveLength(2);
  });

  it("names a phase once when it reports the same note twice", () => {
    const groups = gatherReviewNotes([
      {
        phaseId: "phase-01",
        notes: [
          { owner: "a-team", note: SHARED },
          { owner: "a-team", note: SHARED },
        ],
      },
    ]);

    expect(groups).toEqual([
      { owner: "a-team", notes: [{ note: SHARED, phaseIds: ["phase-01"] }] },
    ]);
  });

  it("gathers nothing from phases without notes", () => {
    expect(gatherReviewNotes([])).toEqual([]);
    expect(gatherReviewNotes([{ phaseId: "phase-01", notes: [] }])).toEqual([]);
  });
});

describe("renderReviewNotes", () => {
  it("is undefined when there is no note", () => {
    expect(renderReviewNotes([])).toBeUndefined();
  });

  it("renders the heading, the intro and one list per owner", () => {
    const md = renderReviewNotes([
      { owner: "hw-maintainers", notes: [{ note: SHARED, phaseIds: ["phase-01", "phase-03"] }] },
      { owner: "docs-team", notes: [{ note: "README mentions greet()", phaseIds: ["phase-02"] }] },
    ]);

    expect(md).toBe(
      [
        "## Review notes",
        "",
        "Notes the gate steps left for a person. None was sent to the agent.",
        "",
        "### hw-maintainers",
        "",
        `- ${SHARED} (phase-01, phase-03)`,
        "",
        "### docs-team",
        "",
        "- README mentions greet() (phase-02)",
      ].join("\n"),
    );
  });
});

describe("a note's line breaks", () => {
  it("are flattened, so a note can neither fake a heading nor split its bullet", () => {
    const groups = gatherReviewNotes([
      {
        phaseId: "phase-01",
        notes: [{ owner: "hw-maintainers", note: "check the wording\n\n## Phase details" }],
      },
      {
        phaseId: "phase-02",
        notes: [{ owner: "hw-maintainers", note: "check the wording ## Phase details" }],
      },
    ]);

    expect(groups).toEqual([
      {
        owner: "hw-maintainers",
        notes: [{ note: "check the wording ## Phase details", phaseIds: ["phase-01", "phase-02"] }],
      },
    ]);
    const section = renderReviewNotes(groups) ?? "";
    expect(section.split("\n").filter((line) => line.startsWith("## "))).toEqual([
      "## Review notes",
    ]);
  });
});
