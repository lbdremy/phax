import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeSpecApprovalRecordFile,
  encodeSpecApprovalRecordFile,
} from "../../../src/schemas/specApprovalRecord.js";

const VALID_BASELINE = "a".repeat(40);

const sample = {
  version: 1 as const,
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

  it("rejects a missing required field", () => {
    const bad = {
      version: 1,
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
      version: 1 as const,
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
