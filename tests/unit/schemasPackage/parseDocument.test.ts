import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  MISSING_SCHEMA_MESSAGE,
  makeDocumentParser,
} from "../../../packages/schemas/src/document.js";
import { parseDocument } from "../../../packages/schemas/src/index.js";
import type { Parsed } from "../../../packages/schemas/src/parsed.js";
import {
  defineFormat,
  newerReleaseMessage,
  unknownFormatMessage,
  type Shape,
} from "../../../packages/schemas/src/shapes.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

const v2Dir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "phase-record-manifest",
  "v2",
);
const [firstV2] = readdirSync(v2Dir).toSorted();
const v2Manifest = JSON.parse(readFileSync(join(v2Dir, firstV2 ?? ""), "utf8")) as Record<
  string,
  unknown
>;

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
    expectFailure(result, "$schema", unknownFormatMessage(url, "0.16.0"));
    expect(result.ok ? "" : result.error.message).toBe(
      `${url} names a format unknown to @lbdremy/phax-schemas 0.16.0 — upgrade the package`,
    );
  });

  it("fails a manifest written by a newer release with the spec's message", () => {
    const result = parseDocument({
      ...v2Manifest,
      $schema: schemaUrl("phase-record-manifest", "0.19.0"),
    });
    expectFailure(
      result,
      "$schema",
      "phase-record-manifest written by phax 0.19.0 is newer than @lbdremy/phax-schemas 0.16.0 — upgrade the package",
    );
    expect(result.ok ? "" : result.error.message).toBe(
      newerReleaseMessage("phase-record-manifest", "0.19.0", "0.16.0"),
    );
  });

  it("fails a known format the package does not read yet with the upgrade message", () => {
    const url = schemaUrl("registry", "0.16.0");
    expectFailure(parseDocument({ $schema: url }), "$schema", unknownFormatMessage(url, "0.16.0"));
  });

  it("finds no phase-record-manifest $schema shape at 0.16.0, for now", () => {
    const result = parseDocument({
      ...v2Manifest,
      $schema: schemaUrl("phase-record-manifest", "0.16.0"),
    });
    expectFailure(result, "$schema", "no phase-record-manifest shape is known at release 0.16.0");
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

// A toy format whose current shape is release-named and carries $schema, so
// identification by $schema alone is proven before any real format has one.
const Toy = Schema.Struct({ $schema: Schema.String, a: Schema.String });
const toyShape: Shape<typeof Toy.Type> = {
  schema: Toy,
  decode: Schema.decodeUnknownEither(Toy, { onExcessProperty: "error" }),
};
const toy = defineFormat<{ "0.12.0": typeof Toy.Type }>(
  {
    id: "gate-pending",
    label: "toy document",
    legacy: {},
    releases: [],
    current: { name: "0.12.0", shape: toyShape },
  },
  { packageVersion: "0.13.0" },
);
const parseToyDocument = makeDocumentParser<{ "gate-pending": { "0.12.0": typeof Toy.Type } }>(
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
