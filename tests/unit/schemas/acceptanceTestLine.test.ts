import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { answerJsonSchema } from "../../../src/schemas/answerSchemas.js";
import { decodeAuthoredPlanDocument } from "../../../src/schemas/planDocument.js";
import { RESERVED_CRITERIA, TEST_LOOPS, TEST_TECHNIQUES } from "../../../src/schemas/testLine.js";
import { renderTestLine, parseTestLine } from "../../../src/domain/plan/testLineGrammar.js";
import { snapshotPath } from "../../../packages/schemas/build/snapshots.js";
import { CURRENT_SHAPES } from "../../../packages/schemas/src/generated/index.js";
import { validDocuments } from "../schemasPackage/documents.js";

// The test line at 0.33.0: the loop `acceptance | in-phase`, the technique
// `boundary` after `example`, and three reserved criterion words.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const TECHNIQUES = [
  "example",
  "boundary",
  "table",
  "property",
  "metamorphic",
  "stateful",
  "fuzz",
  "contract",
  "smoke",
];

type Json = Record<string, unknown>;

/** Every `enum` array found under a `technique` or `loop` property, wherever it sits in the schema. */
function enumsOf(node: unknown, property: "technique" | "loop"): unknown[][] {
  if (Array.isArray(node)) return node.flatMap((item) => enumsOf(item, property));
  if (typeof node !== "object" || node === null) return [];
  const json = node as Json;
  const found: unknown[][] = [];
  const properties = json["properties"];
  if (typeof properties === "object" && properties !== null) {
    const own = (properties as Json)[property];
    if (typeof own === "object" && own !== null) {
      const values = (own as Json)["enum"];
      if (Array.isArray(values)) found.push(values);
    }
  }
  return [...found, ...Object.values(json).flatMap((child) => enumsOf(child, property))];
}

// The format's current snapshot: `next` while a release is pending, the
// release's own stamp once it is cut.
function snapshot(formatId: keyof typeof CURRENT_SHAPES): Json {
  return JSON.parse(
    readFileSync(join(repoRoot, snapshotPath(formatId, CURRENT_SHAPES[formatId])), "utf8"),
  ) as Json;
}

/** A plan document whose phase-02 holds `lines`; phase-01 is the made-up example's. */
function withPhase02Lines(lines: unknown[]): Json {
  const doc = validDocuments["plan-document"] as Json;
  const [first] = doc["phases"] as Json[];
  return {
    ...doc,
    phases: [
      first,
      { ...first, id: "phase-02", planMarkdownAnchor: "#phase-02-second", testStrategy: lines },
    ],
  };
}

const line = (overrides: Json = {}): Json => ({
  guarantee: "the limits are honoured",
  size: "small",
  technique: "boundary",
  oracle: "the expected limits",
  loop: "acceptance",
  criterion: null,
  ...overrides,
});

function refusal(input: unknown): string {
  const result = decodeAuthoredPlanDocument(input);
  if (Either.isRight(result)) throw new Error("expected the document to be refused");
  return result.left;
}

describe("the techniques and loops of a test line (ac-boundary, ac-loop)", () => {
  it("lists the nine techniques, exactly and in order, in the plan-document answer schema", () => {
    expect([...TEST_TECHNIQUES]).toEqual(TECHNIQUES);
    const enums = enumsOf(answerJsonSchema("plan-document"), "technique");
    expect(enums).toEqual([TECHNIQUES]);
  });

  it.each(["phax-plan", "phax-plan-extraction"] as const)(
    "lists the nine techniques, exactly and in order, in the published %s schema",
    (formatId) => {
      expect(enumsOf(snapshot(formatId), "technique")).toEqual([TECHNIQUES]);
    },
  );

  it.each(["plan-document", "phax-plan", "phax-plan-extraction"] as const)(
    "lists the loops acceptance and in-phase in the published %s schema",
    (formatId) => {
      expect([...TEST_LOOPS]).toEqual(["acceptance", "in-phase"]);
      expect(enumsOf(snapshot(formatId), "loop")).toEqual([["acceptance", "in-phase"]]);
    },
  );

  it("decodes a boundary line, and renders and reads it back unchanged", () => {
    const boundary = line();
    expect(Either.isRight(decodeAuthoredPlanDocument(withPhase02Lines([boundary])))).toBe(true);
    expect(parseTestLine(renderTestLine(boundary as never))).toEqual(boundary);
  });

  it("refuses a plan-document answer with the loop `oracle` by the enum's own message, never by name", () => {
    const message = refusal(withPhase02Lines([line({ loop: "oracle" })]));
    // Effect's own refusal of the literal, which only echoes the value it was given.
    expect(message).toBe('phase-02 test line 1 loop: Expected "acceptance", actual "oracle"');
  });
});

describe("the reserved criterion words (ac-criterion)", () => {
  it("reserves the loops and `oracle`", () => {
    expect([...RESERVED_CRITERIA]).toEqual(["acceptance", "in-phase", "oracle"]);
  });

  it.each(["acceptance", "in-phase", "oracle"])(
    "refuses a criterion `%s` naming phase-02, line 1 and criterion",
    (criterion) => {
      expect(refusal(withPhase02Lines([line({ criterion })]))).toBe(
        "phase-02 test line 1 criterion: a criterion is neither 'acceptance', 'in-phase' nor 'oracle'",
      );
    },
  );

  it("names the three words in the criterion's JSON Schema description", () => {
    const schema = JSON.stringify(answerJsonSchema("plan-document"));
    expect(schema).toContain("neither 'acceptance', 'in-phase' nor 'oracle'");
  });

  it("accepts an ordinary criterion id", () => {
    const decoded = decodeAuthoredPlanDocument(withPhase02Lines([line({ criterion: "ac-loop" })]));
    expect(Either.isRight(decoded)).toBe(true);
  });
});
