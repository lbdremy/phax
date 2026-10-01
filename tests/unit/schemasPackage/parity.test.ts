import { Either, type ParseResult } from "effect";
import { describe, expect, it } from "vitest";
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
  parseRecordManifest,
  parseRegistry,
  parseRunStatus,
  parseSpecApprovals,
  parseSpecDocument,
} from "../../../packages/schemas/src/index.js";
import { decodeApprovalRecordFile } from "../../../src/schemas/approvalRecord.js";
import {
  decodeAuthoringRecordManifestFile,
  decodeRecordManifestFile,
  isAuthoringRecordManifest,
} from "../../../src/schemas/authoringRecord.js";
import { decodeComplianceReviewFile } from "../../../src/schemas/complianceReview.js";
import { decodeGateAttributionFile } from "../../../src/schemas/gateAttribution.js";
import { decodeGateDiagnosticsDocument } from "../../../src/schemas/gateDiagnostics.js";
import { decodeGatePendingFile } from "../../../src/schemas/gatePending.js";
import { decodePhaxPlanFile } from "../../../src/schemas/phaxPlan.js";
import { decodePlanDocumentFile } from "../../../src/schemas/planDocument.js";
import { decodePhaseFileReconciliationFile } from "../../../src/schemas/reconciliation.js";
import { decodeRegistryFile } from "../../../src/schemas/registry.js";
import { decodeRunRecordManifestFile } from "../../../src/schemas/runRecord.js";
import { FORMAT_IDS, schemaUrl, type FormatId } from "../../../src/schemas/schemaUrl.js";
import { decodeSpecApprovalRecordFile } from "../../../src/schemas/specApprovalRecord.js";
import { decodeSpecDocumentFile } from "../../../src/schemas/specDocument.js";
import { decodePhaseStatusFile, decodeRunStatusFile } from "../../../src/schemas/status.js";
import {
  validDocuments,
  versionOnePhaseRecordManifest,
  withKey,
  withoutKey,
  type Doc,
} from "./documents.js";

type Decode = (input: unknown) => Either.Either<unknown, ParseResult.ParseError>;
type Parse = (input: unknown) => { readonly ok: boolean; readonly value?: unknown };
type Verdict = "accepted" | "rejected";
type Case = readonly [string, unknown, Verdict];

function expectParity(parse: Parse, phax: Decode, input: unknown, verdict: Verdict) {
  const decoded = phax(input);
  const result = parse(input);
  expect(Either.isRight(decoded)).toBe(verdict === "accepted");
  expect(result.ok).toBe(verdict === "accepted");
  if (result.ok && Either.isRight(decoded)) expect(result.value).toEqual(decoded.right);
}

interface FormatParity {
  readonly id: FormatId;
  readonly parse: Parse;
  readonly phax: Decode;
  /** A key and a value of the wrong type for it. */
  readonly wrongType: readonly [string, unknown];
  /** A key the format requires. */
  readonly required: string;
  /** How phax's decoder treats a key its schema does not name. */
  readonly excess: "error" | "ignore";
}

