// The only source of test documents for the schemas package (spec §5.11).
// Every document is a made-up value typed as a format's frozen pre-schema
// type. `preSchemaDocuments` encodes it through the frozen module, so it
// survives phax's later shape changes; `validDocuments` encodes it through
// phax's own schema, so a schema change breaks the build rather than silently
// staling a fixture. Nothing here comes from a phax home, a records branch or
// another repository.
import { Schema } from "effect";
import { BranchNameSchema } from "../../../src/domain/branded.js";
import { ApprovalRecordFileSchema } from "../../../src/schemas/approvalRecord.js";
import { AuthoringRecordManifestSchema } from "../../../src/schemas/authoringRecord.js";
import { ComplianceReviewFileSchema } from "../../../src/schemas/complianceReview.js";
import { GateAttributionSchema } from "../../../src/schemas/gateAttribution.js";
import { GateDiagnosticsDocumentSchema } from "../../../src/schemas/gateDiagnostics.js";
import { GatePendingDocumentSchema } from "../../../src/schemas/gatePending.js";
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
  GateDiagnosticsPreSchemaSchema,
  type GateDiagnosticsPreSchema,
} from "../../../src/schemas/history/gate-diagnostics/pre-schema.js";
import {
  GatePendingPreSchemaSchema,
  type GatePendingPreSchema,
} from "../../../src/schemas/history/gate-pending/pre-schema.js";
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
import { PhaxPlanFileSchema } from "../../../src/schemas/phaxPlan.js";
import { PlanDocumentSchema } from "../../../src/schemas/planDocument.js";
import { PhaseFileReconciliationSchema } from "../../../src/schemas/reconciliation.js";
import { withSchemaUrl } from "../../../src/schemas/persisted.js";
import { RegistryFileSchema } from "../../../src/schemas/registry.js";
import { RunRecordManifestSchema } from "../../../src/schemas/runRecord.js";
import type { FormatId } from "../../../src/schemas/schemaUrl.js";
import { SpecApprovalRecordFileSchema } from "../../../src/schemas/specApprovalRecord.js";
import { SpecDocumentSchema } from "../../../src/schemas/specDocument.js";
import { PhaseStatusFileSchema, RunStatusFileSchema } from "../../../src/schemas/status.js";

type CompletionDiagnostic = GatePendingPreSchema["steps"][number]["pending"][number]["diagnostic"];

export type Doc = Readonly<Record<string, unknown>>;

function encoded<A, I>(schema: Schema.Schema<A, I>, value: A): Doc {
  return Schema.encodeSync(schema)(value) as Doc;
}

/** A copy of `doc` with `key` set to `value`. */
export function withKey(doc: Doc, key: string, value: unknown): Doc {
  return { ...doc, [key]: value };
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

const gateAttribution: GateAttributionPreSchema = {
  phase: "phase-01",
  steps: [
    { command: "pnpm typecheck", surface: "structural", result: "pass" },
    { command: "pnpm test", surface: "local", result: "fail" },
  ],
};

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

const completion: CompletionDiagnostic = {
  class: "completion",
  scopes: ["phase-02"],
  rule: "planned-file-missing",
  location: { file: "src/later.ts" },
  message: "the planned file src/later.ts does not exist yet",
  repair: "create src/later.ts, as phase-02 plans",
};

const gateDiagnostics: GateDiagnosticsPreSchema = {
  diagnostics: [
    {
      class: "invariant",
      rule: "no-io-in-domain",
      location: { file: "src/domain/example.ts", line: 12 },
      message: "src/domain/example.ts imports node:fs",
      repair: "read the file through the fs port",
    },
    completion,
  ],
};

const gatePending: GatePendingPreSchema = {
  closed: ["phase-01"],
  steps: [
    { command: "pnpm test", pending: [{ diagnostic: completion, openScopes: ["phase-02"] }] },
  ],
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

const planDocument: PlanDocumentPreSchema = {
  version: 1,
  kind: "plan",
  sourceSpec: "docs/specs/example.md",
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
      testStrategy: "A unit test.",
      implementationOrder: ["Write the test.", "Write the module."],
      excludedScope: ["Everything else."],
      verification: "The standard gate.",
      expectedHandoff: "The module's exports.",
    },
  ],
};

/**
 * One minimal document per format id in its pre-schema shape, without
 * `$schema`, encoded through the format's frozen module.
 */
export const preSchemaDocuments: { readonly [F in FormatId]: Doc } = {
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
  "gate-diagnostics": encoded(GateDiagnosticsPreSchemaSchema, gateDiagnostics),
  "gate-pending": encoded(GatePendingPreSchemaSchema, gatePending),
  "spec-document": encoded(SpecDocumentPreSchemaSchema, specDocument),
  "plan-document": encoded(PlanDocumentPreSchemaSchema, planDocument),
};

/** The formats phax already writes with `$schema`; each family phase adds its own. */
export const WRITES_SCHEMA: ReadonlySet<FormatId> = new Set<FormatId>([
  "registry",
  "run-status",
  "phase-status",
  "phax-plan",
  "compliance-review",
]);

/** A pre-schema value as phax holds it in memory: the same fields, without `version`. */
function stepped<T extends { readonly version: 1 }>(value: T): Omit<T, "version"> {
  const { version: _version, ...rest } = value;
  return rest;
}

/**
 * One minimal document per format id, in the shape phax writes today. A
 * format that writes `$schema` carries it first, stamped by `withSchemaUrl`;
 * the others carry none yet.
 */
export const validDocuments: { readonly [F in FormatId]: Doc } = {
  registry: encoded(RegistryFileSchema, withSchemaUrl("registry", { runs: registry.runs })),
  "run-status": encoded(RunStatusFileSchema, withSchemaUrl("run-status", stepped(runStatus))),
  "phase-status": encoded(
    PhaseStatusFileSchema,
    withSchemaUrl("phase-status", stepped(phaseStatus)),
  ),
  "phax-plan": encoded(PhaxPlanFileSchema, withSchemaUrl("phax-plan", stepped(phaxPlan))),
  "compliance-review": encoded(
    ComplianceReviewFileSchema,
    withSchemaUrl("compliance-review", stepped(complianceReview)),
  ),
  "plan-approvals": encoded(ApprovalRecordFileSchema, planApprovals),
  "spec-approvals": encoded(SpecApprovalRecordFileSchema, specApprovals),
  "phase-record-manifest": encoded(RunRecordManifestSchema, phaseRecordManifest),
  "authoring-record-manifest": encoded(AuthoringRecordManifestSchema, authoringRecordManifest),
  "gate-attribution": encoded(GateAttributionSchema, gateAttribution),
  "phase-file-reconciliation": encoded(PhaseFileReconciliationSchema, phaseFileReconciliation),
  "gate-diagnostics": encoded(GateDiagnosticsDocumentSchema, gateDiagnostics),
  "gate-pending": encoded(GatePendingDocumentSchema, gatePending),
  "spec-document": encoded(SpecDocumentSchema, specDocument),
  "plan-document": encoded(PlanDocumentSchema, planDocument),
};

/**
 * A phase record manifest older than the pre-schema shape: `version: 1` and
 * no `verifiedSurfaces`, otherwise like the valid one.
 */
export const versionOnePhaseRecordManifest: Doc = withKey(
  withoutKey(validDocuments["phase-record-manifest"], "verifiedSurfaces"),
  "version",
  1,
);
