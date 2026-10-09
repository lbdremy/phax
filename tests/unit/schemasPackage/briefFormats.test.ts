// The brief request and the brief record are born with $schema: no pre-schema
// shape. Both refuse unknown keys, as phax's decoders do, except inside a
// record's answer, which is kept as printed. Every document comes from
// documents.ts or below and is made up.
import { Either, type ParseResult } from "effect";
import { describe, expect, it } from "vitest";
import { CURRENT_SHAPES, PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
import {
  parseBriefRecord,
  parseBriefReport,
  parseBriefRequest,
  parseDocument,
  toLatestBriefRecord,
  toLatestBriefRequest,
} from "../../../packages/schemas/src/index.js";
import { missingSchemaMessage, newerReleaseMessage } from "../../../packages/schemas/src/shapes.js";
import { decodeBriefRecordFile, decodeBriefRequestFile } from "../../../src/schemas/brief.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import { validDocuments, withKey, withoutKey } from "./documents.js";

type Decode = (input: unknown) => Either.Either<unknown, ParseResult.ParseError>;
type Parse = (
  input: unknown,
) =>
  | { readonly ok: true; readonly shape: string; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly path: string; readonly message: string } };

// Derived from the package version, so a release bump never breaks these tests.
const NEWER_RELEASE = `${Number(PACKAGE_VERSION.split(".")[0]) + 1}.0.0`;

interface BriefFormat {
  readonly id: "brief-request" | "brief-record";
  readonly label: string;
  readonly parse: Parse;
  readonly phax: Decode;
  readonly toLatest: (value: never) => unknown;
  readonly keys: ReadonlyArray<string>;
}

const FORMATS: ReadonlyArray<BriefFormat> = [
  {
    id: "brief-request",
    label: "brief request",
    parse: parseBriefRequest,
    phax: decodeBriefRequestFile,
    toLatest: toLatestBriefRequest,
    keys: ["$schema", "phase", "base", "terminal", "phases", "files"],
  },
  {
    id: "brief-record",
    label: "brief record",
    parse: parseBriefRecord,
    phax: decodeBriefRecordFile,
    toLatest: toLatestBriefRecord,
    keys: ["$schema", "moment", "request", "outcome"],
  },
];

describe.each(FORMATS)("$id, born with $schema", ({ id, label, parse, phax, toLatest, keys }) => {
  const document = validDocuments[id];
  const current = CURRENT_SHAPES[id];

  it("parses the document phax writes as its current shape, with phax's value", () => {
    expect(Object.keys(document)).toEqual(keys);
    const decoded = phax(document);
    if (Either.isLeft(decoded)) throw new Error("document rejected by phax");
    expect(parse(document)).toEqual({ ok: true, shape: current, value: decoded.right });
  });

  it("is identified by parseDocument from its $schema", () => {
    expect(parseDocument(document)).toMatchObject({ ok: true, format: id, shape: current });
  });

  it("fails the same document without $schema at $schema", () => {
    expect(parse(withoutKey(document, "$schema"))).toEqual({
      ok: false,
      error: { path: "$schema", message: missingSchemaMessage(label) },
    });
  });

  it("drops the top-level $schema on upgrade and keeps every other key", () => {
    const result = parse(document);
    if (!result.ok) throw new Error("document rejected");
    expect(toLatest(result.value as never)).toEqual(withoutKey(document, "$schema"));
  });

  it("fails a document written by a newer release with the upgrade message", () => {
    const newer = withKey(document, "$schema", schemaUrl(id, NEWER_RELEASE));
    const message = newerReleaseMessage(id, NEWER_RELEASE, PACKAGE_VERSION);
    for (const result of [parse(newer), parseDocument(newer)]) {
      expect(result).toEqual({ ok: false, error: { path: "$schema", message } });
    }
  });
});

it("refuses unknown keys in a request and a record, as phax's strict decoders do", () => {
  const strict: ReadonlyArray<readonly [Parse, Decode, "brief-request" | "brief-record"]> = [
    [parseBriefRequest, decodeBriefRequestFile, "brief-request"],
    [parseBriefRecord, decodeBriefRecordFile, "brief-record"],
  ];
  for (const [parse, phax, id] of strict) {
    const extra = withKey(validDocuments[id], "owner", "example");
    expect(parse(extra).ok, id).toBe(false);
    expect(Either.isLeft(phax(extra)), id).toBe(true);
  }
});

describe("a brief record's answer", () => {
  it("is kept as printed, and parseBriefReport reads it by its own $schema", () => {
    const record = parseBriefRecord(validDocuments["brief-record"]);
    if (!record.ok) throw new Error("record rejected");
    const { outcome } = record.value;
    if (outcome.kind !== "answered") throw new Error("expected an answered outcome");
    expect(outcome.answer).toEqual(validDocuments["brief-report"]);
    expect(parseBriefReport(outcome.answer)).toEqual({
      ok: true,
      shape: CURRENT_SHAPES["brief-report"],
      value: validDocuments["brief-report"],
    });
  });

  it("keeps an extra key the provider printed, which parseBriefRecord does not validate", () => {
    const answer = withKey(validDocuments["brief-report"], "note", "as printed");
    const document = withKey(validDocuments["brief-record"], "outcome", {
      kind: "answered",
      answer,
    });
    const record = parseBriefRecord(document);
    expect(record.ok && record.value.outcome).toEqual({ kind: "answered", answer });
  });
});

// brief-record's answer description changed after 0.20.0, its keys did not:
// each stamp reads as the shape its release wrote.
function recordStampedAt(release: string) {
  return withKey(validDocuments["brief-record"], "$schema", schemaUrl("brief-record", release));
}

describe("brief-record's released shapes", () => {
  it("reads a 0.20.0 record as shape 0.20.0, its answer as printed", () => {
    const document = recordStampedAt("0.20.0");
    const parsed = parseBriefRecord(document);
    expect(parsed).toEqual({ ok: true, shape: "0.20.0", value: document });
    if (!parsed.ok || parsed.shape !== "0.20.0") return;
    expect(toLatestBriefRecord(parsed.value)).toEqual(withoutKey(document, "$schema"));
  });

  it("reads a record at the current stamp as the current shape", () => {
    const document = recordStampedAt(CURRENT_STAMPS["brief-record"]);
    expect(CURRENT_STAMPS["brief-record"]).toBe("0.21.0");
    expect(CURRENT_SHAPES["brief-record"]).toBe("next");
    expect(parseBriefRecord(document)).toEqual({ ok: true, shape: "next", value: document });
  });
});

it("parseBriefRequest reads the outside variant: $schema and files only", () => {
  const outside = {
    $schema: validDocuments["brief-request"]["$schema"],
    files: ["src/example.ts"],
  };
  expect(parseBriefRequest(outside)).toEqual({
    ok: true,
    shape: CURRENT_SHAPES["brief-request"],
    value: outside,
  });
});
