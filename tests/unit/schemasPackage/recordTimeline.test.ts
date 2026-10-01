import { Either, type ParseResult } from "effect";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
import {
  parseDocument,
  parseGateAttribution,
  parseGateDiagnostics,
  parseGatePending,
  parsePhaseFileReconciliation,
  parseRecordManifest,
  toLatestGateAttribution,
  toLatestGateDiagnostics,
  toLatestGatePending,
  toLatestPhaseFileReconciliation,
  type GateDiagnostics,
  type GatePending,
} from "../../../packages/schemas/src/index.js";
import { newerReleaseMessage } from "../../../packages/schemas/src/shapes.js";
import { decodeGateAttributionFile } from "../../../src/schemas/gateAttribution.js";
import { decodeGateDiagnosticsDocument } from "../../../src/schemas/gateDiagnostics.js";
import { decodeGatePendingFile } from "../../../src/schemas/gatePending.js";
import { decodePhaseFileReconciliationFile } from "../../../src/schemas/reconciliation.js";
import { schemaUrl, type FormatId } from "../../../src/schemas/schemaUrl.js";
import { validDocuments, withKey } from "./documents.js";

type Decode = (input: unknown) => Either.Either<unknown, ParseResult.ParseError>;
type Parse = (input: unknown) => {
  readonly ok: boolean;
  readonly shape?: string;
  readonly value?: unknown;
};

// Derived from the package version, so a release bump never breaks these tests.
const NEWER_RELEASE = `${Number(PACKAGE_VERSION.split(".")[0]) + 1}.0.0`;

interface TimelineFormat {
  readonly id: FormatId;
  readonly parse: Parse;
  readonly phax: Decode;
  readonly toLatest: (value: never) => unknown;
}

const FORMATS: ReadonlyArray<TimelineFormat> = [
  {
    id: "gate-attribution",
    parse: parseGateAttribution,
    phax: decodeGateAttributionFile,
    toLatest: toLatestGateAttribution,
  },
  {
    id: "phase-file-reconciliation",
    parse: parsePhaseFileReconciliation,
    phax: decodePhaseFileReconciliationFile,
    toLatest: toLatestPhaseFileReconciliation,
  },
  {
    id: "gate-diagnostics",
    parse: parseGateDiagnostics,
    phax: decodeGateDiagnosticsDocument,
    toLatest: toLatestGateDiagnostics,
  },
  {
    id: "gate-pending",
    parse: parseGatePending,
    phax: decodeGatePendingFile,
    toLatest: toLatestGatePending,
  },
];

describe.each(FORMATS)("$id", (format) => {
  const document = validDocuments[format.id];

  it("parses the document as shape pre-schema, with phax's value", () => {
    const phax = format.phax(document);
    if (Either.isLeft(phax)) throw new Error("document rejected by phax");
    expect(format.parse(document)).toEqual({ ok: true, shape: "pre-schema", value: phax.right });
  });

  it("reads a document carrying a version key as pre-schema, as phax's decoder does", () => {
    const versioned = withKey(document, "version", 0);
    expect(Either.isRight(format.phax(versioned))).toBe(true);
    expect(format.parse(versioned)).toMatchObject({ ok: true, shape: "pre-schema" });
  });

  it("upgrades by the identity: the pre-schema shape carries no version", () => {
    const result = format.parse(document);
    if (!result.ok) throw new Error("document rejected");
    expect(format.toLatest(result.value as never)).toBe(result.value);
  });

  it("fails a document written by a newer release with the upgrade message", () => {
    const newer = withKey(document, "$schema", schemaUrl(format.id, NEWER_RELEASE));
    const message = newerReleaseMessage(format.id, NEWER_RELEASE, PACKAGE_VERSION);
    for (const result of [format.parse(newer), parseDocument(newer)]) {
      expect(result).toEqual({ ok: false, error: { path: "$schema", message } });
    }
  });

  it("reads a document naming the package's own release as next, with phax's decoder", () => {
    const own = withKey(document, "$schema", schemaUrl(format.id, PACKAGE_VERSION));
    const phax = format.phax(own);
    if (Either.isLeft(phax)) throw new Error("document rejected by phax");
    expect(format.parse(own)).toEqual({ ok: true, shape: "next", value: phax.right });
  });

  it("names no shape below the package's own release", () => {
    const older = withKey(document, "$schema", schemaUrl(format.id, "0.1.0"));
    expect(format.parse(older)).toEqual({
      ok: false,
      error: { path: "$schema", message: `no ${format.id} shape is known at release 0.1.0` },
    });
  });
});

