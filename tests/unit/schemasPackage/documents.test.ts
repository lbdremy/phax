import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Either, type ParseResult } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeApprovalRecordFile,
  decodePlanRecordFile,
} from "../../../src/schemas/approvalRecord.js";
import { decodeAuthoringRecordManifestFile } from "../../../src/schemas/authoringRecord.js";
import { decodeComplianceReviewFile } from "../../../src/schemas/complianceReview.js";
import { decodeGateAttributionFile } from "../../../src/schemas/gateAttribution.js";
import { decodeGateDiagnosticsDocument } from "../../../src/schemas/gateDiagnostics.js";
import { decodeGatePendingFile } from "../../../src/schemas/gatePending.js";
import { decodeAuthoringRecordManifestPreSchema } from "../../../src/schemas/history/authoring-record-manifest/pre-schema.js";
import { decodeComplianceReviewPreSchema } from "../../../src/schemas/history/compliance-review/pre-schema.js";
import { decodeGateAttributionPreSchema } from "../../../src/schemas/history/gate-attribution/pre-schema.js";
import { decodeGateDiagnosticsPreSchema } from "../../../src/schemas/history/gate-diagnostics/pre-schema.js";
import { decodeGatePendingPreSchema } from "../../../src/schemas/history/gate-pending/pre-schema.js";
import { decodePhaseFileReconciliationPreSchema } from "../../../src/schemas/history/phase-file-reconciliation/pre-schema.js";
import { decodePhaseRecordManifestPreSchema } from "../../../src/schemas/history/phase-record-manifest/pre-schema.js";
import { decodePhaseStatusPreSchema } from "../../../src/schemas/history/phase-status/pre-schema.js";
import { decodePhaxPlanPreSchema } from "../../../src/schemas/history/phax-plan/pre-schema.js";
import { decodePlanApprovalsPreSchema } from "../../../src/schemas/history/plan-approvals/pre-schema.js";
import { decodePlanDocumentPreSchema } from "../../../src/schemas/history/plan-document/pre-schema.js";
import { decodeRegistryPreSchema } from "../../../src/schemas/history/registry/pre-schema.js";
import { decodeRunStatusPreSchema } from "../../../src/schemas/history/run-status/pre-schema.js";
import { decodeSpecApprovalsPreSchema } from "../../../src/schemas/history/spec-approvals/pre-schema.js";
import { decodeSpecDocumentPreSchema } from "../../../src/schemas/history/spec-document/pre-schema.js";
import { decodePhaxPlanFile } from "../../../src/schemas/phaxPlan.js";
import { decodePlanDocumentFile } from "../../../src/schemas/planDocument.js";
import { decodePhaseFileReconciliationFile } from "../../../src/schemas/reconciliation.js";
import { decodeRegistryFile } from "../../../src/schemas/registry.js";
import { decodeRunRecordManifestFile } from "../../../src/schemas/runRecord.js";
import { PHAX_RELEASE } from "../../../src/schemas/release.js";
import {
  FORMAT_IDS,
  PRE_SCHEMA_FORMAT_IDS,
  schemaUrl,
  type FormatId,
  type PreSchemaFormatId,
} from "../../../src/schemas/schemaUrl.js";
import {
  decodeSpecApprovalRecordFile,
  decodeSpecRecordFile,
} from "../../../src/schemas/specApprovalRecord.js";
import { decodeSpecDocumentFile } from "../../../src/schemas/specDocument.js";
import { decodePhaseStatusFile, decodeRunStatusFile } from "../../../src/schemas/status.js";
import {
  homePaths,
  preSchemaDocuments,
  strings,
  validDocuments,
  versionOnePhaseRecordManifest,
  withKey,
  withoutKey,
} from "./documents.js";

type Decode = (input: unknown) => Either.Either<unknown, ParseResult.ParseError>;

/** phax's own decoder for each format. */
const PHAX_DECODERS: { readonly [F in FormatId]: Decode } = {
  registry: decodeRegistryFile,
  "run-status": decodeRunStatusFile,
  "phase-status": decodePhaseStatusFile,
  "phax-plan": decodePhaxPlanFile,
  "compliance-review": decodeComplianceReviewFile,
  "plan-approvals": decodeApprovalRecordFile,
  "spec-approvals": decodeSpecApprovalRecordFile,
  "phase-record-manifest": decodeRunRecordManifestFile,
  "authoring-record-manifest": decodeAuthoringRecordManifestFile,
  "gate-attribution": decodeGateAttributionFile,
  "phase-file-reconciliation": decodePhaseFileReconciliationFile,
  "gate-diagnostics": decodeGateDiagnosticsDocument,
  "gate-pending": decodeGatePendingFile,
  "spec-document": decodeSpecDocumentFile,
  "plan-document": decodePlanDocumentFile,
  "plan-approval-record": decodePlanRecordFile,
  "spec-approval-record": decodeSpecRecordFile,
};

