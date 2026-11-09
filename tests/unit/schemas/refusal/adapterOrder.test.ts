import { Result, Schema, SchemaIssue } from "effect";
import { describe, expect, it } from "vitest";
import { decodeCodeReviewV0_29_0 } from "../../../../src/schemas/history/code-review/0.29.0.js";
import { decodeRunStatusV0_26_0 } from "../../../../src/schemas/history/run-status/0.26.0.js";
import { decodePhaxConfig } from "../../../../src/schemas/phaxConfig.js";
import { PlanDocumentFileSchema } from "../../../../src/schemas/planDocument.js";
import { refusalsOf } from "../../../../src/schemas/refusal/adapter.js";
import type { Refusal, RefusalPath } from "../../../../src/schemas/refusal/model.js";

// The adapter keeps ArrayFormatter's issue count, order and paths on phax's
// real decoders, decoding with every error. The only exceptions are the union
// rule's: the member issues of a union that all refused at its own path
// collapse into one refusal, and the shallow members of a union where another
// member got deeper are dropped. Each case names its exceptions.

type Exception =
  | { readonly collapse: RefusalPath; readonly into: Pick<Refusal, "kind"> & { expected: string } }
  | { readonly drop: RefusalPath };

function refused(result: Result.Result<unknown, Schema.SchemaError>): Schema.SchemaError {
  if (Result.isSuccess(result)) throw new Error("expected a refusal");
  return result.failure;
}

const same = (a: RefusalPath, b: RefusalPath): boolean =>
  a.length === b.length && a.every((segment, i) => segment === b[i]);

// ArrayFormatter's paths with the exceptions applied: a collapsed path keeps
// its first issue only, a dropped path keeps none.
function expectedPaths(
  formatted: ReadonlyArray<RefusalPath>,
  exceptions: ReadonlyArray<Exception>,
): ReadonlyArray<RefusalPath> {
  const kept: RefusalPath[] = [];
  for (const path of formatted) {
    const exception = exceptions.find((e) => same("drop" in e ? e.drop : e.collapse, path));
    if (exception !== undefined && "drop" in exception) continue;
    if (exception !== undefined && kept.some((k) => same(k, path))) continue;
    kept.push(path);
  }
  return kept;
}

function checkOrder(error: Schema.SchemaError, exceptions: ReadonlyArray<Exception>): void {
  // A Standard Schema path segment may be an object holding its key.
  const formatted = SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues.map(
    ({ path = [] }) => path.map((segment) => (typeof segment === "object" ? segment.key : segment)),
  );
  const refusals = refusalsOf(error);
  expect(refusals.map(({ path }) => path)).toEqual(expectedPaths(formatted, exceptions));
  for (const exception of exceptions) {
    if ("drop" in exception) {
      // The adapter has no refusal for the shallow member. (Effect 3's ArrayFormatter
      // had its issue; Effect 4's formatter reports none either.)
      expect(refusals.some(({ path }) => same(path, exception.drop))).toBe(false);
    } else {
      // The adapter has one refusal for the union. (Effect 3's ArrayFormatter had one
      // issue per member; Effect 4's formatter reports a literal union once.)
      expect(formatted.filter((path) => same(path, exception.collapse)).length).toBeGreaterThan(0);
      const at = refusals.filter(({ path }) => same(path, exception.collapse));
      expect(at).toHaveLength(1);
      expect(at[0]).toMatchObject(exception.into);
    }
  }
}

const typicalPlanDocument = {
  $schema: "https://docs.phax.run/schemas/plan-document/0.33.0.json",
  kind: "plan",
  sourceSpec: null,
  completesSpec: null,
  run: { shortName: "example-run", title: "Example run", requiredCommands: [] },
  preamble: {
    summary: "An example plan.",
    requiredCommandsNote: "No command beyond the gate.",
    technicalArbitrations: [],
    openQuestions: [],
    arbitratedQuestions: [],
  },
  phases: [
    {
      id: "phase-01",
      title: "Add the example module",
      objective: "The example module exists.",
      detailedInstructions: ["Create src/example.ts."],
      planMarkdownAnchor: "#phase-01-example",
      plannedFilesToCreate: ["src/example.ts"],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      mode: "headless",
      acceptance: null,
      boundaryContracts: null,
      testStrategy: [
        {
          guarantee: "The example module returns its value",
          size: "small",
          technique: "example",
          oracle: "the module's output",
          loop: "in-phase",
          criterion: null,
        },
      ],
      implementationOrder: ["Write the test.", "Write the module."],
      excludedScope: ["Everything else."],
      verification: "The standard gate.",
      expectedHandoff: "The module's exports.",
      commit: { subject: "feat: add the example module", body: "Adds the example module." },
      assignmentReason: null,
      model: "example-model",
      effort: "medium",
    },
  ],
};

