import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";
import {
  decodeSpecApprovalRecordFile,
  decodeSpecRecordFile,
  encodeSpecApprovalRecordFile,
  encodeSpecRecordFile,
} from "../../../src/schemas/specApprovalRecord.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

const VALID_BASELINE = "a".repeat(40);

const SCHEMA_URL = schemaUrl("spec-approvals", "0.17.0");

const sample = {
  $schema: SCHEMA_URL,
  records: {
    "docs/specs/2609101231-spec-approval-ground.md": {
      specFingerprint: "spec-fp",
      approvedAt: "2026-09-03T12:00:00.000Z",
      baseline: VALID_BASELINE,
    },
  },
};

describe("SpecApprovalRecordFileSchema", () => {
  it("round-trips decode/encode", () => {
    const decoded = decodeSpecApprovalRecordFile(sample);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(encodeSpecApprovalRecordFile(decoded.right)).toEqual(sample);
    }
  });

  it("rejects a non-40-hex baseline", () => {
    const bad = {
      ...sample,
      records: {
        "docs/specs/2609101231-spec-approval-ground.md": {
          ...sample.records["docs/specs/2609101231-spec-approval-ground.md"],
          baseline: "not-hex",
        },
      },
    };
    expect(Either.isLeft(decodeSpecApprovalRecordFile(bad))).toBe(true);
  });

  it("rejects a baseline that is hex but not 40 chars", () => {
    const bad = {
      ...sample,
      records: {
        "docs/specs/2609101231-spec-approval-ground.md": {
          ...sample.records["docs/specs/2609101231-spec-approval-ground.md"],
          baseline: "abc1234",
        },
      },
    };
    expect(Either.isLeft(decodeSpecApprovalRecordFile(bad))).toBe(true);
  });

  it("rejects an excess field in a record entry", () => {
    const bad = {
      ...sample,
      records: {
        "docs/specs/2609101231-spec-approval-ground.md": {
          ...sample.records["docs/specs/2609101231-spec-approval-ground.md"],
          extra: "forbidden",
        },
      },
    };
    expect(Either.isLeft(decodeSpecApprovalRecordFile(bad))).toBe(true);
  });

  it("rejects a ledger without $schema, or one that still carries version", () => {
    const { $schema: _schema, ...unstamped } = sample;
    expect(Either.isLeft(decodeSpecApprovalRecordFile({ version: 1, ...unstamped }))).toBe(true);
    expect(Either.isLeft(decodeSpecApprovalRecordFile({ ...sample, version: 1 }))).toBe(true);
  });

  it("rejects a $schema naming another format", () => {
    const other = { ...sample, $schema: schemaUrl("plan-approvals", "0.17.0") };
    expect(Either.isLeft(decodeSpecApprovalRecordFile(other))).toBe(true);
  });

  it("rejects a missing required field", () => {
    const bad = {
      $schema: SCHEMA_URL,
      records: {
        "docs/specs/2609101231-spec-approval-ground.md": {
          approvedAt: "2026-09-03T12:00:00.000Z",
          baseline: VALID_BASELINE,
        },
      },
    };
    expect(Either.isLeft(decodeSpecApprovalRecordFile(bad))).toBe(true);
  });

  it("decodes multiple records", () => {
    const multi = {
      $schema: SCHEMA_URL,
      records: {
        "docs/specs/2609101231-spec-approval-ground.md": {
          specFingerprint: "fp-1",
          approvedAt: "2026-09-03T12:00:00.000Z",
          baseline: VALID_BASELINE,
        },
        "docs/specs/2609101232-other.md": {
          specFingerprint: "fp-2",
          approvedAt: "2026-09-03T13:00:00.000Z",
          baseline: "b".repeat(40),
        },
      },
    };
    expect(Either.isRight(decodeSpecApprovalRecordFile(multi))).toBe(true);
  });

  it("refuses an approvedBy in a ledger entry: only the record file names the approver", () => {
    const entry = sample.records["docs/specs/2609101231-spec-approval-ground.md"];
    const attributed = {
      ...sample,
      records: {
        "docs/specs/2609101231-spec-approval-ground.md": {
          ...entry,
          approvedBy: { kind: "unattributed" },
        },
      },
    };
    expect(Either.isLeft(decodeSpecApprovalRecordFile(attributed))).toBe(true);
  });
});

// A spec's approval record file at the current stamp names its approver.
describe("SpecRecordFileSchema: approvedBy", () => {
  const { approvedBy: _approvedBy, ...withoutApprover } = {
    $schema: currentSchemaUrl("spec-approval-record"),
    artifact: "docs/specs/2609101231-spec-approval-ground.md",
    specFingerprint: "spec-fp",
    approvedAt: "2026-09-03T12:00:00.000Z",
    baseline: VALID_BASELINE,
    approvedBy: null,
  };
  const record = { ...withoutApprover, approvedBy: { kind: "machine", grant: "roadmap-loop" } };

  it.each([
    ["a machine and its grant", { kind: "machine", grant: "roadmap-loop" }],
    ["the operator by name", { kind: "operator", name: "Ada Lovelace" }],
    ["no one recorded", { kind: "unattributed" }],
  ])("reads %s, approvedBy last when encoded", (_label, approvedBy) => {
    const decoded = decodeSpecRecordFile({ ...record, approvedBy });
    if (Either.isLeft(decoded)) throw new Error("record rejected");
    const encoded = encodeSpecRecordFile(decoded.right);
    expect(encoded.approvedBy).toEqual(approvedBy);
    expect(Object.keys(encoded).at(-1)).toBe("approvedBy");
  });

  it.each([
    ["no approvedBy", withoutApprover],
    ["an unknown kind", { ...record, approvedBy: { kind: "human" } }],
    [
      "a grant that is not a slug",
      { ...record, approvedBy: { kind: "machine", grant: "Bad Grant" } },
    ],
    ["a machine without a grant", { ...record, approvedBy: { kind: "machine" } }],
    ["an operator with an empty name", { ...record, approvedBy: { kind: "operator", name: "" } }],
    ["an excess key", { ...record, approvedBy: { kind: "unattributed", name: "Ada Lovelace" } }],
  ])("refuses %s", (_label, input) => {
    expect(Either.isLeft(decodeSpecRecordFile(input))).toBe(true);
  });
});
