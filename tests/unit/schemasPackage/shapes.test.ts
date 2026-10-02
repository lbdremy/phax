import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  UNKNOWN,
  defineFormat,
  developmentBuildMessage,
  isUnknown,
  newerReleaseMessage,
  preSchemaUnsupportedMessage,
  unknownFormatMessage,
  type Shape,
} from "../../../packages/schemas/src/shapes.js";
import type { Parsed } from "../../../packages/schemas/src/parsed.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

function shape<A, I>(schema: Schema.Schema<A, I>): Shape<A> {
  return { schema, decode: Schema.decodeUnknownEither(schema, { onExcessProperty: "error" }) };
}

/** A shape whose decoder counts its calls, so a test can tell which decoder read a document. */
function counted<A, I>(schema: Schema.Schema<A, I>): Shape<A> & { readonly calls: () => number } {
  const inner = shape(schema);
  let calls = 0;
  return {
    schema,
    decode: (input) => {
      calls++;
      return inner.decode(input);
    },
    calls: () => calls,
  };
}

function expectFailure(result: Parsed<unknown>, path: string, message?: string) {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.path).toBe(path);
  expect(result.error.message).not.toBe("");
  if (message !== undefined) expect(result.error.message).toBe(message);
}

const UNSUPPORTED = "toy document older than the first release that writes $schema — not supported";

// The toys' own package version, and no first supported release, injected so
// the package's generated values never change what a toy reads.
const TOY_RELEASES = { packageVersion: "0.13.0", firstSupportedRelease: null } as const;

const url = (release: string) => schemaUrl("gate-pending", release);

// ── variant (a): the pre-schema slot unfilled, phax's current decoder reads it

// The toy admits an optional `version` literal, as phax's formats carry one.
const CURRENT = Schema.Struct({
  version: Schema.optionalWith(Schema.Literal(1), { exact: true }),
  a: Schema.String,
  b: Schema.Number,
});

const unfilled = defineFormat<{ "pre-schema": typeof CURRENT.Type }>(
  {
    id: "gate-pending",
    label: "toy document",
    releases: [],
    current: { name: "pre-schema", shape: shape(CURRENT) },
  },
  TOY_RELEASES,
);

describe("defineFormat, pre-schema slot unfilled: a document without $schema", () => {
  it("is read by the current decoder as shape pre-schema", () => {
    expect(unfilled.parse({ a: "x", b: 1 })).toEqual({
      ok: true,
      shape: "pre-schema",
      value: { a: "x", b: 1 },
    });
  });

  it("is read as pre-schema whatever its version, when the schema admits it", () => {
    expect(unfilled.parse({ version: 1, a: "x", b: 1 })).toEqual({
      ok: true,
      shape: "pre-schema",
      value: { version: 1, a: "x", b: 1 },
    });
  });

  it("fails as older than the first release that writes $schema, at the violation's path", () => {
    const result = unfilled.parse({ a: "x", b: "one" });
    expectFailure(result, "b");
    if (result.ok) return;
    expect(result.error.message.startsWith(UNSUPPORTED)).toBe(true);
  });

  it("fails a version the schema does not admit at version, never trying another decoder", () => {
    const result = unfilled.parse({ version: 2, a: "x", b: 1 });
    expectFailure(result, "version");
    if (result.ok) return;
    expect(result.error.message.startsWith(UNSUPPORTED)).toBe(true);
  });

  it("carries the decoder's own message after the unsupported statement", () => {
    const result = unfilled.parse({ a: "x", b: 1, extra: true });
    expectFailure(result, "extra");
    if (result.ok) return;
    expect(result.error.message).toBe(
      preSchemaUnsupportedMessage(
        "toy document",
        'is unexpected, expected: "version" | "a" | "b"',
        null,
      ),
    );
  });

  it("fails an empty object at the first missing key", () => {
    const result = unfilled.parse({});
    expectFailure(result, "a");
  });
});