const FORMATS: { readonly [F in FormatId]: FormatParity } = {
  registry: {
    id: "registry",
    parse: parseRegistry,
    phax: decodeRegistryFile,
    wrongType: ["runs", {}],
    required: "runs",
    excess: "ignore",
  },
  "run-status": {
    id: "run-status",
    parse: parseRunStatus,
    phax: decodeRunStatusFile,
    wrongType: ["phasesCount", "2"],
    required: "state",
    excess: "ignore",
  },
  "phase-status": {
    id: "phase-status",
    parse: parsePhaseStatus,
    phax: decodePhaseStatusFile,
    wrongType: ["phaseIndex", "0"],
    required: "branchName",
    excess: "ignore",
  },
  "phax-plan": {
    id: "phax-plan",
    parse: parsePhaxPlan,
    phax: decodePhaxPlanFile,
    wrongType: ["phases", "phase-01"],
    required: "run",
    excess: "error",
  },
  "compliance-review": {
    id: "compliance-review",
    parse: parseComplianceReview,
    phax: decodeComplianceReviewFile,
    wrongType: ["summary", 1],
    required: "verdict",
    excess: "error",
  },
  "plan-approvals": {
    id: "plan-approvals",
    parse: parsePlanApprovals,
    phax: decodeApprovalRecordFile,
    wrongType: ["records", []],
    required: "records",
    excess: "error",
  },
  "spec-approvals": {
    id: "spec-approvals",
    parse: parseSpecApprovals,
    phax: decodeSpecApprovalRecordFile,
    wrongType: ["records", []],
    required: "records",
    excess: "error",
  },
  "phase-record-manifest": {
    id: "phase-record-manifest",
    parse: parsePhaseRecordManifest,
    phax: decodeRunRecordManifestFile,
    wrongType: ["verifiedSurfaces", "local"],
    required: "outcome",
    excess: "error",
  },
  "authoring-record-manifest": {
    id: "authoring-record-manifest",
    parse: parseAuthoringRecordManifest,
    phax: decodeAuthoringRecordManifestFile,
    wrongType: ["usage", null],
    required: "authoringId",
    excess: "error",
  },
  "gate-attribution": {
    id: "gate-attribution",
    parse: parseGateAttribution,
    phax: decodeGateAttributionFile,
    wrongType: ["steps", {}],
    required: "phase",
    excess: "ignore",
  },
  "phase-file-reconciliation": {
    id: "phase-file-reconciliation",
    parse: parsePhaseFileReconciliation,
    phax: decodePhaseFileReconciliationFile,
    wrongType: ["hasDeviations", "yes"],
    required: "phaseId",
    excess: "ignore",
  },
  "gate-diagnostics": {
    id: "gate-diagnostics",
    parse: parseGateDiagnostics,
    phax: decodeGateDiagnosticsDocument,
    wrongType: ["diagnostics", {}],
    required: "diagnostics",
    excess: "ignore",
  },
  "gate-pending": {
    id: "gate-pending",
    parse: parseGatePending,
    phax: decodeGatePendingFile,
    wrongType: ["closed", "phase-01"],
    required: "closed",
    excess: "ignore",
  },
  "spec-document": {
    id: "spec-document",
    parse: parseSpecDocument,
    phax: decodeSpecDocumentFile,
    wrongType: ["title", 1],
    required: "title",
    excess: "error",
  },
  "plan-document": {
    id: "plan-document",
    parse: parsePlanDocument,
    phax: decodePlanDocumentFile,
    wrongType: ["phases", {}],
    required: "preamble",
    excess: "error",
  },
};

describe.each(FORMAT_IDS.map((id) => FORMATS[id]))(
  "parity: the package agrees with phax's decoder on $id",
  (format) => {
    const valid = validDocuments[format.id];
    const [key, wrong] = format.wrongType;
    const cases: ReadonlyArray<Case> = [
      ["the valid document", valid, "accepted"],
      [`a wrong type at ${key}`, withKey(valid, key, wrong), "rejected"],
      [`a missing ${format.required}`, withoutKey(valid, format.required), "rejected"],
      [
        "one unknown key",
        withKey(valid, "owner", "example"),
        format.excess === "ignore" ? "accepted" : "rejected",
      ],
      ["a non-object", "document.json", "rejected"],
    ];

    it.each(cases)("%s", (_label, input, verdict) => {
      expectParity(format.parse, format.phax, input, verdict);
    });

    it("fails a hand-made reject at the path phax's decoder names", () => {
      const result = format.parse(withKey(valid, key, wrong)) as {
        readonly ok: boolean;
        readonly error?: { readonly path: string };
      };
      expect(result.error?.path.split(".")[0]).toBe(key);
    });
  },
);

