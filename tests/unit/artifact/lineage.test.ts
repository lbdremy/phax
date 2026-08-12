import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  APPROVALS_FILE_PATH,
  computeStaleness,
  readSourceSpec,
  stampApproved,
  STALENESS_REASONS,
  type ApprovalRecordLike,
  type StalenessEvidence,
  type StalenessReason,
} from "../../../src/domain/artifact/lineage.js";
import { fingerprintSource } from "../../../src/domain/artifact/frontmatter.js";
import {
  decodeApprovalRecordFile,
  encodeApprovalRecordFile,
} from "../../../src/schemas/approvalRecord.js";

function planFm(opts: { status?: string; sourceSpec?: string; approved?: string; body?: string }) {
  const status = opts.status ?? "Draft";
  const sourceSpec = opts.sourceSpec ?? "null";
  const approved = opts.approved !== undefined ? `${opts.approved}\n` : "";
  const body = opts.body ?? "Body text.";
  return `---\nstatus: ${status}\nsource-spec: ${sourceSpec}\n${approved}---\n# Plan\n\n## Overview\n\n${body}\n`;
}

describe("readSourceSpec", () => {
  it("reads a path-form declaration", () => {
    expect(readSourceSpec(planFm({ sourceSpec: "docs/specs/22-foo.md" }))).toEqual({
      kind: "spec",
      path: "docs/specs/22-foo.md",
    });
  });

  it("reads the explicit null form", () => {
    expect(readSourceSpec(planFm({ sourceSpec: "null" }))).toEqual({ kind: "none" });
  });

  it("returns null when the frontmatter block is absent", () => {
    expect(readSourceSpec("# Plan\n\n## Overview\n")).toBeNull();
  });

  it("returns null when the source-spec key is missing", () => {
    expect(readSourceSpec("---\nstatus: Draft\n---\n# Plan\n\n## Overview\n")).toBeNull();
  });
});

describe("fingerprintSource (approval-fingerprint neutrality)", () => {
  const BASE = planFm({ sourceSpec: "docs/specs/22-foo.md" });

  it("is unchanged when only the status key changes", () => {
    const changed = planFm({ status: "Approved", sourceSpec: "docs/specs/22-foo.md" });
    expect(fingerprintSource(changed)).toBe(fingerprintSource(BASE));
  });

  it("is unchanged when an approved mapping is added", () => {
    const stamped = planFm({
      sourceSpec: "docs/specs/22-foo.md",
      approved: "approved:\n  date: 2026-08-10\n  baseline: abc1234",
    });
    expect(fingerprintSource(stamped)).toBe(fingerprintSource(BASE));
  });

  it("changes when the source-spec value changes", () => {
    const changed = planFm({ sourceSpec: "docs/specs/23-bar.md" });
    expect(fingerprintSource(changed)).not.toBe(fingerprintSource(BASE));
  });

  it("changes when body text changes", () => {
    const changed = planFm({ sourceSpec: "docs/specs/22-foo.md", body: "Other text." });
    expect(fingerprintSource(changed)).not.toBe(fingerprintSource(BASE));
  });
});

