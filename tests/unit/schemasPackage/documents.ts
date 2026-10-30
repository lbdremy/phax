// The only source of test documents for the schemas package (spec §5.11).
// Every document is a made-up value typed as a format's frozen pre-schema
// type, or, for a format born with $schema, as phax's in-memory type. `preSchemaDocuments` encodes it through the frozen module, so it
// survives phax's later shape changes; `validDocuments` encodes it through
// phax's own schema, so a schema change breaks the build rather than silently
// staling a fixture. Nothing here comes from a phax home, a records branch or
// another repository.
import { Schema } from "effect";
import { FIRST_SUPPORTED_RELEASE } from "../../../packages/schemas/src/generated/index.js";
import { UNKNOWN } from "../../../packages/schemas/src/shapes.js";
import {
  developmentBuildMessage,
  preSchemaUnsupportedMessage,
} from "../../../packages/schemas/src/shapes.js";
import { BranchNameSchema } from "../../../src/domain/branded.js";
import {
  ApprovalRecordFileSchema,
  PlanRecordFileSchema,
  type PlanRecord,
} from "../../../src/schemas/approvalRecord.js";
import {
  ArchitectureReportFileSchema,
  ArchitectureRequestFileSchema,
} from "../../../src/schemas/architecture.js";
import { AuthoringRecordManifestFileSchema } from "../../../src/schemas/authoringRecord.js";
import {
  BriefRecordFileSchema,
  BriefRequestFileSchema,
  type BriefRecord,
  type PhaseBriefRequest,
} from "../../../src/schemas/brief.js";
import { BriefReportFileSchema, type BriefReport } from "../../../src/schemas/briefReport.js";
import { CodeReviewFileSchema, type CodeReview } from "../../../src/schemas/codeReview.js";
import { ComplianceReviewFileSchema } from "../../../src/schemas/complianceReview.js";
import { CostLedgerFileSchema, type CostLedger } from "../../../src/schemas/costLedger.js";
import {
  DecisionRecordManifestFileSchema,
  type DecisionRecordManifest,
} from "../../../src/schemas/decisionRecord.js";
import {
  ReviewRecordManifestFileSchema,
  type ReviewRecordManifest,
} from "../../../src/schemas/reviewRecord.js";
import {
  DecideVerdictsFileSchema,
  type DecideVerdicts,
} from "../../../src/schemas/decideVerdicts.js";
import { GateAttributionFileSchema } from "../../../src/schemas/gateAttribution.js";
import { GateReportFileSchema, type GateReport } from "../../../src/schemas/gateReport.js";
import { GateRequestFileSchema, type GateRequest } from "../../../src/schemas/gateRequest.js";
import {
  HandDecisionAnswerFileSchema,
  type HandDecisionAnswer,
} from "../../../src/schemas/handDecisionAnswer.js";
import {
  AuthoringRecordManifestPreSchemaSchema,
  type AuthoringRecordManifestPreSchema,
} from "../../../src/schemas/history/authoring-record-manifest/pre-schema.js";
import {
  ComplianceReviewPreSchemaSchema,
  type ComplianceReviewPreSchema,
} from "../../../src/schemas/history/compliance-review/pre-schema.js";
import {
  GateAttributionPreSchemaSchema,
  type GateAttributionPreSchema,
} from "../../../src/schemas/history/gate-attribution/pre-schema.js";
import {
  PhaseFileReconciliationPreSchemaSchema,
  type PhaseFileReconciliationPreSchema,
} from "../../../src/schemas/history/phase-file-reconciliation/pre-schema.js";
import {
  PhaseRecordManifestPreSchemaSchema,
  type PhaseRecordManifestPreSchema,
} from "../../../src/schemas/history/phase-record-manifest/pre-schema.js";
import {
  PhaseStatusPreSchemaSchema,
  type PhaseStatusPreSchema,
} from "../../../src/schemas/history/phase-status/pre-schema.js";
import {
  PhaxPlanPreSchemaSchema,
  type PhaxPlanPreSchema,
} from "../../../src/schemas/history/phax-plan/pre-schema.js";
import {
  PlanApprovalsPreSchemaSchema,
  type PlanApprovalsPreSchema,
} from "../../../src/schemas/history/plan-approvals/pre-schema.js";
import {
  PlanDocumentPreSchemaSchema,
  type PlanDocumentPreSchema,
} from "../../../src/schemas/history/plan-document/pre-schema.js";
import {
  RegistryPreSchemaSchema,
  type RegistryPreSchema,
} from "../../../src/schemas/history/registry/pre-schema.js";
import {
  RunStatusPreSchemaSchema,
  type RunStatusPreSchema,
} from "../../../src/schemas/history/run-status/pre-schema.js";
import {
  SpecApprovalsPreSchemaSchema,
  type SpecApprovalsPreSchema,
} from "../../../src/schemas/history/spec-approvals/pre-schema.js";
import {
  SpecDocumentPreSchemaSchema,
  type SpecDocumentPreSchema,
} from "../../../src/schemas/history/spec-document/pre-schema.js";
import { FirstReadingFileSchema } from "../../../src/schemas/firstReading.js";
import { InteractiveHandoffFileSchema } from "../../../src/schemas/interactiveHandoff.js";
import { InteractiveSessionFileSchema } from "../../../src/schemas/interactiveSession.js";
import { OracleRequestFileSchema } from "../../../src/schemas/oracleRequest.js";
import { PlanExtractionAnswerSchema } from "../../../src/schemas/planExtraction.js";
import { ReviewStopFileSchema } from "../../../src/schemas/reviewStop.js";
import { RunListFileSchema } from "../../../src/schemas/runList.js";
import { PhaxPlanFileSchema } from "../../../src/schemas/phaxPlan.js";
import { PlanDocumentFileSchema } from "../../../src/schemas/planDocument.js";
import type { TestLine } from "../../../src/schemas/testLine.js";
import { renderTestLine } from "../../../src/domain/plan/testLineGrammar.js";
import { PhaseFileReconciliationFileSchema } from "../../../src/schemas/reconciliation.js";
import { withSchemaUrl } from "../../../src/schemas/persisted.js";
import { RegistryFileSchema } from "../../../src/schemas/registry.js";
import {
  RunRecordManifestFileSchema,
  liftFrozenTokenUsage,
} from "../../../src/schemas/runRecord.js";
import {
  compareReleases,
  schemaUrl,
  type FormatId,
  type PreSchemaFormatId,
} from "../../../src/schemas/schemaUrl.js";
import {
  SpecApprovalRecordFileSchema,
  SpecRecordFileSchema,
  type SpecRecord,
} from "../../../src/schemas/specApprovalRecord.js";
import {
  SURFACE_SUMMARY_PLACEHOLDER,
  SpecDocumentFileSchema,
} from "../../../src/schemas/specDocument.js";
import {
  PhaseStatusFileSchema,
  RunStatusFileSchema,
  type PhaseStop,
} from "../../../src/schemas/status.js";

