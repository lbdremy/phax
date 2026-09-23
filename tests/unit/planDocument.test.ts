import { describe, expect, it } from "vitest";
import { Either, Schema } from "effect";
import {
  decodePlanDocument,
  getPlanDocumentJsonSchema,
  projectExtractedPlan,
} from "../../src/schemas/planDocument.js";
import { ExtractedPhaxPlanSchema } from "../../src/schemas/phaxPlan.js";
import { formatFirstViolation } from "../../src/schemas/formatError.js";

function validPhase(n: number) {
  const id = `phase-0${n}`;
  return {
    id,
    title: `Phase ${n}`,
    model: "claude-opus-5-5",
    effort: "high",
    planMarkdownAnchor: `#${id}-work`,
    plannedFilesToCreate: [`src/phase${n}.ts`],
    plannedFilesToEdit: ["README.md"],
    optionalFilesToEdit: [],
    commit: { subject: `feat: phase ${n}`, body: `Phase ${n} body.` },
    objective: "Deliver the phase.",
    detailedInstructions: ["Write the module."],
    boundaryContracts: null,
    testStrategy: "Unit tests first.",
    implementationOrder: ["Module", "Tests"],
    excludedScope: [],
    verification: "standard",
    expectedHandoff: "The exported names.",
  };
}

function validPlanDocument() {
  return {
    version: 1,
    kind: "plan",
    sourceSpec: "docs/specs/2609230835-headless-authoring.md",
    run: {
      shortName: "headless-authoring",
      title: "Headless authoring",
      requiredCommands: ["pnpm gen:usage-spec"],
    },
    preamble: {
      summary: "Core to surface.",
      requiredCommandsNote: "Regenerates the usage spec.",
      technicalArbitrations: [],
    },
    phases: [validPhase(1), { ...validPhase(2), boundaryContracts: "phase-03 consumes X." }],
  };
}

const decodeExtractedStrict = Schema.decodeUnknownEither(ExtractedPhaxPlanSchema, {
  onExcessProperty: "error",
});

function rejection(doc: unknown): string {
  const result = decodePlanDocument(doc);
  if (Either.isRight(result)) throw new Error("expected the document to be rejected");
  return formatFirstViolation(result.left);
}

describe("decodePlanDocument", () => {
  it("decodes a full valid plan document", () => {
    expect(Either.isRight(decodePlanDocument(validPlanDocument()))).toBe(true);
  });

  it("requires kind to be plan", () => {
    expect(rejection({ ...validPlanDocument(), kind: "spec" })).toMatch(/^kind: /);
  });

  it("rejects a phase missing a required list", () => {
    const doc = validPlanDocument();
    const { plannedFilesToEdit: _dropped, ...phase } = doc.phases[0]!;
    expect(rejection({ ...doc, phases: [phase] })).toMatch(
      /^phases\[0\]\.plannedFilesToEdit: is missing/,
    );
  });

  it("rejects an extracted field that fails the extractor's own schema", () => {
    const doc = validPlanDocument();
    doc.phases[0]!.id = "phase-1";
    expect(rejection(doc)).toMatch(/^phases\[0\]\.id: /);
  });

  it("rejects an unknown key on a phase", () => {
    const doc = validPlanDocument();
    expect(rejection({ ...doc, phases: [{ ...doc.phases[0], notes: "x" }] })).toMatch(
      /^phases\[0\]\.notes: is unexpected/,
    );
  });

  it("rejects an empty phase list", () => {
    expect(rejection({ ...validPlanDocument(), phases: [] })).toBe("phases[0]: is missing");
  });
});

describe("projectExtractedPlan", () => {
  it("projects to an extracted plan that decodes strictly and carries every extracted field", () => {
    const doc = Either.getOrThrow(decodePlanDocument(validPlanDocument()));
    const projected = projectExtractedPlan(doc);

    const strict = decodeExtractedStrict(projected);
    expect(Either.isRight(strict)).toBe(true);
    expect(projected).toEqual({
      version: 1,
      run: {
        shortName: "headless-authoring",
        title: "Headless authoring",
        requiredCommands: ["pnpm gen:usage-spec"],
      },
      phases: [1, 2].map((n) => ({
        id: `phase-0${n}`,
        model: "claude-opus-5-5",
        effort: "high",
        planMarkdownAnchor: `#phase-0${n}-work`,
        plannedFilesToCreate: [`src/phase${n}.ts`],
        plannedFilesToEdit: ["README.md"],
        optionalFilesToEdit: [],
        commit: { subject: `feat: phase ${n}`, body: `Phase ${n} body.` },
      })),
    });
  });
});

describe("getPlanDocumentJsonSchema", () => {
  it("is titled experimental", () => {
    const schema = getPlanDocumentJsonSchema() as { title: string; required: string[] };
    expect(schema.title).toBe("phax plan document (experimental)");
    expect(schema.required).toEqual(["version", "kind", "sourceSpec", "run", "preamble", "phases"]);
  });
});
