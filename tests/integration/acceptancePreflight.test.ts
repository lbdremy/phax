import { describe, it, expect } from "vitest";
import { Effect, Either, Layer } from "effect";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { loadOrExtractPlan } from "../../src/app/loadOrExtractPlan.js";
import { runPreflights, type RunPreflightInput } from "../../src/app/runPreflight.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";
import { encodePhaxPlanFile, type PhaxPlan } from "../../src/schemas/phaxPlan.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import {
  ACCEPTANCE_FILE,
  acHeaderOldPlan,
  acHeaderPlan,
  acLoopOldPlan,
  anchorOf,
  OLD_LOOP_MESSAGE,
  PHASE_IDS,
} from "./acceptancePlanCases.js";

// Acceptance tests for the extraction and the run preflight of the plan side.
// Each one is expected to fail until the passing phase switches the header
// lines, the loop word and the preflight to the acceptance names.

const PLAN_MD_PATH = "/workspace/plan.md";
const STATE_ROOT = "/fake-state";
const MODEL = "claude-sonnet-5-5";
const NOW_ISO = "2026-11-02T00:00:00.000Z";

function extract(planMd: string) {
  const fakeFs = makeFakeFileSystem();
  const fakeBackend = makeFakeBackend();
  const fakeShell = makeFakeShell();
  fakeFs.impl.setFile(PLAN_MD_PATH, planMd);
  const result = Effect.runPromise(
    Effect.either(
      loadOrExtractPlan({
        planMdPath: PLAN_MD_PATH,
        model: MODEL,
        effort: "medium",
        stateRoot: STATE_ROOT,
        nowIso: NOW_ISO,
      }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeBackend.layer, fakeShell.layer))),
    ),
  );
  return { result, fakeBackend, fakeShell };
}

describe("acceptance: extraction of the acceptance header lines", () => {
  // ac-header: the written phax-plan.json carries the pair at 0.33.0.
  it.fails("ac-header: the extracted phase carries acceptance, at phax-plan 0.33.0", async () => {
    const { result } = extract(acHeaderPlan());
    const extracted = await result;
    expect(Either.isRight(extracted)).toBe(true);
    if (Either.isLeft(extracted)) return;

    // What createRunFolder writes as phax-plan.json.
    const written = JSON.parse(
      JSON.stringify(encodePhaxPlanFile(withSchemaUrl("phax-plan", extracted.right.plan))),
    ) as { $schema: string; phases: { id: string; acceptance?: unknown }[] };

    expect(written.$schema).toBe("https://docs.phax.run/schemas/phax-plan/0.33.0.json");
    expect(written.phases.find((p) => p.id === "phase-03")?.acceptance).toEqual({
      passedBy: "phase-04",
      files: [ACCEPTANCE_FILE],
    });
  });

  // ac-loop-old: refused before the cache and before any model call.
  it.fails("ac-loop-old: a line in the oracle loop is refused before any model call", async () => {
    const { result, fakeBackend, fakeShell } = extract(acLoopOldPlan());
    const outcome = await result;

    expect(Either.isLeft(outcome)).toBe(true);
    if (Either.isLeft(outcome)) {
      expect(outcome.left.message).toBe(
        `${PLAN_MD_PATH}: phase-03 ${OLD_LOOP_MESSAGE} — run phax plans lint ${PLAN_MD_PATH}`,
      );
    }
    expect(fakeBackend.impl.completeCalls).toEqual([]);
    expect(fakeShell.impl.calls).toEqual([]);
  });
});

// The inputs of a run preflight over the four-phase plan, built as
// tests/unit/runPreflight.test.ts builds its own.
const PLAN_PATH = "docs/plans/foo.md";

function makePlan(): PhaxPlan {
  return {
    version: 1,
    run: { shortName: "foo", title: "Foo", branch: "phax/foo", requiredCommands: [] },
    phases: PHASE_IDS.map((id) => ({
      id,
      title: `Phase ${id}`,
      model: MODEL,
      effort: "medium",
      planMarkdownAnchor: anchorOf(id),
      plannedFilesToCreate: id === "phase-03" ? [ACCEPTANCE_FILE] : [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "feat: do thing", body: "Does the thing." },
    })),
  } as unknown as PhaxPlan;
}

function makeConfig(): ResolvedConfig {
  return {
    raw: {
      version: 1,
      name: "test-project",
      state: { root: STATE_ROOT },
      gateProfiles: {
        standard: [{ command: "true", surface: "local", firing: "every-phase", output: "log" }],
      },
    },
    stateRoot: STATE_ROOT,
    namespace: "test-project",
    repoRoot: "/repo",
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low",
    fileReconciliationMode: "report_only",
    publish: resolvePublishConfig(undefined),
    complianceReview: resolveComplianceReviewConfig(undefined),
    codeReview: resolveCodeReviewConfig(undefined),
    authoring: resolveAuthoringConfig(undefined),
    security: {
      profile: "unsafe",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
    records: {
      enabled: false,
      transcript: false,
      destination: { kind: "in-repo" },
      autoPush: false,
    },
    acceptance: { command: "node scripts/acceptance-verdicts.mjs" },
  } as unknown as ResolvedConfig;
}

function makeInput(planMd: string): RunPreflightInput {
  return {
    plan: makePlan(),
    planMd,
    planPath: PLAN_PATH,
    config: makeConfig(),
    gateProfileId: "standard",
    namespace: "test-project",
    routing: DEFAULT_MODEL_ROUTING,
    providerConfig: DEFAULT_PROVIDER_CONFIG,
    allowSkillEdits: false,
    startIndex: 0,
  };
}

describe("acceptance: the acceptance-phases run preflight", () => {
  // ac-header-old: the preflight reports exactly what lint's acceptance check reports.
  it.fails("ac-header-old: the Oracle lines fail the run with Acceptance preflight failed", async () => {
    const fs = makeFakeFileSystem();
    const shell = makeFakeShell();
    const result = await Effect.runPromise(
      Effect.either(
        runPreflights(makeInput(acHeaderOldPlan())).pipe(
          Effect.provide(fs.layer),
          Effect.provide(shell.layer),
        ),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "AcceptancePreflightError" });
      expect(result.left.message).toBe(
        [
          "Acceptance preflight failed: 2 error(s).",
          "  phase-03  **Oracle phase:** is no longer read: write **Acceptance phase:**",
          "  phase-03  **Oracle files:** is no longer read: write **Acceptance test files:**",
          `Fix the plan, then check it with \`phax plans lint ${PLAN_PATH}\`.`,
        ].join("\n"),
      );
    }
  });
});
