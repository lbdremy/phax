import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Either, JSONSchema, type ParseResult, type Schema } from "effect";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
import {
  GateAttributionV0Schema,
  decodeGateAttributionV0,
} from "../../../packages/schemas/src/history/gate-attribution/v0.js";
import {
  GateDiagnosticsV0Schema,
  decodeGateDiagnosticsV0,
} from "../../../packages/schemas/src/history/gate-diagnostics/v0.js";
import {
  GatePendingV0Schema,
  decodeGatePendingV0,
} from "../../../packages/schemas/src/history/gate-pending/v0.js";
import { decodePhaseFileReconciliationV0 } from "../../../packages/schemas/src/history/phase-file-reconciliation/v0.js";
import {
  UNKNOWN,
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
import {
  GateAttributionSchema,
  decodeGateAttribution,
} from "../../../src/schemas/gateAttribution.js";
import {
  GateDiagnosticsDocumentSchema,
  decodeGateDiagnosticsDocument,
} from "../../../src/schemas/gateDiagnostics.js";
import {
  GatePendingDocumentSchema,
  decodeGatePendingDocument,
} from "../../../src/schemas/gatePending.js";
import { decodePhaseFileReconciliation } from "../../../src/schemas/reconciliation.js";
import { schemaUrl, type FormatId } from "../../../src/schemas/schemaUrl.js";
import { keySignature, readSurveyedFixtures, surveyGroups } from "./surveyedFixtures.js";

type Decode = (input: unknown) => Either.Either<unknown, ParseResult.ParseError>;
type Parse = (input: unknown) => {
  readonly ok: boolean;
  readonly shape?: string;
  readonly value?: unknown;
  readonly error?: { readonly path: string };
};

// Derived from the package version, so a release bump never breaks these tests.
const NEWER_RELEASE = `${Number(PACKAGE_VERSION.split(".")[0]) + 1}.0.0`;

// No diagnostics or pending document exists anywhere yet, so the tests write
// one fix loop's worth: attempt 01 fails on an invariant and a completion
// diagnostic, attempt 02 keeps the completion diagnostic pending.
const completion = {
  class: "completion",
  scopes: ["phase-02"],
  rule: "planned-file-missing",
  location: { file: "src/domain/timeline.ts" },
  message: "the planned file src/domain/timeline.ts does not exist yet",
  repair: "create src/domain/timeline.ts, as phase-02 plans",
} as const;

const invariant = {
  class: "invariant",
  rule: "no-io-in-domain",
  location: { file: "src/domain/record.ts", line: 12 },
  message: "src/domain/record.ts imports node:fs",
  repair: "read the file through the fs port",
} as const;

const ATTEMPT_FILES: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  // Listed out of order: the reader orders attempts by their file names.
  ["checks-attempt-02.diagnostics.json", { diagnostics: [completion] }],
  ["checks-attempt-01.diagnostics.json", { diagnostics: [invariant, completion] }],
  [
    "checks-attempt-02.pending.json",
    {
      closed: ["phase-01"],
      steps: [
        { command: "pnpm test", pending: [{ diagnostic: completion, openScopes: ["phase-02"] }] },
      ],
    },
  ],
]);

const writtenDiagnostics = ATTEMPT_FILES.get("checks-attempt-01.diagnostics.json");
const writtenPending = ATTEMPT_FILES.get("checks-attempt-02.pending.json");

interface TimelineFormat {
  readonly id: FormatId;
  readonly parse: Parse;
  readonly phax: Decode;
  readonly frozen: Decode;
  /** Real documents keyed by signature, or the test-written ones when none exists. */
  readonly documents: ReadonlyArray<{ readonly signature: string; readonly document: unknown }>;
  /** Set for the formats with one signature, whose frozen module is an exact twin. */
  readonly twin?: { readonly frozen: Schema.Schema.Any; readonly phax: Schema.Schema.Any };
}

const FORMATS: ReadonlyArray<TimelineFormat> = [
  {
    id: "gate-attribution",
    parse: parseGateAttribution,
    phax: decodeGateAttribution,
    frozen: decodeGateAttributionV0,
    documents: readSurveyedFixtures("gate-attribution", "v0"),
    twin: { frozen: GateAttributionV0Schema, phax: GateAttributionSchema },
  },
  {
    id: "phase-file-reconciliation",
    parse: parsePhaseFileReconciliation,
    phax: decodePhaseFileReconciliation,
    frozen: decodePhaseFileReconciliationV0,
    documents: readSurveyedFixtures("phase-file-reconciliation", "v0"),
  },
  {
    id: "gate-diagnostics",
    parse: parseGateDiagnostics,
    phax: decodeGateDiagnosticsDocument,
    frozen: decodeGateDiagnosticsV0,
    documents: [...ATTEMPT_FILES]
      .filter(([name]) => name.endsWith(".diagnostics.json"))
      .map(([signature, document]) => ({ signature, document })),
    twin: { frozen: GateDiagnosticsV0Schema, phax: GateDiagnosticsDocumentSchema },
  },
  {
    id: "gate-pending",
    parse: parseGatePending,
    phax: decodeGatePendingDocument,
    frozen: decodeGatePendingV0,
    documents: [{ signature: "checks-attempt-02.pending.json", document: writtenPending }],
    twin: { frozen: GatePendingV0Schema, phax: GatePendingDocumentSchema },
  },
];

