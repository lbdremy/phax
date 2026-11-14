// Plan paths in the persisted plan formats, through phax's files and sessions
// (spec plan-path-canonical): a headless planner's non-canonical path is
// refused and writes nothing; an extraction answer's plannable spellings reach
// the run's phax-plan.json in canonical form, at phax-plan's current stamp; a
// phax-plan.json of the 0.33.0 shape is shown with its paths as written and
// never run. Every plan here is made up, except the hello-world example plan.md.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Result } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorArtifact, type AuthorArtifactInput } from "../../src/app/authorArtifact.js";
import { loadOrExtractPlan } from "../../src/app/loadOrExtractPlan.js";
import { loadPlan, olderPhaxPlanMessage } from "../../src/app/loadPlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import type { ClaudeSessionId, ShortName } from "../../src/domain/branded.js";
import { AuthoringDocumentError } from "../../src/domain/errors.js";
import { extractPlanDeterministic } from "../../src/domain/plan/parsePlanMarkdown.js";
import type { RoutingResolution } from "../../src/domain/routing/types.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { currentSchemaUrl, readPhaxPlanFile } from "../../src/schemas/persisted.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";

const security: ResolvedSecurityConfig = {
  profile: "secure",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],
};

const records: ResolvedRecordsConfig = {
  enabled: true,
  transcript: true,
  destination: { kind: "in-repo" },
  autoPush: false,
};

// ── a headless planner keeps answering ./src/x.ts

const NOW = "2026-11-14T11:03:00.000Z";
const SLUG = "widget-export";
const AUTHORING_ID = `2611141103-${SLUG}`;
const SESSION = "sess-plan" as ClaudeSessionId;

const resolution: RoutingResolution = {
  requested: { model: "claude-opus-5-5", family: "claude-opus", effort: "high" },
  selected: {
    provider: "claude-code",
    family: "claude-opus",
    concreteModel: "claude-opus-5-5",
    thinking: "high",
  },
  relationship: "exact",
  reason: "exact match",
};

const phase = (id: string, plannedFilesToEdit: readonly string[]) => ({
  id,
  title: `Step ${id}`,
  objective: "Do the step.",
  detailedInstructions: ["Do the step."],
  planMarkdownAnchor: `#${id}-step`,
  plannedFilesToCreate: [],
  plannedFilesToEdit,
  optionalFilesToEdit: [],
  mode: "headless",
  acceptance: null,
  boundaryContracts: null,
  testStrategy: [],
  implementationOrder: ["Do the step."],
  excludedScope: [],
  verification: "The `standard` gate profile.",
  expectedHandoff: "Nothing.",
  commit: { subject: `feat: ${id}`, body: "Do the step." },
  assignmentReason: null,
  model: "claude-sonnet-5-5",
  effort: "medium",
});

const NON_CANONICAL_PLAN = JSON.stringify({
  $schema: currentSchemaUrl("plan-document"),
  kind: "plan",
  sourceSpec: null,
  completesSpec: null,
  run: { shortName: SLUG, title: "Widget export", requiredCommands: [] },
  preamble: {
    summary: "Two steps.",
    requiredCommandsNote: "No extra commands.",
    technicalArbitrations: [],
    openQuestions: [],
    arbitratedQuestions: [],
  },
  phases: [phase("phase-01", ["src/widget.ts"]), phase("phase-02", ["./src/x.ts"])],
});

// The literal refusal line of spec §6.
const REFUSAL =
  'phases[1].plannedFilesToEdit[0]: phase-02 plans "./src/x.ts", which is not canonical: write "src/x.ts"';

