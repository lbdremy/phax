import { Either, type ParseResult } from "effect";
import { describe, expect, it } from "vitest";
import { CURRENT_SHAPES } from "../../../packages/schemas/src/generated/index.js";
import {
  parseArchitectureReport,
  parseArchitectureRequest,
  parseOracleRequest,
  parseFirstReading,
  parseInteractiveHandoff,
  parseInteractiveSession,
  parseReviewStop,
  parseRunList,
  parseAuthoringRecordManifest,
  parseBriefRecord,
  parseBriefReport,
  parseBriefRequest,
  parseComplianceReview,
  parseCostLedger,
  parseDecideVerdicts,
  parseDecisionRecordManifest,
  parseGateAttribution,
  parseGateReport,
  parseGateRequest,
  parseHandDecisionAnswer,
  parsePhaseFileReconciliation,
  parsePhaseRecordManifest,
  parsePhaseStatus,
  parsePhaxPlan,
  parsePlanApprovalRecord,
  parsePlanApprovals,
  parsePlanDocument,
  parseRecordManifest,
  parseRegistry,
  parseRunStatus,
  parseSpecApprovalRecord,
  parseSpecApprovals,
  parseSpecDocument,
} from "../../../packages/schemas/src/index.js";
import {
  decodeApprovalRecordFile,
  decodePlanRecordFile,
} from "../../../src/schemas/approvalRecord.js";
import {
  decodeAuthoringRecordManifestFile,
  decodeRecordManifestFile,
  isAuthoringRecordManifest,
} from "../../../src/schemas/authoringRecord.js";
import {
  decodeArchitectureReportFile,
  decodeArchitectureRequestFile,
} from "../../../src/schemas/architecture.js";
import { decodeFirstReadingFile } from "../../../src/schemas/firstReading.js";
import { decodeInteractiveHandoffFile } from "../../../src/schemas/interactiveHandoff.js";
import { decodeInteractiveSessionFile } from "../../../src/schemas/interactiveSession.js";
import { decodeOracleRequestFile } from "../../../src/schemas/oracleRequest.js";
import { decodeReviewStopFile } from "../../../src/schemas/reviewStop.js";
import { decodeRunListFile } from "../../../src/schemas/runList.js";
import { decodeBriefRecordFile, decodeBriefRequestFile } from "../../../src/schemas/brief.js";
import { decodeBriefReportFile } from "../../../src/schemas/briefReport.js";
import { decodeComplianceReviewFile } from "../../../src/schemas/complianceReview.js";
import { decodeCostLedgerFile } from "../../../src/schemas/costLedger.js";
import {
  decodeDecisionRecordManifestFile,
  isDecisionRecordManifest,
} from "../../../src/schemas/decisionRecord.js";
import { decodeGateAttributionFile } from "../../../src/schemas/gateAttribution.js";
import { decodeGateReportFile } from "../../../src/schemas/gateReport.js";
import { decodeGateRequestFile } from "../../../src/schemas/gateRequest.js";
import { decodeDecideVerdictsFile } from "../../../src/schemas/decideVerdicts.js";
import { decodeHandDecisionAnswerFile } from "../../../src/schemas/handDecisionAnswer.js";
import { decodePhaxPlanFile } from "../../../src/schemas/phaxPlan.js";
import { decodePlanDocumentFile } from "../../../src/schemas/planDocument.js";
import { decodePhaseFileReconciliationFile } from "../../../src/schemas/reconciliation.js";
import { decodeRegistryFile } from "../../../src/schemas/registry.js";
import { decodeRunRecordManifestFile } from "../../../src/schemas/runRecord.js";
import { FORMAT_IDS, schemaUrl, type FormatId } from "../../../src/schemas/schemaUrl.js";
import {
  decodeSpecApprovalRecordFile,
  decodeSpecRecordFile,
} from "../../../src/schemas/specApprovalRecord.js";
import { decodeSpecDocumentFile } from "../../../src/schemas/specDocument.js";
import { decodePhaseStatusFile, decodeRunStatusFile } from "../../../src/schemas/status.js";
import {
  builderInteractiveSessionDocument,
  heldPhaseRecordManifestDocument,
  heldReviewStopDocument,
  phaseStatusStopDocuments,
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
  "plan-approval-record": {
    id: "plan-approval-record",
    parse: parsePlanApprovalRecord,
    phax: decodePlanRecordFile,
    wrongType: ["sourceSpec", "docs/specs/example.md"],
    required: "artifact",
    excess: "error",
  },
  "spec-approval-record": {
    id: "spec-approval-record",
    parse: parseSpecApprovalRecord,
    phax: decodeSpecRecordFile,
    wrongType: ["baseline", "abc1234"],
    required: "artifact",
    excess: "error",
  },
  "gate-request": {
    id: "gate-request",
    parse: parseGateRequest,
    phax: decodeGateRequestFile,
    wrongType: ["base", "abc1234"],
    required: "terminal",
    excess: "error",
  },
  "brief-request": {
    id: "brief-request",
    parse: parseBriefRequest,
    phax: decodeBriefRequestFile,
    wrongType: ["files", []],
    required: "terminal",
    excess: "error",
  },
  "brief-record": {
    id: "brief-record",
    parse: parseBriefRecord,
    phax: decodeBriefRecordFile,
    wrongType: ["moment", "later"],
    required: "outcome",
    excess: "error",
  },
  "gate-report": {
    id: "gate-report",
    parse: parseGateReport,
    phax: decodeGateReportFile,
    wrongType: ["findings", {}],
    required: "review",
    excess: "error",
  },
  "brief-report": {
    id: "brief-report",
    parse: parseBriefReport,
    phax: decodeBriefReportFile,
    wrongType: ["rules", {}],
    required: "findings",
    excess: "error",
  },
  "hand-decision-answer": {
    id: "hand-decision-answer",
    parse: parseHandDecisionAnswer,
    phax: decodeHandDecisionAnswerFile,
    wrongType: ["decisions", {}],
    required: "markdown",
    excess: "error",
  },
  "decision-record-manifest": {
    id: "decision-record-manifest",
    parse: parseDecisionRecordManifest,
    phax: decodeDecisionRecordManifestFile,
    // `mode` selects the union's variant, so a wrong type there fails every
    // variant at the same path; a wrong `arbitrated` is reported at whichever
    // variant the union tries last.
    wrongType: ["mode", 2],
    required: "commit",
    excess: "error",
  },
  "cost-ledger": {
    id: "cost-ledger",
    parse: parseCostLedger,
    phax: decodeCostLedgerFile,
    wrongType: ["entries", {}],
    required: "entries",
    excess: "error",
  },
  "architecture-request": {
    id: "architecture-request",
    parse: parseArchitectureRequest,
    phax: decodeArchitectureRequestFile,
    wrongType: ["files", {}],
    required: "files",
    excess: "error",
  },
  "architecture-report": {
    id: "architecture-report",
    parse: parseArchitectureReport,
    phax: decodeArchitectureReportFile,
    wrongType: ["body", {}],
    required: "body",
    excess: "error",
  },
  "oracle-request": {
    id: "oracle-request",
    parse: parseOracleRequest,
    phax: decodeOracleRequestFile,
    wrongType: ["files", {}],
    required: "files",
    excess: "error",
  },
  "first-reading": {
    id: "first-reading",
    parse: parseFirstReading,
    phax: decodeFirstReadingFile,
    wrongType: ["pattern", {}],
    required: "pattern",
    excess: "error",
  },
  "interactive-handoff": {
    id: "interactive-handoff",
    parse: parseInteractiveHandoff,
    phax: decodeInteractiveHandoffFile,
    wrongType: ["corrections", {}],
    required: "corrections",
    excess: "error",
  },
  "interactive-session": {
    id: "interactive-session",
    parse: parseInteractiveSession,
    phax: decodeInteractiveSessionFile,
    wrongType: ["history", {}],
    required: "history",
    excess: "error",
  },
  "review-stop": {
    id: "review-stop",
    parse: parseReviewStop,
    phax: decodeReviewStopFile,
    wrongType: ["commands", []],
    required: "commands",
    excess: "error",
  },
  "run-list": {
    id: "run-list",
    parse: parseRunList,
    phax: decodeRunListFile,
    wrongType: ["runs", {}],
    required: "runs",
    excess: "error",
  },
  "decide-verdicts": {
    id: "decide-verdicts",
    parse: parseDecideVerdicts,
    phax: decodeDecideVerdictsFile,
    wrongType: ["verdicts", {}],
    required: "artifact",
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

describe("parity: the held cause", () => {
  it.each(Object.entries(phaseStatusStopDocuments))(
    "a phase status with a %s stop is accepted by both",
    (_label, document) => {
      expectParity(parsePhaseStatus, decodePhaseStatusFile, document, "accepted");
    },
  );

  it("refuses a closed unchanged held stop that names a review commit, in both", () => {
    const document = withKey(phaseStatusStopDocuments["held closed unchanged"]!, "stop", {
      cause: "held",
      status: "closed",
      outcome: "unchanged",
      reviewCommit: "89abcdef0123456789abcdef0123456789abcdef",
    });
    expectParity(parsePhaseStatus, decodePhaseStatusFile, document, "rejected");
  });

  it("accepts the held review stop in both, and refuses the other variant's keys in both", () => {
    expectParity(parseReviewStop, decodeReviewStopFile, heldReviewStopDocument, "accepted");
    expectParity(
      parseReviewStop,
      decodeReviewStopFile,
      withKey(heldReviewStopDocument, "firstReading", null),
      "rejected",
    );
    expectParity(
      parseReviewStop,
      decodeReviewStopFile,
      withoutKey(heldReviewStopDocument, "phaseCommit"),
      "rejected",
    );
  });

  it("accepts a builder session and closing turn in both", () => {
    expectParity(
      parseInteractiveSession,
      decodeInteractiveSessionFile,
      builderInteractiveSessionDocument,
      "accepted",
    );
  });

  it("accepts a held record's stop in both, and refuses a stop's extra or missing key in both", () => {
    const stop = heldPhaseRecordManifestDocument["stop"] as Doc;
    expectParity(
      parsePhaseRecordManifest,
      decodeRunRecordManifestFile,
      heldPhaseRecordManifestDocument,
      "accepted",
    );
    for (const changed of [
      withKey(stop, "transcript", "kept"),
      withoutKey(stop, "reviewCommit"),
      withoutKey(stop, "closedBy"),
      { ...withoutKey(stop, "reviewCommit"), cause: "declared", reviewCommit: "0".repeat(40) },
    ]) {
      expectParity(
        parsePhaseRecordManifest,
        decodeRunRecordManifestFile,
        withKey(heldPhaseRecordManifestDocument, "stop", changed),
        "rejected",
      );
    }
    for (const key of ["mode", "stop"]) {
      expectParity(
        parsePhaseRecordManifest,
        decodeRunRecordManifestFile,
        withoutKey(heldPhaseRecordManifestDocument, key),
        "rejected",
      );
    }
  });
});

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
    expect(result).toMatchObject({ ok: true, shape: CURRENT_SHAPES.registry });
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
  [
    "gate-request",
    "a phases entry with an extra key",
    withFirst(validDocuments["gate-request"], "phases", { optional: ["src/extra.ts"] }),
    "rejected",
  ],
  [
    "brief-request",
    "the outside variant: $schema and files only",
    { $schema: validDocuments["brief-request"]["$schema"], files: ["src/example.ts"] },
    "accepted",
  ],
  [
    "brief-request",
    "the outside variant with null files",
    { $schema: validDocuments["brief-request"]["$schema"], files: null },
    "rejected",
  ],
  [
    "brief-record",
    "an answered outcome whose answer is not an object",
    withKey(validDocuments["brief-record"], "outcome", { kind: "answered", answer: [] }),
    "rejected",
  ],
  [
    "brief-record",
    "a failed outcome with an empty reason",
    withKey(validDocuments["brief-record"], "outcome", { kind: "failed", reason: "" }),
    "rejected",
  ],
  [
    "gate-report",
    "a finding whose guide carries an extra key",
    withFirst(validDocuments["gate-report"], "findings", {
      guide: { summary: "keep I/O in the caller", read: "guides/example.md", kind: "doc" },
    }),
    "rejected",
  ],
  [
    "gate-report",
    "a finding whose lines are out of order",
    withFirst(validDocuments["gate-report"], "findings", {
      location: { file: "src/example.ts", lines: [3, 1] },
    }),
    "rejected",
  ],
  [
    "gate-report",
    "a refused report: reason and remedy",
    {
      $schema: validDocuments["gate-report"]["$schema"],
      outcome: "refused",
      reason: "the checks need a newer tool",
      remedy: "install the newer tool",
    },
    "accepted",
  ],
  [
    "brief-report",
    "a finding whose due is outside its literals",
    withFirst(validDocuments["brief-report"], "findings", { due: "soon" }),
    "rejected",
  ],
  [
    "brief-report",
    "a rule with no file",
    withFirst(validDocuments["brief-report"], "rules", { files: [] }),
    "rejected",
  ],
];

describe("parity: nested rejects", () => {
  it.each(NESTED)("%s: %s", (id, _label, input, verdict) => {
    expectParity(FORMATS[id].parse, FORMATS[id].phax, input, verdict);
  });
});

const authoring = validDocuments["authoring-record-manifest"];
const decision = validDocuments["decision-record-manifest"];

// Every current-shape manifest, phase, authoring or decision, and the rejects of each.
const RECORD_MANIFEST_CASES: ReadonlyArray<readonly [string, unknown]> = [
  ["a decision manifest", decision],
  ["a failed decision without a commit", { ...decision, outcome: "failed", commit: null }],
  ["a declined decision that names a commit", withKey(decision, "outcome", "declined")],
  ["a committed decision without a commit", withKey(decision, "commit", null)],
  ["a decision manifest with a session id", withKey(decision, "sessionId", "abc")],
  ["a decision manifest without kind", withoutKey(decision, "kind")],
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
        isDecisionRecordManifest(decoded.right)
          ? "decision-record-manifest"
          : isAuthoringRecordManifest(decoded.right)
            ? "authoring-record-manifest"
            : "phase-record-manifest",
      );
    }
  });

  it("covers accepted phase, authoring and decision manifests, and rejected ones", () => {
    const results = RECORD_MANIFEST_CASES.map(([, input]) => parseRecordManifest(input));
    const formats = results.flatMap((result) => (result.ok ? [result.format] : []));
    expect(formats).toContain("phase-record-manifest");
    expect(formats).toContain("authoring-record-manifest");
    expect(formats).toContain("decision-record-manifest");
    expect(results.some((result) => !result.ok)).toBe(true);
  });
});
