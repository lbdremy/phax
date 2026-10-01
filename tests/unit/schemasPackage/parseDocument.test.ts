import { Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import { JSON_SCHEMA_FORMATS } from "../../../packages/schemas/build/jsonSchemas.js";
import {
  MISSING_SCHEMA_MESSAGE,
  makeDocumentParser,
} from "../../../packages/schemas/src/document.js";
import { PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
import { parseDocument } from "../../../packages/schemas/src/index.js";
import type { Parsed } from "../../../packages/schemas/src/parsed.js";
import {
  defineFormat,
  newerReleaseMessage,
  unknownFormatMessage,
  type Shape,
} from "../../../packages/schemas/src/shapes.js";
import { FORMAT_IDS, schemaUrl } from "../../../src/schemas/schemaUrl.js";
import { validDocuments } from "./documents.js";

const v2Manifest = validDocuments["phase-record-manifest"];

// Derived from the package version, so a release bump never breaks these tests.
const NEWER_RELEASE = `${Number(PACKAGE_VERSION.split(".")[0]) + 1}.0.0`;

function expectFailure(result: Parsed<unknown>, path: string, message?: string) {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.path).toBe(path);
  expect(result.error.message).not.toBe("");
  if (message !== undefined) expect(result.error.message).toBe(message);
}

describe("parseDocument", () => {
  it("fails a document without $schema, pointing to parsePhaseRecordManifest", () => {
    const result = parseDocument(v2Manifest);
    expectFailure(result, "$schema", MISSING_SCHEMA_MESSAGE);
    expect(result.ok ? "" : result.error.message).toContain("parsePhaseRecordManifest");
  });

  it("fails an unknown format id, naming the URL and the package version", () => {
    const url = "https://docs.phax.run/schemas/launch-codes/0.16.0.json";
    const result = parseDocument({ $schema: url });
    expectFailure(result, "$schema", unknownFormatMessage(url, PACKAGE_VERSION));
    expect(result.ok ? "" : result.error.message).toBe(
      `${url} names a format unknown to @lbdremy/phax-schemas ${PACKAGE_VERSION} — upgrade the package`,
    );
  });

  it("fails a manifest written by a newer release with the spec's message", () => {
    const result = parseDocument({
      ...v2Manifest,
      $schema: schemaUrl("phase-record-manifest", NEWER_RELEASE),
    });
    expectFailure(
      result,
      "$schema",
      `phase-record-manifest written by phax ${NEWER_RELEASE} is newer than @lbdremy/phax-schemas ${PACKAGE_VERSION} — upgrade the package`,
    );
    expect(result.ok ? "" : result.error.message).toBe(
      newerReleaseMessage("phase-record-manifest", NEWER_RELEASE, PACKAGE_VERSION),
    );
  });

  it("fails a timeline file without $schema, pointing to its parse function", () => {
    const result = parseDocument(validDocuments["gate-attribution"]);
    expectFailure(result, "$schema", MISSING_SCHEMA_MESSAGE);
    expect(result.ok ? "" : result.error.message).toContain("parseGateAttribution");
  });

  it("fails a format the package does not read yet with the upgrade message", () => {
    // code-review joins FORMAT_IDS with the headless-review plan.
    const url = "https://docs.phax.run/schemas/code-review/0.16.0.json";
    expectFailure(
      parseDocument({ $schema: url }),
      "$schema",
      unknownFormatMessage(url, PACKAGE_VERSION),
    );
  });

  it.each(FORMAT_IDS)(
    "reaches the %s definition, which knows no $schema shape below its own release",
    (formatId) => {
      expectFailure(
        parseDocument({ ...validDocuments[formatId], $schema: schemaUrl(formatId, "0.1.0") }),
        "$schema",
        `no ${formatId} shape is known at release 0.1.0`,
      );
    },
  );

  it.each(FORMAT_IDS)(
    "reads a %s at the package's own release with phax's decoder, as next",
    (formatId) => {
      const document = {
        ...validDocuments[formatId],
        $schema: schemaUrl(formatId, PACKAGE_VERSION),
      };
      const result = parseDocument(document);
      const excess = JSON_SCHEMA_FORMATS.find((entry) => entry.format === formatId)?.excess;
      if (excess === "ignore") {
        // phax's decoder drops the key it does not name, as it drops any other.
        expect(result).toEqual({
          ok: true,
          format: formatId,
          shape: "next",
          value: validDocuments[formatId],
        });
      } else {
        // phax's strict decoder names no $schema yet: next's own violation.
        expectFailure(result, "$schema");
        expect(result.ok ? "" : result.error.message).toContain("is unexpected");
      }
    },
  );

  it.each(FORMAT_IDS)(
    "reads every format id: a %s written by a newer release is named, never unknown",
    (formatId) => {
      const url = schemaUrl(formatId, NEWER_RELEASE);
      const result = parseDocument({ $schema: url });
      expectFailure(
        result,
        "$schema",
        newerReleaseMessage(formatId, NEWER_RELEASE, PACKAGE_VERSION),
      );
      expect(result.ok ? "" : result.error.message).not.toBe(
        unknownFormatMessage(url, PACKAGE_VERSION),
      );
    },
  );

  it("fails a phase-record-manifest at the package's own release with next's own violation", () => {
    const result = parseDocument({
      ...v2Manifest,
      $schema: schemaUrl("phase-record-manifest", PACKAGE_VERSION),
    });
    expectFailure(result, "$schema");
    expect(result.ok ? "" : result.error.message).not.toContain("shape is known");
  });

  it.each([
    ["a non-URL string", "record.json"],
    ["a number", 3],
    ["a URL without a release", "https://docs.phax.run/schemas/phase-record-manifest.json"],
  ])("fails a malformed $schema (%s)", (_label, value) => {
    const result = parseDocument({ $schema: value });
    expectFailure(result, "$schema");
    expect(result.ok ? "" : result.error.message).toContain("expected https://docs.phax.run");
  });

  it.each([
    ["null", null],
    ["an array", [v2Manifest]],
    ["a string", "{}"],
    ["undefined", undefined],
  ])("fails a non-object (%s) at the root", (_label, value) => {
    expectFailure(parseDocument(value), "");
  });

  it("never throws", () => {
    const inputs: ReadonlyArray<unknown> = [
      undefined,
      null,
      0,
      "x",
      [],
      {},
      v2Manifest,
      { $schema: null },
      { $schema: "https://docs.phax.run/schemas/constructor/0.1.0.json" },
      { $schema: "https://docs.phax.run/schemas/__proto__/0.1.0.json" },
      { $schema: schemaUrl("phase-record-manifest", "0.1.0") },
      { $schema: schemaUrl("phase-record-manifest", "99.0.0") },
    ];
    for (const input of inputs) expect(() => parseDocument(input)).not.toThrow();
  });
});

// A toy format with a frozen pre-schema shape and a release-named current
// shape that carries $schema, so identification by $schema alone is proven
// before any real format has one.
function toyShape<A, I>(schema: Schema.Schema<A, I>): Shape<A> {
  return { schema, decode: Schema.decodeUnknownEither(schema, { onExcessProperty: "error" }) };
}
const PreSchemaToy = Schema.Struct({ a: Schema.String });
const Toy = Schema.Struct({ $schema: Schema.String, a: Schema.String });
type ToyShapes = { "pre-schema": typeof PreSchemaToy.Type; "0.12.0": typeof Toy.Type };
const toy = defineFormat<ToyShapes>(
  {
    id: "gate-pending",
    label: "toy document",
    preSchema: toyShape(PreSchemaToy),
    releases: [],
    current: { name: "0.12.0", shape: toyShape(Toy) },
  },
  { packageVersion: "0.13.0" },
);
const parseToyDocument = makeDocumentParser<{ "gate-pending": ToyShapes }>(
  { "gate-pending": toy },
  { packageVersion: "0.13.0" },
);

describe("makeDocumentParser", () => {
  it("identifies two documents with identical content the same way, whatever their files are named", () => {
    const content = JSON.stringify({ $schema: schemaUrl("gate-pending", "0.12.0"), a: "x" });
    const files = new Map([
      ["gate-pending.json", content],
      ["renamed-copy.json", content],
    ]);
    const results = [...files.values()].map((text) => parseToyDocument(JSON.parse(text)));
    for (const result of results) {
      expect(result).toEqual({
        ok: true,
        format: "gate-pending",
        shape: "0.12.0",
        value: { $schema: schemaUrl("gate-pending", "0.12.0"), a: "x" },
      });
    }
  });

  it("resolves a later release to the latest shape at or below it", () => {
    const result = parseToyDocument({ $schema: schemaUrl("gate-pending", "0.13.0"), a: "x" });
    expect(result.ok && result.format === "gate-pending" && result.shape).toBe("0.12.0");
  });

  it("names another format as unknown to the parser with its own package version", () => {
    const url = schemaUrl("registry", "0.12.0");
    expectFailure(
      parseToyDocument({ $schema: url }),
      "$schema",
      unknownFormatMessage(url, "0.13.0"),
    );
  });

  it("fails a pre-schema document, even one its format reads, pointing to the parse function", () => {
    expect(toy.parse({ a: "x" })).toEqual({ ok: true, shape: "pre-schema", value: { a: "x" } });
    expectFailure(parseToyDocument({ a: "x" }), "$schema", MISSING_SCHEMA_MESSAGE);
  });

  it("reports the definition's own failure when the document does not match its shape", () => {
    const result = parseToyDocument({ $schema: schemaUrl("gate-pending", "0.12.0"), a: 1 });
    expectFailure(result, "a");
  });

  it("takes exactly one parameter: the value", () => {
    expect(parseToyDocument.length).toBe(1);
    expect(parseDocument.length).toBe(1);
    expectTypeOf<Parameters<typeof parseToyDocument>>().toEqualTypeOf<[input: unknown]>();
    expectTypeOf<Parameters<typeof parseDocument>>().toEqualTypeOf<[input: unknown]>();
  });
});
