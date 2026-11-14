// Plan paths in the three plan formats (spec plan-path-canonical): the plan
// document admits only canonical paths and names the spelling to write; the
// extraction answer rewrites a plannable spelling; the published JSON Schemas
// state the rule; a 0.33.0 document is read by its frozen decoder, its paths as
// written, and an older sidecar's lift is refused at its first non-canonical
// path. Every plan here is made up.
import { readFileSync } from "node:fs";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  parsePhaxPlan,
  parsePhaxPlanExtraction,
  parsePlanDocument,
} from "../../packages/schemas/src/index.js";
import { SHIPPED_JSON_PATH } from "../../packages/schemas/build/jsonSchemas.js";
import { answerJsonSchema } from "../../src/schemas/answerSchemas.js";
import { decodePhaxPlanExtractionV0_33_0 } from "../../src/schemas/history/phax-plan-extraction/0.33.0.js";
import { decodePhaxPlanV0_33_0 } from "../../src/schemas/history/phax-plan/0.33.0.js";
import { decodePlanDocumentV0_33_0 } from "../../src/schemas/history/plan-document/0.33.0.js";
import {
  currentSchemaUrl,
  readDocumentSidecar,
  readPlanDocumentFile,
} from "../../src/schemas/persisted.js";
import { decodePhaxPlanFile } from "../../src/schemas/phaxPlan.js";
import {
  decodeAuthoredPlanDocument,
  decodePlanDocumentFile,
} from "../../src/schemas/planDocument.js";
import {
  decodePlanExtractionAnswer,
  readPlanExtractionAnswer,
} from "../../src/schemas/planExtraction.js";
import { PLAN_PATH_PATTERN } from "../../src/schemas/planPath.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

type Doc = Record<string, unknown>;
type List = "plannedFilesToCreate" | "plannedFilesToEdit" | "optionalFilesToEdit";
const LISTS: readonly List[] = [
  "plannedFilesToCreate",
  "plannedFilesToEdit",
  "optionalFilesToEdit",
];

const phase = (id: string): Doc => ({
  id,
  title: `Step ${id}`,
  objective: "Do the step.",
  detailedInstructions: ["Do the step."],
  planMarkdownAnchor: `#${id}-step`,
  plannedFilesToCreate: [],
  plannedFilesToEdit: [],
  optionalFilesToEdit: [],
  mode: "headless",
  acceptance: null,
  boundaryContracts: null,
  testStrategy: [
    {
      guarantee: "The step does its work",
      size: "small",
      technique: "example",
      oracle: "the step's output",
      loop: "in-phase",
      criterion: null,
    },
  ],
  implementationOrder: ["Do the step."],
  excludedScope: [],
  verification: "The `standard` gate profile.",
  expectedHandoff: "Nothing.",
  commit: { subject: `feat: ${id}`, body: "Do the step." },
  assignmentReason: null,
  model: "claude-sonnet-5-5",
  effort: "medium",
});

/** A two-phase plan document at `$schema`, its phases' lists as given. */
function planDocument(
  $schema: string,
  lists: { readonly [id: string]: Partial<Record<List, readonly string[]>> } = {},
): Doc {
  return {
    $schema,
    kind: "plan",
    sourceSpec: null,
    completesSpec: null,
    run: { shortName: "widget", title: "Widget", requiredCommands: [] },
    preamble: {
      summary: "Two steps.",
      requiredCommandsNote: "No extra commands.",
      technicalArbitrations: [],
      openQuestions: [],
      arbitratedQuestions: [],
    },
    phases: ["phase-01", "phase-02"].map((id) => ({ ...phase(id), ...lists[id] })),
  };
}

const current = (lists?: Parameters<typeof planDocument>[1]) =>
  planDocument(currentSchemaUrl("plan-document"), lists);

const withEdit = (paths: readonly string[]) =>
  current({ "phase-02": { plannedFilesToEdit: paths } });

describe("ac-document-refuses: a plan document holding ./src/x.ts", () => {
  it("is refused at phases[1].plannedFilesToEdit[0], naming phase-02, ./src/x.ts and src/x.ts (spec §6)", () => {
    expect(decodeAuthoredPlanDocument(withEdit(["./src/x.ts", "../shared/y.ts"]))).toEqual(
      Result.fail(
        'phases[1].plannedFilesToEdit[0]: phase-02 plans "./src/x.ts", which is not canonical: write "src/x.ts"',
      ),
    );
    expect(decodeAuthoredPlanDocument(withEdit(["src/x.ts", "../shared/y.ts"]))).toEqual(
      Result.fail(
        'phases[1].plannedFilesToEdit[1]: phase-02 plans "../shared/y.ts", which leaves the repository',
      ),
    );
  });

  it("is accepted with the canonical spelling", () => {
    expect(Result.isSuccess(decodeAuthoredPlanDocument(withEdit(["src/x.ts"])))).toBe(true);
  });
});

