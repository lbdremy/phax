// The only source of test documents for the schemas package (spec §5.11).
// Every document is a made-up value typed as a format's frozen pre-schema
// type, or, for a format born with $schema, as phax's in-memory type. `preSchemaDocuments` encodes it through the frozen module, so it
// survives phax's later shape changes; `validDocuments` encodes it through
// phax's own schema, so a schema change breaks the build rather than silently
// staling a fixture. Nothing here comes from a phax home, a records branch or
// another repository.
import { Schema } from "effect";
import { FIRST_SUPPORTED_RELEASE } from "../../../packages/schemas/src/generated/index.js";
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
import { AuthoringRecordManifestFileSchema } from "../../../src/schemas/authoringRecord.js";
import {
  BriefAnswerFileSchema,
  BriefRecordFileSchema,
  BriefRequestFileSchema,
  type BriefAnswer,
  type BriefRecord,
  type PhaseBriefRequest,
} from "../../../src/schemas/brief.js";
import { BriefReportFileSchema, type BriefReport } from "../../../src/schemas/briefReport.js";
import { ComplianceReviewFileSchema } from "../../../src/schemas/complianceReview.js";
import { GateAttributionFileSchema } from "../../../src/schemas/gateAttribution.js";
import { GateReportFileSchema, type GateReport } from "../../../src/schemas/gateReport.js";
import { GateRequestFileSchema, type GateRequest } from "../../../src/schemas/gateRequest.js";
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
import { PhaxPlanFileSchema } from "../../../src/schemas/phaxPlan.js";
import { PlanDocumentFileSchema } from "../../../src/schemas/planDocument.js";
import { PhaseFileReconciliationFileSchema } from "../../../src/schemas/reconciliation.js";
import { withSchemaUrl } from "../../../src/schemas/persisted.js";
import { RegistryFileSchema } from "../../../src/schemas/registry.js";
import { RunRecordManifestFileSchema } from "../../../src/schemas/runRecord.js";
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
import { SpecDocumentFileSchema } from "../../../src/schemas/specDocument.js";
import { PhaseStatusFileSchema, RunStatusFileSchema } from "../../../src/schemas/status.js";

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

// A format born with $schema has no frozen type: its record is typed as
// phax's in-memory value.
const planRecord: PlanRecord = {
  artifact: "docs/plans/example.md",
  planFingerprint: "plan-fingerprint-0001",
  approvedAt: CREATED_AT,
  baseline: BASELINE,
  sourceSpec: { path: "docs/specs/example.md", fingerprint: "spec-fingerprint-0001" },
};

const specRecord: SpecRecord = {
  artifact: "docs/specs/example.md",
  specFingerprint: "spec-fingerprint-0001",
  approvedAt: CREATED_AT,
  baseline: BASELINE,
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

const briefAnswer: BriefAnswer = {
  guarantees: [
    {
      id: "example-no-io",
      statement: "nothing under src/ imports a node: module",
      places: [
        {
          location: { file: "src/example.ts", line: 3 },
          state: "forbidden",
          due: "this-phase",
          what: "imports node:fs",
          repair: "remove the import",
        },
        { location: { file: "src/missing.ts" }, state: "met" },
      ],
    },
  ],
};

const briefRecord: BriefRecord = {
  moment: "pulled",
  request: withSchemaUrl("brief-request", briefRequest),
  outcome: { kind: "answered", answer: withSchemaUrl("brief-answer", briefAnswer) },
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

// Spec-less, so that phax's bridge and the package step it alike: a pre-schema
// sidecar never recorded `completesSpec`, which only null may stand for.
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
      testStrategy: "A unit test.",
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
 * A format's pre-schema document as phax's bridge and the package's
 * `toLatest*` both read it: without `version`, and with each fact a later
 * shape added set to the only value the document allows — a spec-less plan
 * document's `completesSpec` is null.
 */
export function latestPreSchema(id: PreSchemaFormatId): Doc {
  const { version: _version, ...rest } = preSchemaDocuments[id];
  return id === "plan-document" ? { ...rest, completesSpec: null } : rest;
}

/**
 * One minimal document per format id, in the shape phax writes today:
 * `$schema` first, stamped by `withSchemaUrl`.
 */
export const validDocuments: { readonly [F in FormatId]: Doc } = {
  registry: encoded(RegistryFileSchema, withSchemaUrl("registry", { runs: registry.runs })),
  "run-status": encoded(RunStatusFileSchema, withSchemaUrl("run-status", stepped(runStatus))),
  "phase-status": encoded(
    PhaseStatusFileSchema,
    withSchemaUrl("phase-status", { ...stepped(phaseStatus), base: EXAMPLE_BASE }),
  ),
  "phax-plan": encoded(PhaxPlanFileSchema, withSchemaUrl("phax-plan", stepped(phaxPlan))),
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
    withSchemaUrl("phase-record-manifest", stepped(phaseRecordManifest)),
  ),
  "authoring-record-manifest": encoded(
    AuthoringRecordManifestFileSchema,
    withSchemaUrl("authoring-record-manifest", stepped(authoringRecordManifest)),
  ),
  "gate-attribution": encoded(
    GateAttributionFileSchema,
    withSchemaUrl("gate-attribution", gateAttribution),
  ),
  "phase-file-reconciliation": encoded(
    PhaseFileReconciliationFileSchema,
    withSchemaUrl("phase-file-reconciliation", phaseFileReconciliation),
  ),
  "spec-document": encoded(
    SpecDocumentFileSchema,
    withSchemaUrl("spec-document", stepped(specDocument)),
  ),
  "plan-document": encoded(
    PlanDocumentFileSchema,
    withSchemaUrl("plan-document", {
      ...stepped(planDocument),
      sourceSpec: null,
      completesSpec: null,
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
  "brief-answer": encoded(BriefAnswerFileSchema, withSchemaUrl("brief-answer", briefAnswer)),
  "brief-record": encoded(BriefRecordFileSchema, withSchemaUrl("brief-record", briefRecord)),
  "gate-report": encoded(GateReportFileSchema, withSchemaUrl("gate-report", gateReport)),
  "brief-report": encoded(BriefReportFileSchema, withSchemaUrl("brief-report", briefReport)),
};

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
