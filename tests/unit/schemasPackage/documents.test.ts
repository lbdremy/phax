import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Either, type ParseResult } from "effect";
import { describe, expect, it } from "vitest";
import { decodeApprovalRecordFile } from "../../../src/schemas/approvalRecord.js";
import { decodeAuthoringRecordManifest } from "../../../src/schemas/authoringRecord.js";
import { decodeComplianceReview } from "../../../src/schemas/complianceReview.js";
import { decodeGateAttribution } from "../../../src/schemas/gateAttribution.js";
import { decodeGateDiagnosticsDocument } from "../../../src/schemas/gateDiagnostics.js";
import { decodeGatePendingDocument } from "../../../src/schemas/gatePending.js";
import { decodePhaxPlan } from "../../../src/schemas/phaxPlan.js";
import { decodePlanDocument } from "../../../src/schemas/planDocument.js";
import { decodePhaseFileReconciliation } from "../../../src/schemas/reconciliation.js";
import { decodeRegistry } from "../../../src/schemas/registry.js";
import { decodeRunRecordManifest } from "../../../src/schemas/runRecord.js";
import { FORMAT_IDS, type FormatId } from "../../../src/schemas/schemaUrl.js";
import { decodeSpecApprovalRecordFile } from "../../../src/schemas/specApprovalRecord.js";
import { decodeSpecDocument } from "../../../src/schemas/specDocument.js";
import { decodePhaseStatus, decodeRunStatus } from "../../../src/schemas/status.js";
import { validDocuments, versionOnePhaseRecordManifest, withKey, withoutKey } from "./documents.js";

type Decode = (input: unknown) => Either.Either<unknown, ParseResult.ParseError>;

/** phax's own decoder for each format. */
const PHAX_DECODERS: { readonly [F in FormatId]: Decode } = {
  registry: decodeRegistry,
  "run-status": decodeRunStatus,
  "phase-status": decodePhaseStatus,
  "phax-plan": decodePhaxPlan,
  "compliance-review": decodeComplianceReview,
  "plan-approvals": decodeApprovalRecordFile,
  "spec-approvals": decodeSpecApprovalRecordFile,
  "phase-record-manifest": decodeRunRecordManifest,
  "authoring-record-manifest": decodeAuthoringRecordManifest,
  "gate-attribution": decodeGateAttribution,
  "phase-file-reconciliation": decodePhaseFileReconciliation,
  "gate-diagnostics": decodeGateDiagnosticsDocument,
  "gate-pending": decodeGatePendingDocument,
  "spec-document": decodeSpecDocument,
  "plan-document": decodePlanDocument,
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

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, entry]) => [key, ...strings(entry)]);
  }
  return [];
}

describe("the test documents", () => {
  it("have one document per format id", () => {
    expect(Object.keys(validDocuments).toSorted()).toEqual([...FORMAT_IDS].toSorted());
  });

  it.each(FORMAT_IDS)("%s: is accepted by phax's own decoder", (id) => {
    const decoded = PHAX_DECODERS[id](validDocuments[id]);
    expect(Either.isRight(decoded), JSON.stringify(Either.isLeft(decoded) && decoded.left)).toBe(
      true,
    );
  });

  it("carry no $schema: every one is a pre-schema document", () => {
    for (const document of Object.values(validDocuments)) {
      expect(Object.hasOwn(document, "$schema")).toBe(false);
    }
  });

  it("include a version-1 phase record manifest that phax's decoder rejects", () => {
    expect(versionOnePhaseRecordManifest["version"]).toBe(1);
    expect(Object.hasOwn(versionOnePhaseRecordManifest, "verifiedSurfaces")).toBe(false);
    expect(Either.isLeft(decodeRunRecordManifest(versionOnePhaseRecordManifest))).toBe(true);
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
    const all = strings([validDocuments, versionOnePhaseRecordManifest]);
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((text) => /\/Users\/|\/home\/|~\/\.phax/.test(text))).toEqual([]);
  });
});
