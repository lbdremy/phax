import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as entry from "../../../packages/schemas/src/index.js";

const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "schemas",
);

describe("schemas package entry", () => {
  it("exports exactly parseDocument, each format's schema, parse and upgrade, and the unknown marker at runtime", () => {
    expect(Object.keys(entry).toSorted()).toEqual([
      "ComplianceReviewSchema",
      "PhaseRecordManifestSchema",
      "PhaseStatusSchema",
      "PhaxPlanSchema",
      "PlanApprovalsSchema",
      "PlanDocumentSchema",
      "RegistrySchema",
      "RunStatusSchema",
      "SpecApprovalsSchema",
      "SpecDocumentSchema",
      "UNKNOWN",
      "isUnknown",
      "parseComplianceReview",
      "parseDocument",
      "parsePhaseRecordManifest",
      "parsePhaseStatus",
      "parsePhaxPlan",
      "parsePlanApprovals",
      "parsePlanDocument",
      "parseRegistry",
      "parseRunStatus",
      "parseSpecApprovals",
      "parseSpecDocument",
      "toLatestComplianceReview",
      "toLatestPhaseRecordManifest",
      "toLatestPhaseStatus",
      "toLatestPhaxPlan",
      "toLatestPlanApprovals",
      "toLatestPlanDocument",
      "toLatestRegistry",
      "toLatestRunStatus",
      "toLatestSpecApprovals",
      "toLatestSpecDocument",
    ]);
  });

  it("re-exports phax's own schemas, never a copy", async () => {
    const { ComplianceReviewSchema } = await import("../../../src/schemas/complianceReview.js");
    const { PhaxPlanSchema } = await import("../../../src/schemas/phaxPlan.js");
    const { RegistrySchema } = await import("../../../src/schemas/registry.js");
    const { PhaseStatusSchema, RunStatusSchema } = await import("../../../src/schemas/status.js");
    expect(entry.ComplianceReviewSchema).toBe(ComplianceReviewSchema);
    expect(entry.PhaxPlanSchema).toBe(PhaxPlanSchema);
    expect(entry.RegistrySchema).toBe(RegistrySchema);
    expect(entry.PhaseStatusSchema).toBe(PhaseStatusSchema);
    expect(entry.RunStatusSchema).toBe(RunStatusSchema);
  });

  it("re-exports phax's repository schemas under the spec's names, never a copy", async () => {
    const { ApprovalRecordFileSchema } = await import("../../../src/schemas/approvalRecord.js");
    const { SpecApprovalRecordFileSchema } =
      await import("../../../src/schemas/specApprovalRecord.js");
    const { SpecDocumentSchema } = await import("../../../src/schemas/specDocument.js");
    const { PlanDocumentSchema } = await import("../../../src/schemas/planDocument.js");
    expect(entry.PlanApprovalsSchema).toBe(ApprovalRecordFileSchema);
    expect(entry.SpecApprovalsSchema).toBe(SpecApprovalRecordFileSchema);
    expect(entry.SpecDocumentSchema).toBe(SpecDocumentSchema);
    expect(entry.PlanDocumentSchema).toBe(PlanDocumentSchema);
  });

  it("is the only subpath in the package manifest's exports", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(Object.keys(manifest.exports)).toEqual(["."]);
  });
});