/** The frozen pre-schema decoder of each format with a pre-schema shape. */
const FROZEN_DECODERS: { readonly [F in PreSchemaFormatId]: Decode } = {
  registry: decodeRegistryPreSchema,
  "run-status": decodeRunStatusPreSchema,
  "phase-status": decodePhaseStatusPreSchema,
  "phax-plan": decodePhaxPlanPreSchema,
  "compliance-review": decodeComplianceReviewPreSchema,
  "plan-approvals": decodePlanApprovalsPreSchema,
  "spec-approvals": decodeSpecApprovalsPreSchema,
  "phase-record-manifest": decodePhaseRecordManifestPreSchema,
  "authoring-record-manifest": decodeAuthoringRecordManifestPreSchema,
  "gate-attribution": decodeGateAttributionPreSchema,
  "phase-file-reconciliation": decodePhaseFileReconciliationPreSchema,
  "gate-diagnostics": decodeGateDiagnosticsPreSchema,
  "gate-pending": decodeGatePendingPreSchema,
  "spec-document": decodeSpecDocumentPreSchema,
  "plan-document": decodePlanDocumentPreSchema,
};

const here = dirname(fileURLToPath(import.meta.url));

function walk(dir: string): Array<{ readonly path: string; readonly directory: boolean }> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory()
      ? [{ path, directory: true }, ...walk(path)]
      : [{ path, directory: false }];
  });
}

describe("the test documents", () => {
  it("have one document per format id, and a pre-schema one per format with a pre-schema shape", () => {
    expect(Object.keys(validDocuments).toSorted()).toEqual([...FORMAT_IDS].toSorted());
    expect(Object.keys(preSchemaDocuments).toSorted()).toEqual(
      [...PRE_SCHEMA_FORMAT_IDS].toSorted(),
    );
  });

  it.each(FORMAT_IDS)("%s: is accepted by phax's own decoder", (id) => {
    const decoded = PHAX_DECODERS[id](validDocuments[id]);
    expect(Either.isRight(decoded), JSON.stringify(Either.isLeft(decoded) && decoded.left)).toBe(
      true,
    );
  });

  it.each(PRE_SCHEMA_FORMAT_IDS)(
    "%s: the pre-schema document is accepted by its frozen decoder",
    (id) => {
      const decoded = FROZEN_DECODERS[id](preSchemaDocuments[id]);
      expect(Either.isRight(decoded), JSON.stringify(Either.isLeft(decoded) && decoded.left)).toBe(
        true,
      );
    },
  );

  it("pre-schema documents carry no $schema", () => {
    for (const document of Object.values(preSchemaDocuments)) {
      expect(Object.hasOwn(document, "$schema")).toBe(false);
    }
  });

  it.each(FORMAT_IDS)(
    "%s: the valid document carries $schema first, at the running release, and no version",
    (id) => {
      const document = validDocuments[id];
      expect(Object.keys(document)[0]).toBe("$schema");
      expect(document["$schema"]).toBe(schemaUrl(id, PHAX_RELEASE));
      expect(Object.hasOwn(document, "version")).toBe(false);
    },
  );

  it("include a version-1 phase record manifest that phax's decoder rejects", () => {
    expect(versionOnePhaseRecordManifest["version"]).toBe(1);
    expect(Object.hasOwn(versionOnePhaseRecordManifest, "verifiedSurfaces")).toBe(false);
    expect(Either.isLeft(decodeRunRecordManifestFile(versionOnePhaseRecordManifest))).toBe(true);
  });

  it("are edited by helpers that return new objects", () => {
    const original = validDocuments["run-status"];
    const changed = withKey(original, "state", "paused");
    const removed = withoutKey(original, "state");
    expect(changed).not.toBe(original);
    expect(changed["state"]).toBe("paused");
    expect(Object.hasOwn(removed, "state")).toBe(false);
    expect(original["state"]).toBe("running");
  });

  it("are never files: the test directory holds no .json file and no fixtures directory", () => {
    const entries = walk(here);
    expect(entries.filter(({ path }) => path.endsWith(".json")).map(({ path }) => path)).toEqual(
      [],
    );
    expect(entries.filter(({ path, directory }) => directory && path.endsWith("fixtures"))).toEqual(
      [],
    );
  });

  it("name no home directory and no phax home", () => {
    const all = [validDocuments, preSchemaDocuments, versionOnePhaseRecordManifest];
    expect(strings(all).length).toBeGreaterThan(0);
    expect(homePaths(all)).toEqual([]);
  });
});