describe("ac-document-refuses: headless plan authoring that keeps answering a non-canonical path", () => {
  it("is refused on its retry too, naming the path and the spelling to write, and writes no plan file", async () => {
    const fs = makeFakeFileSystem();
    const git = makeFakeGit();
    const backend = makeFakeBackend();
    const sessionFolder = `/state/authoring/${AUTHORING_ID}`;
    backend.impl.addRunResponse({
      sessionId: SESSION,
      outputPath: `${sessionFolder}/output.jsonl`,
      finalText: NON_CANONICAL_PLAN,
    });
    backend.impl.addResumeResponse({
      sessionId: SESSION,
      outputPath: `${sessionFolder}/retry-output.jsonl`,
      finalText: NON_CANONICAL_PLAN,
    });
    git.impl.setHeadCommit("3e9a1c4d".repeat(5));
    const input: AuthorArtifactInput = {
      kind: "plan",
      slug: SLUG,
      brief: { text: "Export widgets.\n", path: "brief.md" },
      sourceSpec: null,
      completion: { last: false, notLast: false },
      model: "claude-opus-5-5",
      effort: "high",
      resolution,
      skillText: "# phax-planning skill\n",
      security,
      repoRoot: "/repo",
      stateRoot: "/state",
      extractPlanModel: "claude-sonnet-5",
      extractPlanEffort: "medium",
      nowIso: NOW,
      records,
      publishRemote: "origin",
      architectureProvider: false,
      assignmentBounds: false,
      acceptanceProvider: false,
      output: { warn: () => undefined },
    };

    const result = await Effect.runPromise(
      Effect.result(
        authorArtifact(input).pipe(
          Effect.provide(
            Layer.mergeAll(fs.layer, git.layer, backend.layer, makeFakeGitHub().layer),
          ),
        ),
      ),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isSuccess(result)) return;
    expect(result.failure).toBeInstanceOf(AuthoringDocumentError);
    expect(result.failure.message).toBe(
      `plan document rejected twice — first answer: ${REFUSAL}; retry: ${REFUSAL}`,
    );
    // The one corrective resume named the refusal.
    expect(backend.impl.resumeCalls).toHaveLength(1);
    expect(backend.impl.resumeCalls[0]?.prompt).toContain(REFUSAL);
    // Nothing under docs/plans, and no artifact commit.
    expect([...fs.impl.files.keys()].filter((path) => path.includes("docs/plans"))).toEqual([]);
    expect(git.impl.calls.filter((call) => call.method === "commitPaths")).toEqual([]);
  });
});

// ── an extraction answer's spellings reach phax-plan.json in canonical form

const SPELLINGS = ["./src/x.ts", "src//y.ts", "src/a/../z.ts"];

function configAt(stateRoot: string): ResolvedConfig {
  return {
    raw: { version: 1, name: "test-project", state: { root: stateRoot }, gateProfiles: {} },
    stateRoot,
    namespace: "test-project",
    repoRoot: "/repo",
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low" as const,
    fileReconciliationMode: "report_only" as const,
    publish: resolvePublishConfig(undefined),
    complianceReview: resolveComplianceReviewConfig(undefined),
    codeReview: resolveCodeReviewConfig(undefined),
    authoring: resolveAuthoringConfig(undefined),
    security,
    records: { ...records, enabled: false, transcript: false },
  };
}

