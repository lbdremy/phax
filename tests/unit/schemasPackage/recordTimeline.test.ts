import { Either, type ParseResult } from "effect";
import { describe, expect, it } from "vitest";
import { CURRENT_SHAPES, PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
import {
  parseDocument,
  parseGateAttribution,
  parseGateDiagnostics,
  parseGateRequest,
  parsePhaseFileReconciliation,
  parseRecordManifest,
  toLatestGateAttribution,
  toLatestGateDiagnostics,
  toLatestGateRequest,
  toLatestPhaseFileReconciliation,
  type LatestGateDiagnostics,
} from "../../../packages/schemas/src/index.js";
import { missingSchemaMessage, newerReleaseMessage } from "../../../packages/schemas/src/shapes.js";
import { decodeGateAttributionFile } from "../../../src/schemas/gateAttribution.js";
import { decodeGateDiagnosticsFile } from "../../../src/schemas/gateDiagnostics.js";
import { decodeGateRequestFile } from "../../../src/schemas/gateRequest.js";
import { decodePhaseFileReconciliationFile } from "../../../src/schemas/reconciliation.js";
import {
  schemaUrl,
  type FormatId,
  type PreSchemaFormatId,
} from "../../../src/schemas/schemaUrl.js";
import {
  belowOwnReleaseMessage,
  preSchemaDocuments,
  validDocuments,
  withKey,
  withoutKey,
  type Doc,
} from "./documents.js";

type Decode = (input: unknown) => Either.Either<unknown, ParseResult.ParseError>;
type Parse = (input: unknown) => {
  readonly ok: boolean;
  readonly shape?: string;
  readonly value?: unknown;
};

// Derived from the package version, so a release bump never breaks these tests.
const NEWER_RELEASE = `${Number(PACKAGE_VERSION.split(".")[0]) + 1}.0.0`;

interface TimelineFormat {
  readonly id: PreSchemaFormatId;
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
    phax: decodeGateDiagnosticsFile,
    toLatest: toLatestGateDiagnostics,
  },
];

describe.each(FORMATS)("$id", (format) => {
  const preSchema = preSchemaDocuments[format.id];
  const written = validDocuments[format.id];

  it("parses a document without $schema as shape pre-schema", () => {
    expect(format.parse(preSchema)).toEqual({ ok: true, shape: "pre-schema", value: preSchema });
  });

  it("reads a pre-schema document carrying a version key as pre-schema", () => {
    const versioned = withKey(preSchema, "version", 0);
    expect(format.parse(versioned)).toMatchObject({ ok: true, shape: "pre-schema" });
  });

  it("parses a phax-written document as its current shape, with phax's value", () => {
    expect(Object.keys(written)[0]).toBe("$schema");
    expect(written).not.toHaveProperty("version");
    const phax = format.phax(written);
    if (Either.isLeft(phax)) throw new Error("document rejected by phax");
    expect(format.parse(written)).toEqual({
      ok: true,
      shape: CURRENT_SHAPES[format.id],
      value: phax.right,
    });
  });

  it("upgrades either shape to the same value: the identity on pre-schema, without $schema on the current shape", () => {
    const pre = format.parse(preSchema);
    const current = format.parse(written);
    if (!pre.ok || !current.ok) throw new Error("document rejected");
    expect(format.toLatest(pre.value as never)).toBe(pre.value);
    expect(format.toLatest(current.value as never)).toEqual(pre.value);
    expect(format.toLatest(current.value as never)).not.toHaveProperty("$schema");
  });

  it("fails a document written by a newer release with the upgrade message", () => {
    const newer = withKey(written, "$schema", schemaUrl(format.id, NEWER_RELEASE));
    const message = newerReleaseMessage(format.id, NEWER_RELEASE, PACKAGE_VERSION);
    for (const result of [format.parse(newer), parseDocument(newer)]) {
      expect(result).toEqual({ ok: false, error: { path: "$schema", message } });
    }
  });

  it("reads no shape below the package's own release", () => {
    const older = withKey(written, "$schema", schemaUrl(format.id, "0.1.0"));
    expect(format.parse(older)).toEqual({
      ok: false,
      error: { path: "$schema", message: belowOwnReleaseMessage(format.id, "0.1.0") },
    });
  });
});

// The acceptance criterion: a record's timeline files parse. The same folder
// is written twice, its files listed out of order: by hand in the pre-schema
// shapes, and as phax writes it today.
type Folder = { readonly [name: string]: Doc };

function folder(documents: { readonly [F in PreSchemaFormatId]: Doc }): Folder {
  return {
    "checks-attempt-02.diagnostics.json": documents["gate-diagnostics"],
    "record.json": documents["phase-record-manifest"],
    "file-reconciliation.json": documents["phase-file-reconciliation"],
    "checks-attempt-01.diagnostics.json": documents["gate-diagnostics"],
    "gate-attribution.json": documents["gate-attribution"],
  };
}

