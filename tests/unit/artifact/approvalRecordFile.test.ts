import { describe, expect, it } from "vitest";
import {
  PLAN_APPROVAL_RECORD_DIR,
  SPEC_APPROVAL_RECORD_DIR,
  approvalRecordPathFor,
  artifactPathForRecordFile,
  isApprovalRecordPath,
  isLiveArtifactPath,
} from "../../../src/domain/artifact/approvalRecordFile.js";

const PLAN = "docs/plans/2601010000-made-up-plan.md";
const SPEC = "docs/specs/2601010000-made-up.md";

describe("approval record directories", () => {
  it("sit under docs/plans/ and docs/specs/", () => {
    expect(PLAN_APPROVAL_RECORD_DIR).toBe("docs/plans/approvals/");
    expect(SPEC_APPROVAL_RECORD_DIR).toBe("docs/specs/approvals/");
  });
});

describe("isLiveArtifactPath", () => {
  it("accepts a .md directly under the kind's directory", () => {
    expect(isLiveArtifactPath("plan", PLAN)).toBe(true);
    expect(isLiveArtifactPath("spec", SPEC)).toBe(true);
  });

  it.each([
    ["plan", "docs/plans/archive/2601010000-made-up-plan.md"],
    ["plan", "docs/plans/nested/2601010000-made-up-plan.md"],
    ["plan", "docs/plans/approvals/2601010000-made-up-plan.json"],
    ["plan", "docs/plans/2601010000-made-up-plan.json"],
    ["plan", "docs/plans/.md"],
    ["plan", SPEC],
    ["spec", PLAN],
    ["spec", "docs/specs/archive/2601010000-made-up.md"],
    ["spec", "other/2601010000-made-up.md"],
  ] as const)("refuses %s path %s", (kind, path) => {
    expect(isLiveArtifactPath(kind, path)).toBe(false);
  });
});

describe("approvalRecordPathFor", () => {
  it("maps a live plan to its record file", () => {
    expect(approvalRecordPathFor("plan", PLAN)).toBe(
      "docs/plans/approvals/2601010000-made-up-plan.json",
    );
  });

  it("maps a live spec to its record file", () => {
    expect(approvalRecordPathFor("spec", SPEC)).toBe(
      "docs/specs/approvals/2601010000-made-up.json",
    );
  });

  it.each([
    ["plan", "docs/plans/archive/2601010000-made-up-plan.md"],
    ["spec", "docs/specs/archive/2601010000-made-up.md"],
    ["plan", "docs/plans/nested/2601010000-made-up-plan.md"],
    ["plan", "docs/plans/approvals/2601010000-made-up-plan.json"],
    ["spec", "docs/specs/approvals/2601010000-made-up.json"],
    ["plan", "docs/plans/2601010000-made-up-plan.txt"],
    ["plan", SPEC],
  ] as const)("is null for the non-live %s path %s", (kind, path) => {
    expect(approvalRecordPathFor(kind, path)).toBeNull();
  });
});

describe("artifactPathForRecordFile", () => {
  it("inverts approvalRecordPathFor for both kinds", () => {
    expect(artifactPathForRecordFile(approvalRecordPathFor("plan", PLAN) as string)).toEqual({
      kind: "plan",
      artifact: PLAN,
    });
    expect(artifactPathForRecordFile(approvalRecordPathFor("spec", SPEC) as string)).toEqual({
      kind: "spec",
      artifact: SPEC,
    });
  });

  it.each([
    "docs/plans/approvals/nested/2601010000-made-up-plan.json",
    "docs/plans/approvals/2601010000-made-up-plan.md",
    "docs/plans/approvals/.json",
    "docs/plans/approvals.json",
    "docs/specs/approvals.json",
    "docs/plans/2601010000-made-up-plan.json",
  ])("is null for %s", (path) => {
    expect(artifactPathForRecordFile(path)).toBeNull();
  });
});

describe("isApprovalRecordPath", () => {
  it("accepts any path under either approvals directory", () => {
    expect(isApprovalRecordPath("docs/plans/approvals/2601010000-made-up-plan.json")).toBe(true);
    expect(isApprovalRecordPath("docs/specs/approvals/2601010000-made-up.md")).toBe(true);
    expect(isApprovalRecordPath("docs/plans/approvals/nested/x.json")).toBe(true);
  });

  it("refuses artifacts, archives and the old ledgers", () => {
    expect(isApprovalRecordPath(PLAN)).toBe(false);
    expect(isApprovalRecordPath("docs/specs/archive/2601010000-made-up.md")).toBe(false);
    expect(isApprovalRecordPath("docs/plans/approvals.json")).toBe(false);
    expect(isApprovalRecordPath("docs/specs/approvals.json")).toBe(false);
  });
});
