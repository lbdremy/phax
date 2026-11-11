// The equivalence judge on hand-built schema pairs: equal shapes are equivalent
// whatever the documents, an empty document list never proves two different
// shapes equivalent, a document the two judge differently is returned, and
// annotations never count.
import { describe, expect, it } from "vitest";
import {
  judgeEquivalence,
  withoutAnnotations,
} from "../../../packages/schemas/build/equivalence.js";

/** A one-property object schema: `{ n }` of the given type, no other key. */
function objectOf(n: object, annotations: object = {}): object {
  return {
    type: "object",
    ...annotations,
    required: ["n"],
    properties: { n },
    additionalProperties: false,
  };
}

const integer = objectOf({ type: "integer" });
const number = objectOf({ type: "number" });
// The same contract as `integer`, in another form.
const integerAsMultiple = objectOf({ type: "number", multipleOf: 1 });

describe("judgeEquivalence", () => {
  it("finds a pair equal once annotations are dropped equivalent, with no document", () => {
    const annotated = objectOf(
      { type: "integer", description: "a count", title: "Count", examples: [1] },
      { description: "a toy" },
    );
    expect(judgeEquivalence({ released: integer, generated: annotated, documents: [] })).toEqual({
      equivalent: true,
      disagreements: [],
      problem: null,
    });
  });

  it("never proves two different shapes equivalent from an empty document list", () => {
    const verdict = judgeEquivalence({
      released: integer,
      generated: integerAsMultiple,
      documents: [],
    });
    expect(verdict.equivalent).toBe(false);
    expect(verdict.disagreements).toEqual([]);
  });

  it("finds two forms of one contract equivalent when every document is judged alike", () => {
    const documents = [{ n: 1 }, { n: 0 }, { n: 1.5 }, { n: "1" }, {}, { n: 1, extra: true }];
    expect(
      judgeEquivalence({ released: integer, generated: integerAsMultiple, documents }),
    ).toEqual({ equivalent: true, disagreements: [], problem: null });
  });

  it("returns every document the two judge differently, with each verdict, in order", () => {
    const documents = [{ n: 1 }, { n: 1.5 }, { n: "x" }, { n: 2.5 }];
    const verdict = judgeEquivalence({ released: integer, generated: number, documents });
    expect(verdict.equivalent).toBe(false);
    expect(verdict.disagreements).toEqual([
      { document: { n: 1.5 }, released: false, generated: true },
      { document: { n: 2.5 }, released: false, generated: true },
    ]);
    expect(verdict.problem).toBeNull();
  });

  it("ignores annotations when it judges by the documents too", () => {
    const annotated = objectOf({ type: "number", multipleOf: 1, description: "another note" });
    const verdict = judgeEquivalence({
      released: integer,
      generated: annotated,
      documents: [{ n: 3 }, { n: 3.5 }],
    });
    expect(verdict).toEqual({ equivalent: true, disagreements: [], problem: null });
  });

  it("names a schema ajv cannot compile, judged by its shape alone", () => {
    const broken = { type: "no-such-type" };
    const verdict = judgeEquivalence({
      released: integer,
      generated: broken,
      documents: [{ n: 1 }],
    });
    expect(verdict.equivalent).toBe(false);
    expect(verdict.problem).toContain("generated");
  });
});

describe("withoutAnnotations", () => {
  it("drops description, title and examples at every subschema, and keeps a property named description", () => {
    const schema = {
      type: "object",
      title: "Toy",
      description: "a toy",
      properties: {
        description: { type: "string", description: "the toy's own description" },
        list: { type: "array", items: { type: "number", examples: [1] } },
      },
      anyOf: [{ required: ["description"], title: "with one" }],
    };
    expect(withoutAnnotations(schema)).toEqual({
      type: "object",
      properties: {
        description: { type: "string" },
        list: { type: "array", items: { type: "number" } },
      },
      anyOf: [{ required: ["description"] }],
    });
  });
});
