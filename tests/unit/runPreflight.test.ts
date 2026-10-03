import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  RUN_PREFLIGHT_CHECKS,
  runPreflights,
  type RunPreflightCheck,
  type RunPreflightInput,
} from "../../src/app/runPreflight.js";
import { checkCleanWorkingTree } from "../../src/app/worktree.js";
import {
  ModelPreflightError,
  RecordsSyncRequiredError,
  SecurityPreflightError,
  SkillEditConsentError,
  UnsafeGitStateError,
} from "../../src/domain/errors.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { preflightPhaseModels } from "../../src/domain/routing/preflight.js";
import {
  checkSkillEditConsent,
  formatSkillEditConsentRefusal,
} from "../../src/domain/security/skillEditGrants.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import type { PhaxPlan } from "../../src/schemas/phaxPlan.js";

const STATE_ROOT = "/state";
const REPO_ROOT = "/repo";
const NAMESPACE = "test-project";
const GOOD_MODEL = "claude-opus-5-5";
const RECORDS_REMOTE = "https://example.com/records.git";

type Phase = PhaxPlan["phases"][number];

function makePhase(id: string, overrides: Partial<Phase> = {}): Phase {
  return {
    id,
    title: `Phase ${id}`,
    model: GOOD_MODEL,
    effort: "medium",
    planMarkdownAnchor: `#${id}`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    commit: { subject: "feat: do thing", body: "Does the thing." },
    ...overrides,
  } as Phase;
}

function makePlan(
  phases: readonly Phase[] = [makePhase("phase-01")],
  requiredCommands: readonly string[] = [],
): PhaxPlan {
  return {
    version: 1,
    run: { shortName: "foo", title: "Foo", branch: "phax/foo", requiredCommands },
    phases,
  } as unknown as PhaxPlan;
}

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    raw: {
      version: 1,
      name: NAMESPACE,
      state: { root: STATE_ROOT },
      gateProfiles: {
        standard: [{ command: "true", surface: "local", firing: "every-phase", output: "log" }],
      },
    },
    stateRoot: STATE_ROOT,
    namespace: NAMESPACE,
    repoRoot: REPO_ROOT,
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
    ...overrides,
  } as ResolvedConfig;
}

function makeInput(overrides: Partial<RunPreflightInput> = {}): RunPreflightInput {
  return {
    plan: makePlan(),
    config: makeConfig(),
    gateProfileId: "standard",
    namespace: NAMESPACE,
    routing: DEFAULT_MODEL_ROUTING,
    providerConfig: DEFAULT_PROVIDER_CONFIG,
    allowSkillEdits: false,
    startIndex: 0,
    ...overrides,
  };
}

async function run(input: RunPreflightInput, fs = makeFakeFileSystem()) {
  return Effect.runPromise(Effect.either(runPreflights(input).pipe(Effect.provide(fs.layer))));
}

const SKILL_FILE = ".claude/skills/foo/SKILL.md";
const skillPhase = makePhase("phase-01", { plannedFilesToCreate: [SKILL_FILE] });
const badModelPhase = makePhase("phase-01", { model: "completely-unknown-model-xyz" });
const recordsRepoConfig = makeConfig({
  records: {
    enabled: true,
    transcript: false,
    destination: { kind: "repo", remote: RECORDS_REMOTE },
    autoPush: false,
  },
} as Partial<ResolvedConfig>);

function expectedModelMessage(plan: PhaxPlan): string {
  const { failures } = preflightPhaseModels(
    plan.phases,
    DEFAULT_MODEL_ROUTING,
    DEFAULT_PROVIDER_CONFIG,
  );
  const lines = [
    `Model preflight failed: ${failures.length} phase(s) have invalid model configuration.`,
  ];
  for (const f of failures) {
    lines.push(`\n  ${f.phaseId} (${f.model}/${f.effort}):`);
    for (const r of f.reasons) lines.push(`    - ${r}`);
    if (f.alternatives.length > 0) {
      lines.push(`    Alternatives:`);
      for (const a of f.alternatives) {
        lines.push(`      ${a.id} (${a.family}): ${a.efforts.join(", ")}`);
      }
    }
  }
  return lines.join("\n");
}

interface RefusalCase {
  readonly input: RunPreflightInput;
  readonly errorClass: new (...args: never[]) => Error;
  readonly message: string;
}

