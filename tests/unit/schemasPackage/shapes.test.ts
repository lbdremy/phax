import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  UNKNOWN,
  defineFormat,
  isUnknown,
  newerReleaseMessage,
  unknownFormatMessage,
  type Shape,
} from "../../../packages/schemas/src/shapes.js";
import type { Parsed } from "../../../packages/schemas/src/parsed.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

function shape<A, I>(schema: Schema.Schema<A, I>): Shape<A> {
  return { schema, decode: Schema.decodeUnknownEither(schema, { onExcessProperty: "error" }) };
}

// A toy format with legacy literals 1 and 2, a release-named historical shape
// 0.10.0, and a current shape, read by a package at 0.13.0.
const V1 = Schema.Struct({ version: Schema.Literal(1), a: Schema.String });
const V2 = Schema.Struct({ version: Schema.Literal(2), a: Schema.String, b: Schema.Number });
const R0_10 = Schema.Struct({ $schema: Schema.String, a: Schema.String, b: Schema.Number });
const R0_12 = Schema.Struct({
  $schema: Schema.String,
  a: Schema.String,
  b: Schema.Number,
  c: Schema.Boolean,
});
const NEXT = Schema.Struct({
  $schema: Schema.String,
  a: Schema.String,
  b: Schema.Number,
  c: Schema.Boolean,
  d: Schema.String,
});

type ToyShapes = {
  v1: typeof V1.Type;
  v2: typeof V2.Type;
  "0.10.0": typeof R0_10.Type;
  "0.12.0": typeof R0_12.Type;
};

const toy = defineFormat<ToyShapes>(
  {
    id: "gate-pending",
    label: "toy document",
    legacy: { 1: shape(V1), 2: shape(V2) },
    releases: [["0.10.0", shape(R0_10)]],
    current: { name: "0.12.0", shape: shape(R0_12) },
  },
  { packageVersion: "0.13.0" },
);

type ToyNextShapes = Omit<ToyShapes, never> & { next: typeof NEXT.Type };

const toyNext = defineFormat<ToyNextShapes>(
  {
    id: "gate-pending",
    label: "toy document",
    legacy: { 1: shape(V1), 2: shape(V2) },
    releases: [
      ["0.10.0", shape(R0_10)],
      ["0.12.0", shape(R0_12)],
    ],
    current: { name: "next", shape: shape(NEXT) },
  },
  { packageVersion: "0.13.0" },
);

const url = (release: string) => schemaUrl("gate-pending", release);
const at0_10 = (release: string) => ({ $schema: url(release), a: "x", b: 1 });
const at0_12 = (release: string) => ({ ...at0_10(release), c: true });
const atNext = (release: string) => ({ ...at0_12(release), d: "y" });

function expectFailure(result: Parsed<unknown>, path: string, message?: string) {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.path).toBe(path);
  expect(result.error.message).not.toBe("");
  if (message !== undefined) expect(result.error.message).toBe(message);
}

describe("defineFormat: $schema documents", () => {
  it("resolves a release to the latest shape released at or before it", () => {
    expect(toy.parse(at0_10("0.10.0"))).toEqual({
      ok: true,
      shape: "0.10.0",
      value: at0_10("0.10.0"),
    });
    expect(toy.parse(at0_10("0.11.0"))).toMatchObject({ ok: true, shape: "0.10.0" });
    expect(toy.parse(at0_12("0.12.0"))).toMatchObject({ ok: true, shape: "0.12.0" });
    expect(toy.parse(at0_12("0.13.0"))).toMatchObject({ ok: true, shape: "0.12.0" });
  });

  it("fails with the shape's own path when the resolved shape rejects the document", () => {
    expectFailure(toy.parse(at0_12("0.11.0")), "c");
    expectFailure(toy.parse({ ...at0_10("0.10.0"), b: "one" }), "b");
  });

  it("names a release with no shape", () => {
    expectFailure(
      toy.parse(at0_10("0.9.0")),
      "$schema",
      "no gate-pending shape is known at release 0.9.0",
    );
  });

  it("fails a newer release with the upgrade message", () => {
    expectFailure(
      toy.parse(at0_12("99.0.0")),
      "$schema",
      "gate-pending written by phax 99.0.0 is newer than @lbdremy/phax-schemas 0.13.0 — upgrade the package",
    );
    expect(newerReleaseMessage("gate-pending", "99.0.0", "0.13.0")).toBe(
      "gate-pending written by phax 99.0.0 is newer than @lbdremy/phax-schemas 0.13.0 — upgrade the package",
    );
  });

  it("fails an unknown format id with the upgrade message", () => {
    const unknown = "https://docs.phax.run/schemas/code-review/0.12.0.json";
    expectFailure(
      toy.parse({ ...at0_12("0.12.0"), $schema: unknown }),
      "$schema",
      `${unknown} names a format unknown to @lbdremy/phax-schemas 0.13.0 — upgrade the package`,
    );
    expect(unknownFormatMessage(unknown, "0.13.0")).toBe(
      `${unknown} names a format unknown to @lbdremy/phax-schemas 0.13.0 — upgrade the package`,
    );
  });

  it("names another known format", () => {
    const registry = schemaUrl("registry", "0.12.0");
    expectFailure(
      toy.parse({ ...at0_12("0.12.0"), $schema: registry }),
      "$schema",
      `${registry} is a registry document, not a gate-pending`,
    );
  });

  it.each([
    ["another host", "https://example.com/schemas/gate-pending/0.12.0.json"],
    ["a two-part release", "https://docs.phax.run/schemas/gate-pending/0.12.json"],
    ["a number", 12],
    ["null", null],
  ])("fails a malformed $schema (%s), naming the expected form", (_label, value) => {
    const result = toy.parse({ ...at0_12("0.12.0"), $schema: value });
    expectFailure(result, "$schema");
    if (!result.ok) {
      expect(result.error.message).toContain(
        "https://docs.phax.run/schemas/<format-id>/<X.Y.Z>.json",
      );
    }
  });
});