// The acceptance criterion: a record's timeline files parse. The folder is
// written here in pre-schema shapes, its files listed out of order.
const RECORD_FOLDER: ReadonlyMap<string, string> = new Map(
  Object.entries({
    "checks-attempt-02.pending.json": validDocuments["gate-pending"],
    "record.json": validDocuments["phase-record-manifest"],
    "file-reconciliation.json": validDocuments["phase-file-reconciliation"],
    "checks-attempt-01.diagnostics.json": validDocuments["gate-diagnostics"],
    "gate-attribution.json": validDocuments["gate-attribution"],
  }).map(([name, document]) => [name, `${JSON.stringify(document, null, 2)}\n`]),
);

function read(name: string): unknown {
  const content = RECORD_FOLDER.get(name);
  if (content === undefined) throw new Error(`no ${name} in the record folder`);
  return JSON.parse(content);
}

describe("a record's timeline files", () => {
  it("parse, each with its own function, as shape pre-schema", () => {
    const record = parseRecordManifest(read("record.json"));
    expect(record).toMatchObject({
      ok: true,
      format: "phase-record-manifest",
      shape: "pre-schema",
    });

    const attribution = parseGateAttribution(read("gate-attribution.json"));
    const reconciliation = parsePhaseFileReconciliation(read("file-reconciliation.json"));
    expect(attribution).toMatchObject({ ok: true, shape: "pre-schema" });
    expect(reconciliation).toMatchObject({ ok: true, shape: "pre-schema" });
    if (!record.ok || record.format !== "phase-record-manifest") return;
    if (!attribution.ok || !reconciliation.ok) return;

    // One phase: the manifest, its gate steps and its reconciliation agree on it.
    const { phaseId } = record.value;
    expect(attribution.value.phase).toBe(phaseId);
    expect(reconciliation.value.phaseId).toBe(phaseId);
  });

  it("orders the fix-loop attempts by the numbers in their file names", () => {
    const attempts: Array<{
      readonly attempt: number;
      readonly diagnostics?: GateDiagnostics;
      readonly pending?: GatePending;
    }> = [];
    for (const name of RECORD_FOLDER.keys()) {
      const match = /^checks-attempt-(\d+)\.(diagnostics|pending)\.json$/.exec(name);
      if (match === null) continue;
      const attempt = Number(match[1]);
      if (match[2] === "diagnostics") {
        const result = parseGateDiagnostics(read(name));
        expect(result, name).toMatchObject({ ok: true, shape: "pre-schema" });
        if (result.ok) attempts.push({ attempt, diagnostics: result.value });
      } else {
        const result = parseGatePending(read(name));
        expect(result, name).toMatchObject({ ok: true, shape: "pre-schema" });
        if (result.ok) attempts.push({ attempt, pending: result.value });
      }
    }
    const ordered = attempts.toSorted((a, b) => a.attempt - b.attempt);
    expect(ordered.map(({ attempt }) => attempt)).toEqual([1, 2]);
    expect(ordered[0]?.diagnostics?.diagnostics.map((entry) => entry.class)).toEqual([
      "invariant",
      "completion",
    ]);
    expect(ordered[1]?.pending?.steps[0]?.pending[0]?.openScopes).toEqual(["phase-02"]);
  });
});
