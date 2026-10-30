// Spec acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorArtifact, type AuthorArtifactInput } from "../../src/app/authorArtifact.js";
import { extractPlanLlm } from "../../src/app/extractPlan.js";
import { seedPaths, writeSeed } from "../../src/app/interactiveFiles.js";
import { runFirstTurn } from "../../src/app/interactiveStop.js";
import { reviewCodeHeadless } from "../../src/app/reviewCode.js";
import type { BranchName, RunId } from "../../src/domain/branded.js";
import { AgentSessionFailedError } from "../../src/domain/errors.js";
import { serializeSidecar } from "../../src/domain/artifact/sidecar.js";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import type { ProviderId, RoutingResolution } from "../../src/domain/routing/types.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import {
  claudeAnswerSchema,
  STRUCTURED_CALLS,
  type StructuredCallId,
  type StructuredCallsTable,
} from "../../src/domain/session/structuredCalls.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NodeFileSystemLayer, makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { makeNodeBackendLayer } from "../../src/infra/providers/dispatcher.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { answerJsonSchema, type AnswerFormatId } from "../../src/schemas/answerSchemas.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";
import type { SpecDocument } from "../../src/schemas/specDocument.js";
import { makeFakeProviderCli, type FakeProviderCli } from "../helpers/fakeProviderCli.js";
import { KEPT_SESSION, SPEC_FRONTMATTER, useDecideRepo } from "../helpers/decideVerdictsHarness.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import { ANSWER_FOLLOW, FILE_VALID, SPEC, SPEC_PATH } from "../unit/decide/verdictsFixtures.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// Acceptance for the answer schema flags: each structured call hands its
// published answer schema to Claude Code (`--json-schema`, without its root
// `$schema` property, which phax sets on the structured value) and to Codex
// (`--output-schema`, a temporary file), on its first session and on its
// corrective resume. The real adapters run over the fake `claude` and `codex`
// executables; every spec, plan and operator is made up.

const SESSION = "019a2f6e-0000-4000-8000-000000000001";
const STAMP_LINE = "phax sets the answer's `$schema` itself, so leave it out.";

const world = useDecideRepo();

let root: string;
let cli: FakeProviderCli;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "phax-answer-flags-")));
  cli = makeFakeProviderCli(join(root, "cli"));
  for (const [name, value] of Object.entries(cli.env)) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  removeTempDir(root);
});

const codexEntry = () => ({
  ...DEFAULT_PROVIDER_CONFIG.providers["codex-cli"]!,
  enabled: true,
  executable: cli.codexPath,
});

const providerConfig = (): ProviderConfig => ({
  providers: {
    "claude-code": { enabled: true, executable: "claude" },
    "codex-cli": codexEntry(),
  },
});

/** The real backend over the fake CLIs, with the structured calls table a test injects. */
const backendLayer = (table?: StructuredCallsTable) =>
  makeNodeBackendLayer(
    providerConfig(),
    table === undefined ? undefined : { structuredCalls: table },
  );

const withoutStamp = (answer: Record<string, unknown>): Record<string, unknown> => {
  const { $schema: _stamp, ...rest } = answer;
  return rest;
};

/** The published schema as the prompts state it. */
const statedSchema = (format: AnswerFormatId): string =>
  JSON.stringify(answerJsonSchema(format), null, 2);

/** The value of `flag` in an argv, or undefined. */
function flagValue(argv: readonly string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx < 0 ? undefined : argv[idx + 1];
}

const handedToClaude = (format: AnswerFormatId): string =>
  JSON.stringify(claudeAnswerSchema(answerJsonSchema(format)));

/** The prompt of invocation `index`, as the fake CLI read it on stdin. */
const promptOf = (index: number): string => cli.traces()[index]?.stdin ?? "";

// ── Headless authoring (a spec) ────────────────────────────────────────────

