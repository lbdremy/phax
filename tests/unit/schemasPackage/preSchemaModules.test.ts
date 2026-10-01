import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Either, ParseResult, type Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  JSON_SCHEMA_FORMATS,
  renderJsonSchemas,
} from "../../../packages/schemas/build/jsonSchemas.js";
import {
  parseAuthoringRecordManifest,
  parseComplianceReview,
  parseGateAttribution,
  parseGateDiagnostics,
  parseGatePending,
  parsePhaseFileReconciliation,
  parsePhaseRecordManifest,
  parsePhaseStatus,
  parsePhaxPlan,
  parsePlanApprovals,
  parsePlanDocument,
  parseRegistry,
  parseRunStatus,
  parseSpecApprovals,
  parseSpecDocument,
} from "../../../packages/schemas/src/index.js";
import type { ParseFailure } from "../../../packages/schemas/src/parsed.js";
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
import { preSchemaDocuments, withKey, withoutKey } from "./documents.js";

interface FrozenModule {
  readonly schema: Schema.Schema.Any;
  readonly decode: (input: unknown) => Either.Either<unknown, ParseResult.ParseError>;
  readonly parse: (input: unknown) => { readonly ok: true; readonly shape: string } | ParseFailure;
}

/** Each format's frozen module, and the package parse function that reads it. */
const FROZEN: { readonly [F in FormatId]: FrozenModule } = {
  registry: {
    schema: registry.RegistryPreSchemaSchema,
    decode: registry.decodeRegistryPreSchema,
    parse: parseRegistry,
  },
  "run-status": {
    schema: runStatus.RunStatusPreSchemaSchema,
    decode: runStatus.decodeRunStatusPreSchema,
    parse: parseRunStatus,
  },
  "phase-status": {
    schema: phaseStatus.PhaseStatusPreSchemaSchema,
    decode: phaseStatus.decodePhaseStatusPreSchema,
    parse: parsePhaseStatus,
  },
  "phax-plan": {
    schema: phaxPlan.PhaxPlanPreSchemaSchema,
    decode: phaxPlan.decodePhaxPlanPreSchema,
    parse: parsePhaxPlan,
  },
  "compliance-review": {
    schema: complianceReview.ComplianceReviewPreSchemaSchema,
    decode: complianceReview.decodeComplianceReviewPreSchema,
    parse: parseComplianceReview,
  },
  "plan-approvals": {
    schema: planApprovals.PlanApprovalsPreSchemaSchema,
    decode: planApprovals.decodePlanApprovalsPreSchema,
    parse: parsePlanApprovals,
  },
  "spec-approvals": {
    schema: specApprovals.SpecApprovalsPreSchemaSchema,
    decode: specApprovals.decodeSpecApprovalsPreSchema,
    parse: parseSpecApprovals,
  },
  "phase-record-manifest": {
    schema: phaseRecordManifest.PhaseRecordManifestPreSchemaSchema,
    decode: phaseRecordManifest.decodePhaseRecordManifestPreSchema,
    parse: parsePhaseRecordManifest,
  },
  "authoring-record-manifest": {
    schema: authoringRecordManifest.AuthoringRecordManifestPreSchemaSchema,
    decode: authoringRecordManifest.decodeAuthoringRecordManifestPreSchema,
    parse: parseAuthoringRecordManifest,
  },
  "gate-attribution": {
    schema: gateAttribution.GateAttributionPreSchemaSchema,
    decode: gateAttribution.decodeGateAttributionPreSchema,
    parse: parseGateAttribution,
  },
  "phase-file-reconciliation": {
    schema: phaseFileReconciliation.PhaseFileReconciliationPreSchemaSchema,
    decode: phaseFileReconciliation.decodePhaseFileReconciliationPreSchema,
    parse: parsePhaseFileReconciliation,
  },
  "gate-diagnostics": {
    schema: gateDiagnostics.GateDiagnosticsPreSchemaSchema,
    decode: gateDiagnostics.decodeGateDiagnosticsPreSchema,
    parse: parseGateDiagnostics,
  },
  "gate-pending": {
    schema: gatePending.GatePendingPreSchemaSchema,
    decode: gatePending.decodeGatePendingPreSchema,
    parse: parseGatePending,
  },
  "spec-document": {
    schema: specDocument.SpecDocumentPreSchemaSchema,
    decode: specDocument.decodeSpecDocumentPreSchema,
    parse: parseSpecDocument,
  },
  "plan-document": {
    schema: planDocument.PlanDocumentPreSchemaSchema,
    decode: planDocument.decodePlanDocumentPreSchema,
    parse: parsePlanDocument,
  },
};