describe("defineFormat, pre-schema slot unfilled: a document with $schema", () => {
  it("names a release no shape covers", () => {
    expectFailure(
      unfilled.parse({ $schema: url("0.12.0"), a: "x", b: 1 }),
      "$schema",
      "no gate-pending shape is known at release 0.12.0",
    );
  });

  it("fails a newer release with the upgrade message", () => {
    expectFailure(
      unfilled.parse({ $schema: url("99.0.0"), a: "x", b: 1 }),
      "$schema",
      newerReleaseMessage("gate-pending", "99.0.0", "0.13.0"),
    );
  });
});

describe("preSchemaUnsupportedMessage", () => {
  it("states the document is unsupported, then names the violation", () => {
    expect(preSchemaUnsupportedMessage("run status", "is missing", null)).toBe(
      "run status older than the first release that writes $schema — not supported (is missing)",
    );
  });

  it("names the first supported release once one is known", () => {
    expect(preSchemaUnsupportedMessage("run status", "is missing", "0.17.0")).toBe(
      "run status older than phax 0.17.0, the first supported release — not supported (is missing)",
    );
  });
});

describe("defineFormat, an injected first supported release", () => {
  it("names it when the pre-schema decoder rejects a document", () => {
    const known = defineFormat<{ "pre-schema": typeof CURRENT.Type }>(
      {
        id: "gate-pending",
        label: "toy document",
        releases: [],
        current: { name: "pre-schema", shape: shape(CURRENT) },
      },
      { packageVersion: "0.18.0", firstSupportedRelease: "0.17.0" },
    );
    const result = known.parse({ a: "x", b: "one" });
    expectFailure(result, "b");
    if (result.ok) return;
    expect(
      result.error.message.startsWith(
        "toy document older than phax 0.17.0, the first supported release — not supported",
      ),
    ).toBe(true);
  });
});

// ── variant (b): a frozen pre-schema module, releases 0.10.0 and 0.12.0, and a
// `next` current shape, read by a package at 0.13.0

const PRE_SCHEMA = Schema.Struct({ version: Schema.Literal(1), a: Schema.String });
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

type FilledShapes = {
  "pre-schema": typeof PRE_SCHEMA.Type;
  "0.10.0": typeof R0_10.Type;
  "0.12.0": typeof R0_12.Type;
  next: typeof NEXT.Type;
};

function filledFormat() {
  const current = counted(NEXT);
  const format = defineFormat<FilledShapes>(
    {
      id: "gate-pending",
      label: "toy document",
      preSchema: shape(PRE_SCHEMA),
      releases: [
        ["0.10.0", shape(R0_10)],
        ["0.12.0", shape(R0_12)],
      ],
      current: { name: "next", shape: current },
    },
    TOY_RELEASES,
  );
  return { format, currentCalls: current.calls };
}

const { format: filled } = filledFormat();

// A frozen pre-schema module below a release-named current shape.
const releasedCurrent = defineFormat<Omit<FilledShapes, "next">>(
  {
    id: "gate-pending",
    label: "toy document",
    preSchema: shape(PRE_SCHEMA),
    releases: [["0.10.0", shape(R0_10)]],
    current: { name: "0.12.0", shape: shape(R0_12) },
  },
  TOY_RELEASES,
);

const at0_10 = (release: string) => ({ $schema: url(release), a: "x", b: 1 });
const at0_12 = (release: string) => ({ ...at0_10(release), c: true });
const atNext = (release: string) => ({ ...at0_12(release), d: "y" });