function specDocument(refs: readonly string[]) {
  return {
    $schema: currentSchemaUrl("spec-document"),
    kind: "spec",
    title: "Widget export",
    ground: [{ path: "docs/ideas/widget-export.md", note: "the idea this spec makes precise" }],
    context: "Widgets cannot leave the dashboard.",
    problem: "Operators copy widgets by hand.",
    productGoal: {
      statement: "Export a widget as a file.",
      guidingRule: "An export is a file anyone can read.",
    },
    terminology: [{ term: "export", definition: "a widget written to a file" }],
    requirements: [
      {
        id: "5.1",
        title: "Export a widget",
        pattern: "event",
        statement: "WHEN an operator exports a widget THE system SHALL write it to a file.",
      },
    ],
    surface: [
      {
        surface: "cli: `widget export <id>`",
        summary: "An operator can export a widget to a file.",
        binding: "normative",
        before: null,
        after: "widget export w1\n  wrote w1.json\n  $? = 0",
      },
    ],
    nonGoals: ["importing widgets"],
    acceptanceCriteria: [
      {
        id: "AC-1",
        name: "Export writes a file",
        given: "a widget w1",
        when: "`widget export w1` runs",
        then: "w1.json exists",
        refs,
      },
    ],
    openQuestions: [],
    arbitratedQuestions: [],
    planningNote: { settled: ["one file per widget"], open: [], constraints: [] },
    docsPage: { kind: "none", why: "the CLI reference covers it" },
  };
}

const authoringSecurity: ResolvedSecurityConfig = {
  profile: "secure",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],
};
const recordsOff: ResolvedRecordsConfig = {
  enabled: false,
  transcript: false,
  destination: { kind: "in-repo" },
  autoPush: false,
};

function resolutionOn(provider: ProviderId, model: string): RoutingResolution {
  return {
    requested: { model, family: "claude-opus", effort: "high" },
    selected: { provider, family: "claude-opus", concreteModel: model, thinking: "high" },
    relationship: "exact",
    reason: "exact match",
  };
}

async function author(options: {
  readonly provider?: ProviderId;
  readonly table?: StructuredCallsTable | undefined;
}) {
  const provider = options.provider ?? "claude-code";
  const repoRoot = join(root, "repo");
  mkdirSync(join(repoRoot, "docs", "specs"), { recursive: true });
  mkdirSync(join(root, "state"), { recursive: true });
  const git = makeFakeGit();
  git.impl.setHeadCommit("3e9a1c4d".repeat(5));
  const warnings: string[] = [];
  const model = provider === "codex-cli" ? "gpt-6-luna" : "claude-opus-5-5";
  const input: AuthorArtifactInput = {
    kind: "spec",
    slug: "widget-export",
    brief: { text: "Export widgets.\n", path: "brief.md" },
    sourceSpec: null,
    completion: { last: false, notLast: false },
    model,
    effort: "high",
    resolution: resolutionOn(provider, model),
    skillText: "# phax-spec skill\n",
    security: authoringSecurity,
    repoRoot,
    stateRoot: join(root, "state"),
    extractPlanModel: "claude-sonnet-5",
    extractPlanEffort: "medium",
    nowIso: "2026-10-30T14:12:00.000Z",
    records: recordsOff,
    publishRemote: "origin",
    architectureProvider: false,
    assignmentBounds: false,
    oraclesProvider: false,
    output: { warn: (message) => warnings.push(message) },
  };
  const result = await Effect.runPromise(
    Effect.either(
      authorArtifact(input).pipe(
        Effect.provide(
          Layer.mergeAll(
            makeRootedNodeFileSystemLayer(repoRoot),
            git.layer,
            makeFakeGitHub().layer,
            backendLayer(options.table),
          ),
        ),
      ),
    ),
  );
  const specs = join(repoRoot, "docs", "specs");
  const sidecars = readdirSync(specs).filter((name) => name.endsWith(".json"));
  return { result, warnings, specs, sidecars };
}