export type Doc = Readonly<Record<string, unknown>>;

function encoded<A, I>(schema: Schema.Schema<A, I>, value: A): Doc {
  return Schema.encodeSync(schema)(value) as Doc;
}

/** A copy of `doc` with `key` set to `value`. */
export function withKey(doc: Doc, key: string, value: unknown): Doc {
  return { ...doc, [key]: value };
}

/** Every key and string in `value`, depth first. */
export function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, entry]) => [key, ...strings(entry)]);
  }
  return [];
}

/** The keys and strings in `value` that name a home directory or a phax home. */
export function homePaths(value: unknown): string[] {
  return strings(value).filter((text) => /\/Users\/|\/home\/|~\/\.phax/.test(text));
}

/** A copy of `doc` without `key`. */
export function withoutKey(doc: Doc, key: string): Doc {
  const { [key]: _removed, ...rest } = doc;
  return rest;
}

const RUN_ID = "run-0001";
const CREATED_AT = "2026-01-01T09:00:00.000Z";
const UPDATED_AT = "2026-01-01T09:30:00.000Z";
const BASELINE = "0123456789abcdef0123456789abcdef01234567";

const registry: RegistryPreSchema = {
  version: 1,
  runs: [
    {
      namespace: "example",
      shortName: "example-run",
      runId: RUN_ID,
      state: "running",
      branch: "phax/example-run",
      projectName: "example-repo",
      phasesCount: 2,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    },
  ],
};

const runStatus: RunStatusPreSchema = {
  version: 1,
  namespace: "example",
  shortName: "example-run",
  runId: RUN_ID,
  state: "running",
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  phasesCount: 2,
  currentPhaseIndex: 0,
  gateProfileId: "standard",
};

/** A made-up full commit sha: the base a phase status written today notes. */
export const EXAMPLE_BASE = "0123456789abcdef0123456789abcdef01234567";

const phaseStatus: PhaseStatusPreSchema = {
  version: 1,
  phaseId: "phase-01",
  phaseIndex: 0,
  state: "running",
  model: "example-model",
  effort: "high",
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  branchName: Schema.decodeSync(BranchNameSchema)("phax/example-run--phase-01"),
  worktreePath: "/work/example-repo/worktrees/phase-01",
};

const phaxPlan: PhaxPlanPreSchema = {
  version: 1,
  run: {
    shortName: "example-run",
    title: "Example run",
    branch: "phax/example-run",
    requiredCommands: ["pnpm test"],
  },
  phases: [
    {
      id: "phase-01",
      title: "Add the example module",
      model: "example-model",
      effort: "high",
      planMarkdownAnchor: "#phase-01-example",
      plannedFilesToCreate: ["src/example.ts"],
      plannedFilesToEdit: ["src/index.ts"],
      optionalFilesToEdit: ["README.md"],
      commit: { subject: "feat: add the example module", body: "Adds the example module." },
    },
  ],
};

const complianceReview: ComplianceReviewPreSchema = {
  version: 1,
  verdict: "conformant-with-deviations",
  summary: "The run delivers the plan, with one deviation.",
  perPhase: [
    {
      phaseId: "phase-01",
      verdict: "conformant-with-deviations",
      findings: [{ dimension: "files", severity: "deviation", message: "README.md was touched" }],
    },
  ],
  attentionPoints: ["README.md changed"],
  pointers: ["src/example.ts"],
};

const planApprovals: PlanApprovalsPreSchema = {
  version: 1,
  records: {
    "docs/plans/example.md": {
      planFingerprint: "plan-fingerprint-0001",
      approvedAt: CREATED_AT,
      baseline: BASELINE,
      sourceSpec: { path: "docs/specs/example.md", fingerprint: "spec-fingerprint-0001" },
    },
  },
};

const specApprovals: SpecApprovalsPreSchema = {
  version: 1,
  records: {
    "docs/specs/example.md": {
      specFingerprint: "spec-fingerprint-0001",
      approvedAt: CREATED_AT,
      baseline: BASELINE,
    },
  },
};

// A format born with $schema has no pre-schema type: its current record is
// typed as phax's in-memory value.
const planRecord: PlanRecord = {
  artifact: "docs/plans/example.md",
  planFingerprint: "plan-fingerprint-0001",
  approvedAt: CREATED_AT,
  baseline: BASELINE,
  sourceSpec: { path: "docs/specs/example.md", fingerprint: "spec-fingerprint-0001" },
  approvedBy: { kind: "machine", grant: "roadmap-loop" },
};

const specRecord: SpecRecord = {
  artifact: "docs/specs/example.md",
  specFingerprint: "spec-fingerprint-0001",
  approvedAt: CREATED_AT,
  baseline: BASELINE,
  approvedBy: { kind: "operator", name: "Ada Lovelace" },
};

const phaseRecordManifest: PhaseRecordManifestPreSchema = {
  version: 2,
  runId: RUN_ID,
  phaseId: "phase-01",
  shape: "full",
  sourceSha: "abc1234",
  model: "example-model",
  effort: "high",
  provider: "claude-code",
  outcome: "committed",
  usage: {
    available: true,
    usage: {
      provider: "claude-code",
      inputTokens: 1000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 200,
      outputTokens: 300,
      totalCostUsd: 0.01,
    },
  },
  verifiedSurfaces: ["local", "structural"],
};

