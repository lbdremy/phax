// ac-producer and ac-identify-alone: drive phax's writers through in-memory
// ports — run creation, status transitions, approvals, headless authoring, a
// gate run, a file reconciliation, a phase record and a compliance review —
// then check every persisted file they wrote. Each starts with `$schema`
// naming its format at the root package.json release, carries no `version`,
// and is identified by `parseDocument` from its content alone. Every value
// here is made up.
import { readFileSync } from "node:fs";
import { basename } from "node:path/posix";
import { Effect, Either, Layer } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import { CURRENT_SHAPES } from "../../packages/schemas/src/generated/index.js";
import { parseDocument } from "../../packages/schemas/src/index.js";
import { putPlanApprovalRecord, putSpecApprovalRecord } from "../../src/app/approvalRecordStore.js";
import { authorArtifact, type AuthorArtifactInput } from "../../src/app/authorArtifact.js";
import { dispatch, type DispatcherContext } from "../../src/app/dispatcher.js";
import { runGates, serializeGateRequest } from "../../src/app/gates.js";
import { makeGateRequest } from "../../src/domain/gate/gateRequest.js";
import { createPhaseFolder } from "../../src/app/phaseFolder.js";
import { reconcilePhaseFiles } from "../../src/app/reconcilePhaseFiles.js";
import { reviewCompliance } from "../../src/app/reviewCompliance.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { writeRecord } from "../../src/app/writeRecord.js";
import {
  decodeShortName,
  type BranchName,
  type ClaudeSessionId,
  type PhaseId,
  type RunId,
  type WorktreePath,
} from "../../src/domain/branded.js";
import type { PhaxEvent } from "../../src/domain/events.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import type { RoutingResolution } from "../../src/domain/routing/types.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { makeFakeSystemTelemetry } from "../../src/infra/fakes/systemTelemetry.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import type { PhaxPlan } from "../../src/schemas/phaxPlan.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import { PHAX_RELEASE } from "../../src/schemas/release.js";
import { FORMAT_IDS, schemaUrl, type FormatId } from "../../src/schemas/schemaUrl.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";

// The release phax names in `$schema`: the root package.json version, read
// here rather than through the generated constant.
const rootVersion = (
  JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    readonly version: string;
  }
).version;

const STATE_ROOT = "/state";
const REPO_ROOT = "/work/example-repo";
const NAMESPACE = "example";
const SHORT_NAME = "example-run";
const RUN_PATH = `${STATE_ROOT}/runs/${NAMESPACE}.${SHORT_NAME}`;
const PHASE_FOLDER = `${RUN_PATH}/phase-01`;
const WORKTREE = "/work/example-repo-worktrees/phase-01";
const BASELINE = "0123456789abcdef0123456789abcdef01234567";
const SPEC_NOW = "2026-01-01T09:00:00.000Z";
const PLAN_NOW = "2026-01-01T09:05:00.000Z";
const SOURCE_SPEC = "docs/specs/2601010800-example.md";

const RECORDS_IN_REPO: ResolvedRecordsConfig = {
  enabled: true,
  transcript: true,
  destination: { kind: "in-repo" },
  autoPush: false,
};

const security: ResolvedSecurityConfig = {
  profile: "secure",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],
};

const config: ResolvedConfig = {
  raw: {
    version: 1,
    name: NAMESPACE,
    state: { root: STATE_ROOT },
    gateProfiles: {
      fast: [{ command: "pnpm test", surface: "local", firing: "every-phase", output: "log" }],
    },
  },
  stateRoot: STATE_ROOT,
  namespace: NAMESPACE,
  repoRoot: REPO_ROOT,
  maxFixAttempts: 1,
  extractPlanModel: "example-model",
  extractPlanEffort: "low",
  fileReconciliationMode: "report_only",
  publish: resolvePublishConfig(undefined),
  complianceReview: resolveComplianceReviewConfig(undefined),
  codeReview: resolveCodeReviewConfig(undefined),
  authoring: resolveAuthoringConfig(undefined),
  security: { ...security, profile: "unsafe" },
  records: RECORDS_IN_REPO,
};