describe("ac-claude-flag: headless spec authoring on Claude Code", () => {
  it("hands --json-schema without $schema on the first session and on the corrective resume, and stamps the accepted value", async () => {
    cli.setScripts([
      {
        sessionId: SESSION,
        finalText: "",
        structuredOutput: withoutStamp(specDocument(["9.9"])),
      },
      { sessionId: SESSION, finalText: "", structuredOutput: withoutStamp(specDocument(["5.1"])) },
    ]);

    const { result, warnings, specs, sidecars } = await author({});

    expect(Either.isRight(result)).toBe(true);
    expect(warnings[0]).toContain("spec document refused");
    const [first, retry, ...more] = cli.invocations();
    expect(more).toEqual([]);
    for (const call of [first, retry]) {
      expect(call?.executable).toBe("claude");
      expect(flagValue(call?.argv ?? [], "--json-schema")).toBe(handedToClaude("spec-document"));
    }
    const handed = JSON.parse(flagValue(first?.argv ?? [], "--json-schema") ?? "{}") as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(handed.properties)).not.toContain("$schema");
    expect(handed.required).not.toContain("$schema");
    expect(first?.argv).not.toContain("--resume");
    expect(retry?.argv.slice(-2)).toEqual(["--resume", SESSION]);

    // Both prompts keep the whole schema, `$schema` included; the first (and
    // only the first) names the line that leaves the stamp out.
    expect(promptOf(0)).toContain(statedSchema("spec-document"));
    expect(promptOf(0).trimEnd().endsWith(STAMP_LINE)).toBe(true);
    expect(promptOf(1).trimEnd().endsWith(STAMP_LINE)).toBe(true);

    expect(sidecars).toHaveLength(1);
    const written = JSON.parse(readFileSync(join(specs, sidecars[0]!), "utf8")) as {
      $schema: string;
    };
    expect(written.$schema).toBe(currentSchemaUrl("spec-document"));
  });

  it("refuses a success with no structured_output and a prose result as not JSON, resumes once with the schema again and reports no provider error", async () => {
    cli.setScripts([
      { sessionId: SESSION, finalText: "I could not produce a valid object after 4 turns." },
      { sessionId: SESSION, finalText: "", structuredOutput: withoutStamp(specDocument(["5.1"])) },
    ]);

    const { result, warnings, sidecars } = await author({});

    expect(Either.isRight(result)).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("spec document refused");
    expect(warnings[0]).toContain("the session's final message is not JSON");
    const [first, retry, ...more] = cli.invocations();
    expect(more).toEqual([]);
    expect(flagValue(first?.argv ?? [], "--json-schema")).toBe(handedToClaude("spec-document"));
    expect(flagValue(retry?.argv ?? [], "--json-schema")).toBe(handedToClaude("spec-document"));
    expect(retry?.argv.slice(-2)).toEqual(["--resume", SESSION]);
    expect(sidecars).toHaveLength(1);
  });
});

// A spawn handed the schema natively expects structured_output: a success
// with neither it nor text is the provider's failure, never a refusal.
describe("a natively handed Claude Code call whose success carries an empty result", () => {
  it("fails as a provider-error and runs no corrective resume", async () => {
    cli.setScript({ sessionId: SESSION, finalText: "", resultText: "" });

    const { result, warnings, sidecars } = await author({});

    if (Either.isRight(result)) throw new Error("authoring did not fail");
    expect(result.left).toBeInstanceOf(AgentSessionFailedError);
    expect((result.left as AgentSessionFailedError).failure).toMatchObject({
      kind: "provider-error",
      message: "success: the result carried no result text",
    });
    expect(warnings).toEqual([]);
    expect(cli.invocations()).toHaveLength(1);
    expect(sidecars).toEqual([]);
  });
});

// ── decide --verdicts (the writer) ─────────────────────────────────────────

