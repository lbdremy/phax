import { Either, JSONSchema, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { findJsonSchemaGaps } from "../../packages/schemas/build/jsonSchemas.js";
import {
  FORMAT_IDS,
  SCHEMA_URL_BASE,
  compareReleases,
  isFormatId,
  parseSchemaUrl,
  schemaUrl,
  schemaUrlField,
} from "../../src/schemas/schemaUrl.js";

describe("schemaUrl", () => {
  it("builds <base>/<id>/<release>.json", () => {
    expect(schemaUrl("phase-record-manifest", "0.16.0")).toBe(
      "https://docs.phax.run/schemas/phase-record-manifest/0.16.0.json",
    );
  });

  it.each(FORMAT_IDS.map((id) => [id]))("round-trips %s", (id) => {
    expect(parseSchemaUrl(schemaUrl(id, "0.10.2"))).toEqual({ formatId: id, release: "0.10.2" });
  });

  it("lists the fifteen formats of spec §4 without code-review", () => {
    expect(FORMAT_IDS).toHaveLength(15);
    expect(new Set(FORMAT_IDS).size).toBe(15);
    expect(isFormatId("code-review")).toBe(false);
    expect(isFormatId("phase-record-manifest")).toBe(true);
  });
});

describe("schemaUrlField", () => {
  const decode = Schema.decodeUnknownEither(schemaUrlField("registry"));

  it.each(["0.16.0", "0.17.0", "1.0.0", "12.34.56"])(
    "accepts the format's own URL at release %s",
    (release) => {
      expect(Either.isRight(decode(schemaUrl("registry", release)))).toBe(true);
    },
  );

  it.each([
    ["another format id", schemaUrl("run-status", "0.17.0")],
    ["a two-part release", `${SCHEMA_URL_BASE}/registry/0.17.json`],
    ["a pre-release", `${SCHEMA_URL_BASE}/registry/0.17.0-rc.1.json`],
    ["a leading zero", `${SCHEMA_URL_BASE}/registry/0.017.0.json`],
    ["an unescaped dot matching any character", `${SCHEMA_URL_BASE}/registry/0x17x0.json`],
    ["another host", "https://docsxphax.run/schemas/registry/0.17.0.json"],
    ["no .json suffix", `${SCHEMA_URL_BASE}/registry/0.17.0`],
    ["a trailing suffix", `${schemaUrl("registry", "0.17.0")}x`],
  ])("rejects %s", (_label, value) => {
    expect(Either.isLeft(decode(value))).toBe(true);
  });

  it.each([42, null, undefined, {}, ["x"]])("rejects the non-string %j", (value) => {
    expect(Either.isLeft(decode(value))).toBe(true);
  });

  it.each(FORMAT_IDS.map((id) => [id]))(
    "renders to JSON Schema with no gap for %s, naming the format",
    (id) => {
      const field = schemaUrlField(id);
      expect(findJsonSchemaGaps(field)).toEqual([]);
      const rendered = JSONSchema.make(field) as { pattern?: string; description?: string };
      expect(rendered.description).toContain(id);
      expect(new RegExp(rendered.pattern ?? "^$").test(schemaUrl(id, "0.17.0"))).toBe(true);
    },
  );
});

describe("parseSchemaUrl", () => {
  it("accepts an id this build does not know, so it stays reportable", () => {
    expect(parseSchemaUrl(`${SCHEMA_URL_BASE}/code-review/1.2.3.json`)).toEqual({
      formatId: "code-review",
      release: "1.2.3",
    });
  });

  it.each([
    ["another host", "https://example.com/schemas/registry/0.16.0.json"],
    ["no .json suffix", `${SCHEMA_URL_BASE}/registry/0.16.0`],
    ["a two-part release", `${SCHEMA_URL_BASE}/registry/0.16.json`],
    ["a pre-release", `${SCHEMA_URL_BASE}/registry/0.16.0-rc.1.json`],
    ["a leading zero", `${SCHEMA_URL_BASE}/registry/0.016.0.json`],
    ["an upper-case id", `${SCHEMA_URL_BASE}/Registry/0.16.0.json`],
    ["a nested path", `${SCHEMA_URL_BASE}/a/registry/0.16.0.json`],
    ["an empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(parseSchemaUrl(value)).toBeUndefined();
  });

  it.each([42, null, undefined, {}, ["x"]])("rejects the non-string %j", (value) => {
    expect(parseSchemaUrl(value)).toBeUndefined();
  });
});

describe("compareReleases", () => {
  it("orders numeric triples, not strings", () => {
    expect(compareReleases("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareReleases("0.9.0", "0.10.0")).toBeLessThan(0);
    expect(compareReleases("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareReleases("0.16.2", "0.16.10")).toBeLessThan(0);
    expect(compareReleases("0.16.0", "0.16.0")).toBe(0);
  });
});
