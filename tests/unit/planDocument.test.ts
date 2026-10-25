import { describe, expect, it } from "vitest";
import { Either, Schema } from "effect";
import {
  decodePlanDocument,
  decodePlanDocumentFile,
  getPlanDocumentJsonSchema,
  projectExtractedPlan,
} from "../../src/schemas/planDocument.js";
import { ExtractedPhaxPlanSchema } from "../../src/schemas/phaxPlan.js";
import {
  formatFirstViolation,
  formatPlanDocumentViolation,
} from "../../src/schemas/formatError.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";

// A made-up test line.
function testLine(guarantee: string, overrides: Record<string, unknown> = {}) {
  return {
    guarantee,
    size: "small",
    technique: "example",
    oracle: "the module's output",
    loop: "in-phase",
    criterion: null,
    ...overrides,
  };
}

function validPhase(n: number) {
  const id = `phase-0${n}`;
  return {
    id,
    title: `Phase ${n}`,
    assignmentReason: null as string | null,
    model: "claude-opus-5-5",
    effort: "high",
    planMarkdownAnchor: `#${id}-work`,
    plannedFilesToCreate: [`src/phase${n}.ts`],
    plannedFilesToEdit: ["README.md"],
    optionalFilesToEdit: [],
    mode: "headless" as "headless" | "interactive",
    oracle: null as { dischargedBy: string; files: string[] } | null,
    commit: { subject: `feat: phase ${n}`, body: `Phase ${n} body.` },
    objective: "Deliver the phase.",
    detailedInstructions: ["Write the module."],
    boundaryContracts: null,
    testStrategy: [testLine(`phase ${n} works`), testLine(`phase ${n} keeps working`)] as Array<
      Record<string, unknown>
    >,
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
      openQuestions: [] as unknown[],
      arbitratedQuestions: [] as unknown[],
    },
    phases: [validPhase(1), { ...validPhase(2), boundaryContracts: "phase-03 consumes X." }],
  };
}

// Made-up questions of the plan: which phase owns the registry write.
function openQuestion(id = "q-owner") {
  return {
    id,
    question: "Does phase-01 or phase-02 own the registry write?",
    options: [
      { id: "p1", label: "phase-01 writes it", abandons: "a smaller first phase" },
      { id: "p2", label: "phase-02 writes it", abandons: "an early registry" },
    ],
    recommendation: "p1",
    rationale: "the registry is the core",
  };
}

function decidedQuestion(phase: string, by: unknown = { kind: "operator", name: "Ada Lovelace" }) {
  return {
    ...openQuestion("q-decided"),
    verdict: {
      kind: "decided",
      chosen: "p2",
      abandoned: ["p1"],
      why: "phase-02 already touches the registry",
      advocate: "phase-01 is the core",
      principles: [],
      reversibility: "costly",
      by,
      at: "2026-10-20T08:02:11Z",
      revised: [],
      phase,
    },
    history: [],
  };
}

function liftedQuestion(extra: Record<string, unknown> = {}) {
  return {
    ...openQuestion("q-lifted"),
    verdict: {
      kind: "lifted",
      chosen: "p1",
      abandoned: ["p2"],
      why: "the registry is the core",
      at: "2026-09-28",
      by: { kind: "unattributed" },
      ...extra,
    },
    history: [],
  };
}

function withPreamble(questions: { openQuestions?: unknown[]; arbitratedQuestions?: unknown[] }) {
  const doc = validPlanDocument();
  return { ...doc, preamble: { ...doc.preamble, ...questions } };
}

const decodeExtractedStrict = Schema.decodeUnknownEither(ExtractedPhaxPlanSchema, {
  onExcessProperty: "error",
});