const AUTHORING_ID = "2610250900-log-rotation";
const SPEC_JSON = SPEC_PATH.replace(/\.md$/, ".json");

function seedVerdicts(): void {
  const md = SPEC_FRONTMATTER + renderSpecBody(SPEC.document as SpecDocument);
  world.writeRepoFile(SPEC_PATH, md);
  world.writeRepoFile(SPEC_JSON, serializeSidecar(SPEC));
  world.writeRepoFile("verdicts.json", FILE_VALID);
  world.commitAll();
  // A kept authoring session of another checkout, so the writer starts a new one.
  const folder = join(world.stateRoot, "authoring", AUTHORING_ID);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "session.json"),
    JSON.stringify({
      version: 1,
      provider: "claude-code",
      sessionId: SESSION,
      retrySessionId: KEPT_SESSION,
      cwd: "/somewhere/else",
    }),
  );
}

async function decideVerdicts(options: {
  readonly provider: ProviderId;
  readonly table?: StructuredCallsTable | undefined;
}) {
  seedVerdicts();
  const h = world.harness({
    backendLayer: backendLayer(options.table),
  });
  const result = await h.run({
    model: options.provider === "codex-cli" ? "gpt-6-luna" : "claude-opus-5-5",
    providerConfig: providerConfig(),
    routing: DEFAULT_MODEL_ROUTING,
  });
  return { h, result };
}

const refusedThenFollow = (provider: ProviderId) =>
  provider === "codex-cli"
    ? [
        { sessionId: SESSION, finalText: "I decided, but not as JSON." },
        { sessionId: SESSION, finalText: JSON.stringify(ANSWER_FOLLOW) },
      ]
    : [
        { sessionId: SESSION, finalText: "I decided, but not as JSON." },
        { sessionId: SESSION, finalText: "", structuredOutput: withoutStamp(ANSWER_FOLLOW) },
      ];

describe("ac-codex-flag: a decide --verdicts writer routed to Codex", () => {
  it("hands --output-schema on exec and exec resume, a file holding the published spec-document schema", async () => {
    cli.setScripts(refusedThenFollow("codex-cli"));

    const { result } = await decideVerdicts({ provider: "codex-cli" });

    expect(Either.isRight(result)).toBe(true);
    const [first, retry, ...more] = cli.invocations();
    expect(more).toEqual([]);
    expect(first?.argv.slice(0, 2)).toEqual(["exec", "-C"]);
    expect(retry?.argv.slice(0, 3)).toEqual(["exec", "resume", SESSION]);
    for (const call of [first, retry]) {
      expect(call?.executable).toBe("codex");
      const path = flagValue(call?.argv ?? [], "--output-schema");
      expect(path).toMatch(/phax-answer-schema-[^/]+\/answer\.schema\.json$/);
      // The file is read while codex runs and gone once it has ended.
      expect(JSON.parse(call?.outputSchema ?? "null")).toEqual(answerJsonSchema("spec-document"));
      expect(existsSync(dirname(path ?? ""))).toBe(false);
      // `--output-schema` follows `--json`.
      expect(call?.argv.indexOf("--output-schema")).toBe((call?.argv.indexOf("--json") ?? 0) + 1);
    }
    // Codex keeps the stamp: nothing is added to its prompts.
    expect(promptOf(0)).not.toContain(STAMP_LINE);
    expect(promptOf(0)).toContain(statedSchema("spec-document"));
  });
});