describe("ac-unplannable: each unplannable spelling under phase-02's plannedFilesToEdit", () => {
  it.each([
    ["", "is empty"],
    ["./", "is empty"],
    ["/src/x.ts", "is absolute"],
    ["../x.ts", "leaves the repository"],
    ["src/../../x.ts", "leaves the repository"],
    ["src/", "names a directory"],
    ["src\\x.ts", "contains a backslash"],
  ])("refuses %j, naming phase-02, the list, the path and that it %s", (written, reason) => {
    expect(decodeAuthoredPlanDocument(withEdit([written]))).toEqual(
      Result.fail(
        `phases[1].plannedFilesToEdit[0]: phase-02 plans ${JSON.stringify(written)}, which ${reason}`,
      ),
    );
  });
});

// The `items` schema of each file list of a rendered JSON Schema's phases; a
// `$ref` is followed, and a nullable node read as its non-null branch.
function listItems(schema: Doc, phasesAt: readonly string[]): Record<List, Doc> {
  const defs = (schema["$defs"] ?? {}) as Record<string, Doc>;
  const resolve = (node: Doc): Doc => {
    if (typeof node["$ref"] === "string") {
      return resolve(defs[node["$ref"].replace("#/$defs/", "")] ?? {});
    }
    const branches = node["anyOf"];
    if (Array.isArray(branches)) {
      const object = (branches as Doc[]).map(resolve).find((branch) => "properties" in branch);
      if (object !== undefined) return object;
    }
    return node;
  };
  let node = resolve(schema);
  for (const key of phasesAt) {
    node = resolve(((node["properties"] ?? {}) as Record<string, Doc>)[key] ?? {});
  }
  const phases = resolve((node["items"] ?? {}) as Doc);
  const properties = (phases["properties"] ?? {}) as Record<string, Doc>;
  return Object.fromEntries(
    LISTS.map((list) => [list, resolve((resolve(properties[list] ?? {})["items"] ?? {}) as Doc)]),
  ) as Record<List, Doc>;
}

describe("ac-schema: the published JSON Schemas state the canonical-path rule", () => {
  const shipped = JSON.parse(readFileSync(SHIPPED_JSON_PATH, "utf8")) as Record<string, string>;
  const schemas: ReadonlyArray<readonly [string, Doc]> = [
    ["the plan document `phax artifact schema plan` prints", answerJsonSchema("plan-document")],
    [
      "the phax-plan JSON Schema the package ships",
      JSON.parse(shipped["phax-plan.schema.json"] ?? "{}") as Doc,
    ],
  ];

  it.each(schemas)("%s carries it on each file list's items", (_name, schema) => {
    for (const [list, items] of Object.entries(listItems(schema, ["phases"]))) {
      expect(items["pattern"], list).toBe(PLAN_PATH_PATTERN);
      expect(items["description"], list).toContain("canonical form");
    }
  });

  it("the extraction answer's JSON Schema still admits a plannable non-canonical path", () => {
    const items = listItems(answerJsonSchema("phax-plan-extraction"), ["plan", "phases"]);
    for (const [list, item] of Object.entries(items)) {
      expect(item["pattern"], list).toBeUndefined();
      expect(item["description"], list).toContain("rewrites");
    }
    const answer = {
      $schema: currentSchemaUrl("phax-plan-extraction"),
      plan: {
        run: { shortName: "widget", title: "Widget", requiredCommands: [] },
        phases: [
          {
            id: "phase-01",
            model: "claude-sonnet-5-5",
            effort: "medium",
            planMarkdownAnchor: "#phase-01-step",
            plannedFilesToCreate: ["./src/x.ts"],
            plannedFilesToEdit: ["src//y.ts"],
            optionalFilesToEdit: ["src/a/../z.ts"],
            testLines: [],
            commit: { subject: "feat: x", body: "Adds x." },
          },
        ],
      },
      incomplete: null,
    };
    const read = readPlanExtractionAnswer(answer);
    if (Result.isFailure(read)) throw new Error(read.failure);
    expect(read.success.kind === "plan" && read.success.plan.phases[0]).toMatchObject({
      plannedFilesToCreate: ["src/x.ts"],
      plannedFilesToEdit: ["src/y.ts"],
      optionalFilesToEdit: ["src/z.ts"],
    });
  });
});

