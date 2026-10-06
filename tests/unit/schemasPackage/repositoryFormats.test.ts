import { Either, JSONSchema, type ParseResult } from "effect";
import { describe, expect, it } from "vitest";
import { FORMAT_DEFINITIONS } from "../../../packages/schemas/build/jsonSchemas.js";
import { CURRENT_SHAPES, PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
import {
  isUnknown,
  parseDocument,
  parsePlanApprovalRecord,
  parsePlanApprovals,
  parsePlanDocument,
  parseSpecApprovalRecord,
  parseSpecApprovals,
  parseSpecDocument,
  toLatestPlanApprovalRecord,
  toLatestPlanApprovals,
  toLatestPlanDocument,
  toLatestSpecApprovalRecord,
  toLatestSpecApprovals,
  toLatestSpecDocument,
} from "../../../packages/schemas/src/index.js";
import { missingSchemaMessage, newerReleaseMessage } from "../../../packages/schemas/src/shapes.js";
import {
  decodeApprovalRecordFile,
  decodePlanRecordFile,
} from "../../../src/schemas/approvalRecord.js";
import { decodePlanDocumentFile } from "../../../src/schemas/planDocument.js";
import type { PreSchemaFormatId, SchemaBornFormatId } from "../../../src/schemas/schemaUrl.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import {
  decodeSpecApprovalRecordFile,
  decodeSpecRecordFile,
} from "../../../src/schemas/specApprovalRecord.js";
import {
  SpecDocumentFileSchema,
  SpecDocumentSchema,
  decodeSpecDocumentFile,
} from "../../../src/schemas/specDocument.js";
import {
  latestPreSchema,
  preSchemaDocuments,
  preSchemaUnsupported,
  validDocuments,
  withKey,
  withoutKey,
  type Doc,
} from "./documents.js";

type Decode = (input: unknown) => Either.Either<unknown, ParseResult.ParseError>;