function fileRejection(doc: unknown): string {
  const result = decodePlanDocumentFile(doc);
  if (Either.isRight(result)) throw new Error("expected the sidecar to be rejected");
  return formatFirstViolation(result.left);
}

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

  it("accepts an authoring answer with an open question", () => {
    expect(
      Either.isRight(decodePlanDocument(withPreamble({ openQuestions: [openQuestion()] }))),
    ).toBe(true);
  });

  it("checks an authoring answer's open questions", () => {
    const doc = withPreamble({ openQuestions: [{ ...openQuestion(), recommendation: "p3" }] });
    expect(rejection(doc)).toBe(
      'preamble.openQuestions[0].recommendation: "p3" names none of the question\'s options (p1, p2)',
    );
  });

  it("rejects an authoring answer carrying an arbitrated question, at its first entry (§5.60)", () => {
    expect(rejection(withPreamble({ arbitratedQuestions: [liftedQuestion()] }))).toBe(
      "preamble.arbitratedQuestions[0]: an authoring session returns open questions only: arbitratedQuestions must be []",
    );
  });

  it("rejects a preamble missing either question array", () => {
    const doc = validPlanDocument();
    const { arbitratedQuestions: _a, ...noArbitrated } = doc.preamble;
    const { openQuestions: _o, ...noOpen } = doc.preamble;
    expect(rejection({ ...doc, preamble: noArbitrated })).toBe(
      "preamble.arbitratedQuestions: is missing",
    );
    expect(rejection({ ...doc, preamble: noOpen })).toBe("preamble.openQuestions: is missing");
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

  function fileWithQuestions(arbitratedQuestions: unknown[]) {
    const doc = fileDoc({ sourceSpec: null, completesSpec: null });
    return { ...doc, preamble: { ...doc.preamble, arbitratedQuestions } };
  }

  it("accepts lifted and decided verdicts naming one of its phases", () => {
    const doc = fileWithQuestions([liftedQuestion(), decidedQuestion("phase-02")]);
    expect(Either.isRight(decodePlanDocumentFile(doc))).toBe(true);
  });

  it("rejects a decided verdict naming a phase the plan does not have", () => {
    expect(fileRejection(fileWithQuestions([decidedQuestion("phase-09")]))).toBe(
      'preamble.arbitratedQuestions[0].verdict.phase: "phase-09" names none of the plan\'s phases (phase-01, phase-02)',
    );
  });

  it("rejects a lifted verdict carrying a decided verdict's key", () => {
    expect(fileRejection(fileWithQuestions([liftedQuestion({ advocate: "x" })]))).toMatch(
      /^preamble\.arbitratedQuestions\[0\]\.verdict/,
    );
  });

  it("rejects a decided verdict that names no operator", () => {
    const doc = fileWithQuestions([decidedQuestion("phase-01", { kind: "unattributed" })]);
    expect(fileRejection(doc)).toMatch(/^preamble\.arbitratedQuestions\[0\]\.verdict/);
  });

  it("rejects a missing preamble.arbitratedQuestions", () => {
    const doc = fileDoc({ sourceSpec: null, completesSpec: null });
    const { arbitratedQuestions: _dropped, ...preamble } = doc.preamble;
    expect(fileRejection({ ...doc, preamble })).toBe("preamble.arbitratedQuestions: is missing");
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
        mode: "headless",
        oracle: null,
        commit: { subject: `feat: phase ${n}`, body: `Phase ${n} body.` },
      })),
    });
  });

  it("projects mode and oracle unchanged, directly after optionalFilesToEdit", () => {
    const oracle = { dischargedBy: "phase-02", files: ["tests/a.test.ts"] };
    const doc = Either.getOrThrow(
      decodePlanDocument({
        ...validPlanDocument(),
        phases: [{ ...validPhase(1), mode: "interactive", oracle }, validPhase(2)],
      }),
    );
    const [first, second] = projectExtractedPlan(doc).phases;
    expect(first).toMatchObject({ mode: "interactive", oracle });
    expect(second).toMatchObject({ mode: "headless", oracle: null });
    expect(Object.keys(first!).slice(-4)).toEqual([
      "optionalFilesToEdit",
      "mode",
      "oracle",
      "commit",
    ]);
  });

  it("never carries a question into the projection", () => {
    const plain = Either.getOrThrow(decodePlanDocument(validPlanDocument()));
    const questioned = Either.getOrThrow(
      decodePlanDocument(withPreamble({ openQuestions: [openQuestion()] })),
    );
    expect(projectExtractedPlan(questioned)).toEqual(projectExtractedPlan(plain));
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

  it("says an authoring answer's preamble.arbitratedQuestions is empty, and declares the question checks", () => {
    const schema = getPlanDocumentJsonSchema() as {
      description: string;
      properties: { preamble: { required: string[]; properties: Record<string, unknown> } };
    };
    const { preamble } = schema.properties;
    expect(preamble.required).toEqual([
      "summary",
      "requiredCommandsNote",
      "technicalArbitrations",
      "openQuestions",
      "arbitratedQuestions",
    ]);
    expect(preamble.properties["arbitratedQuestions"]).toMatchObject({
      type: "array",
      maxItems: 0,
    });
    expect(schema.description).toMatch(/^Checked by phax's parser, not by this JSON Schema/);
    expect(schema.description).toContain("`phase`");
  });
});

describe("a phase's assignmentReason", () => {
  type JsonSchemaNode = {
    $ref?: string;
    items?: JsonSchemaNode;
    properties?: Record<string, unknown>;
    required?: string[];
  };

  // The printed schema's phase object, with a `$ref` followed into `$defs`.
  function phaseObject(): { properties: string[]; required: string[] } {
    const schema = getPlanDocumentJsonSchema() as {
      $defs?: Record<string, JsonSchemaNode>;
      properties: { phases: JsonSchemaNode };
    };
    let node: JsonSchemaNode = schema.properties.phases.items ?? {};
    if (node.$ref !== undefined) node = schema.$defs?.[node.$ref.split("/").at(-1) ?? ""] ?? {};
    return { properties: Object.keys(node.properties ?? {}), required: node.required ?? [] };
  }

  it("is the last of the phase's three trailing keys, in properties and required", () => {
    const { properties, required } = phaseObject();
    expect(properties.slice(-3)).toEqual(["assignmentReason", "model", "effort"]);
    expect(required.slice(-3)).toEqual(["assignmentReason", "model", "effort"]);
  });

  it("follows mode and oracle, which follow optionalFilesToEdit", () => {
    const { properties, required } = phaseObject();
    for (const keys of [properties, required]) {
      const at = keys.indexOf("optionalFilesToEdit");
      expect(keys.slice(at, at + 3)).toEqual(["optionalFilesToEdit", "mode", "oracle"]);
    }
  });

  it("requires mode and oracle on every phase, and refuses a mode or oracle outside their shapes", () => {
    const { mode: _mode, ...noMode } = validPhase(1);
    const { oracle: _oracle, ...noOracle } = validPhase(1);
    for (const phase of [
      noMode,
      noOracle,
      { ...validPhase(1), mode: "review" },
      { ...validPhase(1), oracle: { dischargedBy: "phase-03" } },
    ]) {
      expect(Either.isLeft(decodePlanDocument({ ...validPlanDocument(), phases: [phase] }))).toBe(
        true,
      );
    }
  });

  it("admits a reason and null, in the authoring answer and the sidecar", () => {
    const reasoned = {
      ...validPlanDocument(),
      phases: [{ ...validPhase(1), assignmentReason: "Designs a state machine." }],
    };
    expect(Either.isRight(decodePlanDocument(reasoned))).toBe(true);
    expect(Either.isRight(decodePlanDocument(validPlanDocument()))).toBe(true);
    const { version: _version, ...rest } = reasoned;
    const sidecar = { $schema: currentSchemaUrl("plan-document"), ...rest };
    expect(Either.isRight(decodePlanDocumentFile(sidecar))).toBe(true);
  });

  it("refuses the old key modelReason as an unknown key, with no alias", () => {
    const { assignmentReason: _reason, ...rest } = validPhase(1);
    const old = { ...validPlanDocument(), phases: [{ ...rest, modelReason: null }] };
    expect(Either.isLeft(decodePlanDocument(old))).toBe(true);
    const { version: _version, ...doc } = validPlanDocument();
    const sidecar = {
      $schema: currentSchemaUrl("plan-document"),
      ...doc,
      phases: [{ ...validPhase(1), modelReason: null }],
    };
    expect(Either.isLeft(decodePlanDocumentFile(sidecar))).toBe(true);
  });

  it("is required, and an empty string is not a reason", () => {
    const { assignmentReason: _reason, ...withoutReason } = validPhase(1);
    const missing = { ...validPlanDocument(), phases: [withoutReason] };
    expect(Either.isLeft(decodePlanDocument(missing))).toBe(true);
    const empty = { ...validPlanDocument(), phases: [{ ...validPhase(1), assignmentReason: "" }] };
    expect(Either.isLeft(decodePlanDocument(empty))).toBe(true);
  });

  it("never reaches the projection", () => {
    const reasoned = {
      ...validPlanDocument(),
      phases: [{ ...validPhase(1), assignmentReason: "Designs a state machine." }],
    };
    const projected = projectExtractedPlan(Either.getOrThrow(decodePlanDocument(reasoned)));
    expect(JSON.stringify(projected)).not.toContain("assignmentReason");
  });
});

// The refusal of a plan document, as `formatPlanDocumentViolation` names it.
function refusal(doc: unknown): string {
  const result = decodePlanDocument(doc);
  if (Either.isRight(result)) throw new Error("expected the document to be refused");
  return formatPlanDocumentViolation(doc, result.left);
}

describe("a phase's test lines", () => {
  const SIZES = ["small", "medium", "large"];
  const TECHNIQUES = [
    "example",
    "table",
    "property",
    "metamorphic",
    "stateful",
    "fuzz",
    "contract",
    "smoke",
  ];
  const LOOPS = ["oracle", "in-phase"];

  // A plan whose phase-02 holds `lines`.
  function withPhase02Lines(lines: unknown[]) {
    const doc = validPlanDocument();
    return { ...doc, phases: [doc.phases[0], { ...doc.phases[1], testStrategy: lines }] };
  }

  it("accepts lines on every size, technique and loop value, and refuses a size outside the set", () => {
    const lines = [
      ...SIZES.map((size) => testLine(`sized ${size}`, { size })),
      ...TECHNIQUES.map((technique) => testLine(`by ${technique}`, { technique })),
      ...LOOPS.map((loop) => testLine(`looped ${loop}`, { loop, criterion: "ac-one" })),
    ];
    expect(Either.isRight(decodePlanDocument(withPhase02Lines(lines)))).toBe(true);
    const unit = lines.map((line, i) => (i === 4 ? { ...line, size: "unit" } : line));
    expect(refusal(withPhase02Lines(unit))).toMatch(/^phase-02 test line 5 size: /);
  });

  it("names phase-02, test line 2 and loop when phase-02's second line has no loop", () => {
    const { loop: _loop, ...noLoop } = testLine("the second guarantee");
    const doc = withPhase02Lines([testLine("the first guarantee"), noLoop]);
    expect(refusal(doc)).toBe("phase-02 test line 2 loop: is missing");
  });

  it.each([
    [
      "a missing coordinate",
      (() => {
        const { technique: _t, ...line } = testLine("x");
        return line;
      })(),
      /^phase-02 test line 1 technique: is missing$/,
    ],
    [
      "a value outside its set",
      testLine("x", { technique: "unit" }),
      /^phase-02 test line 1 technique: /,
    ],
    [
      "an unknown key",
      { ...testLine("x"), notes: "y" },
      /^phase-02 test line 1 notes: is unexpected/,
    ],
    [
      "an oracle holding ' — '",
      testLine("x", { oracle: "a — b" }),
      /^phase-02 test line 1 oracle: an oracle never contains ' — '/,
    ],
    [
      "a criterion holding a backtick",
      testLine("x", { criterion: "`ac`" }),
      /^phase-02 test line 1 criterion: /,
    ],
  ])("refuses %s naming the phase, the line and the coordinate", (_label, line, message) => {
    expect(refusal(withPhase02Lines([line]))).toMatch(message);
  });

  it("names the phase by its index when the input holds no string id there", () => {
    const result = decodePlanDocument(withPhase02Lines([testLine("x", { size: "unit" })]));
    if (Either.isRight(result)) throw new Error("expected the document to be refused");
    expect(formatPlanDocumentViolation({ phases: [{}, {}] }, result.left)).toMatch(
      /^phases\[1\] test line 1 size: /,
    );
  });

  it("keeps formatFirstViolation's text for a violation outside a test line", () => {
    const doc = validPlanDocument();
    expect(refusal({ ...doc, kind: "spec" })).toMatch(/^kind: /);
  });

  it("accepts [] as a phase that tests nothing", () => {
    expect(Either.isRight(decodePlanDocument(withPhase02Lines([])))).toBe(true);
  });

  describe("in the exported JSON Schema", () => {
    type Node = Record<string, unknown> & {
      $ref?: string;
      items?: Node;
      properties?: Record<string, Node>;
    };

    function testLineNode(): Node {
      const schema = getPlanDocumentJsonSchema() as Node & { $defs?: Record<string, Node> };
      const follow = (node: Node | undefined): Node => {
        if (node?.$ref === undefined) return node ?? {};
        return schema.$defs?.[node.$ref.split("/").at(-1) ?? ""] ?? {};
      };
      const phase = follow(schema.properties?.["phases"]?.items);
      return follow(phase.properties?.["testStrategy"]?.items);
    }

    it("lists size, technique and loop as enums of exactly the skill's values", () => {
      const line = testLineNode();
      expect(line.properties?.["size"]?.["enum"]).toEqual(SIZES);
      expect(line.properties?.["technique"]?.["enum"]).toEqual(TECHNIQUES);
      expect(line.properties?.["loop"]?.["enum"]).toEqual(LOOPS);
    });

    it("describes the line format and publishes additionalProperties false on a line", () => {
      const line = testLineNode();
      expect(line["additionalProperties"]).toBe(false);
      expect(line["required"]).toEqual([
        "guarantee",
        "size",
        "technique",
        "oracle",
        "loop",
        "criterion",
      ]);
      expect(line["description"]).toContain(
        "- <guarantee> — <size> · <technique> · <oracle> · <loop>[ · <criterion>]",
      );
      expect(line["description"]).toContain("source spec's JSON sidecar");
    });
  });
});