describe("an extraction answer's unplannable path", () => {
  const answerPhase = (id: string, edit: readonly string[]) => ({
    id,
    model: "claude-sonnet-5-5",
    effort: "medium",
    planMarkdownAnchor: "#step",
    plannedFilesToCreate: [],
    plannedFilesToEdit: edit,
    optionalFilesToEdit: [],
    testLines: [],
    commit: { subject: "feat: x", body: "Adds x." },
  });
  const answer = (second: ReturnType<typeof answerPhase>) => ({
    $schema: currentSchemaUrl("phax-plan-extraction"),
    plan: {
      run: { shortName: "widget", title: "Widget", requiredCommands: [] },
      phases: [answerPhase("phase-01", ["src/a.ts"]), second],
    },
    incomplete: null,
  });

  it("is refused naming the phase by its id, the written path and why", () => {
    expect(readPlanExtractionAnswer(answer(answerPhase("phase-02", ["../x.ts"])))).toEqual(
      Result.fail(
        'plan.phases[1].plannedFilesToEdit[0]: phase-02 plans "../x.ts", which leaves the repository',
      ),
    );
  });
});

describe("ac-older-sidecar: a plan sidecar stamped 0.33.0", () => {
  const at0_33_0 = (lists?: Parameters<typeof planDocument>[1]) =>
    planDocument(schemaUrl("plan-document", "0.33.0"), lists);

  it("lifts unchanged when its paths are canonical", () => {
    const input = at0_33_0({ "phase-02": { plannedFilesToEdit: ["src/x.ts"] } });
    const read = readDocumentSidecar("plan", "plan.json", input);
    if (Result.isFailure(read)) throw new Error(read.failure.message);
    expect(read.success.shape).toBe("0.33.0");
    if (read.success.shape === "current") return;
    const { $schema: _schema, ...value } = input;
    expect(read.success.lift).toEqual({ kind: "lifted", document: value });
  });

  it("is a refused lift at ./src/x.ts, the path never rewritten", () => {
    const input = at0_33_0({ "phase-02": { plannedFilesToEdit: ["src/y.ts", "./src/x.ts"] } });
    const read = readDocumentSidecar("plan", "plan.json", input);
    if (Result.isFailure(read)) throw new Error(read.failure.message);
    if (read.success.shape === "current") throw new Error("read as current");
    expect(read.success.lift).toEqual({
      kind: "refused-path",
      phase: "phase-02",
      list: "plannedFilesToEdit",
      written: "./src/x.ts",
      problem: 'is not canonical: write "src/x.ts"',
    });
    expect(read.success.older.phases[1]?.plannedFilesToEdit).toEqual(["src/y.ts", "./src/x.ts"]);
    expect(readPlanDocumentFile("docs/plans/p-plan.json", input)).toEqual(
      Result.fail({
        _tag: "PersistedReadError",
        file: "docs/plans/p-plan.json",
        format: "plan-document",
        message:
          'docs/plans/p-plan.json: phase-02 plannedFilesToEdit "./src/x.ts" is not canonical: write "src/x.ts"',
      }),
    );
  });

  it("is refused at its first path in plan order: phases in order, then create, edit, optional", () => {
    const refusedAt = (lists: Parameters<typeof planDocument>[1]) => {
      const read = readDocumentSidecar("plan", "plan.json", at0_33_0(lists));
      if (Result.isFailure(read) || read.success.shape === "current") return undefined;
      const { lift } = read.success;
      return lift.kind === "refused-path"
        ? `${lift.phase} ${lift.list} ${lift.written}`
        : lift.kind;
    };
    expect(
      refusedAt({
        "phase-01": { optionalFilesToEdit: ["src/"] },
        "phase-02": { plannedFilesToCreate: ["./a.ts"] },
      }),
    ).toBe("phase-01 optionalFilesToEdit src/");
    expect(
      refusedAt({
        "phase-02": { plannedFilesToCreate: ["./a.ts"], plannedFilesToEdit: ["../b.ts"] },
      }),
    ).toBe("phase-02 plannedFilesToCreate ./a.ts");
  });

  it("is refused at a non-canonical path in an older shape too (0.32.0)", () => {
    const at0_32_0 = planDocument(schemaUrl("plan-document", "0.32.0"), {
      "phase-01": { plannedFilesToEdit: ["src//x.ts"] },
    });
    const phases = (at0_32_0["phases"] as Doc[]).map(({ acceptance, ...p }) => ({
      ...p,
      oracle: acceptance,
    }));
    const read = readDocumentSidecar("plan", "plan.json", { ...at0_32_0, phases });
    if (Result.isFailure(read)) throw new Error(read.failure.message);
    expect(read.success.shape).toBe("0.32.0");
    expect(read.success.shape !== "current" && read.success.lift).toMatchObject({
      kind: "refused-path",
      phase: "phase-01",
      written: "src//x.ts",
    });
  });
});

