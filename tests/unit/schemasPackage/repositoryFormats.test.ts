import { Either, JSONSchema, type ParseResult } from "effect";
import { describe, expect, it } from "vitest";
import { FORMAT_DEFINITIONS } from "../../../packages/schemas/build/jsonSchemas.js";
import { CURRENT_SHAPES, PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
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
import { decodePlanDocumentFile } from "../../../src/schemas/planDocument.js";
import type { FormatId } from "../../../src/schemas/schemaUrl.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import { decodeSpecApprovalRecordFile } from "../../../src/schemas/specApprovalRecord.js";
import {
  SpecDocumentFileSchema,
  SpecDocumentSchema,
  decodeSpecDocumentFile,
} from "../../../src/schemas/specDocument.js";
import {
  preSchemaDocuments,
  preSchemaUnsupported,
  validDocuments,
  withKey,
  withoutKey,
  type Doc,
} from "./documents.js";

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
    phax: decodeSpecDocumentFile,
    toLatest: toLatestSpecDocument,
  },
  {
    id: "plan-document",
    parse: parsePlanDocument,
    phax: decodePlanDocumentFile,
    toLatest: toLatestPlanDocument,
  },
];

// Derived from the package version, so a release bump never breaks these tests.
const NEWER_RELEASE = `${Number(PACKAGE_VERSION.split(".")[0]) + 1}.0.0`;

describe.each(FORMATS)("$id", (format) => {
  const document = validDocuments[format.id];
  const preSchema = preSchemaDocuments[format.id];
  const current = CURRENT_SHAPES[format.id];

  it("parses the pre-schema document as shape pre-schema", () => {
    expect(format.parse(preSchema)).toEqual({ ok: true, shape: "pre-schema", value: preSchema });
  });

  it("parses the document phax writes as its current shape, with phax's value", () => {
    const phax = format.phax(document);
    if (Either.isLeft(phax)) throw new Error("document rejected by phax");
    expect(format.parse(document)).toEqual({ ok: true, shape: current, value: phax.right });
  });

  it("is identified by its $schema alone as its current shape (ac-identify-alone)", () => {
    expect(parseDocument(document)).toMatchObject({ ok: true, format: format.id, shape: current });
  });

  it("fails a document the frozen decoder rejects as older than the first supported release", () => {
    const result = format.parse(withKey(preSchema, "version", 0)) as {
      readonly ok: boolean;
      readonly error?: { readonly path: string; readonly message: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error?.path).toBe("version");
    expect(result.error?.message).toContain(
      preSchemaUnsupported(FORMAT_DEFINITIONS[format.id].label),
    );
  });

  it("upgrades by dropping version and keeping everything else", () => {
    const result = format.parse(preSchema);
    if (!result.ok) throw new Error("document rejected");
    expect(format.toLatest(result.value as never)).toEqual(withoutKey(preSchema, "version"));
  });

  it("drops $schema on upgrade, and carries no version", () => {
    const result = format.parse(document);
    if (!result.ok) throw new Error("document rejected");
    const latest = format.toLatest(result.value as never);
    expect(latest).toEqual(withoutKey(document, "$schema"));
    expect(latest).not.toHaveProperty("version");
  });

  it("upgrades the pre-schema document and the document phax writes to the same value", () => {
    const old = format.parse(preSchema);
    const written = format.parse(document);
    if (!old.ok || !written.ok) throw new Error("document rejected");
    expect(format.toLatest(written.value as never)).toEqual(format.toLatest(old.value as never));
  });

  it("rejects an unknown key, as phax's strict decoder does", () => {
    expect(format.parse(withKey(document, "extra", true)).ok).toBe(false);
    expect(Either.isLeft(format.phax(withKey(document, "extra", true)))).toBe(true);
  });

  it("rejects a document that carries both $schema and version", () => {
    expect(format.parse(withKey(document, "version", 1)).ok).toBe(false);
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
    expect(Either.isLeft(decodeSpecDocumentFile(dangling))).toBe(true);
  });

  it("declares the checks JSON Schema cannot express, in the root description", () => {
    const contract = JSONSchema.make(SpecDocumentSchema) as { description?: string };
    const file = JSONSchema.make(SpecDocumentFileSchema) as { description?: string };
    expect(contract.description).toContain("`refs` entry names an existing requirement");
    expect(file.description).toContain("`refs` entry names an existing requirement");
  });
});