const MODULES = {
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
} satisfies { readonly [F in FormatId]: object };

const snapshotsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "schemas",
  "snapshots",
);

function tableEntry(id: FormatId) {
  const entry = JSON_SCHEMA_FORMATS.find((format) => format.format === id);
  if (entry === undefined) throw new Error(`no JSON Schema table entry for ${id}`);
  return entry;
}

function pascal(id: FormatId): string {
  return id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/** The path of a decoder's first violation, joined with `.`. */
function firstViolationPath(result: Either.Either<unknown, ParseResult.ParseError>): string {
  if (Either.isRight(result)) throw new Error("expected the frozen decoder to reject");
  const [first] = ParseResult.ArrayFormatter.formatErrorSync(result.left);
  return first === undefined ? "" : first.path.map(String).join(".");
}

describe("the frozen pre-schema modules", () => {
  it.each(FORMAT_IDS)("%s: exports exactly its schema and its Either decoder at runtime", (id) => {
    expect(Object.keys(MODULES[id]).toSorted()).toEqual(
      [`${pascal(id)}PreSchemaSchema`, `decode${pascal(id)}PreSchema`].toSorted(),
    );
  });

  it.each(FORMAT_IDS)("%s: renders the committed pre-schema snapshot", (id) => {
    const entry = tableEntry(id);
    const { files, failures } = renderJsonSchemas([{ ...entry, schema: FROZEN[id].schema }]);
    expect(failures).toEqual([]);
    const rendered = files.get(entry.fileName);
    expect(rendered).toBeDefined();
    const snapshot = readFileSync(join(snapshotsDir, id, "pre-schema.schema.json"), "utf8");
    expect(JSON.parse(rendered ?? "null")).toEqual(JSON.parse(snapshot));
  });

  it.each(FORMAT_IDS)("%s: the package reads its pre-schema document as pre-schema", (id) => {
    expect(FROZEN[id].parse(preSchemaDocuments[id])).toMatchObject({
      ok: true,
      shape: "pre-schema",
    });
  });

  it.each(FORMAT_IDS)("%s: the frozen decoder rejects a wrong type at its key", (id) => {
    const document = preSchemaDocuments[id];
    const [key] = Object.keys(document);
    if (key === undefined) throw new Error(`${id}: empty test document`);
    const wrong = typeof document[key] === "string" ? 42 : "wrong";
    expect(firstViolationPath(FROZEN[id].decode(withKey(document, key, wrong)))).toBe(key);
  });

  it.each(FORMAT_IDS)("%s: the frozen decoder rejects a missing required key", (id) => {
    const document = preSchemaDocuments[id];
    const [key] = Object.keys(document);
    if (key === undefined) throw new Error(`${id}: empty test document`);
    expect(firstViolationPath(FROZEN[id].decode(withoutKey(document, key)))).toBe(key);
  });

  it.each(FORMAT_IDS)("%s: the frozen decoder treats an unknown key as phax did", (id) => {
    const extra = withKey(preSchemaDocuments[id], "unexpectedKey", true);
    if (tableEntry(id).excess === "error") {
      expect(firstViolationPath(FROZEN[id].decode(extra))).toBe("unexpectedKey");
    } else {
      expect(Either.isRight(FROZEN[id].decode(extra))).toBe(true);
    }
  });
});
