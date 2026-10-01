import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as entry from "../../../packages/schemas/src/index.js";
import * as authoringRecordManifest from "../../../src/schemas/history/authoring-record-manifest/pre-schema.js";
import * as complianceReview from "../../../src/schemas/history/compliance-review/pre-schema.js";
import * as gateAttribution from "../../../src/schemas/history/gate-attribution/pre-schema.js";
import * as gateDiagnostics from "../../../src/schemas/history/gate-diagnostics/pre-schema.js";
import * as gatePending from "../../../src/schemas/history/gate-pending/pre-schema.js";
import * as phaseFileReconciliation from "../../../src/schemas/history/phase-file-reconciliation/pre-schema.js";
import * as phaseRecordManifest from "../../../src/schemas/history/phase-record-manifest/pre-schema.js";
import * as phaseStatus from "../../../src/schemas/history/phase-status/pre-schema.js";
import * as phaxPlan from "../../../src/schemas/history/phax-plan/pre-schema.js";
import * as planApprovals from "../../../src/schemas/history/plan-approvals/pre-schema.js";
import * as planDocument from "../../../src/schemas/history/plan-document/pre-schema.js";
import * as registry from "../../../src/schemas/history/registry/pre-schema.js";
import * as runStatus from "../../../src/schemas/history/run-status/pre-schema.js";
import * as specApprovals from "../../../src/schemas/history/spec-approvals/pre-schema.js";
import * as specDocument from "../../../src/schemas/history/spec-document/pre-schema.js";
import { FORMAT_IDS, type FormatId } from "../../../src/schemas/schemaUrl.js";

/** Each format's frozen module under src/schemas/history/. */
const FROZEN_MODULES: { readonly [F in FormatId]: object } = {
  registry,
  "run-status": runStatus,
  "phase-status": phaseStatus,
  "phax-plan": phaxPlan,
  "compliance-review": complianceReview,
  "plan-approvals": planApprovals,
  "spec-approvals": specApprovals,
  "phase-record-manifest": phaseRecordManifest,
  "authoring-record-manifest": authoringRecordManifest,
  "gate-attribution": gateAttribution,
  "phase-file-reconciliation": phaseFileReconciliation,
  "gate-diagnostics": gateDiagnostics,
  "gate-pending": gatePending,
  "spec-document": specDocument,
  "plan-document": planDocument,
};

function pascal(id: FormatId): string {
  return id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "schemas",
);