const authoringRecordManifest: AuthoringRecordManifestPreSchema = {
  version: 1,
  kind: "authoring",
  authoringId: "authoring-0001",
  artifact: "docs/specs/example.md",
  artifactKind: "spec",
  shape: "skeleton",
  sourceSha: "def5678",
  provider: "codex-cli",
  model: "example-model",
  effort: "medium",
  outcome: "committed",
  usage: {
    available: true,
    usage: {
      provider: "codex-cli",
      inputTokens: 500,
      cachedInputTokens: 100,
      outputTokens: 50,
      reasoningOutputTokens: 10,
    },
  },
};

const gateAttribution = {
  phase: "phase-01",
  steps: [
    { command: "pnpm typecheck", surface: "structural", result: "pass" },
    { command: "pnpm test", surface: "local", result: "fail" },
  ],
} satisfies GateAttributionPreSchema;

const phaseFileReconciliation: PhaseFileReconciliationPreSchema = {
  phaseId: "phase-01",
  createdAsPlanned: ["src/example.ts"],
  editedAsPlanned: ["src/index.ts"],
  missingPlannedCreate: [],
  missingPlannedEdit: [],
  createdButPlannedEdit: [],
  editedButPlannedCreate: [],
  unplannedCreated: [],
  unplannedEdited: [],
  optionalTouched: ["README.md"],
  deletions: [],
  renames: [{ from: "src/old.ts", to: "src/new.ts" }],
  hasDeviations: false,
};

const gateRequest: GateRequest = {
  phase: "phase-02",
  base: EXAMPLE_BASE,
  terminal: false,
  phases: [
    { id: "phase-01", files: ["src/example.ts", "tests/example.test.ts"] },
    { id: "phase-02", files: ["src/other.ts"] },
  ],
};

const briefRequest: PhaseBriefRequest = {
  ...gateRequest,
  files: ["src/example.ts", "src/missing.ts"],
};

const gateReport: GateReport = {
  outcome: "checked",
  findings: [
    {
      id: "example-no-io src/example.ts node:fs",
      rule: "a module under src/ imports no node: module",
      location: { file: "src/example.ts", lines: [3, 3] },
      message: "imports node:fs",
      related: [{ file: "src/other.ts", lines: [1, 4], why: "the caller, where the read belongs" }],
      guide: { summary: "keep I/O in the caller", read: "guides/example.md" },
    },
  ],
  review: [{ owner: "example-team", note: "whether the greeting reads well" }],
};

const briefReport: BriefReport = {
  rules: [
    {
      rule: "a module under src/ imports no node: module",
      files: ["src/example.ts", "src/missing.ts"],
      guide: { summary: "keep I/O in the caller", read: "guides/example.md" },
    },
  ],
  findings: [
    {
      id: "example-no-io src/example.ts node:fs",
      rule: "a module under src/ imports no node: module",
      location: { file: "src/example.ts", lines: null },
      message: "imports node:fs",
      related: [],
      guide: null,
      due: "this-phase",
    },
  ],
};

const handDecisionAnswer: HandDecisionAnswer = {
  kind: "spec",
  decisions: [
    {
      id: "q-retention",
      verdict: {
        kind: "decided",
        chosen: "keep-30",
        abandoned: ["keep-7"],
        why: "a month covers a release cycle",
        advocate: "a week keeps the disk small",
        principles: ["S1"],
        reversibility: "cheap",
        by: { kind: "operator", name: "Example Operator" },
        at: "2026-10-16T09:30:00Z",
        revised: [],
      },
    },
  ],
  markdown: "---\nstatus: Draft\n---\n# Example spec\n",
};

const decideVerdicts: DecideVerdicts = {
  artifact: "docs/specs/2610250900-example-spec.md",
  verdicts: [
    { question: "q-retention", chosen: "keep-30", note: null },
    { question: "q-format", chosen: "other", note: "Newline-delimited JSON, one record a line." },
  ],
};

const reviewRecordManifest: ReviewRecordManifest = {
  kind: "review",
  runId: "2610270900-example",
  review: "compliance-review",
};

const decisionRecordManifest: DecisionRecordManifest = {
  kind: "decision",
  decisionId: "2610160930-example/01",
  artifact: "docs/specs/2610160930-example.md",
  artifactKind: "spec",
  mode: "interactive",
  session: "new",
  doctrine: [
    { kind: "skill", name: "phax-decide-spec", source: "bundled", fingerprint: "a".repeat(64) },
    { kind: "file", path: "docs/doctrine/spec.md", fingerprint: "b".repeat(64) },
  ],
  questions: ["q-retention", "q-scope"],
  arbitrated: 2,
  departed: 1,
  sourceSha: "abc1234",
  shape: "skeleton",
  provider: "claude-code",
  model: "example-model",
  effort: "high",
  outcome: "committed",
  commit: "def5678",
  usage: { available: false },
};

const costLedger: CostLedger = {
  entries: [
    {
      role: "phase",
      phase: "phase-01",
      completeness: "complete",
      provider: "claude-code",
      sessionId: "00000000-0000-4000-8000-000000000001",
      models: {
        "example-model": {
          inputTokens: 12,
          outputTokens: 340,
          cacheReadTokens: 5600,
          cacheWriteTokens: 780,
          costUsd: 0.125,
        },
      },
      costUsd: 0.125,
      agentMs: 4200,
      endedAt: "2026-10-16T09:30:00Z",
      rateLimitSamples: [
        {
          window: "five-hour",
          utilization: 12.5,
          resetsAt: "2026-10-16T12:00:00Z",
          runCostUsd: 0.1,
        },
      ],
    },
    {
      role: "compliance",
      phase: null,
      completeness: "partial",
      provider: "claude-code",
      sessionId: "00000000-0000-4000-8000-000000000002",
      models: {},
      costUsd: 0,
      agentMs: 0,
      endedAt: "2026-10-16T09:45:00Z",
      rateLimitSamples: [],
    },
    {
      role: "code-review",
      phase: null,
      completeness: "partial",
      provider: "claude-code",
      sessionId: "00000000-0000-4000-8000-000000000003",
      models: {},
      costUsd: 0,
      agentMs: 0,
      endedAt: "2026-10-16T09:50:00Z",
      rateLimitSamples: [],
    },
  ],
};

const codeReview: CodeReview = {
  findings: [
    {
      severity: "bug",
      file: "src/example.ts",
      line: 12,
      message: "An empty name is accepted.",
      lens: "edge",
      escape: "unexplored-input",
      criterion: null,
      suggestion: "Refuse an empty name.",
    },
  ],
};