describe("ac-claude-fallback: a call the table puts on the prompt schema", () => {
  const table: StructuredCallsTable = {
    ...STRUCTURED_CALLS,
    "decide-verdicts": { claudeCode: "prompt" },
  };

  it("runs on Claude Code without --json-schema, with the schema in its prompt and its one corrective resume", async () => {
    cli.setScripts([
      { sessionId: SESSION, finalText: "I decided, but not as JSON." },
      { sessionId: SESSION, finalText: JSON.stringify(ANSWER_FOLLOW) },
    ]);

    const { result } = await decideVerdicts({ provider: "claude-code", table });

    expect(Either.isRight(result)).toBe(true);
    const [first, retry, ...more] = cli.invocations();
    expect(more).toEqual([]);
    expect(first?.argv).not.toContain("--json-schema");
    expect(retry?.argv).not.toContain("--json-schema");
    expect(retry?.argv.slice(-2)).toEqual(["--resume", SESSION]);
    // Nothing is removed from the prompt and no line is added.
    expect(promptOf(0)).toContain(statedSchema("spec-document"));
    expect(promptOf(0)).not.toContain(STAMP_LINE);
    expect(promptOf(1)).not.toContain(STAMP_LINE);
  });

  // On the prompt schema, as on Mistral Vibe, an empty answer reaches phax's
  // decoder, which refuses it as not JSON and resumes once.
  it("refuses an empty result as not JSON and resumes once", async () => {
    cli.setScripts([
      { sessionId: SESSION, finalText: "", resultText: "" },
      { sessionId: SESSION, finalText: JSON.stringify(ANSWER_FOLLOW) },
    ]);

    const { h, result } = await decideVerdicts({ provider: "claude-code", table });

    expect(Either.isRight(result)).toBe(true);
    expect(h.warnings.join("\n")).toContain("not JSON");
    const [first, retry, ...more] = cli.invocations();
    expect(more).toEqual([]);
    expect(first?.argv).not.toContain("--json-schema");
    expect(retry?.argv.slice(-2)).toEqual(["--resume", SESSION]);
  });

  it("still hands --output-schema to the same call on Codex", async () => {
    cli.setScripts(refusedThenFollow("codex-cli"));

    const { result } = await decideVerdicts({ provider: "codex-cli", table });

    expect(Either.isRight(result)).toBe(true);
    for (const call of cli.invocations()) {
      expect(call.argv).toContain("--output-schema");
      expect(JSON.parse(call.outputSchema ?? "null")).toEqual(answerJsonSchema("spec-document"));
    }
  });

  it("leaves the other calls native: flipping one line flips that call alone", async () => {
    cli.setScripts(refusedThenFollow("claude-code"));

    await author({ table });

    expect(flagValue(cli.invocations()[0]?.argv ?? [], "--json-schema")).toBe(
      handedToClaude("spec-document"),
    );
  });
});

// ── Every call, every provider ─────────────────────────────────────────────

// One driver per call, through its real call site and the real adapters. The
// closing turn and the decide handback resume a kept session whose setup is
// the work of their own suites: declaredStopProviderArgv and heldStopClose pin
// the closing turn's argv and schema file on both providers, and
// decideArtifact pins the handback's `answerSchema`.
interface CallDriver {
  readonly call: StructuredCallId;
  readonly format: AnswerFormatId;
  readonly providers: readonly ProviderId[];
  /** Runs the call once, answering with whatever the script says. */
  readonly drive: (provider: ProviderId, table?: StructuredCallsTable) => Promise<void>;
}

