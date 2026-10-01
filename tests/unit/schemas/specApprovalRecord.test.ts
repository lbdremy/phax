import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeSpecApprovalRecordFile,
  encodeSpecApprovalRecordFile,
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
});