describe("defineFormat, pre-schema slot filled: a document without $schema", () => {
  it("is read by the frozen module as shape pre-schema, never by the current decoder", () => {
    const { format, currentCalls } = filledFormat();
    expect(format.parse({ version: 1, a: "x" })).toEqual({
      ok: true,
      shape: "pre-schema",
      value: { version: 1, a: "x" },
    });
    expect(currentCalls()).toBe(0);
  });

  it("fails as unsupported when the frozen module rejects it, even if the current decoder would accept it", () => {
    const { format, currentCalls } = filledFormat();
    const { $schema: _schema, ...unmarked } = atNext("0.13.0");
    const result = format.parse(unmarked);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message.startsWith(UNSUPPORTED)).toBe(true);
    expect(currentCalls()).toBe(0);
  });
});

describe("defineFormat, pre-schema slot filled: $schema documents", () => {
  it("resolves a release to the latest shape released at or before it", () => {
    expect(releasedCurrent.parse(at0_10("0.10.0"))).toEqual({
      ok: true,
      shape: "0.10.0",
      value: at0_10("0.10.0"),
    });
    expect(releasedCurrent.parse(at0_10("0.11.0"))).toMatchObject({ ok: true, shape: "0.10.0" });
    expect(releasedCurrent.parse(at0_12("0.12.0"))).toMatchObject({ ok: true, shape: "0.12.0" });
    expect(releasedCurrent.parse(at0_12("0.13.0"))).toMatchObject({ ok: true, shape: "0.12.0" });
    expect(filled.parse(at0_12("0.12.0"))).toMatchObject({ ok: true, shape: "0.12.0" });
  });

  it("fails with the shape's own path when the resolved shape rejects the document", () => {
    expectFailure(filled.parse(at0_12("0.11.0")), "c");
    expectFailure(filled.parse({ ...at0_10("0.10.0"), b: "one" }), "b");
  });

  it("names a release with no shape", () => {
    expectFailure(
      filled.parse(at0_10("0.9.0")),
      "$schema",
      "no gate-pending shape is known at release 0.9.0",
    );
  });

  it("fails a newer release with the upgrade message", () => {
    expectFailure(
      filled.parse(at0_12("99.0.0")),
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
      filled.parse({ ...at0_12("0.12.0"), $schema: unknown }),
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
      filled.parse({ ...at0_12("0.12.0"), $schema: registry }),
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
    const result = filled.parse({ ...at0_12("0.12.0"), $schema: value });
    expectFailure(result, "$schema");
    if (!result.ok) {
      expect(result.error.message).toContain(
        "https://docs.phax.run/schemas/<format-id>/<X.Y.Z>.json",
      );
    }
  });
});

describe("defineFormat, pre-schema slot filled: a `next` current shape in a development tree", () => {
  it("decodes a document at the package's own release with next first", () => {
    expect(filled.parse(atNext("0.13.0"))).toEqual({
      ok: true,
      shape: "next",
      value: atNext("0.13.0"),
    });
  });

  it("falls back to the latest released shape when next rejects it", () => {
    expect(filled.parse(at0_12("0.13.0"))).toEqual({
      ok: true,
      shape: "0.12.0",
      value: at0_12("0.13.0"),
    });
  });

  it("never tries next below the package's own release", () => {
    expectFailure(filled.parse(atNext("0.12.0")), "d");
  });
});

// A frozen pre-schema module and a `next` current shape, with no release yet:
// the slots every phax format fills before its first `$schema` release.
const unreleased = defineFormat<{ "pre-schema": typeof PRE_SCHEMA.Type; next: typeof NEXT.Type }>(
  {
    id: "gate-pending",
    label: "toy document",
    preSchema: shape(PRE_SCHEMA),
    releases: [],
    current: { name: "next", shape: shape(NEXT) },
  },
  TOY_RELEASES,
);

describe("defineFormat, a `next` current shape and no release yet", () => {
  it("reads a document at the package's own release as next", () => {
    expect(unreleased.parse(atNext("0.13.0"))).toEqual({
      ok: true,
      shape: "next",
      value: atNext("0.13.0"),
    });
  });

  it("fails a document at its own release that next rejects with next's own violation", () => {
    const result = unreleased.parse({ ...atNext("0.13.0"), b: "one" });
    expectFailure(result, "b");
    if (result.ok) return;
    expect(result.error.message).not.toContain("no gate-pending shape is known");
  });

  it("names a lower release with no shape", () => {
    expectFailure(
      unreleased.parse(atNext("0.12.0")),
      "$schema",
      "no gate-pending shape is known at release 0.12.0",
    );
  });
});

// A frozen pre-schema module and a current shape named by the first release
// that writes $schema, 0.17.0, read by a package at 0.17.0: the slots a phax
// format fills once a release renames next.
function firstRelease(firstSupportedRelease: string | null) {
  const preSchema = counted(PRE_SCHEMA);
  const current = counted(R0_12);
  const format = defineFormat<{
    "pre-schema": typeof PRE_SCHEMA.Type;
    "0.17.0": typeof R0_12.Type;
  }>(
    {
      id: "gate-pending",
      label: "toy document",
      preSchema,
      releases: [],
      current: { name: "0.17.0", shape: current },
    },
    { packageVersion: "0.17.0", firstSupportedRelease },
  );
  return { format, calls: () => preSchema.calls() + current.calls() };
}

describe("defineFormat, a $schema document below the first supported release", () => {
  it("fails at $schema as a development build, and no decoder tries it", () => {
    const { format, calls } = firstRelease("0.17.0");
    // The pre-schema decoder would accept every key but $schema.
    const document = { $schema: url("0.16.0"), version: 1, a: "x" };
    expect(format.parse(document)).toEqual({
      ok: false,
      error: { path: "$schema", message: developmentBuildMessage(url("0.16.0"), "0.17.0") },
    });
    expect(calls()).toBe(0);
  });

  it("names the URL and the first supported release", () => {
    expect(developmentBuildMessage(url("0.16.0"), "0.17.0")).toBe(
      `${url("0.16.0")} was written by a development build of phax before 0.17.0, the first supported release — not supported`,
    );
  });

  it("reads a document at the first supported release as its shape", () => {
    const { format } = firstRelease("0.17.0");
    expect(format.parse(at0_12("0.17.0"))).toEqual({
      ok: true,
      shape: "0.17.0",
      value: at0_12("0.17.0"),
    });
  });

  it("keeps the old resolution while no first supported release is known", () => {
    const { format } = firstRelease(null);
    expectFailure(
      format.parse(at0_12("0.16.0")),
      "$schema",
      "no gate-pending shape is known at release 0.16.0",
    );
    expect(format.parse(at0_12("0.17.0"))).toMatchObject({ ok: true, shape: "0.17.0" });
  });

  it("checks a newer release first", () => {
    const { format } = firstRelease("0.17.0");
    expectFailure(
      format.parse(at0_12("0.18.0")),
      "$schema",
      newerReleaseMessage("gate-pending", "0.18.0", "0.17.0"),
    );
  });
});

describe("defineFormat never throws", () => {
  it.each([42, "doc", null, undefined, true, [{ a: "x", b: 1 }]])(
    "fails the non-object %j at the root",
    (input) => {
      expectFailure(unfilled.parse(input), "");
      expectFailure(filled.parse(input), "");
    },
  );

  it("returns a value for every input", () => {
    const inputs: unknown[] = [
      Symbol("x"),
      () => 1,
      new Map(),
      Object.create(null),
      {},
      { a: Symbol("x") },
      { b: 10n },
      { $schema: Symbol("x") },
      { $schema: 10n },
      { version: 10n },
      { version: Number.NaN },
      { version: { toString: () => "1" } },
      { $schema: url("0.12.0") },
      { $schema: url("0.13.0") },
    ];
    for (const input of inputs) {
      expect(() => unfilled.parse(input)).not.toThrow();
      expect(() => filled.parse(input)).not.toThrow();
      expect(() => releasedCurrent.parse(input)).not.toThrow();
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