const RECORD_FOLDERS: ReadonlyArray<{
  readonly written: string;
  readonly shapes: string;
  readonly shape: (id: FormatId) => string;
  readonly files: Folder;
}> = [
  {
    written: "by hand in the pre-schema shapes",
    shapes: "pre-schema",
    shape: () => "pre-schema",
    files: folder(preSchemaDocuments),
  },
  {
    written: "by phax",
    shapes: "their current shapes",
    shape: (id) => CURRENT_SHAPES[id],
    files: folder(validDocuments),
  },
];

describe.each(RECORD_FOLDERS)(
  "a record's timeline files written $written",
  ({ shapes, shape, files }) => {
    const contents: ReadonlyMap<string, string> = new Map(
      Object.entries(files).map(([name, document]) => [
        name,
        `${JSON.stringify(document, null, 2)}\n`,
      ]),
    );

    function read(name: string): unknown {
      const content = contents.get(name);
      if (content === undefined) throw new Error(`no ${name} in the record folder`);
      return JSON.parse(content);
    }

    it(`parse, each with its own function, as ${shapes}`, () => {
      const record = parseRecordManifest(read("record.json"));
      expect(record).toMatchObject({
        ok: true,
        format: "phase-record-manifest",
        shape: shape("phase-record-manifest"),
      });

      const attribution = parseGateAttribution(read("gate-attribution.json"));
      const reconciliation = parsePhaseFileReconciliation(read("file-reconciliation.json"));
      expect(attribution).toMatchObject({ ok: true, shape: shape("gate-attribution") });
      expect(reconciliation).toMatchObject({
        ok: true,
        shape: shape("phase-file-reconciliation"),
      });
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
        readonly diagnostics: LatestGateDiagnostics;
      }> = [];
      for (const name of contents.keys()) {
        const match = /^checks-attempt-(\d+)\.diagnostics\.json$/.exec(name);
        if (match === null) continue;
        const result = parseGateDiagnostics(read(name));
        expect(result, name).toMatchObject({ ok: true, shape: shape("gate-diagnostics") });
        if (result.ok) {
          attempts.push({
            attempt: Number(match[1]),
            diagnostics: toLatestGateDiagnostics(result.value),
          });
        }
      }
      const ordered = attempts.toSorted((a, b) => a.attempt - b.attempt);
      expect(ordered.map(({ attempt }) => attempt)).toEqual([1, 2]);
      for (const { diagnostics } of ordered) {
        expect(diagnostics.diagnostics.map((entry) => entry.class)).toEqual(["invariant"]);
      }
    });
  },
);

// An attempt's gate request is born with $schema: no pre-schema shape, and
// any key beyond its five is refused, as phax's decoder does.
describe("gate-request, born with $schema", () => {
  const document = validDocuments["gate-request"];
  const current = CURRENT_SHAPES["gate-request"];

  it("parses the document phax writes as its current shape, with phax's value", () => {
    expect(Object.keys(document)).toEqual(["$schema", "phase", "base", "terminal", "phases"]);
    const phax = decodeGateRequestFile(document);
    if (Either.isLeft(phax)) throw new Error("document rejected by phax");
    expect(parseGateRequest(document)).toEqual({ ok: true, shape: current, value: phax.right });
  });

  it("is identified by parseDocument from its $schema", () => {
    expect(parseDocument(document)).toMatchObject({
      ok: true,
      format: "gate-request",
      shape: current,
    });
  });

  it("fails a document without $schema at $schema", () => {
    expect(parseGateRequest(withoutKey(document, "$schema"))).toMatchObject({
      ok: false,
      error: { path: "$schema", message: missingSchemaMessage("gate request") },
    });
  });

  it("rejects an extra key, as phax's strict decoder does", () => {
    const extra = withKey(document, "touched", ["src/example.ts"]);
    expect(parseGateRequest(extra).ok).toBe(false);
    expect(Either.isLeft(decodeGateRequestFile(extra))).toBe(true);
  });

  it("drops $schema on upgrade and keeps every other key", () => {
    const result = parseGateRequest(document);
    if (!result.ok) throw new Error("document rejected");
    expect(toLatestGateRequest(result.value)).toEqual(withoutKey(document, "$schema"));
  });

  it("fails a document written by a newer release with the upgrade message", () => {
    const newer = withKey(document, "$schema", schemaUrl("gate-request", NEWER_RELEASE));
    const message = newerReleaseMessage("gate-request", NEWER_RELEASE, PACKAGE_VERSION);
    for (const result of [parseGateRequest(newer), parseDocument(newer)]) {
      expect(result).toEqual({ ok: false, error: { path: "$schema", message } });
    }
  });
});

it("a phax-written timeline file without its $schema is the pre-schema shape", () => {
  for (const { id, parse } of FORMATS) {
    expect(parse(withoutKey(validDocuments[id], "$schema")), id).toMatchObject({
      ok: true,
      shape: "pre-schema",
    });
  }
});
