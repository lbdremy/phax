// The per-artifact approval record files (spec approval-record-files §5.3,
// §6): each is a `$schema` document carrying `artifact` plus every field of
// the record it replaces, born with `$schema`, and since spec artifact-decide
// §5.43–§5.45 `approvedBy`; a 0.19.0 record is lifted to unattributed. Every
// record is made up.
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  parsePlanApprovalRecord,
  parseSpecApprovalRecord,
  toLatestPlanApprovalRecord,
  toLatestSpecApprovalRecord,
} from "../../../packages/schemas/src/formats/repository.js";
import {
  decodePlanRecordFile,
  encodePlanRecordFile,
  type PlanRecord,
} from "../../../src/schemas/approvalRecord.js";
import { decodePlanApprovalRecordV0_19_0 } from "../../../src/schemas/history/plan-approval-record/0.19.0.js";
import { decodeSpecApprovalRecordV0_19_0 } from "../../../src/schemas/history/spec-approval-record/0.19.0.js";
import {
  currentSchemaUrl,
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
  approvedBy: { kind: "machine", grant: "roadmap-loop" },
};

const specRecord: SpecRecord = {
  artifact: "docs/specs/2601010800-example.md",
  specFingerprint: "spec-fingerprint-0001",
  approvedAt: "2026-01-01T08:00:00.000Z",
  baseline: BASELINE,
  approvedBy: { kind: "operator", name: "Ada Lovelace" },
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

  it("keys the file exactly $schema, artifact, planFingerprint, approvedAt, baseline, sourceSpec, approvedBy", () => {
    const decoded = decodePlanRecordFile(planFile);
    if (Either.isLeft(decoded)) throw new Error("record rejected");
    expect(Object.keys(encodePlanRecordFile(decoded.right))).toEqual([
      "$schema",
      "artifact",
      "planFingerprint",
      "approvedAt",
      "baseline",
      "sourceSpec",
      "approvedBy",
    ]);
  });

  it.each([
    ["a missing artifact", without(planFile, "artifact")],
    ["an empty artifact", { ...planFile, artifact: "" }],
    ["an extra key", { ...planFile, records: {} }],
    ["a non-40-hex baseline", { ...planFile, baseline: "abc1234" }],
    ["a missing approvedBy", without(planFile, "approvedBy")],
    ["an approvedBy of an unknown kind", { ...planFile, approvedBy: { kind: "human" } }],
    [
      "a machine grant that is not a slug",
      { ...planFile, approvedBy: { kind: "machine", grant: "Bad Grant" } },
    ],
    [
      "an approvedBy with an excess key",
      { ...planFile, approvedBy: { kind: "operator", name: "Ada Lovelace", email: "x" } },
    ],
    [
      "a $schema naming plan-approvals",
      { ...planFile, $schema: currentSchemaUrl("plan-approvals") },
    ],
    [
      "a $schema naming spec-approval-record",
      { ...planFile, $schema: currentSchemaUrl("spec-approval-record") },
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
      "approvedBy",
    ]);
  });

  it.each([
    ["a missing artifact", without(specFile, "artifact")],
    ["a missing approvedBy", without(specFile, "approvedBy")],
    ["an approvedBy of an unknown kind", { ...specFile, approvedBy: { kind: "human" } }],
    [
      "a machine grant that is not a slug",
      { ...specFile, approvedBy: { kind: "machine", grant: "Bad Grant" } },
    ],
    ["an extra key", { ...specFile, sourceSpec: null }],
    ["a non-40-hex baseline", { ...specFile, baseline: "not-hex" }],
    [
      "a $schema naming spec-approvals",
      { ...specFile, $schema: currentSchemaUrl("spec-approvals") },
    ],
    ["a missing $schema", without(specFile, "$schema")],
  ])("rejects %s", (_label, input) => {
    expect(Either.isLeft(decodeSpecRecordFile(input))).toBe(true);
  });
});

type AnyReader = (file: string, input: unknown) => Either.Either<object, PersistedReadError>;

// Each format's frozen 0.19.0 decoder: a hand-built older record must be that shape.
const FROZEN_V0_19_0: Readonly<
  Record<
    "plan-approval-record" | "spec-approval-record",
    (input: unknown) => Either.Either<object, unknown>
  >
> = {
  "plan-approval-record": decodePlanApprovalRecordV0_19_0,
  "spec-approval-record": decodeSpecApprovalRecordV0_19_0,
};

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

  it("refuses a document stamped newer than the running version", () => {
    const newer = { ...file, $schema: schemaUrl(format, NEWER_RELEASE) };
    expect(message(newer)).toBe(
      `${path}: ${label} ${NEWER_RELEASE} is newer than this phax (${PHAX_RELEASE}) — upgrade phax to read it`,
    );
  });

  it.each([null, [], "record", 42])("refuses the non-object %j", (input) => {
    expect(message(input)).toBe(`${path}: a ${label} is a JSON object`);
  });

  it("refuses a document that fails to decode, naming the file", () => {
    expect(message({ ...file, baseline: "abc1234" })).toContain("baseline");
    expect(message(without(file, "artifact"))).toContain("artifact");
  });

  it("refuses a current-stamped document without approvedBy", () => {
    expect(message(without(file, "approvedBy"))).toContain("approvedBy");
  });

  // A record written before phax named the approver.
  const older = {
    ...without(file, "approvedBy"),
    $schema: schemaUrl(format, "0.19.0"),
  };

  it("lifts a 0.19.0 record to unattributed, never to an operator", () => {
    expect(Either.isRight(FROZEN_V0_19_0[format](older))).toBe(true);
    expect(read(path, older)).toEqual(
      Either.right({ ...without(record, "approvedBy"), approvedBy: { kind: "unattributed" } }),
    );
  });

  it("refuses a 0.19.0 record that carries approvedBy, or fails its frozen shape", () => {
    expect(message({ ...older, approvedBy: { kind: "unattributed" } })).toContain("approvedBy");
    expect(message({ ...older, baseline: "abc1234" })).toContain("baseline");
  });
});

// The schemas package reads the same two shapes and lifts the older one the
// same way phax's reader does.
describe("the schemas package over approval record files", () => {
  const PACKAGE = [
    [
      "plan",
      parsePlanApprovalRecord,
      toLatestPlanApprovalRecord as (value: never) => object,
      planFile,
      planRecord,
      "plan-approval-record",
    ],
    [
      "spec",
      parseSpecApprovalRecord,
      toLatestSpecApprovalRecord as (value: never) => object,
      specFile,
      specRecord,
      "spec-approval-record",
    ],
  ] as const;

  it.each(PACKAGE)(
    "parses a 0.19.0 %s record as shape 0.19.0 and lifts it to unattributed",
    (_kind, parse, toLatest, file, record, format) => {
      const older = { ...without(file, "approvedBy"), $schema: schemaUrl(format, "0.19.0") };
      const parsed = parse(older);
      if (!parsed.ok) throw new Error("record rejected");
      expect(parsed.shape).toBe("0.19.0");
      expect(toLatest(parsed.value as never)).toEqual({
        ...without(record, "approvedBy"),
        approvedBy: { kind: "unattributed" },
      });
    },
  );
});