const SURVEYED = FORMATS.filter(({ id }) => surveyGroups(id).length > 0);

describe.each(SURVEYED)("$id: the surveyed signatures", (format) => {
  const groups = surveyGroups(format.id);

  it("has one real document per surveyed signature, keyed by that signature", () => {
    expect(format.documents.map(({ signature }) => signature).toSorted()).toEqual(
      groups.map(({ keys }) => keys).toSorted(),
    );
    for (const { signature, document } of format.documents) {
      expect(keySignature(document)).toBe(signature);
    }
  });

  it("gets phax's verdict on each fixture: rejected exactly when its group was", () => {
    for (const { signature, document } of format.documents) {
      const group = groups.find(({ keys }) => keys === signature);
      expect(Either.isLeft(format.phax(document)), signature).toBe((group?.rejected ?? 0) > 0);
    }
  });
});

describe("gate diagnostics and gate pending", () => {
  it("have no surveyed document, so the tests write theirs", () => {
    expect(surveyGroups("gate-diagnostics")).toEqual([]);
    expect(surveyGroups("gate-pending")).toEqual([]);
    expect(SURVEYED.map(({ id }) => id)).toEqual(["gate-attribution", "phase-file-reconciliation"]);
  });

  it("parse the written invariant and completion diagnostics as v0, with phax's value", () => {
    const diagnostics = parseGateDiagnostics(writtenDiagnostics);
    expect(diagnostics).toEqual({ ok: true, shape: "v0", value: writtenDiagnostics });
    if (diagnostics.ok) {
      expect(diagnostics.value.diagnostics.map((entry) => entry.class)).toEqual([
        "invariant",
        "completion",
      ]);
    }
    expect(parseGatePending(writtenPending)).toEqual({
      ok: true,
      shape: "v0",
      value: writtenPending,
    });
  });
});

describe.each(FORMATS)("$id", (format) => {
  const accepted = format.documents.filter(({ document }) => Either.isRight(format.phax(document)));

  it("parses every document as shape v0, with phax's value whenever phax accepts it", () => {
    for (const { signature, document } of format.documents) {
      const result = format.parse(document);
      expect(result, signature).toMatchObject({ ok: true, shape: "v0" });
      const phax = format.phax(document);
      if (Either.isRight(phax)) expect(result.value, signature).toEqual(phax.right);
    }
  });

  it("has a frozen v0 module that gives phax's value on every document phax accepts", () => {
    expect(accepted.length).toBeGreaterThan(0);
    for (const { signature, document } of accepted) {
      const frozen = format.frozen(document);
      const phax = format.phax(document);
      expect(Either.isRight(frozen), signature).toBe(true);
      if (Either.isRight(frozen) && Either.isRight(phax)) {
        expect(frozen.right, signature).toEqual(phax.right);
      }
    }
  });

  it("fails a document written by a newer release with the upgrade message", () => {
    const [first] = format.documents;
    const document = {
      ...(first?.document as object),
      $schema: schemaUrl(format.id, NEWER_RELEASE),
    };
    const message = newerReleaseMessage(format.id, NEWER_RELEASE, PACKAGE_VERSION);
    for (const result of [format.parse(document), parseDocument(document)]) {
      expect(result).toEqual({ ok: false, error: { path: "$schema", message } });
    }
  });

  it("fails version: 0, which is never a known literal", () => {
    const [first] = format.documents;
    const result = format.parse({ ...(first?.document as object), version: 0 });
    expect(result.ok).toBe(false);
    expect(result.error?.path).toBe("version");
  });
});

describe("a single-signature timeline format's frozen v0 twin", () => {
  const twins = FORMATS.flatMap(({ id, twin }) => (twin === undefined ? [] : [{ id, ...twin }]));

  it("exists for exactly the gate attribution, the gate diagnostics and the gate pending", () => {
    expect(twins.map(({ id }) => id)).toEqual([
      "gate-attribution",
      "gate-diagnostics",
      "gate-pending",
    ]);
  });

  it.each(twins)("$id: has the same JSON Schema as phax's", ({ frozen, phax }) => {
    expect(JSONSchema.make(frozen)).toEqual(JSONSchema.make(phax));
  });
});