const briefRecord: BriefRecord = {
  moment: "pulled",
  request: withSchemaUrl("brief-request", briefRequest),
  outcome: { kind: "answered", answer: withSchemaUrl("brief-report", briefReport) },
};

const specDocument: SpecDocumentPreSchema = {
  version: 1,
  kind: "spec",
  title: "Example spec",
  ground: [{ path: "src/example.ts", note: "the module the spec changes" }],
  context: "An example context.",
  problem: "An example problem.",
  productGoal: { statement: "An example goal.", guidingRule: "Keep it small." },
  terminology: [{ term: "example", definition: "a made-up thing" }],
  requirements: [
    { id: "req-one", title: "One", pattern: "ubiquitous", statement: "The tool shall work." },
  ],
  surface: [
    { surface: "cli: example", binding: "normative", before: null, after: "example --flag" },
  ],
  nonGoals: ["Anything else."],
  acceptanceCriteria: [
    {
      id: "ac-one",
      name: "It works",
      given: "a repository",
      when: "the tool runs",
      // The criterion's given/when/then is data, never awaited.
      // eslint-disable-next-line unicorn/no-thenable
      then: "it works",
      refs: ["req-one"],
    },
  ],
  openQuestions: [
    {
      id: "q-one",
      question: "Which option?",
      options: [
        { id: "a", label: "Option A", abandons: "option B's speed" },
        { id: "b", label: "Option B", abandons: "option A's safety" },
      ],
      recommendation: "a",
      rationale: "Safety first.",
    },
  ],
  planningNote: { settled: ["One phase."], open: [], constraints: [] },
  docsPage: { kind: "none", why: "Nothing user-facing." },
};

/** A made-up test strategy in the line format, as an older plan document's string carried it. */
const EXAMPLE_TEST_STRATEGY =
  "- The example module returns its value — small · example · the module's output · in-phase";

/** The test lines `EXAMPLE_TEST_STRATEGY` reads as. */
export const EXAMPLE_TEST_LINES = [
  {
    guarantee: "The example module returns its value",
    size: "small",
    technique: "example",
    oracle: "the module's output",
    loop: "in-phase",
    criterion: null,
  },
] as const;

// Spec-less, so that phax's bridge and the package step it alike: a pre-schema
// sidecar never recorded `completesSpec`, which only null may stand for. Its
// test strategy follows the line format, so both lift it to test lines.
const planDocument: PlanDocumentPreSchema = {
  version: 1,
  kind: "plan",
  sourceSpec: null,
  run: { shortName: "example-run", title: "Example run", requiredCommands: [] },
  preamble: {
    summary: "An example plan.",
    requiredCommandsNote: "No command beyond the gate.",
    technicalArbitrations: [],
  },
  phases: [
    {
      id: "phase-01",
      title: "Add the example module",
      model: "example-model",
      effort: "medium",
      planMarkdownAnchor: "#phase-01-example",
      plannedFilesToCreate: ["src/example.ts"],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "feat: add the example module", body: "Adds the example module." },
      objective: "The example module exists.",
      detailedInstructions: ["Create src/example.ts."],
      boundaryContracts: null,
      testStrategy: EXAMPLE_TEST_STRATEGY,
      implementationOrder: ["Write the test.", "Write the module."],
      excludedScope: ["Everything else."],
      verification: "The standard gate.",
      expectedHandoff: "The module's exports.",
    },
  ],
};

/**
 * One minimal document per format id with a pre-schema shape, without
 * `$schema`, encoded through the format's frozen module. A format born with
 * `$schema` has none.
 */
export const preSchemaDocuments: { readonly [F in PreSchemaFormatId]: Doc } = {
  registry: encoded(RegistryPreSchemaSchema, registry),
  "run-status": encoded(RunStatusPreSchemaSchema, runStatus),
  "phase-status": encoded(PhaseStatusPreSchemaSchema, phaseStatus),
  "phax-plan": encoded(PhaxPlanPreSchemaSchema, phaxPlan),
  "compliance-review": encoded(ComplianceReviewPreSchemaSchema, complianceReview),
  "plan-approvals": encoded(PlanApprovalsPreSchemaSchema, planApprovals),
  "spec-approvals": encoded(SpecApprovalsPreSchemaSchema, specApprovals),
  "phase-record-manifest": encoded(PhaseRecordManifestPreSchemaSchema, phaseRecordManifest),
  "authoring-record-manifest": encoded(
    AuthoringRecordManifestPreSchemaSchema,
    authoringRecordManifest,
  ),
  "gate-attribution": encoded(GateAttributionPreSchemaSchema, gateAttribution),
  "phase-file-reconciliation": encoded(
    PhaseFileReconciliationPreSchemaSchema,
    phaseFileReconciliation,
  ),
  "spec-document": encoded(SpecDocumentPreSchemaSchema, specDocument),
  "plan-document": encoded(PlanDocumentPreSchemaSchema, planDocument),
};

/** A pre-schema value as phax holds it in memory: the same fields, without `version`. */
function stepped<T extends { readonly version: number }>(value: T): Omit<T, "version"> {
  const { version: _version, ...rest } = value;
  return rest;
}

/**
 * A plan document as every shape before the preamble's question arrays and
 * each phase's reason (the frozen 0.20.0 shape): without both, and without
 * each phase's `mode` and `oracle`, its test lines as a string. The reason is
 * `assignmentReason` in the current shape.
 */
export function withoutPreambleQuestions(doc: Doc): Doc {
  const {
    openQuestions: _open,
    arbitratedQuestions: _arbitrated,
    ...preamble
  } = doc["preamble"] as Doc;
  const phases = (doc["phases"] as Doc[]).map(
    ({ assignmentReason: _reason, mode: _mode, oracle: _oracle, ...phase }) =>
      withTestStrategyText(phase),
  );
  return { ...doc, preamble, phases };
}

/** A phase with its test lines as the string an older shape carried: one `- ` line each. */
function withTestStrategyText(phase: Doc): Doc {
  const lines = phase["testStrategy"] as TestLine[];
  const text =
    lines.length === 0 ? "- (none)" : lines.map((line) => `- ${renderTestLine(line)}`).join("\n");
  return { ...phase, testStrategy: text };
}