describe("stampApproved", () => {
  it("adds the approved mapping after the other keys", () => {
    const md = planFm({ sourceSpec: "null" });
    const updated = stampApproved(md, "2026-08-10T12:00:00.000Z", "abc1234");
    expect(Either.isRight(updated)).toBe(true);
    if (Either.isRight(updated)) {
      expect(updated.right).toContain("approved:");
      expect(updated.right).toContain("date: 2026-08-10");
      expect(updated.right).toContain("baseline: abc1234");
    }
  });

  it("replaces an existing approved mapping in place", () => {
    const md = planFm({
      sourceSpec: "null",
      approved: "approved:\n  date: 2020-01-01\n  baseline: '0000000'",
    });
    const updated = stampApproved(md, "2026-08-10T12:00:00.000Z", "abc1234");
    expect(Either.isRight(updated)).toBe(true);
    if (Either.isRight(updated)) {
      expect(updated.right).toContain("date: 2026-08-10");
      expect(updated.right).not.toContain("2020-01-01");
      expect((updated.right.match(/^approved:/gm) ?? []).length).toBe(1);
    }
  });

  it("leaves the document body byte-identical", () => {
    const md = planFm({ sourceSpec: "null", body: "Untouched body line.\n\nSecond paragraph." });
    const updated = stampApproved(md, "2026-08-10T12:00:00.000Z", "abc1234");
    expect(Either.isRight(updated)).toBe(true);
    if (Either.isRight(updated)) {
      const bodyAfter = updated.right.slice(updated.right.indexOf("---\n", 3) + 4);
      const bodyBefore = md.slice(md.indexOf("---\n", 3) + 4);
      expect(bodyAfter).toBe(bodyBefore);
    }
  });

  it("never affects the approval fingerprint", () => {
    const md = planFm({ sourceSpec: "null" });
    const stamped = stampApproved(md, "2026-08-10T12:00:00.000Z", "abc1234");
    expect(Either.isRight(stamped)).toBe(true);
    if (Either.isRight(stamped)) {
      expect(fingerprintSource(stamped.right)).toBe(fingerprintSource(md));
    }
  });

  it("fails with missing-block when there is no frontmatter", () => {
    const result = stampApproved("# Plan\n\n## Overview\n", "2026-08-10T12:00:00.000Z", "abc1234");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.kind).toBe("missing-block");
    }
  });
});

function record(overrides: Partial<ApprovalRecordLike> = {}): ApprovalRecordLike {
  return {
    planFingerprint: "plan-fp",
    approvedAt: "2026-08-10T00:00:00.000Z",
    baseline: "a".repeat(40),
    sourceSpec: { path: "docs/specs/22-foo.md", fingerprint: "spec-fp" },
    ...overrides,
  };
}

describe("STALENESS_REASONS", () => {
  it("is the closed reason set in evidence-collection order", () => {
    expect(STALENESS_REASONS).toEqual(["spec-changed", "ground-changed", "self-changed"]);
    const reason: StalenessReason = STALENESS_REASONS[0];
    expect(STALENESS_REASONS).toContain(reason);
  });

  it("StalenessEvidence discriminates by reason", () => {
    const evidence: StalenessEvidence = { reason: "self-changed" };
    expect(evidence.reason).toBe("self-changed");
  });
});