describe("the frozen 0.33.0 decoders keep a path as written", () => {
  it("admit ./src/x.ts where the current decoders refuse it", () => {
    const document = planDocument(schemaUrl("plan-document", "0.33.0"), {
      "phase-01": { plannedFilesToEdit: ["./src/x.ts"] },
    });
    expect(Result.isSuccess(decodePlanDocumentV0_33_0(document))).toBe(true);
    expect(
      Result.isFailure(
        decodePlanDocumentFile({ ...document, $schema: currentSchemaUrl("plan-document") }),
      ),
    ).toBe(true);

    const plan = {
      $schema: schemaUrl("phax-plan", "0.33.0"),
      run: { shortName: "widget", title: "Widget", branch: "phax/widget", requiredCommands: [] },
      phases: [
        {
          id: "phase-01",
          title: "Widget",
          model: "claude-sonnet-5-5",
          effort: "medium",
          planMarkdownAnchor: "#phase-01-widget",
          plannedFilesToCreate: [],
          plannedFilesToEdit: ["./src/x.ts"],
          optionalFilesToEdit: [],
          mode: "headless",
          acceptance: null,
          testLines: [],
          commit: { subject: "feat: widget", body: "Adds the widget." },
        },
      ],
    };
    expect(Result.isSuccess(decodePhaxPlanV0_33_0(plan))).toBe(true);
    expect(
      Result.isFailure(decodePhaxPlanFile({ ...plan, $schema: currentSchemaUrl("phax-plan") })),
    ).toBe(true);

    const answer = {
      $schema: schemaUrl("phax-plan-extraction", "0.33.0"),
      plan: {
        run: { shortName: "widget", title: "Widget", requiredCommands: [] },
        phases: [{ ...plan.phases[0], title: undefined, mode: undefined, acceptance: undefined }],
      },
      incomplete: null,
    };
    const frozen = decodePhaxPlanExtractionV0_33_0(JSON.parse(JSON.stringify(answer)));
    expect(Result.isSuccess(frozen) && frozen.success.plan?.phases[0].plannedFilesToEdit).toEqual([
      "./src/x.ts",
    ]);
  });
});

// The corpus holds documents at each format's current stamp; phax's file
// decoder and the schemas package must give each the same verdict and value.
describe("phax's readers and the schemas package agree on every current-shape corpus document", () => {
  interface Verdict {
    readonly ok: boolean;
    readonly value: unknown;
  }
  const phax = (result: Result.Result<unknown, unknown>): Verdict =>
    Result.isSuccess(result) ? { ok: true, value: result.success } : { ok: false, value: null };
  const pkg = (parsed: { readonly ok: boolean; readonly value?: unknown }): Verdict =>
    parsed.ok ? { ok: true, value: parsed.value } : { ok: false, value: null };
  const formats: ReadonlyArray<
    readonly [
      "phax-plan" | "plan-document" | "phax-plan-extraction",
      (input: unknown) => Verdict,
      (input: unknown) => Verdict,
    ]
  > = [
    ["phax-plan", (i) => phax(decodePhaxPlanFile(i)), (i) => pkg(parsePhaxPlan(i))],
    ["plan-document", (i) => phax(decodePlanDocumentFile(i)), (i) => pkg(parsePlanDocument(i))],
    [
      "phax-plan-extraction",
      (i) => phax(decodePlanExtractionAnswer(i)),
      (i) => pkg(parsePhaxPlanExtraction(i)),
    ],
  ];

  it.each(formats)("%s", (id, decode, parse) => {
    const file = JSON.parse(
      readFileSync(`tests/behaviourCorpus/cases/formats/${id}.json`, "utf8"),
    ) as { current: Array<{ name: string; input: unknown }> };
    const documents = file.current.filter(
      (c) => (c.input as Doc | null)?.["$schema"] === currentSchemaUrl(id),
    );
    expect(documents.length).toBeGreaterThan(10);
    for (const { name, input } of documents) {
      expect(parse(input), name).toEqual(decode(input));
    }
  });
});