interface RepositoryFormat {
  readonly id: PreSchemaFormatId;
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
    expect(format.toLatest(result.value as never)).toEqual(latestPreSchema(format.id));
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

// The old ledgers stay readable in every released $schema shape (§5.21): a
// document any release wrote resolves to the latest shape at or below it.
describe.each(["plan-approvals", "spec-approvals"] as const)(
  "%s, the old ledger read to migrate",
  (id) => {
    const format = FORMATS.find((entry) => entry.id === id);
    if (format === undefined) throw new Error(`${id}: no format entry`);
    const document = validDocuments[id];

    it.each(["0.17.0", "0.18.0"])("parses a document written by phax %s", (release) => {
      const written = withKey(document, "$schema", schemaUrl(id, release));
      expect(format.parse(written)).toMatchObject({ ok: true, shape: CURRENT_SHAPES[id] });
      expect(parseDocument(written)).toMatchObject({ ok: true, format: id });
    });
  },
);

interface RecordFormat {
  readonly id: SchemaBornFormatId;
  readonly parse: (input: unknown) => {
    readonly ok: boolean;
    readonly shape?: string;
    readonly value?: unknown;
  };
  readonly phax: Decode;
  readonly toLatest: (value: never) => unknown;
  /** The old ledger of the same kind, whose $schema the record refuses. */
  readonly ledger: PreSchemaFormatId;
}

const RECORD_FORMATS: ReadonlyArray<RecordFormat> = [
  {
    id: "plan-approval-record",
    parse: parsePlanApprovalRecord,
    phax: decodePlanRecordFile,
    toLatest: toLatestPlanApprovalRecord,
    ledger: "plan-approvals",
  },
  {
    id: "spec-approval-record",
    parse: parseSpecApprovalRecord,
    phax: decodeSpecRecordFile,
    toLatest: toLatestSpecApprovalRecord,
    ledger: "spec-approvals",
  },
];

describe.each(RECORD_FORMATS)("$id, born with $schema", (format) => {
  const document = validDocuments[format.id];
  const current = CURRENT_SHAPES[format.id];
  const label = FORMAT_DEFINITIONS[format.id].label;

  // `next` until a release cut renames it, then the release that cut it
  // (release.sh writes CURRENT_SHAPES), so this holds before and after a cut.
  it("is named next until a release renames it", () => {
    expect(current).toMatch(/^(next|\d+\.\d+\.\d+)$/);
  });

  it("parses the document phax writes as shape next, with phax's value", () => {
    const phax = format.phax(document);
    if (Either.isLeft(phax)) throw new Error("document rejected by phax");
    expect(format.parse(document)).toEqual({ ok: true, shape: current, value: phax.right });
    expect(parseDocument(document)).toMatchObject({ ok: true, format: format.id, shape: current });
  });

  it("fails a document without $schema at $schema, trying no decoder", () => {
    const failure = { ok: false, error: { path: "$schema", message: missingSchemaMessage(label) } };
    expect(format.parse(withoutKey(document, "$schema"))).toEqual(failure);
    expect(format.parse(withKey(withoutKey(document, "$schema"), "version", 1))).toEqual(failure);
    expect(format.parse({})).toEqual(failure);
  });

  it("fails a $schema naming the old ledger", () => {
    const ledger = withKey(document, "$schema", schemaUrl(format.ledger, PACKAGE_VERSION));
    expect(format.parse(ledger)).toMatchObject({ ok: false, error: { path: "$schema" } });
  });

  it("rejects an unknown key and a missing artifact, as phax's strict decoder does", () => {
    for (const input of [withKey(document, "extra", true), withoutKey(document, "artifact")]) {
      expect(format.parse(input).ok).toBe(false);
      expect(Either.isLeft(format.phax(input))).toBe(true);
    }
  });

  it("drops $schema on upgrade and keeps every other key", () => {
    const result = format.parse(document);
    if (!result.ok) throw new Error("document rejected");
    expect(format.toLatest(result.value as never)).toEqual(withoutKey(document, "$schema"));
  });

  it("fails a document written by a newer release with the upgrade message", () => {
    const newer = withKey(document, "$schema", schemaUrl(format.id, NEWER_RELEASE));
    const message = newerReleaseMessage(format.id, NEWER_RELEASE, PACKAGE_VERSION);
    for (const result of [format.parse(newer), parseDocument(newer)]) {
      expect(result).toEqual({ ok: false, error: { path: "$schema", message } });
    }
  });
});

describe("the plan document's completesSpec history", () => {
  const spec = "docs/specs/example.md";
  const current = validDocuments["plan-document"];
  const { completesSpec: _unrecorded, ...withoutCompletesSpec } = current;
  /** A sidecar as phax 0.17.0 through 0.19.x wrote it: `$schema`, no completesSpec. */
  function older(release: string, sourceSpec: string | null): Doc {
    return {
      ...withoutCompletesSpec,
      $schema: schemaUrl("plan-document", release),
      sourceSpec,
    };
  }

  it("parses a 0.17.0 document as shape 0.17.0 through the frozen module", () => {
    const document = older("0.17.0", null);
    expect(parsePlanDocument(document)).toEqual({ ok: true, shape: "0.17.0", value: document });
  });

  it("reads a document stamped at the package's own release without completesSpec as shape 0.17.0", () => {
    const result = parsePlanDocument(older(PACKAGE_VERSION, spec));
    expect(result).toMatchObject({ ok: true, shape: "0.17.0" });
  });

  it("refuses completesSpec in a 0.17.0 document", () => {
    const result = parsePlanDocument({ ...older("0.17.0", null), completesSpec: null });
    expect(result).toMatchObject({ ok: false, error: { path: "completesSpec" } });
  });

  it("upgrades an older spec-less document with completesSpec: null", () => {
    for (const document of [older("0.17.0", null), preSchemaDocuments["plan-document"]]) {
      const result = parsePlanDocument(document);
      if (!result.ok) throw new Error("document rejected");
      expect(toLatestPlanDocument(result.value)).toMatchObject({
        sourceSpec: null,
        completesSpec: null,
      });
    }
  });

  it("upgrades an older document beside a spec path with completesSpec Unknown, never a boolean", () => {
    const preSchema = withKey(preSchemaDocuments["plan-document"], "sourceSpec", spec);
    for (const document of [older("0.17.0", spec), preSchema]) {
      const result = parsePlanDocument(document);
      if (!result.ok) throw new Error("document rejected");
      const latest = toLatestPlanDocument(result.value);
      expect(latest.sourceSpec).toBe(spec);
      expect(isUnknown(latest.completesSpec)).toBe(true);
    }
  });

  it("keeps a current document's completesSpec", () => {
    const document = { ...current, sourceSpec: spec, completesSpec: false };
    const result = parsePlanDocument(document);
    expect(result).toMatchObject({ ok: true, shape: CURRENT_SHAPES["plan-document"] });
    if (!result.ok) return;
    expect(toLatestPlanDocument(result.value)).toEqual(withoutKey(document, "$schema"));
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
