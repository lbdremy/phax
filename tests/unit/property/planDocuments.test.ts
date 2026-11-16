// Sanity properties of the plan-document generator: every document it makes decodes as a plan
// sidecar, satisfies every renderable rule and has well-formed phase ids, and a fixed-seed sample
// shows that every variant and adversarial token it promises occurs.
import { Result } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";
import { PhaseModeSchema, PlanEffortSchema } from "../../../src/schemas/phaxPlan.js";
import { decodePlanDocumentFile, type PlanDocument } from "../../../src/schemas/planDocument.js";
import { TEST_SIZES, TEST_TECHNIQUES, TestLoopSchema } from "../../../src/schemas/testLine.js";
import { checkProperty, propertyTimeout } from "../../helpers/property/harness.js";
import { planDocuments, RENDERABLE_RULES } from "../../helpers/property/planDocuments.js";

const CATALOG_PREFIXES = ["claude-", "gpt-", "devstral-"];

// The phase ids a plan of `count` phases has: `phase-01` to `phase-NN`.
const expectedIds = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `phase-${String(i + 1).padStart(2, "0")}`);

describe("plan documents", () => {
  it(
    "decode through the sidecar decoder once stamped",
    () => {
      checkProperty(planDocuments(), (doc) => {
        const decoded = decodePlanDocumentFile({
          $schema: currentSchemaUrl("plan-document"),
          ...doc,
        });
        if (Result.isFailure(decoded)) throw new Error(decoded.failure.message);
        return true;
      });
    },
    propertyTimeout(),
  );

  it(
    "satisfy every renderable rule",
    () => {
      checkProperty(planDocuments(), (doc) => {
        const broken = RENDERABLE_RULES.filter((rule) => !rule.holds(doc)).map((rule) => rule.name);
        if (broken.length > 0) throw new Error(`breaks the rule(s) ${broken.join(", ")}`);
        return true;
      });
    },
    propertyTimeout(),
  );

  it(
    "number their phases from phase-01 with no gap, each anchor opening with its id",
    () => {
      checkProperty(planDocuments(), (doc) => {
        const ids = doc.phases.map((phase) => phase.id);
        const anchored = doc.phases.every((phase) =>
          phase.planMarkdownAnchor.startsWith(`#${phase.id}-`),
        );
        const accepted = doc.phases.every(
          ({ acceptance }) => acceptance === null || ids.includes(acceptance.passedBy),
        );
        return anchored && accepted && ids.join() === expectedIds(ids.length).join();
      });
    },
    propertyTimeout(),
  );
});

// ---------------------------------------------------------------------------------------------
// Coverage: what a fixed-seed sample of the generator must show, by name.
// ---------------------------------------------------------------------------------------------

type Sample = ReadonlyArray<PlanDocument>;

interface Coverage {
  readonly name: string;
  readonly occurs: (sample: Sample) => boolean;
}

const phasesOf = (sample: Sample) => sample.flatMap((doc) => doc.phases);

// Every string held anywhere in the sample's documents.
const stringsIn = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(stringsIn);
  return [];
};

const everyString = (sample: Sample): string[] => stringsIn(sample);

const holds = (pattern: RegExp, sample: Sample): boolean =>
  everyString(sample).some((text) => pattern.test(text));

const includes = (token: string): Coverage => ({
  name: `token ${JSON.stringify(token)}`,
  occurs: (sample) => everyString(sample).some((text) => text.includes(token)),
});

// Each list of the format, with an accessor for every one of its occurrences in a sample.
const LISTS: ReadonlyArray<
  readonly [string, (sample: Sample) => ReadonlyArray<ReadonlyArray<unknown>>]
> = [
  ["plannedFilesToCreate", (s) => phasesOf(s).map((p) => p.plannedFilesToCreate)],
  ["plannedFilesToEdit", (s) => phasesOf(s).map((p) => p.plannedFilesToEdit)],
  ["optionalFilesToEdit", (s) => phasesOf(s).map((p) => p.optionalFilesToEdit)],
  ["detailedInstructions", (s) => phasesOf(s).map((p) => p.detailedInstructions)],
  ["implementationOrder", (s) => phasesOf(s).map((p) => p.implementationOrder)],
  ["excludedScope", (s) => phasesOf(s).map((p) => p.excludedScope)],
  ["testStrategy", (s) => phasesOf(s).map((p) => p.testStrategy)],
  ["technicalArbitrations", (s) => s.map((d) => d.preamble.technicalArbitrations)],
  ["run.requiredCommands", (s) => s.map((d) => d.run.requiredCommands)],
  ["openQuestions", (s) => s.map((d) => d.preamble.openQuestions)],
  ["arbitratedQuestions", (s) => s.map((d) => d.preamble.arbitratedQuestions)],
];

const verdicts = (sample: Sample) =>
  sample.flatMap((doc) => doc.preamble.arbitratedQuestions.map((q) => ({ q, v: q.verdict })));