describe("defineFormat: a `next` current shape in a development tree", () => {
  it("decodes a document at the package's own release with next first", () => {
    expect(toyNext.parse(atNext("0.13.0"))).toEqual({
      ok: true,
      shape: "next",
      value: atNext("0.13.0"),
    });
  });

  it("falls back to the latest released shape when next rejects it", () => {
    expect(toyNext.parse(at0_12("0.13.0"))).toEqual({
      ok: true,
      shape: "0.12.0",
      value: at0_12("0.13.0"),
    });
  });

  it("never tries next below the package's own release", () => {
    expectFailure(toyNext.parse(atNext("0.12.0")), "d");
  });
});

describe("defineFormat: legacy documents", () => {
  it("resolves a version literal to its frozen shape", () => {
    expect(toy.parse({ version: 1, a: "x" })).toEqual({
      ok: true,
      shape: "v1",
      value: { version: 1, a: "x" },
    });
    expect(toy.parse({ version: 2, a: "x", b: 1 })).toMatchObject({ ok: true, shape: "v2" });
  });

  it("decodes a v<N> current shape with the current decoder, not the legacy one", () => {
    const current = defineFormat<{ v1: typeof V1.Type; v2: typeof V2.Type }>(
      {
        id: "gate-pending",
        label: "toy document",
        legacy: { 1: shape(V1), 2: shape(V1) as unknown as Shape<typeof V2.Type> },
        releases: [],
        current: { name: "v2", shape: shape(V2) },
      },
      { packageVersion: "0.13.0" },
    );
    expect(current.parse({ version: 2, a: "x", b: 1 })).toMatchObject({ ok: true, shape: "v2" });
  });

  it("fails an unknown literal at version, listing the known literals", () => {
    expectFailure(
      toy.parse({ version: 3, a: "x" }),
      "version",
      "unknown toy document version 3 — known versions are 1, 2",
    );
    expectFailure(toy.parse({ version: "1", a: "x" }), "version");
  });

  it("fails a legacy document its shape rejects, at the offending path", () => {
    expectFailure(toy.parse({ version: 1, a: "x", extra: true }), "extra");
  });
});

describe("defineFormat: neither marker", () => {
  it("fails a document with neither $schema nor version at $schema", () => {
    expectFailure(toy.parse({ a: "x" }), "$schema");
  });

  it.each([42, "doc", null, undefined, true, [{ version: 1, a: "x" }]])(
    "fails the non-object %j at the root",
    (input) => {
      expectFailure(toy.parse(input), "");
    },
  );
});

describe("defineFormat never throws", () => {
  it("returns a value for every input", () => {
    const inputs: unknown[] = [
      Symbol("x"),
      () => 1,
      new Map(),
      Object.create(null),
      { $schema: Symbol("x") },
      { $schema: 10n },
      { version: 10n },
      { version: Number.NaN },
      { version: { toString: () => "1" } },
      { $schema: url("0.12.0") },
    ];
    for (const input of inputs) {
      expect(() => toy.parse(input)).not.toThrow();
      expect(() => toyNext.parse(input)).not.toThrow();
    }
  });
});

describe("the unknown marker", () => {
  it("is a frozen { kind: 'unknown' }", () => {
    expect(UNKNOWN).toEqual({ kind: "unknown" });
    expect(Object.isFrozen(UNKNOWN)).toBe(true);
  });

  it("is recognised structurally, so a copied marker still reads as unknown", () => {
    expect(isUnknown(UNKNOWN)).toBe(true);
    expect(isUnknown(JSON.parse(JSON.stringify(UNKNOWN)))).toBe(true);
    expect(isUnknown(["local"])).toBe(false);
    expect(isUnknown(null)).toBe(false);
    expect(isUnknown("unknown")).toBe(false);
  });
});