describe("refusalsOf on phax's real decoders", () => {
  it("decodes the typical plan document the cases below mutate", () => {
    expect(
      Result.isSuccess(
        Schema.decodeUnknownResult(PlanDocumentFileSchema, { reportInput: true })(
          typicalPlanDocument,
        ),
      ),
    ).toBe(true);
  });

  it("keeps the config decoder's order, collapsing literal unions and dropping `undefined` alternatives", () => {
    const error = refused(
      decodePhaxConfig({
        version: 2,
        name: "",
        colour: 1,
        gateProfiles: { standard: [{ surface: "remote", command: "pnpm test", output: "x" }] },
        brief: { push: "nope" },
        records: {
          transcript: false,
          destination: { kind: "repo", remote: "http://example.com/r.git" },
          autoPush: false,
        },
      }),
    );
    checkOrder(error, [
      // `brief.push: Expected "findings"` and `Expected "findings-and-rules"`.
      {
        collapse: ["brief", "push"],
        into: { kind: "invalid-value", expected: '"findings" | "findings-and-rules"' },
      },
      // The optional `brief`'s `Expected undefined`: its object member got deeper.
      { drop: ["brief"] },
      // One issue per gate-step variant, each refusing its `surface` literal.
      {
        collapse: ["gateProfiles", "standard", 0, "surface"],
        into: { kind: "invalid-value", expected: '"local" | "structural" | "product"' },
      },
      // The optional `output`: two literals and `undefined`, which reads as one more literal.
      {
        collapse: ["gateProfiles", "standard", 0, "output"],
        into: { kind: "invalid-value", expected: '"log" | "gate-report" | undefined' },
      },
      // The optional `records`'s `Expected undefined`: its object member got deeper.
      { drop: ["records"] },
    ]);
  });

  it("keeps the plan document decoder's order, collapsing each union of shallow members", () => {
    const [phase] = typicalPlanDocument.phases;
    const [line] = phase!.testStrategy;
    const error = refused(
      Schema.decodeUnknownResult(PlanDocumentFileSchema, {
        errors: "all",
        onExcessProperty: "error",
        reportInput: true,
      })({
        ...typicalPlanDocument,
        kind: "spec",
        run: { ...typicalPlanDocument.run, shortName: "", extra: 1 },
        phases: [
          {
            ...phase,
            mode: "x",
            acceptance: 1,
            plannedFilesToCreate: [1],
            testStrategy: [{ ...line, oracle: " padded ", loop: "nope", criterion: 5 }],
            commit: { subject: "feat: add the example module" },
          },
        ],
      }),
    );
    checkOrder(error, [
      {
        collapse: ["phases", 0, "mode"],
        into: { kind: "invalid-value", expected: '"headless" | "interactive"' },
      },
      {
        collapse: ["phases", 0, "acceptance"],
        into: { kind: "invalid-type", expected: "one of an object | null" },
      },
      {
        collapse: ["phases", 0, "testStrategy", 0, "loop"],
        into: { kind: "invalid-value", expected: '"acceptance" | "in-phase"' },
      },
      {
        collapse: ["phases", 0, "testStrategy", 0, "criterion"],
        into: { kind: "invalid-type", expected: "one of string | null" },
      },
    ]);
  });

  it("keeps a frozen decoder's order, with a message override on a literal union", () => {
    const error = refused(
      decodeCodeReviewV0_29_0(
        { findings: [{ severity: "mid", line: "x", lens: "core" }] },
        { errors: "all" },
      ),
    );
    checkOrder(error, []);
    expect(refusalsOf(error)[1]).toEqual({
      kind: "invalid-value",
      path: ["findings", 0, "severity"],
      expected: '"bug" | "deviation" | "concern" | "info"',
      actual: "mid",
      message: '"mid" is not a severity (expected one of bug, deviation, concern, info)',
    });
  });

  it("keeps a frozen decoder's single whole-type refusal", () => {
    const error = refused(decodeRunStatusV0_26_0(null, { errors: "all" }));
    checkOrder(error, []);
    expect(refusalsOf(error)).toEqual([
      { kind: "invalid-type", path: [], expected: "an object", actual: null, message: null },
    ]);
  });
});

describe("refusalsOf on a Forbidden issue", () => {
  it("gives an invalid-value refusal, never a crash", () => {
    // Effect 4's synchronous decoders die on an asynchronous step rather than
    // report it, so the Forbidden issue is built as Effect builds one.
    const error = new Schema.SchemaError(
      new SchemaIssue.Forbidden(undefined, "x", { reportInput: true }),
    );
    expect(error.issue).toBeInstanceOf(SchemaIssue.Forbidden);
    expect(refusalsOf(error)).toEqual([
      {
        kind: "invalid-value",
        path: [],
        expected: "a value decoded synchronously",
        actual: "x",
        message: null,
      },
    ]);
  });
});
