import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  APPROVALS_FILE_PATH,
  computeStaleness,
  fingerprintableContent,
  readSourceSpecLine,
  STALENESS_REASONS,
  upsertApprovedLine,
  type ApprovalRecordLike,
  type StalenessEvidence,
  type StalenessReason,
} from "../../../src/domain/artifact/lineage.js";
import {
  decodeApprovalRecordFile,
  encodeApprovalRecordFile,
} from "../../../src/schemas/approvalRecord.js";

describe("readSourceSpecLine", () => {
  it("reads a path-form declaration", () => {
    const md = `# Plan\n\nStatus: Draft\nSource-Spec: docs/specs/22-foo.md\n\n## Overview\n`;
    expect(readSourceSpecLine(md)).toEqual({ kind: "spec", path: "docs/specs/22-foo.md" });
  });

  it("reads the explicit (none) form", () => {
    const md = `# Plan\n\nStatus: Draft\nSource-Spec: (none)\n\n## Overview\n`;
    expect(readSourceSpecLine(md)).toEqual({ kind: "none" });
  });

  it("returns null when the line is absent", () => {
    const md = `# Plan\n\nStatus: Draft\n\n## Overview\n`;
    expect(readSourceSpecLine(md)).toBeNull();
  });

  it("returns null for an empty value", () => {
    const md = `# Plan\n\nStatus: Draft\nSource-Spec: \n\n## Overview\n`;
    expect(readSourceSpecLine(md)).toBeNull();
  });

  it("ignores a Source-Spec line below the first H2", () => {
    const md = `# Plan\n\nStatus: Draft\nSource-Spec: (none)\n\n## Overview\n\nSource-Spec: docs/specs/99-decoy.md\n`;
    expect(readSourceSpecLine(md)).toEqual({ kind: "none" });
  });
});

describe("fingerprintableContent", () => {
  const BASE = `# Plan\n\nStatus: Draft\nSource-Spec: docs/specs/22-foo.md\n\n## Overview\n\nBody text.\n`;

  it("is unchanged when only the Status: line changes", () => {
    const changed = `# Plan\n\nStatus: Approved\nSource-Spec: docs/specs/22-foo.md\n\n## Overview\n\nBody text.\n`;
    expect(fingerprintableContent(changed)).toBe(fingerprintableContent(BASE));
  });

  it("is unchanged when an Approved: stamp is added", () => {
    const stamped = `# Plan\n\nStatus: Draft\nSource-Spec: docs/specs/22-foo.md\nApproved: 2026-08-10 @ abc1234\n\n## Overview\n\nBody text.\n`;
    expect(fingerprintableContent(stamped)).toBe(fingerprintableContent(BASE));
  });

  it("changes when the Source-Spec line changes", () => {
    const changed = `# Plan\n\nStatus: Draft\nSource-Spec: docs/specs/23-bar.md\n\n## Overview\n\nBody text.\n`;
    expect(fingerprintableContent(changed)).not.toBe(fingerprintableContent(BASE));
  });

  it("changes when body text changes", () => {
    const changed = `# Plan\n\nStatus: Draft\nSource-Spec: docs/specs/22-foo.md\n\n## Overview\n\nOther text.\n`;
    expect(fingerprintableContent(changed)).not.toBe(fingerprintableContent(BASE));
  });

  it("preserves a Status:-looking line below the first H2", () => {
    const md = `# Plan\n\nStatus: Draft\nSource-Spec: (none)\n\n## Overview\n\nStatus: illustrative-example\n`;
    expect(fingerprintableContent(md)).toContain("Status: illustrative-example");
  });
});

describe("upsertApprovedLine", () => {
  it("inserts after the Source-Spec line", () => {
    const md = `# Plan\n\nStatus: Draft\nSource-Spec: (none)\n\n## Overview\n`;
    const updated = upsertApprovedLine(md, "2026-08-10T12:00:00.000Z", "abc1234");
    const lines = updated.split("\n");
    const specIndex = lines.findIndex((l) => l.startsWith("Source-Spec:"));
    expect(lines[specIndex + 1]).toBe("Approved: 2026-08-10 @ abc1234");
  });

  it("inserts after Status when there is no Source-Spec line", () => {
    const md = `# Plan\n\nStatus: Draft\n\n## Overview\n`;
    const updated = upsertApprovedLine(md, "2026-08-10T12:00:00.000Z", "abc1234");
    const lines = updated.split("\n");
    const statusIndex = lines.findIndex((l) => l.startsWith("Status:"));
    expect(lines[statusIndex + 1]).toBe("Approved: 2026-08-10 @ abc1234");
  });

  it("replaces an existing stamp", () => {
    const md = `# Plan\n\nStatus: Draft\nSource-Spec: (none)\nApproved: 2020-01-01 @ 0000000\n\n## Overview\n`;
    const updated = upsertApprovedLine(md, "2026-08-10T12:00:00.000Z", "abc1234");
    expect(updated).toContain("Approved: 2026-08-10 @ abc1234");
    expect(updated).not.toContain("2020-01-01");
    expect((updated.match(/^Approved:/gm) ?? []).length).toBe(1);
  });

  it("round-trips with fingerprintableContent (the stamp never affects the fingerprint)", () => {
    const md = `# Plan\n\nStatus: Draft\nSource-Spec: (none)\n\n## Overview\n\nBody.\n`;
    const stamped = upsertApprovedLine(md, "2026-08-10T12:00:00.000Z", "abc1234");
    expect(fingerprintableContent(stamped)).toBe(fingerprintableContent(md));
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