describe("ac-persisted-canonical: an extraction answer writing ./src/x.ts, src//y.ts and src/a/../z.ts", () => {
  it("reaches the run's phax-plan.json as src/x.ts, src/y.ts and src/z.ts, at phax-plan's current stamp", async () => {
    const helloWorld = await readFile(
      join(import.meta.dirname, "..", "..", "examples", "hello-world", "plan.md"),
      "utf8",
    );
    // phase-01 lists the three spellings under Planned files to edit. The
    // deterministic reading rewrites them itself, so the plan is made
    // non-conforming (no "## Required commands") to reach the extraction model.
    const planMd = helloWorld
      .replace(
        "### Planned files to edit\n\n- (none)",
        `### Planned files to edit\n\n${SPELLINGS.map((p) => `- ${p}`).join("\n")}`,
      )
      .replace("## Required commands", "## Commands");
    expect(planMd).not.toBe(helloWorld);
    expect(Result.isFailure(extractPlanDeterministic(planMd))).toBe(true);

    // The model answers the plan as written, in the extraction answer's shape.
    const canonical = extractPlanDeterministic(helloWorld);
    if (Result.isFailure(canonical)) throw new Error(canonical.failure.message);
    const answer = {
      $schema: currentSchemaUrl("phax-plan-extraction"),
      plan: {
        run: canonical.success.run,
        phases: canonical.success.phases.map(({ mode: _m, acceptance: _a, ...rest }, i) =>
          i === 0 ? { ...rest, plannedFilesToEdit: SPELLINGS } : rest,
        ),
      },
      incomplete: null,
    };

    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();
    backend.impl.addCompletionResponse({ finalText: JSON.stringify(answer) });
    fs.impl.setFile("/repo/plan.md", planMd);
    const layer = Layer.mergeAll(fs.layer, backend.layer, makeFakeShell().layer);

    const loaded = await Effect.runPromise(
      loadOrExtractPlan({
        planMdPath: "/repo/plan.md",
        model: "claude-sonnet-5-5",
        effort: "medium",
        stateRoot: "/state",
        nowIso: NOW,
      }).pipe(Effect.provide(layer)),
    );
    expect(backend.impl.completeCalls).toHaveLength(1);

    const { runPath } = await Effect.runPromise(
      createRunFolder("hello-world" as ShortName, planMd, loaded.plan, configAt("/state")).pipe(
        Effect.provide(layer),
      ),
    );
    const written = JSON.parse(fs.impl.getFile(join(runPath, "phax-plan.json")) ?? "null") as {
      $schema: string;
    };
    expect(written.$schema).toBe(currentSchemaUrl("phax-plan"));
    expect(written.$schema).not.toBe(schemaUrl("phax-plan", "0.33.0"));

    const read = readPhaxPlanFile(join(runPath, "phax-plan.json"), written);
    if (Result.isFailure(read)) throw new Error(read.failure.message);
    expect(read.success.shape).toBe("current");
    expect(read.success.plan.phases[0].plannedFilesToEdit).toEqual([
      "src/x.ts",
      "src/y.ts",
      "src/z.ts",
    ]);
  });
});

// ── a phax-plan.json of the 0.33.0 shape

describe("ac-older-phax-plan: a phax-plan.json stamped 0.33.0 listing ./src/x.ts", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "phax-plan-path-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const older = {
    $schema: schemaUrl("phax-plan", "0.33.0"),
    run: { shortName: "widget", title: "Widget", branch: "phax/widget", requiredCommands: [] },
    phases: [
      {
        id: "phase-01",
        title: "Widget",
        model: "claude-sonnet-5-5",
        effort: "medium",
        planMarkdownAnchor: "#phase-01-widget",
        plannedFilesToCreate: [],
        plannedFilesToEdit: ["./src/x.ts"],
        optionalFilesToEdit: [],
        mode: "headless",
        acceptance: null,
        testLines: [],
        commit: { subject: "feat: widget", body: "Adds the widget." },
      },
    ],
  };

  it("is displayed in the 0.33.0 shape with the path as written", () => {
    const read = readPhaxPlanFile("phax-plan.json", older);
    if (Result.isFailure(read)) throw new Error(read.failure.message);
    expect(read.success.shape).toBe("0.33.0");
    expect(read.success.plan.phases[0].plannedFilesToEdit).toEqual(["./src/x.ts"]);
    expect("testLines" in read.success.plan.phases[0]).toBe(false);
  });

  it("is refused for a run as an older shape", async () => {
    const path = join(dir, "phax-plan.json");
    await writeFile(path, JSON.stringify(older));
    const loaded = loadPlan(path, { run: "widget" });
    expect(Result.isFailure(loaded)).toBe(true);
    if (Result.isSuccess(loaded)) return;
    expect(loaded.failure.message).toBe(olderPhaxPlanMessage(path, "0.33.0", "widget"));
  });
});
