// Properties of the plan parser (spec property-tests §5.7 to §5.10). The round trip: any valid plan
// document, rendered to Markdown, is extracted and finalized back to its finalized projection with
// no warning. Every renderable rule the generator stays clear of carries a hand-written example
// that decodes yet does not round trip, so no rule narrows the generator without cause.
import { isDeepStrictEqual } from "node:util";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { renderPlanBody } from "../../../src/domain/authoring/renderPlan.js";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";
import {
  decodePlanDocumentFile,
  projectExtractedPlan,
  type PlanDocument,
  type PlanDocumentPhase,
} from "../../../src/schemas/planDocument.js";
import { checkProperty, propertyTimeout } from "../../helpers/property/harness.js";
import { planDocuments, RENDERABLE_RULES } from "../../helpers/property/planDocuments.js";
import { roundTrip } from "../../helpers/planRoundTrip.js";

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const show = (value: unknown): string => (value === undefined ? "(absent)" : JSON.stringify(value));

// The first path at which `read` and `expected` differ, own keys only, with both values; undefined
// when they are equal. Leaves are compared with `isDeepStrictEqual`.
function firstDifference(read: unknown, expected: unknown, path: string): string | undefined {
  if (isObject(read) && isObject(expected) && Array.isArray(read) === Array.isArray(expected)) {
    for (const key of new Set([...Object.keys(read), ...Object.keys(expected)])) {
      const at = Array.isArray(read) ? `${path}[${key}]` : `${path}.${key}`;
      const difference =
        Object.hasOwn(read, key) && Object.hasOwn(expected, key)
          ? firstDifference(read[key], expected[key], at)
          : `${at}: read ${show(read[key])}, expected ${show(expected[key])}`;
      if (difference !== undefined) return difference;
    }
    return undefined;
  }
  return isDeepStrictEqual(read, expected)
    ? undefined
    : `${path}: read ${show(read)}, expected ${show(expected)}`;
}

// The first way `doc`'s rendering fails to read back to its projection, or undefined. Throws the
// round-trip helper's error on a refusal.
function roundTripDifference(doc: PlanDocument): string | undefined {
  const { parsed, fromMarkdown, fromDocument } = roundTrip(doc, renderPlanBody(doc));
  const projection = projectExtractedPlan(doc);
  return (
    firstDifference(parsed.phases, projection.phases, "parsed.phases") ??
    firstDifference(parsed.run.title, projection.run.title, "parsed.run.title") ??
    firstDifference(
      parsed.run.requiredCommands,
      projection.run.requiredCommands,
      "parsed.run.requiredCommands",
    ) ??
    firstDifference(fromMarkdown.plan, fromDocument.plan, "fromMarkdown.plan") ??
    firstDifference(fromMarkdown.warnings, [], "fromMarkdown.warnings")
  );
}

// How `doc` fails to round trip (a refusal or the first difference), or undefined when it does.
function roundTripFailure(doc: PlanDocument): string | undefined {
  try {
    return roundTripDifference(doc);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("plan parser", () => {
  it(
    "a rendered plan parses back to its projection",
    () => {
      checkProperty(planDocuments(), (doc) => {
        const difference = roundTripDifference(doc);
        if (difference !== undefined) throw new Error(difference);
        return true;
      });
    },
    propertyTimeout(),
  );
});

// ---------------------------------------------------------------------------------------------
// Renderable rules: one hand-written document per rule, breaking that rule alone.
// ---------------------------------------------------------------------------------------------

const BASE_PHASE: PlanDocumentPhase = {
  id: "phase-01",
  title: "Read the plan",
  objective: "Read the rendered plan back.",
  detailedInstructions: ["Render the document."],
  planMarkdownAnchor: "#phase-01-read",
  plannedFilesToCreate: ["src/read.ts"],
  plannedFilesToEdit: [],
  optionalFilesToEdit: [],
  mode: "headless",
  acceptance: null,
  boundaryContracts: null,
  testStrategy: [],
  implementationOrder: [],
  excludedScope: [],
  verification: "The standard gate.",
  expectedHandoff: "The exported names.",
  commit: { subject: "test: read the plan", body: "Read the rendered plan back." },
  assignmentReason: null,
  model: "claude-opus-5-5",
  effort: "high",
};

const BASE: PlanDocument = {
  kind: "plan",
  sourceSpec: null,
  completesSpec: null,
  run: { shortName: "read-the-plan", title: "Read the plan", requiredCommands: ["pnpm test"] },
  preamble: {
    summary: "Read a rendered plan back.",
    requiredCommandsNote: "The gate runs it.",
    technicalArbitrations: [],
    openQuestions: [],
    arbitratedQuestions: [],
  },
  phases: [BASE_PHASE],
};

const withRun = (run: Partial<PlanDocument["run"]>): PlanDocument => ({
  ...BASE,
  run: { ...BASE.run, ...run },
});

const withPhase = (phase: Partial<PlanDocumentPhase>): PlanDocument => ({
  ...BASE,
  phases: [{ ...BASE_PHASE, ...phase }],
});

const RULE_EXAMPLES: Readonly<Record<string, PlanDocument>> = {
  "short-name-is-the-title-slug": withRun({ shortName: "another-name" }),
  "run-title-is-one-trimmed-line": withRun({ title: "Read\nthe plan" }),
  "model-is-one-token": withPhase({ model: "claude opus" }),
  "anchor-fits-its-braces": withPhase({ planMarkdownAnchor: "#phase-01-read}x" }),
  "phase-title-holds-no-anchor": withPhase({ title: "Read {#x} the plan" }),
  "phase-title-has-text": withPhase({ title: " " }),
  "root-prose-opens-no-block": withPhase({ objective: "## Notes" }),
  "commit-body-is-trimmed": withPhase({
    commit: { ...BASE_PHASE.commit, body: "Read the rendered plan back.\n" },
  }),
  "commit-subject-is-one-line-of-single-spaces": withPhase({
    commit: { ...BASE_PHASE.commit, subject: "test:  read the plan" },
  }),
  "required-command-is-a-trimmed-line": withRun({ requiredCommands: ["(none)"] }),
};

describe("renderable rules", () => {
  it("every rule has an example and every example a rule", () => {
    expect(Object.keys(RULE_EXAMPLES).toSorted()).toEqual(
      RENDERABLE_RULES.map((rule) => rule.name).toSorted(),
    );
  });

  it("the base of the examples round trips and breaks no rule", () => {
    expect(RENDERABLE_RULES.filter((rule) => !rule.holds(BASE)).map((r) => r.name)).toEqual([]);
    expect(roundTripFailure(BASE)).toBeUndefined();
  });

  it.each(RENDERABLE_RULES)("$name: $reason", (rule) => {
    const example = RULE_EXAMPLES[rule.name];
    if (example === undefined) throw new Error(`no example for ${rule.name}`);
    const decoded = decodePlanDocumentFile({
      $schema: currentSchemaUrl("plan-document"),
      ...example,
    });
    if (Result.isFailure(decoded)) throw new Error(decoded.failure.message);
    expect(RENDERABLE_RULES.filter((r) => !r.holds(example)).map((r) => r.name)).toEqual([
      rule.name,
    ]);
    expect(roundTripFailure(example)).toBeDefined();
  });
});
