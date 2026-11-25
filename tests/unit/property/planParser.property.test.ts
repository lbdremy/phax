// Properties of the plan parser (spec property-tests §5.7 to §5.10). The round trip: any valid plan
// document, rendered to Markdown, is extracted and finalized back to its finalized projection with
// no warning. Every renderable rule the generator stays clear of carries a hand-written example
// that decodes yet does not round trip, so no rule narrows the generator without cause.
import { isDeepStrictEqual } from "node:util";
import { Result } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  collectPlanStructureErrors,
  extractPlanDeterministic,
  readPlanDeterministic,
  readPlanTestStrategies,
} from "../../../src/domain/plan/parsePlanMarkdown.js";
import { finalizeExtractedPlan } from "../../../src/domain/plan/finalize.js";
import { locatePlanSections, type LocatablePhase } from "../../../src/domain/plan/sections.js";
import { headingText } from "../../../src/domain/authoring/markdown.js";
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
import { anyPlanText, largePlanText, mutatedPlanText } from "../../helpers/property/planText.js";
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
// round-trip helper's error on a refusal. The projection carries no phase title, and finalize reads
// the titles of both sides from the same Markdown, so each title read back is held to the
// document's title as the heading writes it: folded onto one line and trimmed by `headingText`
// (the renderer limit `phase-title-folds-onto-its-heading`).
function roundTripDifference(doc: PlanDocument): string | undefined {
  const { parsed, fromMarkdown, fromDocument } = roundTrip(doc, renderPlanBody(doc));
  const projection = projectExtractedPlan(doc);
  return (
    firstDifference(parsed.phases, projection.phases, "parsed.phases") ??
    firstDifference(
      fromMarkdown.plan.phases.map((phase) => phase.title),
      doc.phases.map((phase) => headingText(phase.title)),
      "fromMarkdown.plan.phases[].title",
    ) ??
    firstDifference(parsed.run.title, projection.run.title, "parsed.run.title") ??
    firstDifference(parsed.run.gateProfile, projection.run.gateProfile, "parsed.run.gateProfile") ??
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

// ---------------------------------------------------------------------------------------------
// Totality and bounded time.
// ---------------------------------------------------------------------------------------------

const totalityInputs = () => fc.oneof(anyPlanText(), mutatedPlanText());

interface StructureException {
  readonly name: string;
  readonly reason: string;
  readonly matches: (text: string) => boolean;
}

const STRUCTURE_EXCEPTIONS: readonly StructureException[] = [
  {
    name: "departing-test-line",
    reason:
      "extractPlanDeterministic refuses a test line that departs from the grammar, while collectPlanStructureErrors leaves test lines to the tests check of `phax plans lint`",
    matches: (text) => {
      if (collectPlanStructureErrors(text).length > 0) return false;
      const reading = readPlanDeterministic(text);
      return Result.isSuccess(reading) && reading.success.departures.length > 0;
    },
  },
];

const BUG_PREFIX = "deterministic extraction produced invalid ExtractedPhaxPlan";

const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

type Extraction = ReturnType<typeof extractPlanDeterministic>;

// The phases `locatePlanSections` looks for: the extraction's, or one probe phase when extraction
// refused the text (or has not run), so section location reads every text.
const PROBE_PHASES: readonly LocatablePhase[] = [
  { id: "phase-01", planMarkdownAnchor: "#phase-01" },
];

const phasesToLocate = (extraction: Extraction | undefined): readonly LocatablePhase[] =>
  extraction !== undefined && Result.isSuccess(extraction)
    ? extraction.success.phases
    : PROBE_PHASES;

// Calls each entry point in order, recording its answer in `answers`; the first throw, described,
// or undefined.
function firstThrow(
  calls: Readonly<Record<string, () => unknown>>,
  answers: Record<string, unknown>,
): string | undefined {
  for (const [name, call] of Object.entries(calls)) {
    try {
      answers[name] = call();
    } catch (error) {
      return `${name} threw ${describeError(error)}`;
    }
  }
  return undefined;
}

// The first way the parser entry points, and the finalize and section location that read the
// same text after them, fail to answer `text`, or undefined.
function totalityProblem(text: string): string | undefined {
  const answers: Record<string, unknown> = {};
  const parserThrow = firstThrow(
    {
      collectPlanStructureErrors: () => collectPlanStructureErrors(text),
      readPlanDeterministic: () => readPlanDeterministic(text),
      extractPlanDeterministic: () => extractPlanDeterministic(text),
    },
    answers,
  );
  if (parserThrow !== undefined) return parserThrow;
  const extraction = answers["extractPlanDeterministic"] as Extraction;
  const readerThrow = firstThrow(
    {
      locatePlanSections: () => locatePlanSections(text, phasesToLocate(extraction)),
      ...(Result.isSuccess(extraction)
        ? { finalizeExtractedPlan: () => finalizeExtractedPlan(extraction.success, text) }
        : {}),
    },
    answers,
  );
  if (readerThrow !== undefined) return readerThrow;
  const errors = answers["collectPlanStructureErrors"] as ReturnType<
    typeof collectPlanStructureErrors
  >;
  if (!Array.isArray(errors)) return "collectPlanStructureErrors did not return an array";
  for (const error of errors) {
    if (
      !(error.phase === null || typeof error.phase === "string") ||
      typeof error.message !== "string" ||
      error.message === ""
    ) {
      return `collectPlanStructureErrors returned a malformed error: ${JSON.stringify(error)}`;
    }
  }
  for (const name of [
    "readPlanDeterministic",
    "extractPlanDeterministic",
    "finalizeExtractedPlan",
  ]) {
    if (!Object.hasOwn(answers, name)) continue;
    const result = answers[name] as Result.Result<unknown, { readonly message: string }>;
    if (!Result.isResult(result)) return `${name} did not return a Result`;
    if (Result.isFailure(result)) {
      const { message } = result.failure;
      if (typeof message !== "string" || message === "") return `${name} failed with no message`;
      if (message.startsWith(BUG_PREFIX)) return `${name} hit a parser bug: ${message}`;
    }
  }
  const located = answers["locatePlanSections"] as ReturnType<typeof locatePlanSections>;
  if (!Result.isResult(located)) return "locatePlanSections did not return a Result";
  if (Result.isFailure(located) && located.failure.length === 0) {
    return "locatePlanSections failed with no missing phase";
  }
  const read = answers["readPlanDeterministic"] as ReturnType<typeof readPlanDeterministic>;
  if (Result.isSuccess(read) && read.success.plan.phases.length === 0) {
    return "readPlanDeterministic succeeded with no phase";
  }
  return undefined;
}

const TIME_BOUND_MS = 2000;

// The timed calls on `text`, in order. Finalize and section location read the extraction the
// extraction call left, so only their own work is timed; finalize runs on a successful extraction.
function timedCalls(text: string): ReadonlyArray<readonly [string, () => unknown]> {
  let extraction: Extraction | undefined;
  return [
    ["collectPlanStructureErrors", () => collectPlanStructureErrors(text)],
    ["extractPlanDeterministic", () => (extraction = extractPlanDeterministic(text))],
    [
      "finalizeExtractedPlan",
      () =>
        extraction !== undefined && Result.isSuccess(extraction)
          ? finalizeExtractedPlan(extraction.success, text)
          : undefined,
    ],
    ["locatePlanSections", () => locatePlanSections(text, phasesToLocate(extraction))],
  ];
}

// The CPU time `call` takes, in milliseconds, user and system together. Not the wall-clock time: in a
// phase gate the unit tier runs beside the rest of the suite, and an input that parses in 0.4 s took
// 2 to 4.5 s of wall time there, every attempt, for about 0.4 s of CPU. A worker process of vitest's
// `forks` pool runs one test file at a time, so the count holds only this parse and the engine's own
// helper threads (garbage collection), never another test.
const timeOnce = (call: () => unknown): number => {
  const start = process.cpuUsage();
  call();
  const used = process.cpuUsage(start);
  return (used.user + used.system) / 1000;
};

// The inputs the bounded-time property checks while PHAX_PROPERTY_RUNS is unset, in place of the
// harness's 100; the deep pass still checks 2,000. Its work grows with the large inputs it draws,
// each parsed four times, so it is the one property whose time is set by its run count: at 100 runs
// it took 10 to 32 s on CI against its 30-second timeout. Two inputs of over 60 KiB of nested lists
// and quotes (paths 85 and 88 of the default seed) made half its work; on a slow runner path 85
// took 2,060 ms of CPU per call, where the retries below triple a call's time. 40 runs still draw
// 16 large inputs, three of them over 60 KiB.
const BOUNDED_TIME_RUNS = 40;

// The timings of `call`: one, or three when the first is over the bound (the property judges the
// fastest). A throw comes back as its description.
function fastestOfThree(call: () => unknown): readonly number[] | string {
  try {
    const timings = [timeOnce(call)];
    while (timings.length < 3 && timings[0]! > TIME_BOUND_MS) timings.push(timeOnce(call));
    return timings;
  } catch (error) {
    return describeError(error);
  }
}

describe("plan parser", () => {
  it(
    "the structure check agrees with extraction",
    () => {
      checkProperty(totalityInputs(), ({ origin, text }) => {
        const errors = collectPlanStructureErrors(text);
        const extraction = extractPlanDeterministic(text);
        const clean = errors.length === 0;
        const read = Result.isSuccess(extraction);
        if (clean === read) return true;
        if (STRUCTURE_EXCEPTIONS.some((exception) => exception.matches(text))) return true;
        throw new Error(
          `structure check ${clean ? "clean" : "not clean"} but extraction ${read ? "read" : "refused"} ` +
            `the plan (origin: ${origin}); first structure error: ${errors[0]?.message ?? "(none)"}; ` +
            `extraction: ${Result.isFailure(extraction) ? extraction.failure.message : "(read)"}`,
        );
      });
    },
    propertyTimeout(),
  );

  it(
    "any text yields a plan or structure errors",
    () => {
      checkProperty(totalityInputs(), ({ origin, text }) => {
        const problem = totalityProblem(text);
        if (problem !== undefined) throw new Error(`${problem} (origin: ${origin})`);
        return true;
      });
    },
    propertyTimeout(),
  );

  it(
    "parsing finishes in bounded time",
    () => {
      checkProperty(
        // Large inputs are a third of the draw: each one is parsed four times, and at a larger share
        // the property outgrew the unit tier's 30-second per-test timeout on a loaded CI runner.
        fc.oneof(
          { arbitrary: largePlanText(), weight: 1 },
          { arbitrary: mutatedPlanText(), weight: 1 },
          { arbitrary: anyPlanText(), weight: 1 },
        ),
        ({ origin, text }) => {
          const bytes = Buffer.byteLength(text, "utf8");
          for (const [name, call] of timedCalls(text)) {
            const timings = fastestOfThree(call);
            if (typeof timings === "string") {
              throw new Error(`${name} threw: ${timings} (origin: ${origin}, ${bytes} bytes)`);
            }
            if (Math.min(...timings) > TIME_BOUND_MS) {
              throw new Error(
                `${name} used over ${TIME_BOUND_MS} ms of CPU on ${bytes} bytes (origin: ${origin}); ` +
                  `CPU timings: ${timings.map((t) => `${Math.round(t)} ms`).join(", ")}`,
              );
            }
          }
          return true;
        },
        process.env,
        { defaultRuns: BOUNDED_TIME_RUNS },
      );
    },
    propertyTimeout(),
  );

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

  // Metamorphic: the `## Gate profile` section names the run's profile and nothing else. Taking it
  // out adds the one missing-declaration error and changes no phase's reading; naming another id
  // changes the run's profile alone.
  it(
    "the gate-profile section changes no phase it reads",
    () => {
      checkProperty(planDocuments(), (doc) => {
        const body = renderPlanBody(doc);
        const section = `## Gate profile\n\n\`${doc.run.gateProfile}\`\n\n`;
        if (!body.includes(section)) throw new Error("the rendered plan declares no gate profile");
        const without = body.replace(section, "");
        const other = body.replace(section, "## Gate profile\n\nanother-profile\n\n");

        const missing = { phase: null, message: GATE_PROFILE_MISSING };
        const errorsWith = collectPlanStructureErrors(body);
        const errorsWithout = collectPlanStructureErrors(without);
        expect(errorsWithout.filter((e) => !isDeepStrictEqual(e, missing))).toEqual(errorsWith);
        expect(errorsWithout.filter((e) => isDeepStrictEqual(e, missing))).toHaveLength(1);
        expect(readPlanTestStrategies(without)).toEqual(readPlanTestStrategies(body));

        const read = Result.getOrThrow(readPlanDeterministic(body));
        const readOther = Result.getOrThrow(readPlanDeterministic(other));
        expect(readOther.plan.phases).toEqual(read.plan.phases);
        expect(readOther.plan.run).toEqual({ ...read.plan.run, gateProfile: "another-profile" });
        return true;
      });
    },
    propertyTimeout(),
  );
});

const GATE_PROFILE_MISSING = "the plan declares no gate profile (## Gate profile)";

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
  run: {
    shortName: "read-the-plan",
    title: "Read the plan",
    requiredCommands: ["pnpm test"],
    gateProfile: "standard",
  },
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

// ---------------------------------------------------------------------------------------------
// Structure exceptions: one hand-written plan per exception.
// ---------------------------------------------------------------------------------------------

// A minimal valid plan whose one test line writes `--` where the grammar wants ` — `.
const DEPARTING_TEST_LINE_PLAN = renderPlanBody(BASE).replace(
  "### Test strategy\n\n- (none)",
  "### Test strategy\n\n- a plan is read--small · example · the plan · in-phase",
);

const STRUCTURE_EXAMPLES: Readonly<Record<string, string>> = {
  "departing-test-line": DEPARTING_TEST_LINE_PLAN,
};

describe("structure exceptions", () => {
  it("every exception has an example and every example an exception", () => {
    expect(Object.keys(STRUCTURE_EXAMPLES).toSorted()).toEqual(
      STRUCTURE_EXCEPTIONS.map((exception) => exception.name).toSorted(),
    );
  });

  it.each(STRUCTURE_EXCEPTIONS)("$name: $reason", (exception) => {
    const example = STRUCTURE_EXAMPLES[exception.name];
    if (example === undefined) throw new Error(`no example for ${exception.name}`);
    expect(example).toContain("read--small");
    expect(exception.matches(example)).toBe(true);
    expect(collectPlanStructureErrors(example)).toEqual([]);
    expect(Result.isFailure(extractPlanDeterministic(example))).toBe(true);
  });
});