async function driveFirstTurn(provider: ProviderId, table?: StructuredCallsTable): Promise<void> {
  const worktree = join(root, "worktree");
  const phaseFolder = join(root, "runs", "invoice-export", "phase-03");
  mkdirSync(worktree, { recursive: true });
  mkdirSync(phaseFolder, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: worktree, stdio: "pipe" });
  git("init", "--initial-branch=main");
  disableGitAutoMaintenance(worktree);
  git("config", "--local", "user.email", "ada@example.test");
  git("config", "--local", "user.name", "Ada Example");
  writeFileSync(join(worktree, ".gitignore"), ".phax-context/\n");
  writeFileSync(join(worktree, "invoiceRow.ts"), "export const header = 'invoice_no';\n");
  git("add", "-A");
  git("commit", "-m", "base");
  const policy: SecurityPolicy = {
    mode: "secure",
    filesystem: { allowRead: [], allowWrite: [] },
    network: { profile: "open" },
    mcp: { mode: "disabled", allow: [] },
    agentCommands: [],
    failClosed: true,
  };
  const program = Effect.gen(function* () {
    yield* writeSeed(seedPaths(worktree, phaseFolder), "# Interactive review: phase-03\n");
    return yield* runFirstTurn({
      runId: "invoice-export-1792667922832" as RunId,
      runPath: join(root, "runs", "invoice-export"),
      phaseFolder,
      worktree,
      phase: { id: "phase-03" },
      provider,
      model: provider === "codex-cli" ? "gpt-6-luna" : "claude-sonnet-5-5",
      effort: "medium",
      policy,
      origin: "first-turn",
    });
  });
  await Effect.runPromise(
    program.pipe(
      Effect.provide(
        Layer.mergeAll(
          backendLayer(table),
          NodeFileSystemLayer,
          NodeGitLayer,
          NoopSystemTelemetryLayer,
        ),
      ),
    ),
  );
}

async function driveCodeReview(provider: ProviderId, table?: StructuredCallsTable): Promise<void> {
  const stateRoot = join(root, "review-state");
  const runPath = join(stateRoot, "runs", "my-run");
  const worktreePath = join(root, "review-worktree");
  mkdirSync(runPath, { recursive: true });
  mkdirSync(worktreePath, { recursive: true });
  const info: RunReviewInfo = {
    namespace: "test-project",
    shortName: "my-run",
    runId: "my-run-001",
    runState: "review_open",
    branch: "feature/my-run",
    runTitle: "My Run",
    finalPhaseBranch: "feature/my-run--phase-01" as BranchName,
    stateRoot,
    runPath,
    finalPhaseId: "phase-01",
    finalPhaseTitle: "Phase 01",
    worktreePath,
    claudeSessionId: undefined,
    gateProfileId: "full",
    phaseStatuses: [],
    planPhases: [{ id: "phase-01", title: "Phase 01" }],
    updatedAt: "2026-10-27T11:00:00.000Z",
    stoppedReason: undefined,
    lastError: undefined,
  };
  await Effect.runPromise(
    Effect.either(
      reviewCodeHeadless(
        info,
        { enabled: false, model: "claude-opus-5-5", effort: "high" },
        resolutionOn(provider, provider === "codex-cli" ? "gpt-6-luna" : "claude-opus-5-5"),
        { mode: "secure", config: authoringSecurity },
        {
          bundledReviewSkill: "---\nname: phax-review\n---\n\n# Bundled doctrine\n",
          nowIso: "2026-10-27T12:00:00.000Z",
          output: { log() {}, warn() {}, error() {} },
        },
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            makeFakeFileSystem().layer,
            makeFakeGit().layer,
            makeFakeGitHub().layer,
            backendLayer(table),
            NoopSystemTelemetryLayer,
          ),
        ),
      ),
    ),
  );
}

async function driveExtraction(table?: StructuredCallsTable): Promise<void> {
  await Effect.runPromise(
    Effect.either(
      extractPlanLlm("# Made-up plan\n", { model: "claude-sonnet-5-5", effort: "low" }).pipe(
        Effect.provide(Layer.mergeAll(backendLayer(table), NodeFileSystemLayer)),
      ),
    ),
  );
}

const DRIVERS: readonly CallDriver[] = [
  {
    call: "authoring",
    format: "spec-document",
    providers: ["claude-code", "codex-cli"],
    drive: async (provider, table) => void (await author({ provider, table })),
  },
  {
    call: "plan-extraction",
    format: "phax-plan-extraction",
    providers: ["claude-code"],
    drive: (_provider, table) => driveExtraction(table),
  },
  {
    call: "decide-verdicts",
    format: "spec-document",
    providers: ["claude-code", "codex-cli"],
    drive: async (provider, table) => void (await decideVerdicts({ provider, table })),
  },
  {
    call: "first-turn",
    format: "first-reading",
    providers: ["claude-code", "codex-cli"],
    drive: (provider, table) => driveFirstTurn(provider, table),
  },
  {
    call: "code-review",
    format: "code-review",
    providers: ["claude-code", "codex-cli"],
    drive: (provider, table) => driveCodeReview(provider, table),
  },
];