const plan: PhaxPlan = {
  run: {
    shortName: SHORT_NAME,
    title: "Example run",
    branch: "phax/example-run",
    requiredCommands: [],
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
    },
  ],
};

const resolution: RoutingResolution = {
  requested: { model: "example-model", family: "claude-opus", effort: "high" },
  selected: {
    provider: "claude-code",
    family: "claude-opus",
    concreteModel: "example-model",
    thinking: "high",
  },
  relationship: "exact",
  reason: "exact match",
};

const SPEC_DOCUMENT = {
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
  openQuestions: [],
  planningNote: { settled: ["One phase."], open: [], constraints: [] },
  docsPage: { kind: "none", why: "Nothing user-facing." },
};

const PLAN_DOCUMENT = {
  version: 1,
  kind: "plan",
  sourceSpec: SOURCE_SPEC,
  completesSpec: true,
  run: { shortName: SHORT_NAME, title: "Example run", requiredCommands: [] },
  preamble: {
    summary: "An example plan.",
    requiredCommandsNote: "No command beyond the gate.",
    technicalArbitrations: [],
  },
  phases: [
    {
      ...plan.phases[0],
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

const APPROVED_SPEC = `---
status: Approved
date: 2026-01-01
audience: implementation planning
scope: functional behavior
approved:
  date: 2026-01-01
  baseline: abc1234
---
# Example spec
`;

// A gate step's stdout, stamped at the running release: one invariant and one
// completion, both failing.
const MIXED_DIAGNOSTICS = JSON.stringify({
  $schema: schemaUrl("gate-diagnostics", PHAX_RELEASE),
  diagnostics: [
    {
      rule: "no-io-in-domain",
      class: "invariant",
      location: { file: "src/domain/example.ts", line: 3 },
      message: "src/domain/example.ts imports node:fs",
      repair: "read the file through the fs port",
    },
    {
      rule: "wire-example",
      class: "completion",
      location: { file: "src/example.ts" },
      message: "the example module is not wired yet",
      repair: "wire it in a later phase",
    },
  ],
});

const COMPLIANCE_VERDICT = JSON.stringify({
  version: 1,
  verdict: "conformant",
  summary: "The run delivers the plan.",
  perPhase: [{ phaseId: "phase-01", verdict: "conformant", findings: [] }],
  attentionPoints: [],
  pointers: [],
});

/** One file phax wrote: where, and its parsed content. */
interface Written {
  readonly location: string;
  readonly format: FormatId;
  readonly document: Readonly<Record<string, unknown>>;
}

/**
 * The format a written file's location maps to, or undefined for a file that
 * is not a persisted format (logs, markdown, the config copy, the cache).
 * `document.json` in an authoring session holds the document of its kind.
 */
function formatAt(
  location: string,
  authoringKinds: ReadonlyMap<string, FormatId>,
): FormatId | undefined {
  const name = basename(location);
  if (name === "registry.json") return "registry";
  if (name === "run-status.json") return "run-status";
  if (name === "status.json") return "phase-status";
  if (name === "phax-plan.json") return "phax-plan";
  if (name === "compliance-review.json") return "compliance-review";
  if (name === "gate-attribution.json") return "gate-attribution";
  if (name === "file-reconciliation.json") return "phase-file-reconciliation";
  if (name.endsWith(".diagnostics.json")) return "gate-diagnostics";
  if (name.endsWith(".request.json")) return "gate-request";
  if (name === "record.json") {
    return location.includes("authoring/") ? "authoring-record-manifest" : "phase-record-manifest";
  }
  if (name === "document.json") {
    const id = [...authoringKinds.keys()].find((key) => location.includes(`/${key}/`));
    return id === undefined ? undefined : authoringKinds.get(id);
  }
  if (location === "docs/plans/approvals.json") return "plan-approvals";
  if (location === "docs/specs/approvals.json") return "spec-approvals";
  if (/^docs\/plans\/approvals\/[^/]+\.json$/.test(location)) return "plan-approval-record";
  if (/^docs\/specs\/approvals\/[^/]+\.json$/.test(location)) return "spec-approval-record";
  if (/^docs\/specs\/[^/]+\.json$/.test(location)) return "spec-document";
  if (/^docs\/plans\/[^/]+\.json$/.test(location)) return "plan-document";
  return undefined;
}

async function driveWriters(): Promise<ReadonlyArray<Written>> {
  const fs = makeFakeFileSystem();
  const git = makeFakeGit();
  const shell = makeFakeShell();
  const backend = makeFakeBackend();
  const github = makeFakeGitHub();
  git.impl.setHeadCommit("a1b2c3d4".repeat(5));
  const layer = Layer.mergeAll(
    fs.layer,
    git.layer,
    shell.layer,
    backend.layer,
    github.layer,
    makeFakeSystemTelemetry().layer,
  );
  const run = <A, E>(effect: Effect.Effect<A, E, Layer.Layer.Success<typeof layer>>) =>
    Effect.runPromise(Effect.either(Effect.provide(effect, layer)));

  // Inputs the test hands phax, never files phax wrote.
  const seeded = new Set<string>();
  const seed = (path: string, content: string) => {
    seeded.add(path);
    fs.impl.setFile(path, content);
  };

  // Run creation: run status, phax-plan and the registry.
  const shortName = Either.getOrThrow(decodeShortName(SHORT_NAME));
  const created = await run(createRunFolder(shortName, "# Example plan\n", plan, config));
  if (Either.isLeft(created)) throw new Error("createRunFolder failed");
  const phase = plan.phases[0];
  if (phase === undefined) throw new Error("no phase");
  await run(
    createPhaseFolder(
      RUN_PATH,
      phase,
      0,
      {
        kind: "created",
        branch: "phax/example-run--phase-01" as BranchName,
        base: "0123456789abcdef0123456789abcdef01234567",
      },
      REPO_ROOT,
    ),
  );

  // Two dispatched transitions: the run starts, then its phase.
  const ctx: DispatcherContext = {
    runPath: RUN_PATH,
    shortName: SHORT_NAME,
    phaseFolderPath: PHASE_FOLDER,
    phaseId: "phase-01",
  };
  const eventFields = {
    eventId: "evt-0001",
    occurredAt: "2026-01-01T09:10:00.000Z",
    run: SHORT_NAME as RunId,
    phase: "phase-01" as PhaseId,
  };
  const runStarted: PhaxEvent = { type: "RunStarted", ...eventFields };
  const phaseStarted: PhaxEvent = {
    type: "PhaseStartRequested",
    ...eventFields,
    phaseId: "phase-01" as PhaseId,
  };
  for (const event of [runStarted, phaseStarted]) {
    const dispatched = await run(dispatch(event, ctx));
    if (Either.isLeft(dispatched) || dispatched.right.disposition !== "Handled") {
      throw new Error(`${event.type} was not handled`);
    }
  }

  // A plan approval and a spec approval.
  await run(
    putPlanApprovalRecord("docs/plans/2601010900-example-plan.md", {
      planFingerprint: "plan-fingerprint-0001",
      approvedAt: SPEC_NOW,
      baseline: BASELINE,
      sourceSpec: { path: SOURCE_SPEC, fingerprint: "spec-fingerprint-0001" },
    }),
  );
  await run(
    putSpecApprovalRecord(SOURCE_SPEC, {
      specFingerprint: "spec-fingerprint-0001",
      approvedAt: SPEC_NOW,
      baseline: BASELINE,
    }),
  );

  // Two headless authoring sessions, records on: a sidecar, the session's
  // document.json and an authoring record each.
  const authoringKinds = new Map<string, FormatId>();
  seed(SOURCE_SPEC, APPROVED_SPEC);
  const authoring: ReadonlyArray<readonly [Partial<AuthorArtifactInput>, string, FormatId]> = [
    [{ kind: "spec", nowIso: SPEC_NOW }, JSON.stringify(SPEC_DOCUMENT), "spec-document"],
    [
      {
        kind: "plan",
        nowIso: PLAN_NOW,
        sourceSpec: SOURCE_SPEC,
        completion: { last: true, notLast: false },
      },
      JSON.stringify(PLAN_DOCUMENT),
      "plan-document",
    ],
  ];
  for (const [overrides, finalText, format] of authoring) {
    backend.impl.addRunResponse({
      sessionId: "session-authoring" as ClaudeSessionId,
      outputPath: `${STATE_ROOT}/authoring/output.jsonl`,
      finalText,
    });
    const authored = await run(
      authorArtifact({
        kind: "spec",
        slug: "example",
        brief: { text: "An example brief.\n", path: "brief.md" },
        sourceSpec: null,
        completion: { last: false, notLast: false },
        model: "example-model",
        effort: "high",
        resolution,
        skillText: "# example skill\n",
        security,
        repoRoot: REPO_ROOT,
        stateRoot: STATE_ROOT,
        extractPlanModel: "example-model",
        extractPlanEffort: "medium",
        nowIso: SPEC_NOW,
        records: RECORDS_IN_REPO,
        publishRemote: "origin",
        output: { warn: () => {} },
        ...overrides,
      }),
    );
    if (Either.isLeft(authored)) {
      throw new Error(`authoring ${format} failed: ${JSON.stringify(authored.left)}`);
    }
    expect(authored.right.record).toMatchObject({ kind: "written" });
    authoringKinds.set(authored.right.authoringId, format);
  }

  // One gate run: request, attribution and diagnostics documents.
  shell.impl.setResponse("pnpm audit", { exitCode: 1, stdout: MIXED_DIAGNOSTICS, stderr: "" });
  await run(
    runGates({
      steps: [
        {
          command: "pnpm audit",
          surface: "local",
          firing: "every-phase",
          output: "diagnostics",
          input: "gate-request",
        },
      ],
      cwd: WORKTREE,
      attemptLogPath: `${PHASE_FOLDER}/checks-attempt-01.log`,
      attributionPath: `${PHASE_FOLDER}/gate-attribution.json`,
      phaseId: "phase-01",
      gateRequest: serializeGateRequest(
        makeGateRequest({
          phaseId: "phase-01",
          base: "0123456789abcdef0123456789abcdef01234567",
          terminal: true,
          phases: plan.phases,
        }),
      ),
    }),
  );

  // A file reconciliation.
  const reconciled = await run(
    reconcilePhaseFiles({
      phase,
      worktreePath: WORKTREE as WorktreePath,
      phaseFolderPath: PHASE_FOLDER,
      runId: created.right.runId,
      fileReconciliationMode: "report_only",
    }),
  );
  if (Either.isLeft(reconciled)) throw new Error("reconcilePhaseFiles failed");

  // The phase's record, which also carries the phase folder's timeline files.
  const recorded = await run(
    writeRecord({
      repoRoot: REPO_ROOT,
      phaseFolderPath: PHASE_FOLDER,
      runId: created.right.runId,
      phaseId: "phase-01",
      provider: "claude-code",
      model: "example-model",
      effort: "medium",
      outcome: "committed",
      records: RECORDS_IN_REPO,
      sourceSha: "abc1234",
    }),
  );
  if (Either.isLeft(recorded) || recorded.right.kind !== "written") {
    throw new Error("writeRecord wrote no record");
  }

  // A compliance review with a fake agent, whose verdict file phax decodes.
  const phaxContext = `${WORKTREE}/.phax-context`;
  seed(`${RUN_PATH}/global-file-reconciliation.md`, "# Global File Reconciliation\n");
  seed(`${PHASE_FOLDER}/phase-handoff.md`, "## What was delivered\nThe example module.\n");
  seed(`${phaxContext}/compliance-review.md`, "# Compliance Review\n\nConformant.\n");
  seed(`${phaxContext}/compliance-review.json`, COMPLIANCE_VERDICT);
  backend.impl.addRunResponse({
    sessionId: "session-review" as ClaudeSessionId,
    outputPath: `${RUN_PATH}/compliance-review.session.jsonl`,
    finalText: "Review complete.",
  });
  const info: RunReviewInfo = {
    namespace: NAMESPACE,
    shortName: SHORT_NAME,
    runId: created.right.runId,
    runState: "review_open",
    branch: plan.run.branch,
    runTitle: plan.run.title,
    finalPhaseBranch: "phax/example-run--phase-01" as BranchName,
    stateRoot: STATE_ROOT,
    runPath: RUN_PATH,
    finalPhaseId: "phase-01",
    finalPhaseTitle: phase.title,
    worktreePath: WORKTREE,
    claudeSessionId: undefined,
    gateProfileId: "fast",
    phaseStatuses: [],
    planPhases: [{ id: "phase-01", title: phase.title }],
    updatedAt: "2026-01-01T10:00:00.000Z",
    stoppedReason: undefined,
    lastError: undefined,
  };
  const reviewed = await run(
    reviewCompliance(
      info,
      { enabled: true, model: "example-model", effort: "medium" },
      resolution,
      { mode: "secure", config: security },
      {},
    ),
  );
  if (Either.isLeft(reviewed) || reviewed.right.kind !== "generated") {
    throw new Error("reviewCompliance generated no review");
  }

  // Every file phax wrote: on the file system, and in every records commit.
  const locations = new Map<string, string>();
  for (const [path, content] of fs.impl.files) {
    if (!seeded.has(path)) locations.set(path, content);
  }
  for (const commit of git.impl.fakeCommits.values()) {
    for (const entry of git.impl.fakeTrees.get(commit.tree) ?? []) {
      const blob = git.impl.fakeBlobs.get(entry.oid);
      if (blob !== undefined) {
        locations.set(`records:${entry.path}`, new TextDecoder().decode(blob));
      }
    }
  }
  const written: Written[] = [];
  for (const [location, content] of locations) {
    const format = formatAt(location, authoringKinds);
    if (format === undefined || location.includes("/.phax-context/")) continue;
    written.push({
      location,
      format,
      document: JSON.parse(content) as Readonly<Record<string, unknown>>,
    });
  }
  return written;
}

/**
 * The formats no writer produces: the old approval ledgers, read only to
 * migrate them to record files and never written again, and the brief answer.
 */
const NEVER_WRITTEN: ReadonlyArray<FormatId> = [
  "plan-approvals",
  "spec-approvals",
  // phax never writes a brief answer as a file: it is the brief provider's
  // stdout, held as printed inside a brief record.
  "brief-answer",
  // phax starts writing these in the brief-provider plan's phase-03.
  "brief-request",
  "brief-record",
];

describe("every persisted file phax writes", () => {
  let written: ReadonlyArray<Written> = [];

  beforeAll(async () => {
    written = await driveWriters();
  });

  it("covers every format id phax writes", () => {
    expect(new Set(written.map((file) => file.format))).toEqual(
      new Set(FORMAT_IDS.filter((id) => !NEVER_WRITTEN.includes(id))),
    );
  });

  it("never writes an old approval ledger", () => {
    const locations = written.map((file) => file.location);
    expect(locations).not.toContain("docs/plans/approvals.json");
    expect(locations).not.toContain("docs/specs/approvals.json");
  });

  it("starts with $schema naming its format at the root package.json release", () => {
    for (const { location, format, document } of written) {
      expect(Object.keys(document)[0], location).toBe("$schema");
      expect(document["$schema"], location).toBe(schemaUrl(format, rootVersion));
    }
  });

  it("carries no version", () => {
    for (const { location, document } of written) {
      expect(document, location).not.toHaveProperty("version");
    }
  });

  it("is identified by parseDocument from its content alone, as its format's current shape", () => {
    // Copied under a neutral name: parseDocument sees only the content.
    written.forEach(({ location, format, document }, n) => {
      const copy = { name: `exports/${n}.json`, content: JSON.parse(JSON.stringify(document)) };
      expect(parseDocument(copy.content), `${location} as ${copy.name}`).toMatchObject({
        ok: true,
        format,
        shape: CURRENT_SHAPES[format],
      });
    });
  });
});
