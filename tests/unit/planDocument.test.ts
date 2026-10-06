import { describe, expect, it } from "vitest";
import { Either, Schema } from "effect";
import {
  decodePlanDocument,
  decodePlanDocumentFile,
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
    sourceSpec: "docs/specs/2609230835-headless-authoring.md" as string | null,
    completesSpec: true as boolean | null,
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

  it("accepts both legal lineage pairs: a spec path with a boolean, null with null", () => {
    for (const completesSpec of [true, false]) {
      expect(Either.isRight(decodePlanDocument({ ...validPlanDocument(), completesSpec }))).toBe(
        true,
      );
    }
    const specLess = { ...validPlanDocument(), sourceSpec: null, completesSpec: null };
    expect(Either.isRight(decodePlanDocument(specLess))).toBe(true);
  });

  it("rejects a document without completesSpec", () => {
    const { completesSpec: _dropped, ...doc } = validPlanDocument();
    expect(rejection(doc)).toBe("completesSpec: is missing");
  });

  it("rejects completesSpec true beside sourceSpec: null", () => {
    expect(rejection({ ...validPlanDocument(), sourceSpec: null, completesSpec: true })).toBe(
      "completesSpec is a boolean beside a sourceSpec path and null beside sourceSpec: null",
    );
  });

  it("rejects completesSpec null beside a sourceSpec path", () => {
    expect(rejection({ ...validPlanDocument(), completesSpec: null })).toBe(
      "completesSpec is a boolean beside a sourceSpec path and null beside sourceSpec: null",
    );
  });

  it("rejects a non-boolean completesSpec", () => {
    expect(rejection({ ...validPlanDocument(), completesSpec: "yes" })).toMatch(/^completesSpec: /);
  });
});

describe("decodePlanDocumentFile", () => {
  const $schema = "https://docs.phax.run/schemas/plan-document/0.19.0.json";

  function fileDoc(lineage: { sourceSpec: string | null; completesSpec: boolean | null }) {
    const { version: _version, ...doc } = validPlanDocument();
    return { $schema, ...doc, ...lineage };
  }

  it("accepts the legal lineage pairs and refuses the cross pairs and a missing completesSpec", () => {
    const spec = "docs/specs/2609230835-headless-authoring.md";
    expect(
      Either.isRight(decodePlanDocumentFile(fileDoc({ sourceSpec: spec, completesSpec: false }))),
    ).toBe(true);
    expect(
      Either.isRight(decodePlanDocumentFile(fileDoc({ sourceSpec: null, completesSpec: null }))),
    ).toBe(true);
    expect(
      Either.isLeft(decodePlanDocumentFile(fileDoc({ sourceSpec: null, completesSpec: false }))),
    ).toBe(true);
    expect(
      Either.isLeft(decodePlanDocumentFile(fileDoc({ sourceSpec: spec, completesSpec: null }))),
    ).toBe(true);
    const { completesSpec: _dropped, ...missing } = fileDoc({
      sourceSpec: spec,
      completesSpec: true,
    });
    expect(Either.isLeft(decodePlanDocumentFile(missing))).toBe(true);
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
    expect(schema.required).toEqual([
      "version",
      "kind",
      "sourceSpec",
      "completesSpec",
      "run",
      "preamble",
      "phases",
    ]);
  });

  it("states the two legal sourceSpec/completesSpec pairs", () => {
    const schema = getPlanDocumentJsonSchema() as { allOf: unknown };
    expect(schema.allOf).toEqual([
      {
        oneOf: [
          {
            properties: {
              sourceSpec: { type: "string", minLength: 1 },
              completesSpec: { type: "boolean" },
            },
          },
          { properties: { sourceSpec: { type: "null" }, completesSpec: { type: "null" } } },
        ],
      },
    ]);
  });
});