/**
 * A current plan document as the frozen 0.26.0 shape wrote it: each phase's
 * test lines are the string the line format renders.
 */
export function withTestStrategyStrings(doc: Doc): Doc {
  return { ...doc, phases: (doc["phases"] as Doc[]).map(withTestStrategyText) };
}

/**
 * A current plan document as the frozen 0.25.0 shape wrote it: each phase's
 * `assignmentReason` is a `modelReason`, in the same place before model and
 * effort, no phase carries `mode` or `oracle`, and its test lines are a string.
 */
export function withModelReasons(doc: Doc): Doc {
  const phases = (doc["phases"] as Doc[]).map(
    ({ assignmentReason, model, effort, mode: _mode, oracle: _oracle, ...phase }) => ({
      ...withTestStrategyText(phase),
      modelReason: assignmentReason,
      model,
      effort,
    }),
  );
  return { ...doc, phases };
}

/**
 * A current phax-plan as the frozen 0.17.0 shape wrote it: no phase carries
 * `mode`, `oracle` or `testLines`.
 */
export function withoutPhaseKinds(doc: Doc): Doc {
  const phases = (withoutTestLines(doc)["phases"] as Doc[]).map(
    ({ mode: _mode, oracle: _oracle, ...phase }) => phase,
  );
  return { ...doc, phases };
}

/**
 * A cost ledger as the frozen 0.26.0 shape wrote it: stamped 0.26.0, holding
 * a first-turn and a closing-turn entry and no code-review entry.
 */
export function costLedgerV0_26_0Document(): Doc {
  const [phaseEntry, complianceEntry] = validDocuments["cost-ledger"]["entries"] as [Doc, Doc];
  return {
    $schema: "https://docs.phax.run/schemas/cost-ledger/0.26.0.json",
    entries: [
      { ...phaseEntry, role: "first-turn" },
      { ...phaseEntry, role: "closing-turn" },
      complianceEntry,
    ],
  };
}

/** A current phax-plan as the frozen 0.26.0 shape wrote it: no phase carries `testLines`. */
export function withoutTestLines(doc: Doc): Doc {
  const phases = (doc["phases"] as Doc[]).map(({ testLines: _lines, ...phase }) => phase);
  return { ...doc, phases };
}

/**
 * A plan document with what an older shape lifts to: the preamble's question
 * arrays both empty, and `mode: "headless"`, `oracle: null` and a null
 * `assignmentReason` on every phase.
 */
function withEmptyQuestions(doc: Doc): Doc {
  const preamble = doc["preamble"] as Doc;
  const phases = (doc["phases"] as Doc[]).map((phase) => ({
    ...phase,
    testStrategy: EXAMPLE_TEST_LINES,
    mode: "headless",
    oracle: null,
    assignmentReason: null,
  }));
  return {
    ...doc,
    preamble: { ...preamble, openQuestions: [], arbitratedQuestions: [] },
    phases,
  };
}

/**
 * A format's pre-schema document as phax's bridge and the package's
 * `toLatest*` both read it: without `version`, and with each fact a later
 * shape added set to the only value the document allows — a spec-less plan
 * document's `completesSpec` is null and its preamble questions empty, and a
 * spec document whose questions carry no author's marker has no arbitrated
 * question.
 */
export function latestPreSchema(id: PreSchemaFormatId): Doc {
  const lifted = liftPreSchema(id, UNKNOWN);
  if (id !== "phax-plan") return lifted;
  // The package's lift states no test line: each phase's `testLines` is `Unknown`.
  const phases = (lifted["phases"] as Doc[]).map((phase) => ({ ...phase, testLines: UNKNOWN }));
  return { ...lifted, phases };
}

/** The made-up summary `validDocuments["spec-document"]` gives its surface element. */
export const EXAMPLE_SURFACE_SUMMARY = "An operator can run the example.";

/**
 * The same value as phax's reader lifts it: a spec document's surface elements,
 * which recorded no summary, hold the placeholder where the package's
 * `toLatest*` holds `Unknown` (`latestPreSchema`).
 */
export function phaxLatestPreSchema(id: PreSchemaFormatId): Doc {
  const lifted = liftPreSchema(id, SURFACE_SUMMARY_PLACEHOLDER);
  // A pre-schema attribution ran no protected-paths check: phax's reader
  // lifts it with `null`, the package keeps the recorded value as it is.
  return id === "gate-attribution" ? { ...lifted, protectedPaths: null } : lifted;
}

/** A latest spec document's surface elements, each with `summary` replaced. */
export function withSurfaceSummary(doc: Doc, summary: unknown): Doc {
  const lifted = (doc["surface"] as Doc[]).map((element) => ({
    surface: element["surface"],
    summary,
    binding: element["binding"],
    before: element["before"],
    after: element["after"],
  }));
  return { ...doc, surface: lifted };
}

/** A spec document as a sidecar older than the surface summary carried it: no `summary` on any element. */
export function withoutSurfaceSummary(doc: Doc): Doc {
  const surface = (doc["surface"] as Doc[]).map(({ summary: _summary, ...element }) => element);
  return { ...doc, surface };
}

function liftPreSchema(id: PreSchemaFormatId, summary: unknown): Doc {
  const { version: _version, ...rest } = preSchemaDocuments[id];
  if (id === "plan-document") return withEmptyQuestions({ ...rest, completesSpec: null });
  if (id === "spec-document") {
    return withSurfaceSummary({ ...rest, arbitratedQuestions: [] }, summary);
  }
  if (id === "phax-plan") {
    const phases = (rest["phases"] as Doc[]).map((phase) => ({
      ...phase,
      mode: "headless",
      oracle: null,
    }));
    return { ...rest, phases };
  }
  if (id === "phase-file-reconciliation") return { ...rest, reviewCorrections: [] };
  return rest;
}

/**
 * One minimal document per format id, in the shape phax writes today:
 * `$schema` first, stamped by `withSchemaUrl`.
 */