describe("toLatest", () => {
  it("phase-file-reconciliation: marks phaseId and the two mismatch lists unknown only when absent", () => {
    const facts = ["phaseId", "createdButPlannedEdit", "editedButPlannedCreate"] as const;
    const absent = { phaseId: 0, createdButPlannedEdit: 0, editedButPlannedCreate: 0 };
    for (const { signature, document } of readSurveyedFixtures("phase-file-reconciliation", "v0")) {
      const result = parsePhaseFileReconciliation(document);
      if (!result.ok) throw new Error("fixture rejected");
      const latest = toLatestPhaseFileReconciliation(result.value);
      const recorded = result.value as Readonly<Record<string, unknown>>;
      const marked: Record<string, unknown> = {};
      for (const fact of facts) {
        if (recorded[fact] === undefined) {
          absent[fact]++;
          marked[fact] = UNKNOWN;
        }
      }
      expect(latest, signature).toEqual({ ...recorded, ...marked });
      expect(Object.keys(latest).toSorted(), signature).toEqual(
        [...new Set([...Object.keys(recorded), ...facts])].toSorted(),
      );
    }
    expect(absent).toEqual({ phaseId: 1, createdButPlannedEdit: 3, editedButPlannedCreate: 3 });
  });

  it("gate attribution, diagnostics and pending: the identity on the current shape", () => {
    for (const { document } of readSurveyedFixtures("gate-attribution", "v0")) {
      const result = parseGateAttribution(document);
      if (!result.ok) throw new Error("fixture rejected");
      expect(toLatestGateAttribution(result.value)).toEqual(document);
    }
    const diagnostics = parseGateDiagnostics(writtenDiagnostics);
    const pending = parseGatePending(writtenPending);
    if (!diagnostics.ok || !pending.ok) throw new Error("written document rejected");
    expect(toLatestGateDiagnostics(diagnostics.value)).toEqual(writtenDiagnostics);
    expect(toLatestGatePending(pending.value)).toEqual(writtenPending);
  });
});

// The acceptance criterion: a record's timeline files parse. The folder is one
// real phase (phax.artifact-timestamp-naming, phase-05) plus the attempt
// documents the tests write.
describe("a record's timeline files", () => {
  const folder = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures", "record-timeline");
  const read = (name: string): unknown => JSON.parse(readFileSync(join(folder, name), "utf8"));

  it("parse, each with its own function, the timeline files as shape v0", () => {
    const record = parseRecordManifest(read("record.json"));
    expect(record).toMatchObject({ ok: true, format: "phase-record-manifest", shape: "v2" });

    const attribution = parseGateAttribution(read("gate-attribution.json"));
    const reconciliation = parsePhaseFileReconciliation(read("file-reconciliation.json"));
    expect(attribution).toMatchObject({ ok: true, shape: "v0" });
    expect(reconciliation).toMatchObject({ ok: true, shape: "v0" });
    if (!record.ok || record.format !== "phase-record-manifest") return;
    if (!attribution.ok || !reconciliation.ok) return;

    // One phase: the manifest, its gate steps and its reconciliation agree on it.
    const { phaseId } = record.value;
    expect(attribution.value.phase).toBe(phaseId);
    expect(reconciliation.value.phaseId).toBe(phaseId);
    expect(attribution.value.steps.map(({ command }) => command)).toContain("pnpm test");
    expect(new Set(attribution.value.steps.map(({ surface }) => surface))).toEqual(
      new Set(["local", "structural", "product"]),
    );
  });

  it("orders the fix-loop attempts by the numbers in their file names", () => {
    const attempts: Array<{
      readonly attempt: number;
      readonly diagnostics?: GateDiagnostics;
      readonly pending?: GatePending;
    }> = [];
    for (const [name, document] of ATTEMPT_FILES) {
      const match = /^checks-attempt-(\d+)\.(diagnostics|pending)\.json$/.exec(name);
      if (match === null) throw new Error(name);
      const attempt = Number(match[1]);
      if (match[2] === "diagnostics") {
        const result = parseGateDiagnostics(document);
        expect(result, name).toMatchObject({ ok: true, shape: "v0" });
        if (result.ok) attempts.push({ attempt, diagnostics: result.value });
      } else {
        const result = parseGatePending(document);
        expect(result, name).toMatchObject({ ok: true, shape: "v0" });
        if (result.ok) attempts.push({ attempt, pending: result.value });
      }
    }
    const diagnostics = attempts
      .filter((entry) => entry.diagnostics !== undefined)
      .toSorted((a, b) => a.attempt - b.attempt);
    expect(diagnostics.map(({ attempt }) => attempt)).toEqual([1, 2]);
    expect(diagnostics.map((entry) => entry.diagnostics?.diagnostics.length)).toEqual([2, 1]);
    const pending = attempts.find((entry) => entry.pending !== undefined);
    expect(pending?.attempt).toBe(2);
    expect(pending?.pending?.steps[0]?.pending[0]?.openScopes).toEqual(["phase-02"]);
  });
});
