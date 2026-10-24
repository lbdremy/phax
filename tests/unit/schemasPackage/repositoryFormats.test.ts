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
import {
  UNKNOWN,
  missingSchemaMessage,
  newerReleaseMessage,
} from "../../../packages/schemas/src/shapes.js";
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
  withSurfaceSummary,
  withoutSurfaceSummary,
  preSchemaUnsupported,
  validDocuments,
  withKey,
  withoutKey,
  withModelReasons,
  withoutPreambleQuestions,
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
    // A pre-schema spec document recorded no summary: the package lifts it as
    // Unknown and keeps the one a current document recorded.
    const fromWritten = format.toLatest(written.value as never) as Doc;
    const expected =
      format.id === "spec-document" ? withSurfaceSummary(fromWritten, UNKNOWN) : fromWritten;
    expect(format.toLatest(old.value as never)).toEqual(expected);
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

  // A record written before phax named the approver: no approvedBy.
  const older = withKey(
    withoutKey(document, "approvedBy"),
    "$schema",
    schemaUrl(format.id, "0.19.0"),
  );

  it("parses a 0.19.0 record as shape 0.19.0 and lifts it to unattributed, never an operator", () => {
    const result = format.parse(older);
    expect(result).toMatchObject({ ok: true, shape: "0.19.0" });
    expect(parseDocument(older)).toMatchObject({ ok: true, format: format.id, shape: "0.19.0" });
    if (!result.ok) throw new Error("document rejected");
    expect(format.toLatest(result.value as never)).toEqual({
      ...withoutKey(older, "$schema"),
      approvedBy: { kind: "unattributed" },
    });
  });

  it("fails a 0.19.0 record carrying approvedBy, and a current record without one", () => {
    expect(format.parse(withKey(older, "approvedBy", { kind: "unattributed" })).ok).toBe(false);
    expect(format.parse(withoutKey(document, "approvedBy")).ok).toBe(false);
  });
});