export const validDocuments: { readonly [F in FormatId]: Doc } = {
  // Built on access: the embedded stop is `heldReviewStopDocument`, declared below.
  get "run-list"(): Doc {
    return runListDocument();
  },
  registry: encoded(RegistryFileSchema, withSchemaUrl("registry", { runs: registry.runs })),
  "run-status": encoded(
    RunStatusFileSchema,
    withSchemaUrl("run-status", { ...stepped(runStatus), hold: { selection: "none" as const } }),
  ),
  "phase-status": encoded(
    PhaseStatusFileSchema,
    withSchemaUrl("phase-status", {
      ...stepped(phaseStatus),
      base: EXAMPLE_BASE,
      mode: "headless" as const,
      stop: null,
    }),
  ),
  "phax-plan": encoded(
    PhaxPlanFileSchema,
    withSchemaUrl("phax-plan", {
      run: phaxPlan.run,
      phases: [
        { ...phaxPlan.phases[0], mode: "headless" as const, oracle: null, testLines: [] },
        ...phaxPlan.phases
          .slice(1)
          .map((phase) => ({ ...phase, mode: "headless" as const, oracle: null, testLines: [] })),
      ],
    }),
  ),
  "compliance-review": encoded(
    ComplianceReviewFileSchema,
    withSchemaUrl("compliance-review", stepped(complianceReview)),
  ),
  "plan-approvals": encoded(
    ApprovalRecordFileSchema,
    withSchemaUrl("plan-approvals", stepped(planApprovals)),
  ),
  "spec-approvals": encoded(
    SpecApprovalRecordFileSchema,
    withSchemaUrl("spec-approvals", stepped(specApprovals)),
  ),
  "phase-record-manifest": encoded(
    RunRecordManifestFileSchema,
    withSchemaUrl("phase-record-manifest", {
      ...stepped(phaseRecordManifest),
      usage: liftFrozenTokenUsage(phaseRecordManifest.usage),
      oracle: null,
      mode: "headless",
      stop: null,
    }),
  ),
  "authoring-record-manifest": encoded(
    AuthoringRecordManifestFileSchema,
    withSchemaUrl("authoring-record-manifest", {
      ...stepped(authoringRecordManifest),
      usage: liftFrozenTokenUsage(authoringRecordManifest.usage),
      retry: "none",
    }),
  ),
  "gate-attribution": encoded(
    GateAttributionFileSchema,
    withSchemaUrl("gate-attribution", { ...gateAttribution, protectedPaths: null }),
  ),
  "phase-file-reconciliation": encoded(
    PhaseFileReconciliationFileSchema,
    withSchemaUrl("phase-file-reconciliation", {
      ...phaseFileReconciliation,
      reviewCorrections: [],
    }),
  ),
  "spec-document": encoded(
    SpecDocumentFileSchema,
    withSchemaUrl("spec-document", {
      ...stepped(specDocument),
      surface: specDocument.surface.map(({ surface, binding, before, after }) => ({
        surface,
        summary: EXAMPLE_SURFACE_SUMMARY,
        binding,
        before,
        after,
      })),
      arbitratedQuestions: [],
    }),
  ),
  "plan-document": encoded(
    PlanDocumentFileSchema,
    withSchemaUrl("plan-document", {
      ...stepped(planDocument),
      sourceSpec: null,
      completesSpec: null,
      preamble: { ...planDocument.preamble, openQuestions: [], arbitratedQuestions: [] },
      phases: [
        {
          ...planDocument.phases[0],
          testStrategy: EXAMPLE_TEST_LINES,
          mode: "headless",
          oracle: null,
          assignmentReason: null,
        },
        ...planDocument.phases.slice(1).map((phase) => ({
          ...phase,
          testStrategy: EXAMPLE_TEST_LINES,
          mode: "headless" as const,
          oracle: null,
          assignmentReason: null,
        })),
      ],
    }),
  ),
  "plan-approval-record": encoded(
    PlanRecordFileSchema,
    withSchemaUrl("plan-approval-record", planRecord),
  ),
  "spec-approval-record": encoded(
    SpecRecordFileSchema,
    withSchemaUrl("spec-approval-record", specRecord),
  ),
  "gate-request": encoded(GateRequestFileSchema, withSchemaUrl("gate-request", gateRequest)),
  "brief-request": encoded(BriefRequestFileSchema, withSchemaUrl("brief-request", briefRequest)),
  "brief-record": encoded(BriefRecordFileSchema, withSchemaUrl("brief-record", briefRecord)),
  "gate-report": encoded(GateReportFileSchema, withSchemaUrl("gate-report", gateReport)),
  "brief-report": encoded(BriefReportFileSchema, withSchemaUrl("brief-report", briefReport)),
  "hand-decision-answer": encoded(
    HandDecisionAnswerFileSchema,
    withSchemaUrl("hand-decision-answer", handDecisionAnswer),
  ),
  "decide-verdicts": encoded(
    DecideVerdictsFileSchema,
    withSchemaUrl("decide-verdicts", decideVerdicts),
  ),
  "decision-record-manifest": encoded(
    DecisionRecordManifestFileSchema,
    withSchemaUrl("decision-record-manifest", decisionRecordManifest),
  ),
  "review-record-manifest": encoded(
    ReviewRecordManifestFileSchema,
    withSchemaUrl("review-record-manifest", reviewRecordManifest),
  ),
  "cost-ledger": encoded(CostLedgerFileSchema, withSchemaUrl("cost-ledger", costLedger)),
  "code-review": encoded(CodeReviewFileSchema, withSchemaUrl("code-review", codeReview)),
  "phax-plan-extraction": encoded(
    PlanExtractionAnswerSchema,
    withSchemaUrl("phax-plan-extraction", {
      plan: {
        run: {
          shortName: "invoice-export",
          title: "Invoice export",
          requiredCommands: ["pnpm check"],
        },
        phases: [
          {
            id: "phase-01",
            model: "claude-sonnet-5-5",
            effort: "medium",
            planMarkdownAnchor: "#phase-01-export-rows",
            plannedFilesToCreate: ["src/exportRows.ts"],
            plannedFilesToEdit: [],
            optionalFilesToEdit: [],
            testLines: [],
            commit: { subject: "feat: export rows", body: "Builds the export rows." },
          },
        ],
      },
      incomplete: null,
    }),
  ),
  "architecture-request": encoded(
    ArchitectureRequestFileSchema,
    withSchemaUrl("architecture-request", { files: ["src/example.ts", "src/missing.ts"] }),
  ),
  "architecture-report": encoded(
    ArchitectureReportFileSchema,
    withSchemaUrl("architecture-report", {
      body: "# Architecture — example",
      parts: [
        {
          id: "core-decide",
          name: "core · decide",
          description: "The pure decision logic.",
          globs: ["src/core/decide/**"],
        },
      ],
    }),
  ),
  "oracle-request": encoded(
    OracleRequestFileSchema,
    withSchemaUrl("oracle-request", {
      verdict: "authored",
      phase: "phase-02",
      oraclePhase: "phase-02",
      base: EXAMPLE_BASE,
      files: ["tests/prune.test.ts"],
    }),
  ),
  "first-reading": encoded(
    FirstReadingFileSchema,
    withSchemaUrl("first-reading", {
      pattern: ["Each export row is built by one pure function over the invoice."],
      copiedBy: [{ phase: "phase-02", what: "the credit-note rows copy the row builder" }],
      toCheck: ["Whether the credit-note rows should round per line or per invoice."],
    }),
  ),
  "interactive-handoff": encoded(
    InteractiveHandoffFileSchema,
    withSchemaUrl("interactive-handoff", {
      corrections: [
        {
          what: "Rounded per line, not per invoice.",
          guard: { kind: "test", ref: "tests/unit/exportRows.test.ts" },
        },
        {
          what: "Renamed the row builder.",
          guard: { kind: "none", reason: "A rename the typechecker already guards." },
        },
      ],
      patternFromNowOn: ["Round each line, then sum."],
      nextPhasesNeedToKnow: ["The credit-note rows follow the per-line rounding."],
    }),
  ),
  "interactive-session": encoded(
    InteractiveSessionFileSchema,
    withSchemaUrl("interactive-session", {
      phaseId: "phase-03",
      provider: "claude-code",
      interactiveResume: "verified",
      current: {
        provider: "claude-code",
        model: "claude-sonnet-5-5",
        effort: "medium",
        sessionId: "4f6c1a52-0000-4000-8000-000000000001",
        startedAt: "2026-01-01T09:10:00.000Z",
        origin: "first-turn",
      },
      history: [],
      firstTurns: [
        {
          outcome: "answered",
          origin: "first-turn",
          startedAt: "2026-01-01T09:10:00.000Z",
          endedAt: "2026-01-01T09:12:00.000Z",
          sessionId: "4f6c1a52-0000-4000-8000-000000000001",
        },
      ],
      turnInProgress: null,
      transcripts: [
        {
          sessionId: "4f6c1a52-0000-4000-8000-000000000001",
          status: "captured",
          sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      ],
      builderUsage: null,
    }),
  ),
  "review-stop": encoded(
    ReviewStopFileSchema,
    withSchemaUrl("review-stop", {
      run: "example.invoice-export",
      state: "awaiting_review",
      cause: "declared",
      phase: {
        id: "phase-03",
        title: "Export the credit notes",
        mode: "interactive",
        position: 3,
        of: 4,
      },
      firstReading: "/example/runs/invoice-export/phase-03/first-reading.md",
      worktree: "/example/worktrees/invoice-export/phase-03",
      seed: "/example/worktrees/invoice-export/phase-03/.phax-context/review-seed.md",
      session: {
        provider: "claude-code",
        sessionId: "4f6c1a52-0000-4000-8000-000000000001",
        origin: "first-turn",
        interactiveResume: "verified",
      },
      commands: {
        continue: {
          cwd: "/example/worktrees/invoice-export/phase-03",
          argv: ["claude", "--resume", "4f6c1a52-0000-4000-8000-000000000001"],
          env: {},
        },
        freshStart: {
          cwd: "/example/worktrees/invoice-export/phase-03",
          argv: ["claude"],
          env: {},
        },
        enterPhase: {
          cwd: "/example/repo",
          argv: ["phax", "enter-phase", "invoice-export", "phase-03"],
          env: {},
        },
        close: { cwd: "/example/repo", argv: ["phax", "resume", "invoice-export"], env: {} },
        reset: {
          cwd: "/example/repo",
          argv: ["phax", "reset-phase", "invoice-export", "phase-03"],
          env: {},
        },
      },
      lastClose: null,
      closeBase: null,
    }),
  ),
};

const EXAMPLE_REVIEW_COMMIT = "89abcdef0123456789abcdef0123456789abcdef";

function phaseStatusWithStop(
  state: "awaiting_review" | "committed",
  mode: "headless" | "interactive",
  stop: PhaseStop,
): Doc {
  return encoded(
    PhaseStatusFileSchema,
    withSchemaUrl("phase-status", {
      ...stepped(phaseStatus),
      state,
      base: EXAMPLE_BASE,
      mode,
      stop,
    }),
  );
}

/**
 * One current-shape phase status per variant of a phase's `stop`, keyed by a
 * label naming the cause, the status and the outcome.
 */
export const phaseStatusStopDocuments: Readonly<Record<string, Doc>> = {
  "declared waiting": phaseStatusWithStop("awaiting_review", "interactive", {
    cause: "declared",
    status: "waiting",
  }),
  "declared closed corrected": phaseStatusWithStop("committed", "interactive", {
    cause: "declared",
    status: "closed",
    outcome: "corrected",
    oracleStep: "authored",
    closedBy: { name: "Ada Example", email: "ada@example.com" },
  }),
  "declared closed unchanged": phaseStatusWithStop("committed", "interactive", {
    cause: "declared",
    status: "closed",
    outcome: "unchanged",
    closedBy: { name: "Ada Example", email: "ada@example.com" },
  }),
  "held waiting": phaseStatusWithStop("awaiting_review", "headless", {
    cause: "held",
    status: "waiting",
  }),
  "held closed corrected": phaseStatusWithStop("committed", "headless", {
    cause: "held",
    status: "closed",
    outcome: "corrected",
    reviewCommit: EXAMPLE_REVIEW_COMMIT,
    oracleStep: "none",
    closedBy: { name: "Ada Example", email: "ada@example.com" },
  }),
  "held closed unchanged": phaseStatusWithStop("committed", "headless", {
    cause: "held",
    status: "closed",
    outcome: "unchanged",
    closedBy: { name: "Ada Example", email: "ada@example.com" },
  }),
};

/**
 * A current-shape `review-stop` in its held variant: a stop after the commit
 * of the headless phase-02 of the made-up invoice-export run, with the
 * builder session current.
 */
export const heldReviewStopDocument: Doc = encoded(
  ReviewStopFileSchema,
  withSchemaUrl("review-stop", {
    run: "example.invoice-export",
    state: "awaiting_review",
    cause: "held",
    phase: {
      id: "phase-02",
      title: "Write the credit-note rows",
      mode: "headless",
      position: 2,
      of: 4,
    },
    phaseCommit: EXAMPLE_BASE,
    worktree: "/example/worktrees/invoice-export/phase-02",
    seed: "/example/worktrees/invoice-export/phase-02/.phax-context/review-seed.md",
    session: {
      provider: "claude-code",
      sessionId: "4f6c1a52-0000-4000-8000-0000000000b1",
      origin: "builder",
      interactiveResume: "verified",
    },
    commands: {
      continue: {
        cwd: "/example/worktrees/invoice-export/phase-02",
        argv: ["claude", "--resume", "4f6c1a52-0000-4000-8000-0000000000b1"],
        env: {},
      },
      freshStart: {
        cwd: "/example/worktrees/invoice-export/phase-02",
        argv: ["claude"],
        env: {},
      },
      enterPhase: {
        cwd: "/example/repo",
        argv: ["phax", "enter-phase", "invoice-export", "phase-02"],
        env: {},
      },
      close: { cwd: "/example/repo", argv: ["phax", "resume", "invoice-export"], env: {} },
      reset: {
        cwd: "/example/repo",
        argv: ["phax", "reset-phase", "invoice-export", "phase-02"],
        env: {},
      },
    },
    lastClose: null,
    closeBase: null,
  }),
);

/**
 * A current-shape `run-list`: the made-up invoice-export run held at phase-02,
 * which embeds its review stop, and the payments-fix run that failed, which
 * has none.
 */
function runListDocument(): Doc {
  const stop = Schema.decodeUnknownSync(ReviewStopFileSchema)(heldReviewStopDocument);
  return encoded(
    RunListFileSchema,
    withSchemaUrl("run-list", {
      runs: [
        {
          qualifiedName: "example.invoice-export",
          namespace: "example",
          shortName: "invoice-export",
          state: "awaiting_review",
          branch: "phax/invoice-export",
          currentPhase: "2/4",
          gateProfile: "standard",
          updatedAt: "2026-10-24 09:30",
          lockState: "none",
          recordsPending: 1,
          archivePath: null,
          stop,
        },
        {
          qualifiedName: "example.payments-fix",
          namespace: "example",
          shortName: "payments-fix",
          state: "failed",
          branch: "phax/payments-fix",
          currentPhase: null,
          gateProfile: null,
          updatedAt: "2026-10-23 17:05",
          lockState: "none",
          recordsPending: null,
          archivePath: null,
          stop: null,
        },
      ],
    }),
  );
}

/**
 * A current-shape `interactive-session` for a held phase: the builder session
 * is current, and a read-only closing turn that resumed it is in progress.
 */
export const builderInteractiveSessionDocument: Doc = encoded(
  InteractiveSessionFileSchema,
  withSchemaUrl("interactive-session", {
    phaseId: "phase-02",
    provider: "claude-code",
    interactiveResume: "verified",
    current: {
      provider: "claude-code",
      model: "claude-sonnet-5-5",
      effort: "high",
      sessionId: "4f6c1a52-0000-4000-8000-0000000000b1",
      startedAt: "2026-01-01T09:10:00.000Z",
      origin: "builder",
    },
    history: [],
    firstTurns: [],
    turnInProgress: {
      kind: "closing-turn",
      turn: 1,
      origin: "builder",
      beforeTree: "0123456789abcdef0123456789abcdef01234567",
      personHandoffBefore: null,
      startedAt: "2026-01-01T09:20:00.000Z",
    },
    transcripts: null,
    builderUsage: {
      available: true,
      usage: {
        provider: "claude-code",
        inputTokens: 1200,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 300,
        outputTokens: 400,
        totalCostUsd: 0.02,
      },
    },
  }),
);

/**
 * A current-shape phase record manifest of a held phase closed with
 * corrections: its stop names the review commit, its closer and the builder
 * session with its transcript's digest.
 */
export const heldPhaseRecordManifestDocument: Doc = encoded(
  RunRecordManifestFileSchema,
  withSchemaUrl("phase-record-manifest", {
    ...stepped(phaseRecordManifest),
    usage: liftFrozenTokenUsage(phaseRecordManifest.usage),
    oracle: null,
    mode: "headless",
    stop: {
      cause: "held",
      outcome: "corrected",
      reviewCommit: "0123456789abcdef0123456789abcdef01234567",
      closedBy: { name: "Ada Example", email: "ada@example.test" },
      sessions: [
        {
          provider: "claude-code",
          model: "claude-sonnet-5-5",
          effort: "high",
          sessionId: "4f6c1a52-0000-4000-8000-0000000000b1",
          origin: "builder",
          transcript: {
            status: "captured",
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      ],
    },
  }),
);

/**
 * A phase record manifest older than the pre-schema shape: `version: 1` and
 * no `verifiedSurfaces` and no `$schema`, otherwise like the pre-schema one.
 */
export const versionOnePhaseRecordManifest: Doc = withKey(
  withoutKey(preSchemaDocuments["phase-record-manifest"], "verifiedSurfaces"),
  "version",
  1,
);

// The messages a test expects follow the package's generated values, so a
// release commit, which names the first supported release, leaves them green.

/**
 * How the package fails a `$schema` document at `release`, below its own
 * release: a development build once a first supported release is known,
 * else no shape at that release.
 */
export function belowOwnReleaseMessage(formatId: FormatId, release: string): string {
  return FIRST_SUPPORTED_RELEASE !== null && compareReleases(release, FIRST_SUPPORTED_RELEASE) < 0
    ? developmentBuildMessage(schemaUrl(formatId, release), FIRST_SUPPORTED_RELEASE)
    : `no ${formatId} shape is known at release ${release}`;
}

/** How the package fails a document its frozen pre-schema decoder rejects, up to the violation. */
export function preSchemaUnsupported(label: string): string {
  return preSchemaUnsupportedMessage(label, "", FIRST_SUPPORTED_RELEASE).slice(0, -" ()".length);
}