const REFUSALS = {
  "gate-profile": {
    input: makeInput({ gateProfileId: "nope" }),
    errorClass: UnsafeGitStateError,
    message: 'Gate profile "nope" not found or empty',
  },
  "required-commands": {
    input: makeInput({ plan: makePlan(undefined, ["pnpm lint"]) }),
    errorClass: SecurityPreflightError,
    message: [
      "Security preflight failed: the plan requires 1 command(s) not covered by the frozen set.",
      'Missing: "pnpm lint"',
      "Add the missing commands to security.agentCommands in phax.json before running.",
    ].join("\n"),
  },
  "skill-edit-consent": {
    input: makeInput({ plan: makePlan([skillPhase]) }),
    errorClass: SkillEditConsentError,
    message: formatSkillEditConsentRefusal(
      checkSkillEditConsent({ phases: [skillPhase], allowSkillEdits: false }),
    ),
  },
  "mcp-allow": {
    input: makeInput({
      config: makeConfig({
        security: {
          ...makeConfig().security,
          mcp: { mode: "allowlist", allow: ["/missing/mcp.json"] },
        },
      }),
    }),
    errorClass: SecurityPreflightError,
    message: [
      "Security preflight failed: 1 mcp.allow entry does not resolve to a readable file.",
      'Missing: "/missing/mcp.json"',
      "mcp.allow entries must be paths to MCP server config files (not server names).",
    ].join("\n"),
  },
  "records-destination": {
    input: makeInput({ config: recordsRepoConfig }),
    errorClass: RecordsSyncRequiredError,
    message: `Records destination "${RECORDS_REMOTE}" has no local clone at "/state/records/${NAMESPACE}". Run \`phax records sync\` before starting this run.`,
  },
  "phase-models": {
    input: makeInput({ plan: makePlan([badModelPhase]) }),
    errorClass: ModelPreflightError,
    message: expectedModelMessage(makePlan([badModelPhase])),
  },
} satisfies Record<RunPreflightCheck, RefusalCase>;

describe("runPreflights", () => {
  it("runs the checks in executePlan's historical order", () => {
    expect(RUN_PREFLIGHT_CHECKS).toEqual([
      "gate-profile",
      "required-commands",
      "skill-edit-consent",
      "mcp-allow",
      "records-destination",
      "phase-models",
    ]);
  });

  it.each(Object.entries(REFUSALS))(
    "%s refuses with the unchanged error and message",
    async (_id, c: RefusalCase) => {
      const result = await run(c.input);
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(c.errorClass);
        expect(result.left.message).toBe(c.message);
      }
    },
  );

  it("model refusal keeps its failure payload", async () => {
    const result = await run(REFUSALS["phase-models"].input);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result) && result.left instanceof ModelPreflightError) {
      expect(result.left.failures.map((f) => f.phaseId)).toEqual(["phase-01"]);
      expect(result.left.failures[0]?.model).toBe("completely-unknown-model-xyz");
    }
  });

  it("first failure wins: required commands before models", async () => {
    const result = await run(makeInput({ plan: makePlan([badModelPhase], ["pnpm lint"]) }));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(SecurityPreflightError);
  });

  it("skill edit consent covers only phases from startIndex", async () => {
    const plan = makePlan([skillPhase, makePhase("phase-02")]);
    expect(Either.isLeft(await run(makeInput({ plan, startIndex: 0 })))).toBe(true);
    expect(Either.isRight(await run(makeInput({ plan, startIndex: 1 })))).toBe(true);
  });

  it("records destination passes once the clone exists", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.addDir(`/state/records/${NAMESPACE}`);
    expect(Either.isRight(await run(makeInput({ config: recordsRepoConfig }), fs))).toBe(true);
  });

  it("returns the resolved profile's gate steps on success", async () => {
    const result = await run(makeInput());
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.gateSteps).toEqual(makeConfig().raw.gateProfiles["standard"]);
    }
  });
});

describe("checkCleanWorkingTree", () => {
  it("refuses a dirty tree with the unchanged message and only asks isClean", async () => {
    const git = makeFakeGit();
    git.impl.setRepoIsClean(false);
    const result = await Effect.runPromise(
      Effect.either(checkCleanWorkingTree(REPO_ROOT, false).pipe(Effect.provide(git.layer))),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(UnsafeGitStateError);
      expect(result.left.message).toBe(
        "Working tree is not clean. Commit or stash changes, or pass --allow-dirty.",
      );
    }
    expect(git.impl.calls).toEqual([{ method: "isClean", repo: REPO_ROOT }]);
  });

  it("passes a clean tree", async () => {
    const git = makeFakeGit();
    await Effect.runPromise(
      checkCleanWorkingTree(REPO_ROOT, false).pipe(Effect.provide(git.layer)),
    );
    expect(git.impl.calls).toEqual([{ method: "isClean", repo: REPO_ROOT }]);
  });

  it("makes no git call with allowDirty", async () => {
    const git = makeFakeGit();
    git.impl.setRepoIsClean(false);
    await Effect.runPromise(checkCleanWorkingTree(REPO_ROOT, true).pipe(Effect.provide(git.layer)));
    expect(git.impl.calls).toEqual([]);
  });
});
