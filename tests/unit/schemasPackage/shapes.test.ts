import { Either, Schema } from "effect";
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

  it("keeps a single known literal in the list when current and legacy share it", () => {
    const shared = defineFormat<{ v1: typeof V1.Type }>(
      {
        id: "gate-pending",
        label: "toy document",
        legacy: { 1: shape(V1) },
        releases: [],
        current: { name: "v1", shape: shape(V1) },
      },
      { packageVersion: "0.13.0" },
    );
    expectFailure(
      shared.parse({ version: 2, a: "x" }),
      "version",
      "unknown toy document version 2 — known versions are 1",
    );
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

// A toy whose current shape and frozen module share the literal 1: the frozen
// module is the union of every signature written under it, so it also admits
// documents written before `b` was required.
const CURRENT_V1 = Schema.Struct({
  version: Schema.Literal(1),
  a: Schema.String,
  b: Schema.Number,
});
const FROZEN_V1 = Schema.Struct({
  version: Schema.Literal(1),
  a: Schema.String,
  b: Schema.optionalWith(Schema.Number, { exact: true }),
});

const fallback = defineFormat<{ v1: typeof FROZEN_V1.Type }>(
  {
    id: "gate-pending",
    label: "toy document",
    legacy: { 1: shape(FROZEN_V1) },
    releases: [],
    current: { name: "v1", shape: shape(CURRENT_V1) },
  },
  { packageVersion: "0.13.0" },
);

describe("defineFormat: the literal fallback", () => {
  it("reads a document the current decoder rejects with the frozen module of its literal, as the same shape", () => {
    expect(fallback.parse({ version: 1, a: "x" })).toEqual({
      ok: true,
      shape: "v1",
      value: { version: 1, a: "x" },
    });
  });

  it("returns the current decoder's value when it accepts the document", () => {
    let frozenCalls = 0;
    const counted = defineFormat<{ v1: typeof FROZEN_V1.Type }>(
      {
        id: "gate-pending",
        label: "toy document",
        legacy: {
          1: {
            schema: FROZEN_V1,
            decode: (input) => {
              frozenCalls++;
              return shape(FROZEN_V1).decode(input);
            },
          },
        },
        releases: [],
        current: {
          name: "v1",
          shape: {
            schema: CURRENT_V1,
            // Reads `b` as twice its value, so the test can tell which decoder answered.
            decode: (input) =>
              Schema.decodeUnknownEither(
                Schema.transform(CURRENT_V1, CURRENT_V1, {
                  strict: true,
                  decode: (value) => ({ ...value, b: value.b * 2 }),
                  encode: (value) => value,
                }),
                { onExcessProperty: "error" },
              )(input),
          },
        },
      },
      { packageVersion: "0.13.0" },
    );
    expect(counted.parse({ version: 1, a: "x", b: 2 })).toEqual({
      ok: true,
      shape: "v1",
      value: { version: 1, a: "x", b: 4 },
    });
    expect(frozenCalls).toBe(0);
  });

  it("returns the current decoder's failure when both reject the document", () => {
    // The current decoder fails at `b`; this frozen module would fail at `z`.
    const OTHER_V1 = Schema.Struct({
      version: Schema.Literal(1),
      a: Schema.String,
      z: Schema.String,
    });
    const both = defineFormat<{ v1: typeof OTHER_V1.Type | typeof CURRENT_V1.Type }>(
      {
        id: "gate-pending",
        label: "toy document",
        legacy: { 1: shape(OTHER_V1) },
        releases: [],
        current: { name: "v1", shape: shape(CURRENT_V1) },
      },
      { packageVersion: "0.13.0" },
    );
    expect(Either.isLeft(Schema.decodeUnknownEither(OTHER_V1)({ version: 1, a: "x" }))).toBe(true);
    expectFailure(both.parse({ version: 1, a: "x" }), "b");
    expectFailure(fallback.parse({ version: 1, a: "x", extra: true }), "extra");
  });

  it("never throws", () => {
    for (const input of [{ version: 1 }, { version: 1, a: Symbol("x") }, { version: 1, b: 10n }]) {
      expect(() => fallback.parse(input)).not.toThrow();
    }
  });
});

// A toy unversioned format: its current shape and its frozen module are both
// v0, and the frozen module also admits documents written before `b` existed.
const CURRENT_V0 = Schema.Struct({ a: Schema.String, b: Schema.Number });
const FROZEN_V0 = Schema.Struct({
  a: Schema.String,
  b: Schema.optionalWith(Schema.Number, { exact: true }),
});

const unversioned = defineFormat<{ v0: typeof FROZEN_V0.Type }>(
  {
    id: "gate-pending",
    label: "toy document",
    legacy: { 0: shape(FROZEN_V0) },
    releases: [],
    current: { name: "v0", shape: shape(CURRENT_V0) },
  },
  { packageVersion: "0.13.0" },
);

describe("defineFormat: the unversioned shape v0", () => {
  it("reads a document with neither marker with the current v0 decoder", () => {
    expect(unversioned.parse({ a: "x", b: 1 })).toEqual({
      ok: true,
      shape: "v0",
      value: { a: "x", b: 1 },
    });
  });

  it("falls back to the frozen v0 module when the current decoder rejects the document", () => {
    expect(unversioned.parse({ a: "x" })).toEqual({ ok: true, shape: "v0", value: { a: "x" } });
  });

  it("returns the current decoder's failure when both reject the document", () => {
    // The current decoder fails at `b`; this frozen module would fail at `z`.
    const OTHER_V0 = Schema.Struct({ a: Schema.String, z: Schema.String });
    const both = defineFormat<{ v0: typeof OTHER_V0.Type | typeof CURRENT_V0.Type }>(
      {
        id: "gate-pending",
        label: "toy document",
        legacy: { 0: shape(OTHER_V0) },
        releases: [],
        current: { name: "v0", shape: shape(CURRENT_V0) },
      },
      { packageVersion: "0.13.0" },
    );
    expectFailure(both.parse({ a: "x" }), "b");
    expectFailure(unversioned.parse({ a: 1, b: 1 }), "a");
  });

  it("never treats version: 0 as a known literal", () => {
    expectFailure(
      unversioned.parse({ version: 0, a: "x", b: 1 }),
      "version",
      "unknown toy document version 0 — a toy document carries no version literal",
    );
  });

  it("names a version literal on a format that has none", () => {
    expectFailure(
      unversioned.parse({ version: 1, a: "x", b: 1 }),
      "version",
      "unknown toy document version 1 — a toy document carries no version literal",
    );
  });

  it("reads a frozen v0 below a versioned current shape, and still resolves literals by version", () => {
    const later = defineFormat<{ v0: typeof FROZEN_V0.Type; v1: typeof V1.Type }>(
      {
        id: "gate-pending",
        label: "toy document",
        legacy: { 0: shape(FROZEN_V0), 1: shape(V1) },
        releases: [],
        current: { name: "v1", shape: shape(V1) },
      },
      { packageVersion: "0.13.0" },
    );
    expect(later.parse({ a: "x" })).toEqual({ ok: true, shape: "v0", value: { a: "x" } });
    expect(later.parse({ version: 1, a: "x" })).toMatchObject({ ok: true, shape: "v1" });
    expectFailure(
      later.parse({ version: 0, a: "x" }),
      "version",
      "unknown toy document version 0 — known versions are 1",
    );
  });

  it("still reads a $schema document by its URL", () => {
    expectFailure(
      unversioned.parse({ $schema: url("0.12.0"), a: "x", b: 1 }),
      "$schema",
      "no gate-pending shape is known at release 0.12.0",
    );
  });

  it("never throws", () => {
    for (const input of [{}, { a: Symbol("x") }, { b: 10n }, { version: 0 }, Object.create(null)]) {
      expect(() => unversioned.parse(input)).not.toThrow();
    }
  });
});

describe("defineFormat: neither marker", () => {
  it("fails a document with neither $schema nor version at $schema, for a format without v0", () => {
    expectFailure(
      toy.parse({ a: "x" }),
      "$schema",
      "missing $schema — a toy document names its shape with a $schema URL or a version literal",
    );
    expectFailure(fallback.parse({ a: "x", b: 1 }), "$schema");
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
