import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { findJsonSchemaGaps } from "../../packages/schemas/build/jsonSchemas.js";
import {
  FORMAT_IDS,
  PRE_SCHEMA_FORMAT_IDS,
  SCHEMA_BORN_FORMAT_IDS,
  SCHEMA_URL_BASE,
  compareReleases,
  draft07JsonSchema,
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

  it("lists the thirteen formats of spec §4 phax still writes, the two approval record formats, the gate request, the brief request and record, the two reports, the hand decision answer, the decision record manifest, the cost ledger, the architecture request and report, the oracle request and the four documents of a declared stop, the run list, the decide verdicts, the review record manifest, the code review, the plan extraction, the two hand decision answers, the acceptance request and the three answers of the commands behind the Claude Code mod", () => {
    expect(FORMAT_IDS).toHaveLength(41);
    expect(new Set(FORMAT_IDS).size).toBe(41);
    expect(FORMAT_IDS.slice(-28)).toEqual([
      "plan-approval-record",
      "spec-approval-record",
      "gate-request",
      "brief-request",
      "brief-record",
      "gate-report",
      "brief-report",
      "hand-decision-answer",
      "decision-record-manifest",
      "cost-ledger",
      "architecture-request",
      "architecture-report",
      "oracle-request",
      "first-reading",
      "interactive-handoff",
      "interactive-session",
      "review-stop",
      "run-list",
      "decide-verdicts",
      "review-record-manifest",
      "code-review",
      "phax-plan-extraction",
      "spec-hand-decision-answer",
      "plan-hand-decision-answer",
      "acceptance-request",
      "artifact-status",
      "plan-overview",
      "plan-lint",
    ]);
    expect(isFormatId("code-review")).toBe(true);
    expect(isFormatId("phase-record-manifest")).toBe(true);
  });

  it("splits the formats into those with a pre-schema shape and those born with $schema", () => {
    expect(SCHEMA_BORN_FORMAT_IDS).toEqual([
      "plan-approval-record",
      "spec-approval-record",
      "gate-request",
      "brief-request",
      "brief-record",
      "gate-report",
      "brief-report",
      "hand-decision-answer",
      "decision-record-manifest",
      "cost-ledger",
      "architecture-request",
      "architecture-report",
      "oracle-request",
      "first-reading",
      "interactive-handoff",
      "interactive-session",
      "review-stop",
      "run-list",
      "decide-verdicts",
      "review-record-manifest",
      "code-review",
      "phax-plan-extraction",
      "spec-hand-decision-answer",
      "plan-hand-decision-answer",
      "acceptance-request",
      "artifact-status",
      "plan-overview",
      "plan-lint",
    ]);
    expect(PRE_SCHEMA_FORMAT_IDS).toEqual(
      FORMAT_IDS.filter((id) => !SCHEMA_BORN_FORMAT_IDS.some((born) => born === id)),
    );
    expect(PRE_SCHEMA_FORMAT_IDS).toHaveLength(13);
  });
});

describe("schemaUrlField", () => {
  const decode = Schema.decodeUnknownResult(schemaUrlField("registry"), { reportInput: true });

  it.each(["0.16.0", "0.17.0", "1.0.0", "12.34.56"])(
    "accepts the format's own URL at release %s",
    (release) => {
      expect(Result.isSuccess(decode(schemaUrl("registry", release)))).toBe(true);
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
    expect(Result.isFailure(decode(value))).toBe(true);
  });

  it.each([42, null, undefined, {}, ["x"]])("rejects the non-string %j", (value) => {
    expect(Result.isFailure(decode(value))).toBe(true);
  });

  it.each(FORMAT_IDS.map((id) => [id]))(
    "renders to JSON Schema with no gap for %s, naming the format",
    (id) => {
      const field = schemaUrlField(id);
      expect(findJsonSchemaGaps(field)).toEqual([]);
      const rendered = draft07JsonSchema(field) as { pattern?: string; description?: string };
      expect(rendered.description).toContain(id);
      expect(new RegExp(rendered.pattern ?? "^$").test(schemaUrl(id, "0.17.0"))).toBe(true);
    },
  );

  it.each(FORMAT_IDS.map((id) => [id]))(
    "says the %s stamp names the release that last changed the format's shape",
    (id) => {
      const rendered = draft07JsonSchema(schemaUrlField(id)) as { description?: string };
      expect(rendered.description).toBe(
        `The ${id} format's shape, named by the phax release that last changed it ` +
          `(not necessarily the release that wrote this file): ${SCHEMA_URL_BASE}/${id}/<X.Y.Z>.json`,
      );
      expect(rendered.description).not.toContain("the phax release that wrote this file");
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

// The published JSON Schema describes what phax's decoders accept, not the
// encoded side of Effect's JSON codec.
const properties = (schema: Schema.Top): Record<string, unknown> =>
  (draft07JsonSchema(schema) as { properties: Record<string, unknown> }).properties;

// Every `.ts` file under `dir`, recursively.
const sources = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(dir, entry.name)]
        : [],
  );

describe("draft07JsonSchema as the decoders read it", () => {
  it("refuses the strings NaN and Infinity in a number, as the decoder does", () => {
    const Subject = Schema.Struct({ count: Schema.Number });
    expect(properties(Subject)["count"]).toEqual({ type: "number" });
    expect(Result.isFailure(Schema.decodeUnknownResult(Subject)({ count: "NaN" }))).toBe(true);
  });

  it("refuses null in an optional key, as the decoder does", () => {
    const Subject = Schema.Struct({ note: Schema.optional(Schema.String) });
    expect(properties(Subject)["note"]).toEqual({ type: "string" });
    expect(Result.isFailure(Schema.decodeUnknownResult(Subject)({ note: null }))).toBe(true);
  });

  it("keeps null where the decoder accepts it: a required nullable key and an optional nullable one", () => {
    const Subject = Schema.Struct({
      reason: Schema.NullOr(Schema.String),
      code: Schema.optional(Schema.NullOr(Schema.Number)),
    });
    expect(properties(Subject)).toEqual({
      reason: { anyOf: [{ type: "string" }, { type: "null" }] },
      code: { anyOf: [{ type: "number" }, { type: "null" }] },
    });
    expect(
      Result.isSuccess(Schema.decodeUnknownResult(Subject)({ reason: null, code: null })),
    ).toBe(true);
  });

  // `optionalKey(NullOr(X))` renders with one `null`, which the published form
  // cannot tell from an optional key's `undefined`, so it would lose it.
  // `optional(NullOr(X))` renders with two and keeps one.
  it("finds no optionalKey(NullOr(…)) in the sources, whose null the published form would drop", () => {
    const root = join(import.meta.dirname, "../..");
    const offenders = [join(root, "src"), join(root, "packages/schemas/src")]
      .flatMap(sources)
      .filter((file) =>
        /optionalKey\(\s*(Schema\.)?(NullOr|NullishOr)\(/.test(readFileSync(file, "utf8")),
      );
    expect(offenders).toEqual([]);
  });
});