describe("schemas package entry", () => {
  it("exports exactly parseDocument, each format's schema, pre-schema schema, parse and upgrade, and the unknown marker at runtime", () => {
    expect(Object.keys(entry).toSorted()).toEqual([
      "AuthoringRecordManifestPreSchemaSchema",
      "AuthoringRecordManifestSchema",
      "ComplianceReviewPreSchemaSchema",
      "ComplianceReviewSchema",
      "GateAttributionPreSchemaSchema",
      "GateAttributionSchema",
      "GateDiagnosticsPreSchemaSchema",
      "GateDiagnosticsSchema",
      "GatePendingPreSchemaSchema",
      "GatePendingSchema",
      "PhaseFileReconciliationPreSchemaSchema",
      "PhaseFileReconciliationSchema",
      "PhaseRecordManifestPreSchemaSchema",
      "PhaseRecordManifestSchema",
      "PhaseStatusPreSchemaSchema",
      "PhaseStatusSchema",
      "PhaxPlanPreSchemaSchema",
      "PhaxPlanSchema",
      "PlanApprovalsPreSchemaSchema",
      "PlanApprovalsSchema",
      "PlanDocumentPreSchemaSchema",
      "PlanDocumentSchema",
      "RecordManifestSchema",
      "RegistryPreSchemaSchema",
      "RegistrySchema",
      "RunStatusPreSchemaSchema",
      "RunStatusSchema",
      "SpecApprovalsPreSchemaSchema",
      "SpecApprovalsSchema",
      "SpecDocumentPreSchemaSchema",
      "SpecDocumentSchema",
      "UNKNOWN",
      "isUnknown",
      "parseAuthoringRecordManifest",
      "parseComplianceReview",
      "parseDocument",
      "parseGateAttribution",
      "parseGateDiagnostics",
      "parseGatePending",
      "parsePhaseFileReconciliation",
      "parsePhaseRecordManifest",
      "parsePhaseStatus",
      "parsePhaxPlan",
      "parsePlanApprovals",
      "parsePlanDocument",
      "parseRecordManifest",
      "parseRegistry",
      "parseRunStatus",
      "parseSpecApprovals",
      "parseSpecDocument",
      "toLatestAuthoringRecordManifest",
      "toLatestComplianceReview",
      "toLatestGateAttribution",
      "toLatestGateDiagnostics",
      "toLatestGatePending",
      "toLatestPhaseFileReconciliation",
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

  it("exports a schema, a pre-schema schema, a parse function and an upgrade for every format id, plus the union, parseDocument and the unknown marker", () => {
    const names = FORMAT_IDS.map(pascal);
    expect(Object.keys(entry).toSorted()).toEqual(
      [
        ...names.flatMap((name) => [
          `${name}Schema`,
          `${name}PreSchemaSchema`,
          `parse${name}`,
          `toLatest${name}`,
        ]),
        "RecordManifestSchema",
        "parseRecordManifest",
        "parseDocument",
        "UNKNOWN",
        "isUnknown",
      ].toSorted(),
    );
  });

  it("re-exports phax's own schemas, never a copy", async () => {
    const { ComplianceReviewFileSchema } = await import("../../../src/schemas/complianceReview.js");
    const { PhaxPlanFileSchema } = await import("../../../src/schemas/phaxPlan.js");
    const { RegistryFileSchema } = await import("../../../src/schemas/registry.js");
    const { PhaseStatusFileSchema, RunStatusFileSchema } =
      await import("../../../src/schemas/status.js");
    expect(entry.ComplianceReviewSchema).toBe(ComplianceReviewFileSchema);
    expect(entry.PhaxPlanSchema).toBe(PhaxPlanFileSchema);
    expect(entry.RegistrySchema).toBe(RegistryFileSchema);
    expect(entry.PhaseStatusSchema).toBe(PhaseStatusFileSchema);
    expect(entry.RunStatusSchema).toBe(RunStatusFileSchema);
  });

  it("re-exports phax's repository schemas under the spec's names, never a copy", async () => {
    const { ApprovalRecordFileSchema } = await import("../../../src/schemas/approvalRecord.js");
    const { SpecApprovalRecordFileSchema } =
      await import("../../../src/schemas/specApprovalRecord.js");
    const { SpecDocumentFileSchema } = await import("../../../src/schemas/specDocument.js");
    const { PlanDocumentFileSchema } = await import("../../../src/schemas/planDocument.js");
    expect(entry.PlanApprovalsSchema).toBe(ApprovalRecordFileSchema);
    expect(entry.SpecApprovalsSchema).toBe(SpecApprovalRecordFileSchema);
    expect(entry.SpecDocumentSchema).toBe(SpecDocumentFileSchema);
    expect(entry.PlanDocumentSchema).toBe(PlanDocumentFileSchema);
  });

  it("re-exports phax's record manifest file schemas under the spec's names, never a copy", async () => {
    const { AuthoringRecordManifestFileSchema, RecordManifestFileSchema } =
      await import("../../../src/schemas/authoringRecord.js");
    const { RunRecordManifestFileSchema } = await import("../../../src/schemas/runRecord.js");
    expect(entry.AuthoringRecordManifestSchema).toBe(AuthoringRecordManifestFileSchema);
    expect(entry.RecordManifestSchema).toBe(RecordManifestFileSchema);
    expect(entry.PhaseRecordManifestSchema).toBe(RunRecordManifestFileSchema);
  });

  it("re-exports phax's timeline schemas under the spec's names, never a copy", async () => {
    const { GateAttributionSchema } = await import("../../../src/schemas/gateAttribution.js");
    const { PhaseFileReconciliationSchema } =
      await import("../../../src/schemas/reconciliation.js");
    const { GateDiagnosticsDocumentSchema } =
      await import("../../../src/schemas/gateDiagnostics.js");
    const { GatePendingDocumentSchema } = await import("../../../src/schemas/gatePending.js");
    expect(entry.GateAttributionSchema).toBe(GateAttributionSchema);
    expect(entry.PhaseFileReconciliationSchema).toBe(PhaseFileReconciliationSchema);
    expect(entry.GateDiagnosticsSchema).toBe(GateDiagnosticsDocumentSchema);
    expect(entry.GatePendingSchema).toBe(GatePendingDocumentSchema);
  });

  it.each(FORMAT_IDS)(
    "re-exports the %s frozen module's schema, never a copy, and never its decoder",
    (id) => {
      const frozen = FROZEN_MODULES[id] as Readonly<Record<string, unknown>>;
      const name = `${pascal(id)}PreSchemaSchema`;
      expect(frozen[name]).toBeDefined();
      expect((entry as Readonly<Record<string, unknown>>)[name]).toBe(frozen[name]);
      expect(frozen[`decode${pascal(id)}PreSchema`]).toBeDefined();
      expect(Object.keys(entry)).not.toContain(`decode${pascal(id)}PreSchema`);
    },
  );

  it("is the only code subpath in the package manifest's exports; ./json/* holds data", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(Object.keys(manifest.exports)).toEqual([".", "./json/*"]);
  });
});