describe("parity: one unknown key", () => {
  it("is rejected by both for a phase record manifest, at the key", () => {
    const input = withKey(validDocuments["phase-record-manifest"], "reviewer", "human");
    expect(Either.isLeft(decodeRunRecordManifestFile(input))).toBe(true);
    const result = parsePhaseRecordManifest(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.path).toBe("reviewer");
  });

  it("is accepted by both for a registry, and dropped from the value", () => {
    const input = withKey(validDocuments.registry, "owner", "example");
    expect(Either.isRight(decodeRegistryFile(input))).toBe(true);
    const result = parseRegistry(input);
    expect(result).toMatchObject({ ok: true, shape: "next" });
    if (result.ok) expect(Object.hasOwn(result.value, "owner")).toBe(false);
  });
});

const base = validDocuments["phase-record-manifest"];
const baseUsage = (base["usage"] as { readonly usage: Doc }).usage;

const MANIFEST_CASES: ReadonlyArray<Case> = [
  ["a manifest without sourceSha", withoutKey(base, "sourceSha"), "accepted"],
  [
    "an interrupted phase with unavailable usage",
    { ...base, outcome: "interrupted", usage: { available: false } },
    "accepted",
  ],
  [
    "a vibe manifest",
    {
      ...base,
      provider: "mistral-vibe",
      usage: {
        available: true,
        usage: {
          provider: "mistral-vibe",
          inputTokens: 10,
          outputTokens: 2,
          sessionCostUsd: 0.01,
          toolCallsAgreed: 1,
          toolCallsRejected: 0,
          toolCallsFailed: 0,
          toolCallsSucceeded: 1,
        },
      },
      verifiedSurfaces: ["local", "structural", "product"],
    },
    "accepted",
  ],
  ["a version-1 manifest", versionOnePhaseRecordManifest, "rejected"],
  ["a version-3 manifest", withKey(base, "version", 3), "rejected"],
  ["a manifest whose outcome is paused", withKey(base, "outcome", "paused"), "rejected"],
  ["a manifest with an empty runId", withKey(base, "runId", ""), "rejected"],
  ["a manifest with an empty sourceSha", withKey(base, "sourceSha", ""), "rejected"],
  ["a manifest with an unknown surface", withKey(base, "verifiedSurfaces", ["cloud"]), "rejected"],
  [
    "a manifest with usage available but absent",
    withKey(base, "usage", { available: true }),
    "rejected",
  ],
  [
    "a manifest whose usage carries an extra key",
    withKey(base, "usage", { available: true, usage: { ...baseUsage, costUsd: 1 } }),
    "rejected",
  ],
];

describe("parity: parsePhaseRecordManifest agrees with phax's decoder", () => {
  it.each(MANIFEST_CASES)("%s", (_label, input, verdict) => {
    expectParity(parsePhaseRecordManifest, decodeRunRecordManifestFile, input, verdict);
  });
});

/** A ledger whose first record has `fields` merged over it. */
function withFirstRecord(ledger: Doc, fields: Doc): Doc {
  const [[key, value], ...rest] = Object.entries(ledger["records"] as Record<string, Doc>) as [
    [string, Doc],
    ...Array<[string, Doc]>,
  ];
  return { ...ledger, records: Object.fromEntries([[key, { ...value, ...fields }], ...rest]) };
}

/** A document whose first element of `list` has `fields` merged over it. */
function withFirst(document: Doc, list: string, fields: Doc): Doc {
  const [head, ...rest] = document[list] as ReadonlyArray<Doc>;
  return { ...document, [list]: [{ ...head, ...fields }, ...rest] };
}

const completion = (validDocuments["gate-diagnostics"]["diagnostics"] as ReadonlyArray<Doc>)[1];