const COVERAGE: ReadonlyArray<Coverage> = [
  // Phases and their kinds.
  ...[1, 2, 3, 4].map((count): Coverage => ({
    name: `a plan of ${count} phase(s)`,
    occurs: (sample) => sample.some((doc) => doc.phases.length === count),
  })),
  ...PhaseModeSchema.literals.map((mode): Coverage => ({
    name: `a ${mode} phase`,
    occurs: (sample) => phasesOf(sample).some((p) => p.mode === mode),
  })),
  ...PlanEffortSchema.literals.map((effort): Coverage => ({
    name: `effort ${effort}`,
    occurs: (sample) => phasesOf(sample).some((p) => p.effort === effort),
  })),
  {
    name: "a catalog model",
    occurs: (s) => phasesOf(s).some((p) => CATALOG_PREFIXES.some((x) => p.model.startsWith(x))),
  },
  {
    name: "a generated model token",
    occurs: (s) => phasesOf(s).some((p) => !CATALOG_PREFIXES.some((x) => p.model.startsWith(x))),
  },
  { name: "acceptance null", occurs: (s) => phasesOf(s).some((p) => p.acceptance === null) },
  {
    name: "acceptance with files",
    occurs: (s) => phasesOf(s).some((p) => p.acceptance !== null && p.acceptance.files.length > 0),
  },
  {
    name: "acceptance with no file",
    occurs: (s) =>
      phasesOf(s).some((p) => p.acceptance !== null && p.acceptance.files.length === 0),
  },
  {
    name: "boundaryContracts null",
    occurs: (s) => phasesOf(s).some((p) => p.boundaryContracts === null),
  },
  {
    name: "boundaryContracts set",
    occurs: (s) => phasesOf(s).some((p) => p.boundaryContracts !== null),
  },
  {
    name: "assignmentReason null",
    occurs: (s) => phasesOf(s).some((p) => p.assignmentReason === null),
  },
  {
    name: "assignmentReason set",
    occurs: (s) => phasesOf(s).some((p) => p.assignmentReason !== null),
  },
  // Lists, empty and not.
  ...LISTS.flatMap(([name, lists]): Coverage[] => [
    { name: `${name} empty`, occurs: (s) => lists(s).some((list) => list.length === 0) },
    { name: `${name} non-empty`, occurs: (s) => lists(s).some((list) => list.length > 0) },
  ]),
  // Test lines.
  {
    name: "a test line with a criterion",
    occurs: (s) => phasesOf(s).some((p) => p.testStrategy.some((l) => l.criterion !== null)),
  },
  {
    name: "a test line with criterion null",
    occurs: (s) => phasesOf(s).some((p) => p.testStrategy.some((l) => l.criterion === null)),
  },
  ...TEST_SIZES.map((size): Coverage => ({
    name: `test size ${size}`,
    occurs: (s) => phasesOf(s).some((p) => p.testStrategy.some((l) => l.size === size)),
  })),
  ...TEST_TECHNIQUES.map((technique): Coverage => ({
    name: `test technique ${technique}`,
    occurs: (s) => phasesOf(s).some((p) => p.testStrategy.some((l) => l.technique === technique)),
  })),
  ...TestLoopSchema.literals.map((loop): Coverage => ({
    name: `test loop ${loop}`,
    occurs: (s) => phasesOf(s).some((p) => p.testStrategy.some((l) => l.loop === loop)),
  })),
  {
    name: "an oracle holding ' · '",
    occurs: (s) => phasesOf(s).some((p) => p.testStrategy.some((l) => l.oracle.includes(" · "))),
  },
  {
    name: "a guarantee holding ' — '",
    occurs: (s) => phasesOf(s).some((p) => p.testStrategy.some((l) => l.guarantee.includes(" — "))),
  },
  // Lineage and questions.
  { name: "lineage null", occurs: (s) => s.some((d) => d.sourceSpec === null) },
  { name: "lineage completing its spec", occurs: (s) => s.some((d) => d.completesSpec === true) },
  {
    name: "lineage not completing its spec",
    occurs: (s) => s.some((d) => d.completesSpec === false),
  },
  { name: "a decided verdict", occurs: (s) => verdicts(s).some(({ v }) => v.kind === "decided") },
  { name: "a lifted verdict", occurs: (s) => verdicts(s).some(({ v }) => v.kind === "lifted") },
  {
    name: "a verdict choosing other",
    occurs: (s) => verdicts(s).some(({ v }) => v.chosen === "other"),
  },
  {
    name: "a verdict choosing an option",
    occurs: (s) => verdicts(s).some(({ v }) => v.chosen !== "other"),
  },
  {
    name: "a question with a history",
    occurs: (s) => verdicts(s).some(({ q }) => q.history.length > 0),
  },
  // Multi-line text.
  { name: "a single newline", occurs: (s) => holds(/[^\n]\n[^\n]/, s) },
  { name: "a blank line", occurs: (s) => holds(/\n\n/, s) },
  // The adversarial inline vocabulary.
  includes("`"),
  { name: "a code span", occurs: (s) => holds(/`[^`\n]+`/, s) },
  includes("*"),
  includes("_"),
  includes("["),
  includes("]"),
  includes("<"),
  includes(">"),
  includes("&"),
  includes("\\"),
  includes("#"),
  includes("{#x}"),
  includes(" — "),
  includes(" · "),
  { name: 'token "phase-03" outside a heading', occurs: (s) => holds(/(?<!## )phase-03/, s) },
  { name: 'token "## phase-03" mid-line', occurs: (s) => holds(/[^\n]## phase-03/, s) },
  {
    name: 'token "Recommended model:" mid-line',
    occurs: (s) => holds(/[^\n]Recommended model:/, s),
  },
  includes("(none)"),
  { name: "a non-ASCII character", occurs: (s) => holds(/\P{ASCII}/u, s) },
  { name: "an astral character", occurs: (s) => holds(/[\u{10000}-\u{10ffff}]/u, s) },
];

describe("plan document coverage", () => {
  it("a fixed-seed sample shows every variant and every adversarial token", () => {
    const sample = fc.sample(planDocuments(), { seed: 20_261_114, numRuns: 200 });
    const missing = COVERAGE.filter((entry) => !entry.occurs(sample)).map((entry) => entry.name);
    expect(missing).toEqual([]);
  });
});