describe("computeStaleness", () => {
  it("is fresh when nothing changed", () => {
    const verdict = computeStaleness({
      record: record(),
      baselineExists: true,
      currentPlanFingerprint: "plan-fp",
      currentSpecFingerprint: "spec-fp",
      changedFilesSinceBaseline: [],
      footprint: ["src/a.ts"],
    });
    expect(verdict).toEqual({ kind: "fresh" });
  });

  it("reports spec-changed alone", () => {
    const verdict = computeStaleness({
      record: record(),
      baselineExists: true,
      currentPlanFingerprint: "plan-fp",
      currentSpecFingerprint: "spec-fp-2",
      changedFilesSinceBaseline: [],
      footprint: ["src/a.ts"],
    });
    expect(verdict).toEqual({
      kind: "stale",
      evidence: [{ reason: "spec-changed", specPath: "docs/specs/22-foo.md" }],
    });
  });

  it("reports ground-changed naming exactly the intersecting files", () => {
    const verdict = computeStaleness({
      record: record(),
      baselineExists: true,
      currentPlanFingerprint: "plan-fp",
      currentSpecFingerprint: "spec-fp",
      changedFilesSinceBaseline: ["src/a.ts", "src/unrelated.ts"],
      footprint: ["src/a.ts", "src/b.ts"],
    });
    expect(verdict).toEqual({
      kind: "stale",
      evidence: [{ reason: "ground-changed", baseline: "a".repeat(40), files: ["src/a.ts"] }],
    });
  });

  it("reports self-changed alone", () => {
    const verdict = computeStaleness({
      record: record(),
      baselineExists: true,
      currentPlanFingerprint: "plan-fp-2",
      currentSpecFingerprint: "spec-fp",
      changedFilesSinceBaseline: [],
      footprint: ["src/a.ts"],
    });
    expect(verdict).toEqual({ kind: "stale", evidence: [{ reason: "self-changed" }] });
  });

  it("reports all three reasons together in enum order", () => {
    const verdict = computeStaleness({
      record: record(),
      baselineExists: true,
      currentPlanFingerprint: "plan-fp-2",
      currentSpecFingerprint: "spec-fp-2",
      changedFilesSinceBaseline: ["src/a.ts"],
      footprint: ["src/a.ts"],
    });
    expect(verdict).toEqual({
      kind: "stale",
      evidence: [
        { reason: "spec-changed", specPath: "docs/specs/22-foo.md" },
        { reason: "ground-changed", baseline: "a".repeat(40), files: ["src/a.ts"] },
        { reason: "self-changed" },
      ],
    });
  });

  it("is fresh when changed files are disjoint from the footprint", () => {
    const verdict = computeStaleness({
      record: record(),
      baselineExists: true,
      currentPlanFingerprint: "plan-fp",
      currentSpecFingerprint: "spec-fp",
      changedFilesSinceBaseline: ["src/unrelated.ts"],
      footprint: ["src/a.ts"],
    });
    expect(verdict).toEqual({ kind: "fresh" });
  });

  it("is missing-record with no record", () => {
    const verdict = computeStaleness({
      record: null,
      baselineExists: true,
      currentPlanFingerprint: "plan-fp",
      currentSpecFingerprint: "spec-fp",
      changedFilesSinceBaseline: [],
      footprint: [],
    });
    expect(verdict.kind).toBe("missing-record");
  });

  it("is missing-record when the baseline has vanished", () => {
    const verdict = computeStaleness({
      record: record(),
      baselineExists: false,
      currentPlanFingerprint: "plan-fp",
      currentSpecFingerprint: "spec-fp",
      changedFilesSinceBaseline: [],
      footprint: [],
    });
    expect(verdict.kind).toBe("missing-record");
    if (verdict.kind === "missing-record") {
      expect(verdict.detail).toContain("a".repeat(40));
    }
  });

  it("a spec-less record never reports spec-changed", () => {
    const verdict = computeStaleness({
      record: record({ sourceSpec: null }),
      baselineExists: true,
      currentPlanFingerprint: "plan-fp",
      currentSpecFingerprint: null,
      changedFilesSinceBaseline: [],
      footprint: [],
    });
    expect(verdict).toEqual({ kind: "fresh" });
  });
});

describe("approval record sidecar schema", () => {
  const sample = {
    version: 1 as const,
    records: {
      "docs/plans/22-foo-plan.md": {
        planFingerprint: "plan-fp",
        approvedAt: "2026-08-10T00:00:00.000Z",
        baseline: "a".repeat(40),
        sourceSpec: { path: "docs/specs/22-foo.md", fingerprint: "spec-fp" },
      },
    },
  };

  it("round-trips decode/encode", () => {
    const decoded = decodeApprovalRecordFile(sample);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(encodeApprovalRecordFile(decoded.right)).toEqual(sample);
    }
  });

  it("decodes a null sourceSpec", () => {
    const withNull = {
      ...sample,
      records: {
        "docs/plans/22-foo-plan.md": {
          ...sample.records["docs/plans/22-foo-plan.md"],
          sourceSpec: null,
        },
      },
    };
    expect(Either.isRight(decodeApprovalRecordFile(withNull))).toBe(true);
  });

  it("rejects a missing required field", () => {
    const bad = {
      version: 1,
      records: { "docs/plans/22-foo-plan.md": { approvedAt: "2026-08-10T00:00:00.000Z" } },
    };
    expect(Either.isLeft(decodeApprovalRecordFile(bad))).toBe(true);
  });

  it("rejects a malformed baseline", () => {
    const bad = {
      ...sample,
      records: {
        "docs/plans/22-foo-plan.md": {
          ...sample.records["docs/plans/22-foo-plan.md"],
          baseline: "not-hex",
        },
      },
    };
    expect(Either.isLeft(decodeApprovalRecordFile(bad))).toBe(true);
  });

  it("exposes the sidecar file path constant", () => {
    expect(APPROVALS_FILE_PATH).toBe("docs/plans/approvals.json");
  });
});
