import { Either, JSONSchema, type ParseResult, type Schema } from "effect";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
import {
  PlanApprovalsV1Schema,
  decodePlanApprovalsV1,
} from "../../../packages/schemas/src/history/plan-approvals/v1.js";
import {
  PlanDocumentV1Schema,
  decodePlanDocumentV1,
} from "../../../packages/schemas/src/history/plan-document/v1.js";
import {
  SpecApprovalsV1Schema,
  decodeSpecApprovalsV1,
} from "../../../packages/schemas/src/history/spec-approvals/v1.js";
import {
  SpecDocumentV1Schema,
  decodeSpecDocumentV1,
} from "../../../packages/schemas/src/history/spec-document/v1.js";
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
import {
  ApprovalRecordFileSchema,
  decodeApprovalRecordFile,
} from "../../../src/schemas/approvalRecord.js";
import { PlanDocumentSchema, decodePlanDocument } from "../../../src/schemas/planDocument.js";
import type { FormatId } from "../../../src/schemas/schemaUrl.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import {
  SpecApprovalRecordFileSchema,
  decodeSpecApprovalRecordFile,
} from "../../../src/schemas/specApprovalRecord.js";
import { SpecDocumentSchema, decodeSpecDocument } from "../../../src/schemas/specDocument.js";
import { keySignature, readSurveyedFixtures, surveyGroups } from "./surveyedFixtures.js";

type Decode = (input: unknown) => Either.Either<unknown, ParseResult.ParseError>;

interface RepositoryFormat {
  readonly id: FormatId;
  readonly parse: (input: unknown) => {
    readonly ok: boolean;
    readonly shape?: string;
    readonly value?: unknown;
  };
  readonly phax: Decode;
  readonly frozen: Decode;
  readonly toLatest: (value: never) => unknown;
  readonly schemas: { readonly frozen: Schema.Schema.Any; readonly phax: Schema.Schema.Any };
}

const FORMATS: ReadonlyArray<RepositoryFormat> = [
  {
    id: "plan-approvals",
    parse: parsePlanApprovals,
    phax: decodeApprovalRecordFile,
    frozen: decodePlanApprovalsV1,
    toLatest: toLatestPlanApprovals,
    schemas: { frozen: PlanApprovalsV1Schema, phax: ApprovalRecordFileSchema },
  },
  {
    id: "spec-approvals",
    parse: parseSpecApprovals,
    phax: decodeSpecApprovalRecordFile,
    frozen: decodeSpecApprovalsV1,
    toLatest: toLatestSpecApprovals,
    schemas: { frozen: SpecApprovalsV1Schema, phax: SpecApprovalRecordFileSchema },
  },
  {
    id: "spec-document",
    parse: parseSpecDocument,
    phax: decodeSpecDocument,
    frozen: decodeSpecDocumentV1,
    toLatest: toLatestSpecDocument,
    schemas: { frozen: SpecDocumentV1Schema, phax: SpecDocumentSchema },
  },
  {
    id: "plan-document",
    parse: parsePlanDocument,
    phax: decodePlanDocument,
    frozen: decodePlanDocumentV1,
    toLatest: toLatestPlanDocument,
    schemas: { frozen: PlanDocumentV1Schema, phax: PlanDocumentSchema },
  },
];

// Derived from the package version, so a release bump never breaks these tests.
const NEWER_RELEASE = `${Number(PACKAGE_VERSION.split(".")[0]) + 1}.0.0`;

function withoutVersion(value: unknown): Record<string, unknown> {
  const { version: _version, ...rest } = value as Record<string, unknown>;
  return rest;
}

describe.each(FORMATS)("$id", (format) => {
  const groups = surveyGroups(format.id);
  const fixtures = readSurveyedFixtures(format.id, "v1");

  it("has one real document per surveyed signature, keyed by that signature", () => {
    expect(fixtures.map(({ signature }) => signature).toSorted()).toEqual(
      groups.map(({ keys }) => keys).toSorted(),
    );
    for (const { signature, document } of fixtures) expect(keySignature(document)).toBe(signature);
  });

  it("gets phax's verdict on each fixture: every surveyed group was accepted", () => {
    for (const group of groups) expect(group.rejected, group.keys).toBe(0);
    for (const { signature, document } of fixtures) {
      expect(Either.isRight(format.phax(document)), signature).toBe(true);
    }
  });

  it("parses every fixture as shape v1, with phax's value", () => {
    for (const { signature, document } of fixtures) {
      const result = format.parse(document);
      expect(result, signature).toMatchObject({ ok: true, shape: "v1" });
      const phax = format.phax(document);
      if (Either.isRight(phax)) expect(result.value, signature).toEqual(phax.right);
    }
  });

  it("has a frozen v1 twin that gives phax's value on every fixture", () => {
    for (const { signature, document } of fixtures) {
      const frozen = format.frozen(document);
      const phax = format.phax(document);
      expect(Either.isRight(frozen), signature).toBe(true);
      if (Either.isRight(frozen) && Either.isRight(phax)) {
        expect(frozen.right, signature).toEqual(phax.right);
      }
    }
  });

  it("has a frozen v1 twin with the same JSON Schema as phax's", () => {
    expect(JSONSchema.make(format.schemas.frozen)).toEqual(JSONSchema.make(format.schemas.phax));
  });

  it("upgrades every fixture by dropping version and keeping everything else", () => {
    for (const { signature, document } of fixtures) {
      const result = format.parse(document);
      if (!result.ok) throw new Error("fixture rejected");
      expect(format.toLatest(result.value as never), signature).toEqual(
        withoutVersion(result.value),
      );
    }
  });

  it("fails a document written by a newer release with the upgrade message", () => {
    const [first] = fixtures;
    const document = {
      ...(first?.document as object),
      $schema: schemaUrl(format.id, NEWER_RELEASE),
    };
    const message = newerReleaseMessage(format.id, NEWER_RELEASE, PACKAGE_VERSION);
    for (const result of [format.parse(document), parseDocument(document)]) {
      expect(result).toEqual({ ok: false, error: { path: "$schema", message } });
    }
  });
});

describe("the spec document's traceability", () => {
  const [fixture] = readSurveyedFixtures("spec-document", "v1");
  const spec = fixture?.document as {
    readonly acceptanceCriteria: ReadonlyArray<Record<string, unknown>>;
  };
  const [criterion, ...rest] = spec.acceptanceCriteria;
  const dangling = {
    ...spec,
    acceptanceCriteria: [{ ...criterion, refs: ["no-such-requirement"] }, ...rest],
  };

  it("rejects a dangling refs entry in both parseSpecDocument and the frozen module", () => {
    const result = parseSpecDocument(dangling);
    expect(result).toEqual({
      ok: false,
      error: {
        path: "acceptanceCriteria.0.refs.0",
        message: '"no-such-requirement" names no requirement',
      },
    });
    expect(Either.isLeft(decodeSpecDocumentV1(dangling))).toBe(true);
    expect(Either.isLeft(decodeSpecDocument(dangling))).toBe(true);
  });

  it("declares the checks JSON Schema cannot express, in the root description", () => {
    const schema = JSONSchema.make(SpecDocumentSchema) as { description?: string };
    expect(schema.description).toContain("`refs` entry names an existing requirement");
  });
});