describe("ac-every-call: each structured call hands its answer schema on every spawn", () => {
  const cases = DRIVERS.flatMap((driver) =>
    driver.providers.map((provider) => ({ driver, provider })),
  );

  it.each(cases)(
    "$driver.call on $provider carries the $driver.format schema and states it in the prompt",
    async ({ driver, provider }) => {
      // An answer the call refuses: only the spawns are of interest here.
      cli.setScript({ sessionId: SESSION, finalText: "No answer, only prose." });

      await driver.drive(provider);

      const invocations = cli.invocations();
      expect(invocations.length).toBeGreaterThan(0);
      for (const [index, call] of invocations.entries()) {
        if (provider === "claude-code") {
          expect(call.executable).toBe("claude");
          expect(flagValue(call.argv, "--json-schema")).toBe(handedToClaude(driver.format));
          expect(promptOf(index).trimEnd().endsWith(STAMP_LINE)).toBe(true);
        } else {
          expect(call.executable).toBe("codex");
          expect(JSON.parse(call.outputSchema ?? "null")).toEqual(answerJsonSchema(driver.format));
          expect(promptOf(index)).not.toContain(STAMP_LINE);
        }
        // Every prompt states the whole published schema, `$schema` included.
        const stated = statedSchema(driver.format);
        if (index === 0) expect(promptOf(index)).toContain(stated);
      }
    },
  );

  const claudeDrivers = DRIVERS.map((driver) => ({ driver }));

  it.each(claudeDrivers)(
    "flipping the $driver.call line alone puts that call on the prompt schema on Claude Code",
    async ({ driver }) => {
      const flipped: StructuredCallsTable = {
        ...STRUCTURED_CALLS,
        [driver.call]: { claudeCode: "prompt" },
      };
      cli.setScript({ sessionId: SESSION, finalText: "No answer, only prose." });

      await driver.drive("claude-code", flipped);

      const invocations = cli.invocations();
      expect(invocations.length).toBeGreaterThan(0);
      for (const [index, call] of invocations.entries()) {
        expect(call.argv).not.toContain("--json-schema");
        expect(promptOf(index)).not.toContain(STAMP_LINE);
      }
      expect(promptOf(0)).toContain(statedSchema(driver.format));
    },
  );

  it("hands nothing to a phase turn, a fix turn or the probe", async () => {
    const { runClaudeAgent, buildProbeArgs } =
      await import("../../src/infra/providers/claudeCode.js");
    cli.setScript({ sessionId: SESSION, finalText: "done" });
    const options = {
      provider: "claude-code" as const,
      model: "claude-sonnet-5-5",
      effort: "medium",
      cwd: root,
      security: {
        mode: "unsafe" as const,
        filesystem: { allowRead: [], allowWrite: [] },
        network: { profile: "open" as const },
        mcp: { mode: "provider-default" as const, allow: [] },
        agentCommands: [],
        failClosed: false,
      },
    };
    await Effect.runPromise(runClaudeAgent("a phase turn", options));
    await Effect.runPromise(runClaudeAgent("a fix turn", options, SESSION));

    for (const call of cli.invocations()) expect(call.argv).not.toContain("--json-schema");
    for (const prompt of [promptOf(0), promptOf(1)]) expect(prompt).not.toContain(STAMP_LINE);
    expect(buildProbeArgs({ model: "claude-haiku-5-5", effort: "low" })).not.toContain(
      "--json-schema",
    );
  });
});
