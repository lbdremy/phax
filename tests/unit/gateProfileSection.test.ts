// The plan's `## Gate profile` section, read by phax itself: one id written as
// a code span or a bare word, and a missing or doubled declaration refused.
import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { renderPlanBody } from "../../src/domain/authoring/renderPlan.js";
import {
  readPlanDeterministic,
  readPlanGateProfile,
} from "../../src/domain/plan/parsePlanMarkdown.js";
import { decodeAuthoredPlanDocument } from "../../src/schemas/planDocument.js";
import { validDocuments } from "./schemasPackage/documents.js";

const MISSING = "the plan declares no gate profile (## Gate profile)";
const DOUBLED = "the plan declares more than one gate profile (## Gate profile)";
const NOT_AN_ID =
  "the plan's gate profile is not one id written as a code span or a bare word (## Gate profile)";

const PHASE = [
  "## phase-01 — Alpha {#phase-01-alpha}",
  "",
  "**Recommended model:** claude-opus-5-5",
  "**Recommended effort:** medium",
].join("\n");

/** A plan whose preamble, after its title, is `preamble`. */
function planWith(preamble: string): string {
  return ["# A plan", "", preamble, "", "## Required commands", "", "- (none)", "", PHASE].join(
    "\n",
  );
}

function read(preamble: string): string {
  const result = readPlanGateProfile(planWith(preamble));
  return Result.isSuccess(result) ? `id ${result.success}` : result.failure.message;
}

describe("readPlanGateProfile", () => {
  it.each([
    ["a code span", "## Gate profile\n\n`light`", "id light"],
    ["a bare word", "## Gate profile\n\nlight", "id light"],
    ["a dotted id with a dash", "## Gate profile\n\n`ci-full.v2`", "id ci-full.v2"],
    ["a code span padded with spaces", "## Gate profile\n\n`  light  `", "id light"],
    ["the title in another case, padded", "##   gate PROFILE  \n\nlight", "id light"],
    ["no section", "Some context.", MISSING],
    ["an empty section", "## Gate profile\n", MISSING],
    ["a section holding an empty code span", "## Gate profile\n\n`  `", MISSING],
    ["two sections", "## Gate profile\n\nlight\n\n## Gate profile\n\nstandard", DOUBLED],
    [
      "two sections naming the same id",
      "## Gate profile\n\nlight\n\n## Gate profile\n\nlight",
      DOUBLED,
    ],
    ["two paragraphs", "## Gate profile\n\nlight\n\nstandard", DOUBLED],
    ["a list", "## Gate profile\n\n- light\n- standard", DOUBLED],
    ["a one-item list", "## Gate profile\n\n- light", DOUBLED],
    ["two words", "## Gate profile\n\nlight standard", DOUBLED],
    ["two code spans", "## Gate profile\n\n`light` `standard`", DOUBLED],
    ["a code span holding two words", "## Gate profile\n\n`light standard`", DOUBLED],
    ["a word with a backtick", "## Gate profile\n\nli`ght", NOT_AN_ID],
    ["a code block", "## Gate profile\n\n```\nlight\n```", NOT_AN_ID],
  ])("reads %s", (_, preamble, expected) => {
    expect(read(preamble)).toBe(expected);
  });

  it("ends the section at the next ## heading, so a later section's text is not read", () => {
    expect(read("## Gate profile\n\nlight\n\n## Context\n\nMore words here.")).toBe("id light");
  });

  it("reads only the preamble: a section inside a phase is no declaration", () => {
    const plan = ["# A plan", "", "## Required commands", "", "- (none)", "", PHASE].join("\n");
    const inPhase = `${plan}\n\n### Gate profile\n\nlight\n`;
    const result = readPlanGateProfile(inPhase);
    if (Result.isSuccess(result)) throw new Error("unexpected success");
    expect(result.failure.message).toBe(MISSING);
  });

  it("reads light back from the plan.md a plan document declaring light renders", () => {
    const { $schema: _schema, ...written } = Result.getOrThrow(
      decodeAuthoredPlanDocument(validDocuments["plan-document"]),
    );
    const document = { ...written, run: { ...written.run, gateProfile: "light" } };
    const reading = Result.getOrThrow(readPlanDeterministic(renderPlanBody(document)));
    expect(reading.plan.run.gateProfile).toBe("light");
  });

  it("reads the declaration below a frontmatter block", () => {
    const result = readPlanGateProfile(
      `---\nstatus: Draft\n---\n${planWith("## Gate profile\n\n`light`")}`,
    );
    expect(Result.getOrThrow(result)).toBe("light");
  });
});
