import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FORMAT_DEFINITIONS } from "../../../packages/schemas/build/jsonSchemas.js";
import * as entry from "../../../packages/schemas/src/index.js";
import * as planDocumentV0_17_0 from "../../../src/schemas/history/plan-document/0.17.0.js";
import * as phaseStatusV0_17_0 from "../../../src/schemas/history/phase-status/0.17.0.js";
import * as authoringRecordManifest from "../../../src/schemas/history/authoring-record-manifest/pre-schema.js";
import * as complianceReview from "../../../src/schemas/history/compliance-review/pre-schema.js";
import * as gateAttribution from "../../../src/schemas/history/gate-attribution/pre-schema.js";
import * as gateDiagnostics from "../../../src/schemas/history/gate-diagnostics/pre-schema.js";
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
import {
  FORMAT_IDS,
  PRE_SCHEMA_FORMAT_IDS,
  type FormatId,
  type PreSchemaFormatId,
} from "../../../src/schemas/schemaUrl.js";

/** The frozen module under src/schemas/history/ of each format with a pre-schema shape. */
const FROZEN_MODULES: { readonly [F in PreSchemaFormatId]: object } = {
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
      "BriefAnswerSchema",
      "BriefRecordSchema",
      "BriefReportSchema",
      "BriefRequestSchema",
      "ComplianceReviewPreSchemaSchema",
      "ComplianceReviewSchema",
      "GateAttributionPreSchemaSchema",
      "GateAttributionSchema",
      "GateAttributionV0_17_0Schema",
      "GateDiagnosticsPreSchemaSchema",
      "GateDiagnosticsSchema",
      "GateDiagnosticsV0_17_0Schema",
      "GateReportSchema",
      "GateRequestSchema",
      "PhaseFileReconciliationPreSchemaSchema",
      "PhaseFileReconciliationSchema",
      "PhaseRecordManifestPreSchemaSchema",
      "PhaseRecordManifestSchema",
      "PhaseStatusPreSchemaSchema",
      "PhaseStatusSchema",
      "PhaseStatusV0_17_0Schema",
      "PhaxPlanPreSchemaSchema",
      "PhaxPlanSchema",
      "PlanApprovalRecordSchema",
      "PlanApprovalsPreSchemaSchema",
      "PlanApprovalsSchema",
      "PlanDocumentPreSchemaSchema",
      "PlanDocumentSchema",
      "PlanDocumentV0_17_0Schema",
      "RecordManifestSchema",
      "RegistryPreSchemaSchema",
      "RegistrySchema",
      "RunStatusPreSchemaSchema",
      "RunStatusSchema",
      "SpecApprovalRecordSchema",
      "SpecApprovalsPreSchemaSchema",
      "SpecApprovalsSchema",
      "SpecDocumentPreSchemaSchema",
      "SpecDocumentSchema",
      "UNKNOWN",
      "isUnknown",
      "parseAuthoringRecordManifest",
      "parseBriefAnswer",
      "parseBriefRecord",
      "parseBriefReport",
      "parseBriefRequest",
      "parseComplianceReview",
      "parseDocument",
      "parseGateAttribution",
      "parseGateDiagnostics",
      "parseGateReport",
      "parseGateRequest",
      "parsePhaseFileReconciliation",
      "parsePhaseRecordManifest",
      "parsePhaseStatus",
      "parsePhaxPlan",
      "parsePlanApprovalRecord",
      "parsePlanApprovals",
      "parsePlanDocument",
      "parseRecordManifest",
      "parseRegistry",
      "parseRunStatus",
      "parseSpecApprovalRecord",
      "parseSpecApprovals",
      "parseSpecDocument",
      "toLatestAuthoringRecordManifest",
      "toLatestBriefAnswer",
      "toLatestBriefRecord",
      "toLatestBriefReport",
      "toLatestBriefRequest",
      "toLatestComplianceReview",
      "toLatestGateAttribution",
      "toLatestGateDiagnostics",
      "toLatestGateReport",
      "toLatestGateRequest",
      "toLatestPhaseFileReconciliation",
      "toLatestPhaseRecordManifest",
      "toLatestPhaseStatus",
      "toLatestPhaxPlan",
      "toLatestPlanApprovalRecord",
      "toLatestPlanApprovals",
      "toLatestPlanDocument",
      "toLatestRegistry",
      "toLatestRunStatus",
      "toLatestSpecApprovalRecord",
      "toLatestSpecApprovals",
      "toLatestSpecDocument",
    ]);
  });

  it("exports a schema, a parse function and an upgrade for every format id, a pre-schema schema for every format with a pre-schema shape, a schema for every released shape that is no longer current, plus the union, parseDocument and the unknown marker", () => {
    expect(Object.keys(entry).toSorted()).toEqual(
      [
        ...FORMAT_IDS.map(pascal).flatMap((name) => [
          `${name}Schema`,
          `parse${name}`,
          `toLatest${name}`,
        ]),
        ...PRE_SCHEMA_FORMAT_IDS.map((id) => `${pascal(id)}PreSchemaSchema`),
        ...FORMAT_IDS.flatMap((id) =>
          FORMAT_DEFINITIONS[id].releases.map(
            ([release]) => `${pascal(id)}V${release.replaceAll(".", "_")}Schema`,
          ),
        ),
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
    const { ApprovalRecordFileSchema, PlanRecordFileSchema } =
      await import("../../../src/schemas/approvalRecord.js");
    const { SpecApprovalRecordFileSchema, SpecRecordFileSchema } =
      await import("../../../src/schemas/specApprovalRecord.js");
    const { SpecDocumentFileSchema } = await import("../../../src/schemas/specDocument.js");
    const { PlanDocumentFileSchema } = await import("../../../src/schemas/planDocument.js");
    expect(entry.PlanApprovalRecordSchema).toBe(PlanRecordFileSchema);
    expect(entry.SpecApprovalRecordSchema).toBe(SpecRecordFileSchema);
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

  it("re-exports phax's timeline file schemas under the spec's names, never a copy", async () => {
    const { GateAttributionFileSchema } = await import("../../../src/schemas/gateAttribution.js");
    const { PhaseFileReconciliationFileSchema } =
      await import("../../../src/schemas/reconciliation.js");
    const { GateDiagnosticsFileSchema } = await import("../../../src/schemas/gateDiagnostics.js");
    const { GateRequestFileSchema } = await import("../../../src/schemas/gateRequest.js");
    expect(entry.GateAttributionSchema).toBe(GateAttributionFileSchema);
    expect(entry.PhaseFileReconciliationSchema).toBe(PhaseFileReconciliationFileSchema);
    expect(entry.GateDiagnosticsSchema).toBe(GateDiagnosticsFileSchema);
    expect(entry.GateRequestSchema).toBe(GateRequestFileSchema);
  });

  it("re-exports phax's brief file schemas under the spec's names, never a copy", async () => {
    const { BriefAnswerFileSchema, BriefRecordFileSchema, BriefRequestFileSchema } =
      await import("../../../src/schemas/brief.js");
    expect(entry.BriefRequestSchema).toBe(BriefRequestFileSchema);
    expect(entry.BriefAnswerSchema).toBe(BriefAnswerFileSchema);
    expect(entry.BriefRecordSchema).toBe(BriefRecordFileSchema);
  });

  it("re-exports phax's report file schemas under the spec's names, never a copy", async () => {
    const { GateReportFileSchema } = await import("../../../src/schemas/gateReport.js");
    const { BriefReportFileSchema } = await import("../../../src/schemas/briefReport.js");
    expect(entry.GateReportSchema).toBe(GateReportFileSchema);
    expect(entry.BriefReportSchema).toBe(BriefReportFileSchema);
  });

  it.each(PRE_SCHEMA_FORMAT_IDS)(
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

  it("re-exports the plan-document 0.17.0 frozen module's schema, never a copy, and never its decoder", () => {
    expect(entry.PlanDocumentV0_17_0Schema).toBe(planDocumentV0_17_0.PlanDocumentV0_17_0Schema);
    expect(planDocumentV0_17_0.decodePlanDocumentV0_17_0).toBeDefined();
    expect(Object.keys(entry)).not.toContain("decodePlanDocumentV0_17_0");
  });

  it("re-exports the phase-status 0.17.0 frozen module's schema, never a copy, and never its decoder", () => {
    expect(entry.PhaseStatusV0_17_0Schema).toBe(phaseStatusV0_17_0.PhaseStatusV0_17_0Schema);
    expect(phaseStatusV0_17_0.decodePhaseStatusV0_17_0).toBeDefined();
    expect(Object.keys(entry)).not.toContain("decodePhaseStatusV0_17_0");
  });

  it("is the only code subpath in the package manifest's exports; ./json/* holds data", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(Object.keys(manifest.exports)).toEqual([".", "./json/*"]);
  });
});
