import { Either, JSONSchema, type ParseResult } from "effect";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
import {
  parseDocument,
  parsePlanApprovals,
  parsePlanDocument,
  parseSpecApprovals,
  parseSpecDocument,
  toLatestPlanApprovals,
  toLatestPlanDocument,
  toLatestSpecApprovals,
  toLatestSpecDocument,
} from "../../../packages/schemas/src/index.js";
import { newerReleaseMessage } from "../../../packages/schemas/src/shapes.js";
import { decodeApprovalRecordFile } from "../../../src/schemas/approvalRecord.js";
import { decodePlanDocument } from "../../../src/schemas/planDocument.js";
import type { FormatId } from "../../../src/schemas/schemaUrl.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import { decodeSpecApprovalRecordFile } from "../../../src/schemas/specApprovalRecord.js";
import { SpecDocumentSchema, decodeSpecDocument } from "../../../src/schemas/specDocument.js";
import { validDocuments, withKey, withoutKey, type Doc } from "./documents.js";

type Decode = (input: unknown) => Either.Either<unknown, ParseResult.ParseError>;

interface RepositoryFormat {
  readonly id: FormatId;
  readonly parse: (input: unknown) => {
    readonly ok: boolean;
    readonly shape?: string;
    readonly value?: unknown;
  };
  readonly phax: Decode;
  readonly toLatest: (value: never) => unknown;
}

const FORMATS: ReadonlyArray<RepositoryFormat> = [
  {
    id: "plan-approvals",
    parse: parsePlanApprovals,
    phax: decodeApprovalRecordFile,
    toLatest: toLatestPlanApprovals,
  },
  {
    id: "spec-approvals",
    parse: parseSpecApprovals,
    phax: decodeSpecApprovalRecordFile,
    toLatest: toLatestSpecApprovals,
  },
  {
    id: "spec-document",
    parse: parseSpecDocument,
    phax: decodeSpecDocument,
    toLatest: toLatestSpecDocument,
  },
  {
    id: "plan-document",
    parse: parsePlanDocument,
    phax: decodePlanDocument,
    toLatest: toLatestPlanDocument,
  },
];

// Derived from the package version, so a release bump never breaks these tests.
const NEWER_RELEASE = `${Number(PACKAGE_VERSION.split(".")[0]) + 1}.0.0`;

describe.each(FORMATS)("$id", (format) => {
  const document = validDocuments[format.id];

  it("parses the document as shape pre-schema, with phax's value", () => {
    const phax = format.phax(document);
    if (Either.isLeft(phax)) throw new Error("document rejected by phax");
    expect(format.parse(document)).toEqual({ ok: true, shape: "pre-schema", value: phax.right });
  });

  it("fails a document phax's decoder rejects as older than the first supported release", () => {
    const result = format.parse(withKey(document, "version", 0)) as {
      readonly ok: boolean;
      readonly error?: { readonly path: string; readonly message: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error?.path).toBe("version");
    expect(result.error?.message).toContain("older than the first supported release");
  });

  it("upgrades by dropping version and keeping everything else", () => {
    const result = format.parse(document);
    if (!result.ok) throw new Error("document rejected");
    expect(format.toLatest(result.value as never)).toEqual(withoutKey(document, "version"));
  });

  it("fails a document written by a newer release with the upgrade message", () => {
    const newer = withKey(document, "$schema", schemaUrl(format.id, NEWER_RELEASE));
    const message = newerReleaseMessage(format.id, NEWER_RELEASE, PACKAGE_VERSION);
    for (const result of [format.parse(newer), parseDocument(newer)]) {
      expect(result).toEqual({ ok: false, error: { path: "$schema", message } });
    }
  });
});

describe("the spec document's traceability", () => {
  const spec = validDocuments["spec-document"];
  const [criterion, ...rest] = spec["acceptanceCriteria"] as ReadonlyArray<Doc>;
  const dangling = withKey(spec, "acceptanceCriteria", [
    { ...criterion, refs: ["no-such-requirement"] },
    ...rest,
  ]);

  it("rejects a dangling refs entry, at its path, as phax does", () => {
    const result = parseSpecDocument(dangling);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.path).toBe("acceptanceCriteria.0.refs.0");
      expect(result.error.message).toContain('"no-such-requirement" names no requirement');
    }
    expect(Either.isLeft(decodeSpecDocument(dangling))).toBe(true);
  });

  it("declares the checks JSON Schema cannot express, in the root description", () => {
    const schema = JSONSchema.make(SpecDocumentSchema) as { description?: string };
    expect(schema.description).toContain("`refs` entry names an existing requirement");
  });
});