describe("the plan document's completesSpec history", () => {
  const spec = "docs/specs/example.md";
  const current = validDocuments["plan-document"];
  const { completesSpec: _unrecorded, ...withoutCompletesSpec } = withoutPreambleQuestions(current);
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

  // Literal releases, not PACKAGE_VERSION: the answer must not change when a release is cut.
  it("reads a document stamped 0.19.0, the last release without completesSpec, as shape 0.17.0", () => {
    const result = parsePlanDocument(older("0.19.0", spec));
    expect(result).toMatchObject({ ok: true, shape: "0.17.0" });
  });

  it("refuses a document stamped 0.20.0, the first release with completesSpec, that lacks it", () => {
    const result = parsePlanDocument(older("0.20.0", spec));
    expect(result).toMatchObject({ ok: false, error: { path: "completesSpec" } });
  });

  it("refuses completesSpec in a 0.17.0 document", () => {
    const result = parsePlanDocument({ ...older("0.17.0", null), completesSpec: null });
    expect(result).toMatchObject({ ok: false, error: { path: "completesSpec" } });
  });

  it("upgrades an older spec-less document with completesSpec: null and empty preamble questions", () => {
    for (const document of [older("0.17.0", null), preSchemaDocuments["plan-document"]]) {
      const result = parsePlanDocument(document);
      if (!result.ok) throw new Error("document rejected");
      expect(toLatestPlanDocument(result.value)).toMatchObject({
        sourceSpec: null,
        completesSpec: null,
        preamble: { openQuestions: [], arbitratedQuestions: [] },
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

describe("the plan document's question history", () => {
  const spec = "docs/specs/example.md";
  const current = validDocuments["plan-document"];
  // Literal releases, not PACKAGE_VERSION: the answer must not change when a release is cut.
  const v0_20_0 = withKey(
    withoutPreambleQuestions({ ...current, sourceSpec: spec, completesSpec: true }),
    "$schema",
    schemaUrl("plan-document", "0.20.0"),
  );

  it("parses a 0.20.0 document as shape 0.20.0 and lifts it with empty preamble questions", () => {
    const result = parsePlanDocument(v0_20_0);
    expect(result).toEqual({ ok: true, shape: "0.20.0", value: v0_20_0 });
    expect(parseDocument(v0_20_0)).toMatchObject({
      ok: true,
      format: "plan-document",
      shape: "0.20.0",
    });
    if (!result.ok) throw new Error("document rejected");
    const preamble = v0_20_0["preamble"] as Doc;
    expect(toLatestPlanDocument(result.value)).toEqual({
      ...withoutKey(v0_20_0, "$schema"),
      preamble: { ...preamble, openQuestions: [], arbitratedQuestions: [] },
      phases: (v0_20_0["phases"] as Doc[]).map((phase) => ({
        ...phase,
        mode: "headless",
        oracle: null,
        assignmentReason: null,
      })),
    });
  });

  it("parses a 0.25.0 document as shape 0.25.0 and carries each modelReason over", () => {
    const v0_25_0 = withKey(
      withModelReasons({
        ...current,
        phases: (current["phases"] as Doc[]).map((phase) => ({
          ...phase,
          assignmentReason: "Designs a state machine.",
        })),
      }),
      "$schema",
      schemaUrl("plan-document", "0.25.0"),
    );
    const result = parsePlanDocument(v0_25_0);
    expect(result).toEqual({ ok: true, shape: "0.25.0", value: v0_25_0 });
    expect(parseDocument(v0_25_0)).toMatchObject({
      ok: true,
      format: "plan-document",
      shape: "0.25.0",
    });
    if (!result.ok) throw new Error("document rejected");
    expect(toLatestPlanDocument(result.value)).toEqual({
      ...withoutKey(current, "$schema"),
      phases: (current["phases"] as Doc[]).map((phase) => ({
        ...phase,
        assignmentReason: "Designs a state machine.",
      })),
    });
    // Stamped with the current shape, a document still carrying modelReason is refused.
    expect(parsePlanDocument(withKey(v0_25_0, "$schema", current["$schema"])).ok).toBe(false);
  });

  it("refuses preamble questions in a 0.20.0 document, and a current document without them", () => {
    const preamble = v0_20_0["preamble"] as Doc;
    const withQuestions = withKey(v0_20_0, "preamble", { ...preamble, openQuestions: [] });
    expect(parsePlanDocument(withQuestions).ok).toBe(false);
    expect(parsePlanDocument(withoutPreambleQuestions(current)).ok).toBe(false);
  });
});

describe("the spec document's question history", () => {
  const current = validDocuments["spec-document"];
  const [question] = current["openQuestions"] as ReadonlyArray<Doc>;
  const marked = {
    ...question,
    id: "q-marked",
    rationale: "Decided by the author on 2026-09-28, as recommended.",
  };
  // Literal release, not PACKAGE_VERSION: the answer must not change when a release is cut.
  const v0_17_0 = withKey(
    withKey(withoutKey(withoutSurfaceSummary(current), "arbitratedQuestions"), "openQuestions", [
      question,
      marked,
    ]),
    "$schema",
    schemaUrl("spec-document", "0.17.0"),
  );

  it("parses a 0.17.0 document as shape 0.17.0 and lifts it by the rationale marker", () => {
    const result = parseSpecDocument(v0_17_0);
    expect(result).toEqual({ ok: true, shape: "0.17.0", value: v0_17_0 });
    expect(parseDocument(v0_17_0)).toMatchObject({
      ok: true,
      format: "spec-document",
      shape: "0.17.0",
    });
    if (!result.ok) throw new Error("document rejected");
    expect(toLatestSpecDocument(result.value)).toEqual({
      ...withSurfaceSummary(withoutKey(v0_17_0, "$schema"), UNKNOWN),
      openQuestions: [question],
      arbitratedQuestions: [
        {
          ...marked,
          verdict: {
            kind: "lifted",
            chosen: "a",
            abandoned: ["b"],
            why: "Decided by the author on 2026-09-28, as recommended.",
            at: "2026-09-28",
            by: { kind: "unattributed" },
          },
          history: [],
        },
      ],
    });
  });

  it("lifts a pre-schema document by the same rule", () => {
    const preSchema = withKey(preSchemaDocuments["spec-document"], "openQuestions", [
      question,
      marked,
    ]);
    const old = parseSpecDocument(preSchema);
    const stamped = parseSpecDocument(v0_17_0);
    if (!old.ok || !stamped.ok) throw new Error("document rejected");
    expect(toLatestSpecDocument(old.value)).toEqual(toLatestSpecDocument(stamped.value));
  });

  // Literal release again: a 0.25.0 document carries its questions and no summary.
  it("parses a 0.25.0 document as shape 0.25.0 and lifts each summary as Unknown, keeping a current one", () => {
    const v0_25_0 = withKey(
      withoutSurfaceSummary(current),
      "$schema",
      schemaUrl("spec-document", "0.25.0"),
    );
    const result = parseSpecDocument(v0_25_0);
    expect(result).toEqual({ ok: true, shape: "0.25.0", value: v0_25_0 });
    expect(parseDocument(v0_25_0)).toMatchObject({
      ok: true,
      format: "spec-document",
      shape: "0.25.0",
    });
    if (!result.ok) throw new Error("document rejected");
    expect(toLatestSpecDocument(result.value)).toEqual(
      withSurfaceSummary(withoutKey(v0_25_0, "$schema"), UNKNOWN),
    );
    const written = parseSpecDocument(current);
    if (!written.ok) throw new Error("document rejected");
    expect(toLatestSpecDocument(written.value)).toEqual(withoutKey(current, "$schema"));
    // An empty surface lifts the same from either shape.
    const empty = parseSpecDocument(withKey(v0_25_0, "surface", []));
    if (!empty.ok) throw new Error("document rejected");
    expect(toLatestSpecDocument(empty.value)).toMatchObject({ surface: [] });
  });

  it("refuses arbitratedQuestions in a 0.17.0 document, and a current document without it", () => {
    expect(parseSpecDocument(withKey(v0_17_0, "arbitratedQuestions", [])).ok).toBe(false);
    expect(parseSpecDocument(withoutKey(current, "arbitratedQuestions")).ok).toBe(false);
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