// Rejects that reach inside a document: each one a refinement or a nested
// literal phax's decoder checks.
const NESTED: ReadonlyArray<readonly [FormatId, string, Doc, Verdict]> = [
  ["registry", "an empty registry", withKey(validDocuments.registry, "runs", []), "accepted"],
  [
    "registry",
    "a $schema naming another format",
    withKey(validDocuments.registry, "$schema", schemaUrl("run-status", "0.1.0")),
    "rejected",
  ],
  [
    "registry",
    "a run in an unknown state",
    withFirst(validDocuments.registry, "runs", { state: "paused" }),
    "rejected",
  ],
  [
    "phase-status",
    "a branch name with a leading dash",
    withKey(validDocuments["phase-status"], "branchName", "-x"),
    "rejected",
  ],
  [
    "phax-plan",
    "a phase whose id breaks the pattern",
    withFirst(validDocuments["phax-plan"], "phases", { id: "phase-1" }),
    "rejected",
  ],
  [
    "compliance-review",
    "a finding with an unknown severity",
    withFirst(validDocuments["compliance-review"], "perPhase", {
      findings: [{ dimension: "files", severity: "fatal", message: "x" }],
    }),
    "rejected",
  ],
  [
    "plan-approvals",
    "a record whose baseline is not 40-hex",
    withFirstRecord(validDocuments["plan-approvals"], { baseline: "abc1234" }),
    "rejected",
  ],
  [
    "spec-approvals",
    "a record with an empty specFingerprint",
    withFirstRecord(validDocuments["spec-approvals"], { specFingerprint: "" }),
    "rejected",
  ],
  [
    "gate-attribution",
    "a step whose result is outside its literals",
    withFirst(validDocuments["gate-attribution"], "steps", { result: "skipped" }),
    "rejected",
  ],
  [
    "gate-diagnostics",
    "a diagnostic at line 0",
    { diagnostics: [{ ...completion, location: { file: "a.ts", line: 0 } }] },
    "rejected",
  ],
  [
    "gate-pending",
    "a step with nothing pending",
    withKey(validDocuments["gate-pending"], "steps", [{ command: "pnpm test", pending: [] }]),
    "rejected",
  ],
  [
    "spec-document",
    "a docs page of kind none without a reason",
    withKey(validDocuments["spec-document"], "docsPage", { kind: "none" }),
    "rejected",
  ],
  [
    "plan-document",
    "a phase with an unknown effort",
    withFirst(validDocuments["plan-document"], "phases", { effort: "extreme" }),
    "rejected",
  ],
];

describe("parity: nested rejects", () => {
  it.each(NESTED)("%s: %s", (id, _label, input, verdict) => {
    expectParity(FORMATS[id].parse, FORMATS[id].phax, input, verdict);
  });
});

const authoring = validDocuments["authoring-record-manifest"];

// Every current-shape manifest, phase or authoring, and the rejects of both.
const RECORD_MANIFEST_CASES: ReadonlyArray<readonly [string, unknown]> = [
  ["a phase manifest", base],
  ...MANIFEST_CASES.map(([label, input]) => [label, input] as const),
  ["an authoring manifest", authoring],
  ["an authoring manifest without sourceSha", withoutKey(authoring, "sourceSha")],
  ["an interrupted authoring session", withKey(authoring, "outcome", "interrupted")],
  ["an authoring manifest with one unknown key", withKey(authoring, "reviewer", "human")],
  ["a phase manifest that claims kind authoring", withKey(base, "kind", "authoring")],
  ["an authoring manifest without kind", withoutKey(authoring, "kind")],
];

describe("parity: parseRecordManifest agrees with phax's union", () => {
  it.each(RECORD_MANIFEST_CASES)("%s", (_label, input) => {
    const decoded = decodeRecordManifestFile(input);
    const result = parseRecordManifest(input);
    expect(result.ok).toBe(Either.isRight(decoded));
    if (result.ok && Either.isRight(decoded)) {
      expect(result.value).toEqual(decoded.right);
      expect(result.format).toBe(
        isAuthoringRecordManifest(decoded.right)
          ? "authoring-record-manifest"
          : "phase-record-manifest",
      );
    }
  });

  it("covers accepted phase and authoring manifests, and rejected ones", () => {
    const results = RECORD_MANIFEST_CASES.map(([, input]) => parseRecordManifest(input));
    const formats = results.flatMap((result) => (result.ok ? [result.format] : []));
    expect(formats).toContain("phase-record-manifest");
    expect(formats).toContain("authoring-record-manifest");
    expect(results.some((result) => !result.ok)).toBe(true);
  });
});
