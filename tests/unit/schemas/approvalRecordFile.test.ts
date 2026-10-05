// The per-artifact approval record files (spec approval-record-files §5.3,
// §6): each is a `$schema` document carrying `artifact` plus every field of
// the record it replaces, born with `$schema`. Every record is made up.
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodePlanRecordFile,
  encodePlanRecordFile,
  type PlanRecord,
} from "../../../src/schemas/approvalRecord.js";
import {
  readPlanRecordFile,
  readSpecRecordFile,
  withSchemaUrl,
  type PersistedReadError,
} from "../../../src/schemas/persisted.js";
import { PHAX_RELEASE } from "../../../src/schemas/release.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import {
  decodeSpecRecordFile,
  encodeSpecRecordFile,
  type SpecRecord,
} from "../../../src/schemas/specApprovalRecord.js";

const BASELINE = "0123456789abcdef0123456789abcdef01234567";
const NEWER_RELEASE = `${Number(PHAX_RELEASE.split(".")[0]) + 1}.0.0`;

const planRecord: PlanRecord = {
  artifact: "docs/plans/2601010900-example.md",
  planFingerprint: "plan-fingerprint-0001",
  approvedAt: "2026-01-01T09:00:00.000Z",
  baseline: BASELINE,
  sourceSpec: { path: "docs/specs/2601010800-example.md", fingerprint: "spec-fingerprint-0001" },
};

const specRecord: SpecRecord = {
  artifact: "docs/specs/2601010800-example.md",
  specFingerprint: "spec-fingerprint-0001",
  approvedAt: "2026-01-01T08:00:00.000Z",
  baseline: BASELINE,
};

const planFile = withSchemaUrl("plan-approval-record", planRecord);
const specFile = withSchemaUrl("spec-approval-record", specRecord);

const PLAN_PATH = "/work/example-repo/docs/plans/approvals/2601010900-example.json";
const SPEC_PATH = "/work/example-repo/docs/specs/approvals/2601010800-example.json";

function without(doc: object, key: string): Record<string, unknown> {
  const { [key]: _removed, ...rest } = doc as Record<string, unknown>;
  return rest;
}

describe("PlanRecordFileSchema", () => {
  it("decodes a record with a source spec and round-trips through the encoder", () => {
    const decoded = decodePlanRecordFile(planFile);
    if (Either.isLeft(decoded)) throw new Error("record rejected");
    expect(encodePlanRecordFile(decoded.right)).toEqual(planFile);
  });

  it("decodes a record with a null source spec", () => {
    expect(Either.isRight(decodePlanRecordFile({ ...planFile, sourceSpec: null }))).toBe(true);
  });

  it("keys the file exactly $schema, artifact, planFingerprint, approvedAt, baseline, sourceSpec", () => {
    const decoded = decodePlanRecordFile(planFile);
    if (Either.isLeft(decoded)) throw new Error("record rejected");
    expect(Object.keys(encodePlanRecordFile(decoded.right))).toEqual([
      "$schema",
      "artifact",
      "planFingerprint",
      "approvedAt",
      "baseline",
      "sourceSpec",
    ]);
  });

  it.each([
    ["a missing artifact", without(planFile, "artifact")],
    ["an empty artifact", { ...planFile, artifact: "" }],
    ["an extra key", { ...planFile, records: {} }],
    ["a non-40-hex baseline", { ...planFile, baseline: "abc1234" }],
    [
      "a $schema naming plan-approvals",
      { ...planFile, $schema: schemaUrl("plan-approvals", PHAX_RELEASE) },
    ],
    [
      "a $schema naming spec-approval-record",
      { ...planFile, $schema: schemaUrl("spec-approval-record", PHAX_RELEASE) },
    ],
    ["a missing $schema", without(planFile, "$schema")],
  ])("rejects %s", (_label, input) => {
    expect(Either.isLeft(decodePlanRecordFile(input))).toBe(true);
  });
});

describe("SpecRecordFileSchema", () => {
  it("decodes a record and round-trips through the encoder, keys in order", () => {
    const decoded = decodeSpecRecordFile(specFile);
    if (Either.isLeft(decoded)) throw new Error("record rejected");
    const encoded = encodeSpecRecordFile(decoded.right);
    expect(encoded).toEqual(specFile);
    expect(Object.keys(encoded)).toEqual([
      "$schema",
      "artifact",
      "specFingerprint",
      "approvedAt",
      "baseline",
    ]);
  });

  it.each([
    ["a missing artifact", without(specFile, "artifact")],
    ["an extra key", { ...specFile, sourceSpec: null }],
    ["a non-40-hex baseline", { ...specFile, baseline: "not-hex" }],
    [
      "a $schema naming spec-approvals",
      { ...specFile, $schema: schemaUrl("spec-approvals", PHAX_RELEASE) },
    ],
    ["a missing $schema", without(specFile, "$schema")],
  ])("rejects %s", (_label, input) => {
    expect(Either.isLeft(decodeSpecRecordFile(input))).toBe(true);
  });
});

type AnyReader = (file: string, input: unknown) => Either.Either<object, PersistedReadError>;

const READERS: ReadonlyArray<
  readonly [
    string,
    AnyReader,
    object,
    object,
    string,
    "plan-approval-record" | "spec-approval-record",
  ]
> = [
  ["Plan", readPlanRecordFile, planFile, planRecord, PLAN_PATH, "plan-approval-record"],
  ["Spec", readSpecRecordFile, specFile, specRecord, SPEC_PATH, "spec-approval-record"],
];

describe.each(READERS)("read%sRecordFile", (kind, read, file, record, path, format) => {
  const label = `${kind.toLowerCase()} approval record`;

  function message(input: unknown): string {
    const result = read(path, input);
    if (Either.isRight(result)) throw new Error("expected the reader to refuse");
    expect(result.left).toMatchObject({ _tag: "PersistedReadError", file: path, format });
    expect(result.left.message.startsWith(`${path}: `)).toBe(true);
    return result.left.message;
  }

  it("reads the file as the record without $schema", () => {
    expect(read(path, file)).toEqual(Either.right(record));
  });

  it("refuses a document without $schema, naming the file", () => {
    expect(message(without(file, "$schema"))).toBe(
      `${path}: ${label} has no $schema — every ${label} is written with one`,
    );
    expect(message({ version: 1, ...without(file, "$schema") })).toContain("has no $schema");
  });

  it("refuses a document written by a newer release", () => {
    const newer = { ...file, $schema: schemaUrl(format, NEWER_RELEASE) };
    expect(message(newer)).toBe(
      `${path}: ${label} written by phax ${NEWER_RELEASE} is newer than this phax (${PHAX_RELEASE}) — upgrade phax to read it`,
    );
  });

  it.each([null, [], "record", 42])("refuses the non-object %j", (input) => {
    expect(message(input)).toBe(`${path}: a ${label} is a JSON object`);
  });

  it("refuses a document that fails to decode, naming the file", () => {
    expect(message({ ...file, baseline: "abc1234" })).toContain("baseline");
    expect(message(without(file, "artifact"))).toContain("artifact");
  });
});
