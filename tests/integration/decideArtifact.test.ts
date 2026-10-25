// Acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Either, Layer, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectArtifact } from "../../src/app/artifactStatus.js";
import { type DecideArtifactInput, decideArtifact } from "../../src/app/decideArtifact.js";
import { loadOrExtractPlan } from "../../src/app/loadOrExtractPlan.js";
import { readCacheEntry } from "../../src/app/planCacheStore.js";
import { explainRecord } from "../../src/app/recordsExplain.js";
import { exitCodeForAuthoringError } from "../../src/cli/commands/runLayers.js";
import { serializeSidecar } from "../../src/domain/artifact/sidecar.js";
import { renderPlanBody } from "../../src/domain/authoring/renderPlan.js";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { planCacheKey } from "../../src/domain/planCache/key.js";
import { structureFindings } from "../../src/domain/plan/lint.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { FAKE_PROMPT_CANCEL, makeFakePrompt } from "../../src/infra/fakes/prompt.js";
import { makeFakeSession } from "../../src/infra/fakes/session.js";
import { makeFakeTerminal } from "../../src/infra/fakes/terminal.js";
import { makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { PlanDocument } from "../../src/schemas/planDocument.js";
import { projectExtractedPlan } from "../../src/schemas/planDocument.js";
import type {
  OpenQuestion,
  PlanArbitratedQuestion,
  SpecArbitratedQuestion,
} from "../../src/schemas/questions.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";
import type { SpecDocument } from "../../src/schemas/specDocument.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Real-git acceptance for `phax artifact decide` on headless-authored specs
// and plans (spec artifact-decide §8; §5.1–§5.34). The interactive session,
// the handback, the confirm prompt and the terminal are fakes; git and the
// filesystem are real. Every spec, plan, question, doctrine and operator is
// made up.

const OPERATOR = "Ada Lovelace";
const NOW = "2026-10-16T09:00:41.000Z";
const AUTHORING_ID = "2610160900-log-rotation";
const SPEC = `docs/specs/${AUTHORING_ID}.md`;
const SPEC_JSON = `docs/specs/${AUTHORING_ID}.json`;
const PLAN_ID = "2610161000-log-rotation";
const PLAN = `docs/plans/${PLAN_ID}-plan.md`;
const PLAN_JSON = `docs/plans/${PLAN_ID}-plan.json`;
const SOURCE_SPEC = "docs/specs/2610150800-log-rotation.md";
const KEPT_SESSION = "5f0c2a71-1b9e-4c55-9a43-6a2d1f6e8b10";
const EXTRACT_MODEL = "claude-haiku-5-5";
const EXTRACT_EFFORT = "low";

// Made-up doctrine skills: ids open list items; `S0` and `P0` are named only
// inside a numbered step, so they are not citable.
const SKILL_SPEC = [
  "# Decide a spec (bundled)",
  "",
  "- `E0` Escalate what you may not decide.",
  "- `C1` Name what each option abandons.",
  "- `C4` Prefer the reversible option.",
  "- `S1` Adopt the recommendation unless a principle says otherwise.",
  "- `S2` A surface beats a promise.",
  "",
  "1. Read every question first; `S0` is how you start.",
  "",
].join("\n");
const SKILL_PLAN = [
  "# Decide a plan (bundled)",
  "",
  "- `E0` Escalate what you may not decide.",
  "- `P1` Split by shippable surface.",
  "",
].join("\n");

const SECURITY: ResolvedSecurityConfig = {
  profile: "secure",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],
};

const RECORDS_OFF: ResolvedRecordsConfig = {
  enabled: false,
  transcript: false,
  destination: { kind: "in-repo" },
  autoPush: false,
};

let repoDir: string;
let configDir: string;
let stateRoot: string;

function git(args: readonly string[]): string {
  return execFileSync("git", args, { cwd: repoDir, stdio: "pipe" }).toString();
}

function writeRepoFile(rel: string, content: string): void {
  const abs = join(repoDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function readRepoFile(rel: string): string {
  return readFileSync(join(repoDir, rel), "utf8");
}

function commitAll(message = "seed"): void {
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message]);
}

function headSha(): string {
  return git(["rev-parse", "HEAD"]).trim();
}

function headFiles(): string[] {
  return git(["show", "--name-only", "--format=", "HEAD"]).trim().split("\n").toSorted();
}

function porcelain(): string {
  return git(["status", "--porcelain"]).trim();
}

// ── Fixtures ──────────────────────────────────────────────────────────────

function question(id: string, options: readonly [string, string] = [`${id}-a`, `${id}-b`]) {
  return {
    id,
    question: `What about ${id}?`,
    options: [
      { id: options[0], label: "The first way", abandons: "the second way" },
      { id: options[1], label: "The second way", abandons: "the first way" },
    ],
    recommendation: options[0],
    rationale: "it is the cheaper way",
  } satisfies OpenQuestion;
}

function verdict(q: OpenQuestion, chosen = q.recommendation, extra: Record<string, unknown> = {}) {
  return {
    kind: "decided" as const,
    chosen,
    abandoned: q.options.map((o) => o.id).filter((id) => id !== chosen),
    why: "the operator weighed it",
    advocate: "the other way keeps more options open",
    principles: ["S1"],
    reversibility: "cheap" as const,
    by: { kind: "operator" as const, name: "Somebody Else" },
    at: "2026-01-01T00:00:00Z",
    revised: [] as string[],
    ...extra,
  };
}

function arbitrated(
  q: OpenQuestion,
  chosen = q.recommendation,
  extra: Record<string, unknown> = {},
): SpecArbitratedQuestion {
  return { ...q, verdict: verdict(q, chosen, extra), history: [] };
}

function specDocument(
  open: readonly OpenQuestion[],
  decided: readonly SpecArbitratedQuestion[] = [],
): SpecDocument {
  return {
    kind: "spec",
    title: "Log rotation",
    ground: [{ path: "src/app/archive.ts", note: "where runs are archived" }],
    context: "Every run writes one log.",
    problem: "Logs grow without bound.",
    productGoal: { statement: "Keep logs bounded.", guidingRule: "A log is kept while useful." },
    terminology: [],
    requirements: [
      {
        id: "R-keep",
        title: "Keep",
        pattern: "event",
        statement: "WHEN a run ends THE system SHALL keep its log.",
      },
    ],
    surface: [],
    nonGoals: [],
    acceptanceCriteria: [
      {
        id: "AC-1",
        name: "Logs are kept",
        given: "a finished run",
        when: "it ends",
        then: "its log is kept",
        refs: ["R-keep"],
      },
    ],
    openQuestions: [...open],
    arbitratedQuestions: [...decided],
    planningNote: { settled: [], open: [], constraints: [] },
    docsPage: { kind: "none", why: "the CLI reference covers it" },
  };
}

const SPEC_FRONTMATTER =
  "---\nstatus: Draft\ndate: 2026-10-16\naudience: maintainers\nscope: logs\n---\n";

function writeSpec(path: string, doc: SpecDocument, frontmatter = SPEC_FRONTMATTER): string {
  const md = frontmatter + renderSpecBody(doc);
  writeRepoFile(path, md);
  writeRepoFile(path.replace(/\.md$/, ".json"), serializeSidecar({ kind: "spec", document: doc }));
  return md;
}

function planPhase(id: string): PlanDocument["phases"][number] {
  return {
    id,
    title: `Step ${id}`,
    planMarkdownAnchor: `#${id}-step`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [`src/${id}.ts`],
    optionalFilesToEdit: [],
    mode: "headless",
    oracle: null,
    commit: { subject: `feat: ${id}`, body: "Do the step." },
    objective: "Do the step.",
    detailedInstructions: ["Do it."],
    boundaryContracts: null,
    testStrategy: [
      {
        guarantee: "The step does its work",
        size: "small",
        technique: "example",
        oracle: "the step's output",
        loop: "in-phase",
        criterion: null,
      },
    ],
    implementationOrder: ["Do it."],
    excludedScope: [],
    verification: "The `standard` gate profile.",
    expectedHandoff: "Nothing.",
    assignmentReason: null,
    model: "claude-sonnet-5-5",
    effort: "medium",
  };
}

function planDocument(
  open: readonly OpenQuestion[],
  decided: readonly PlanArbitratedQuestion[] = [],
): PlanDocument {
  return {
    kind: "plan",
    sourceSpec: SOURCE_SPEC,
    completesSpec: false,
    run: { shortName: "log-rotation", title: "Log rotation", requiredCommands: [] },
    preamble: {
      summary: "Two phases: the rotation, then its docs.",
      requiredCommandsNote: "No extra commands.",
      technicalArbitrations: [],
      openQuestions: [...open],
      arbitratedQuestions: [...decided],
    },
    phases: [planPhase("phase-01"), planPhase("phase-02")],
  };
}

const PLAN_FRONTMATTER = `---\nstatus: Draft\nsource-spec: ${SOURCE_SPEC}\ncompletes-spec: false\n---\n`;

function writePlan(doc: PlanDocument): string {
  const md = PLAN_FRONTMATTER + renderPlanBody(doc);
  writeRepoFile(PLAN, md);
  writeRepoFile(PLAN_JSON, serializeSidecar({ kind: "plan", document: doc }));
  return md;
}

/** A session's answer: the document, `$schema` first at the current shape (or `schema`). */
function answer(
  doc: { readonly kind: "spec" | "plan" },
  schema: string | null = currentSchemaUrl(doc.kind === "spec" ? "spec-document" : "plan-document"),
): string {
  return JSON.stringify(schema === null ? doc : { $schema: schema, ...doc });
}

function keepAuthoringSession(
  id = AUTHORING_ID,
  provider = "claude-code",
  cwd: string = repoDir,
): void {
  const folder = join(stateRoot, "authoring", id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "session.json"),
    JSON.stringify({
      version: 1,
      provider,
      sessionId: "11111111-2222-4333-8444-555555555555",
      retrySessionId: KEPT_SESSION,
      cwd,
    }),
  );
}

// ── Running ───────────────────────────────────────────────────────────────

interface HarnessOptions {
  readonly answers?: readonly string[];
  readonly confirm?: ReadonlyArray<boolean | typeof FAKE_PROMPT_CANCEL>;
  readonly terminal?: boolean;
}

function harness(opts: HarnessOptions = {}) {
  const backend = makeFakeBackend();
  for (const finalText of opts.answers ?? []) {
    backend.impl.addResumeResponse({
      sessionId: "sess-handback" as ClaudeSessionId,
      outputPath: "",
      finalText,
    });
  }
  const session = makeFakeSession();
  const prompt = makeFakePrompt([...(opts.confirm ?? [true])]);
  const terminal = makeFakeTerminal(opts.terminal ?? true);
  const github = makeFakeGitHub();
  const lines: string[] = [];
  const warnings: string[] = [];
  const layer = Layer.mergeAll(
    makeRootedNodeFileSystemLayer(repoDir),
    NodeGitLayer,
    backend.layer,
    session.layer,
    prompt.layer,
    terminal.layer,
    github.layer,
  );
  const run = (overrides: Partial<DecideArtifactInput> = {}) =>
    Effect.runPromise(
      Effect.either(
        decideArtifact({
          path: SPEC,
          question: null,
          doctrinePath: null,
          model: undefined,
          effort: undefined,
          bundledSkills: { spec: SKILL_SPEC, plan: SKILL_PLAN },
          security: SECURITY,
          repoRoot: repoDir,
          stateRoot,
          extractPlanModel: EXTRACT_MODEL,
          extractPlanEffort: EXTRACT_EFFORT,
          nowIso: NOW,
          records: RECORDS_OFF,
          publishRemote: "origin",
          output: { log: (l) => lines.push(l), warn: (w) => warnings.push(w) },
          ...overrides,
        }).pipe(Effect.provide(layer)),
      ),
    );
  return {
    backend: backend.impl,
    session: session.impl,
    prompt: prompt.impl,
    github: github.impl,
    lines,
    warnings,
    run,
  };
}

type Harness = ReturnType<typeof harness>;
type RunResult = Awaited<ReturnType<Harness["run"]>>;

function decisionFolder(index = "01", id = AUTHORING_ID): string {
  return join(stateRoot, "decide", id, index);
}

function sidecarJson(path = SPEC_JSON): Record<string, unknown> {
  return JSON.parse(readRepoFile(path)) as Record<string, unknown>;
}

/** The run failed with this exit code, before or after the session, leaving tree and HEAD as they were. */
function expectRefused(result: RunResult, exitCode: number, head: string): string {
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isRight(result)) return "";
  expect(exitCodeForAuthoringError(result.left)).toBe(exitCode);
  expect(headSha()).toBe(head);
  expect(porcelain()).toBe("");
  return result.left.message;
}

function expectNoSession(h: Harness): void {
  expect(h.session.invocations).toEqual([]);
  expect(h.backend.resumeCalls).toEqual([]);
  expect(existsSync(join(stateRoot, "decide"))).toBe(false);
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "phax-decide-config-"));
  stateRoot = join(realpathSync(configDir), "state");
  writeFileSync(join(configDir, "gitconfig"), "[user]\n\tuseConfigOnly = true\n");
  vi.stubEnv("GIT_CONFIG_GLOBAL", join(configDir, "gitconfig"));
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  vi.stubEnv("GIT_COMMITTER_NAME", OPERATOR);
  repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-decide-")));
  git(["init", "-q", "-b", "main"]);
  disableGitAutoMaintenance(repoDir);
  git(["config", "--local", "user.name", OPERATOR]);
  git(["config", "--local", "user.email", "ada@example.test"]);
  writeRepoFile("README.md", "fixture\n");
  commitAll("init");
});

afterEach(() => {
  vi.unstubAllEnvs();
  removeTempDir(repoDir);
  removeTempDir(configDir);
});

const Q1 = question("Q1");
const Q2 = question("Q2");
const Q3 = question("Q3");

describe("decide — an interactive session lands the revised document", { timeout: 30_000 }, () => {
  it("resumes the kept authoring session, moves Q1 with an operator verdict, and commits the two paths", async () => {
    writeSpec(SPEC, specDocument([Q1, Q2]));
    commitAll();
    keepAuthoringSession();
    const h = harness({ answers: [answer(specDocument([Q2], [arbitrated(Q1)]))] });

    const result = await h.run();

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;
    expect(result.right).toMatchObject({
      kind: "committed",
      path: SPEC,
      paths: [SPEC, SPEC_JSON],
      decided: ["Q1"],
      decisionId: `${AUTHORING_ID}/01`,
      session: "resumed-authoring",
    });
    expect(h.lines[0]).toBe(
      "decide spec log-rotation — framing F1–F5, then Q1, Q2 — interactive, resumed authoring session",
    );

    // The interactive launch: the kept (retried) session, resumed at its cwd.
    expect(h.session.invocations).toHaveLength(1);
    const [invocation] = h.session.invocations;
    expect(invocation?.executable).toBe("claude");
    expect(invocation?.cwd).toBe(repoDir);
    expect(invocation?.args.slice(0, 6)).toEqual([
      "--resume",
      KEPT_SESSION,
      "--model",
      "claude-opus-5-5",
      "--effort",
      "high",
    ]);
    // Read-only whatever the profile: Manual mode, the reading tools only; the prompt is read from the decision folder, so the
    // repository gets no file.
    expect(invocation?.args.slice(6)).toEqual([
      "--permission-mode",
      "default",
      "--add-dir",
      decisionFolder(),
      "--tools",
      "Read,Grep,Glob",
      "--strict-mcp-config",
      "--",
      `Read ${join(decisionFolder(), "prompt.md")} and follow it.`,
    ]);
    expect(existsSync(join(repoDir, ".phax-context"))).toBe(false);
    const prompt = readFileSync(join(decisionFolder(), "prompt.md"), "utf8");
    expect(prompt.indexOf("- F1:")).toBeGreaterThan(0);
    expect(prompt.indexOf("- F5:")).toBeLessThan(prompt.indexOf("### Q1 —"));
    expect(prompt.indexOf("### Q1 —")).toBeLessThan(prompt.indexOf("### Q2 —"));

    // The handback: the same session, headless, under the review policy.
    expect(h.backend.resumeCalls).toHaveLength(1);
    const [handback] = h.backend.resumeCalls;
    expect(handback?.sessionId).toBe(KEPT_SESSION);
    expect(handback?.options).toMatchObject({
      provider: "claude-code",
      model: "claude-opus-5-5",
      effort: "high",
      cwd: repoDir,
      outputJsonlPath: join(decisionFolder(), "output.jsonl"),
      readOnly: true,
      phaseFolderPath: decisionFolder(),
    });
    expect(handback?.prompt).toBe(
      readFileSync(join(decisionFolder(), "handback-prompt.md"), "utf8"),
    );

    // Q1 arbitrated by the committing identity at the command's time; Q2 open.
    const sidecar = sidecarJson();
    expect(sidecar["$schema"]).toBe(currentSchemaUrl("spec-document"));
    const [q1] = sidecar["arbitratedQuestions"] as SpecArbitratedQuestion[];
    expect(q1?.id).toBe("Q1");
    expect(q1?.verdict).toMatchObject({
      kind: "decided",
      chosen: "Q1-a",
      by: { kind: "operator", name: OPERATOR },
      at: NOW,
    });
    expect((sidecar["openQuestions"] as OpenQuestion[]).map((q) => q.id)).toEqual(["Q2"]);

    // §9 re-rendered, frontmatter kept; exactly the two paths in HEAD.
    const md = readRepoFile(SPEC);
    expect(md.startsWith(SPEC_FRONTMATTER)).toBe(true);
    expect(md).toContain("## 9b. Arbitrated questions");
    expect(md).toContain(`Decision: Q1-a`);
    expect(headFiles()).toEqual([SPEC_JSON, SPEC]);
    expect(porcelain()).toBe("");
    expect(git(["log", "-1", "--format=%s"]).trim()).toBe("docs(specs): decide log-rotation Q1");
    const body = git(["log", "-1", "--format=%b"]);
    expect(body).toContain("claude-opus-5-5 / high");
    expect(body).toContain(`Decided-By: operator (${OPERATOR})`);
    expect(body).toContain(`Decision-Id: ${AUTHORING_ID}/01`);

    // The decision folder keeps the answer and the diff.
    expect(readFileSync(join(decisionFolder(), "document.json"), "utf8")).toBe(
      readRepoFile(SPEC_JSON),
    );
    expect(readFileSync(join(decisionFolder(), "body.diff"), "utf8")).toContain("+Decision: Q1-a");
    expect(h.prompt.asks).toEqual(["accept the body diff?"]);
    expect(h.lines).toContain("Q1         arbitrated  Q1-a (recommended)");
    expect(h.lines).toContain("Q2         open        (not decided this session)");
  });

  it("starts a new session when local state is gone, and writes nothing when nothing was decided", async () => {
    const doc = specDocument([Q1, Q2]);
    writeSpec(SPEC, doc);
    commitAll();
    const head = headSha();
    const h = harness({ answers: [answer(doc)] });

    const result = await h.run();

    expect(Either.getOrThrow(result)).toMatchObject({ kind: "undecided", session: "new" });
    expect(h.lines[0]).toContain("— interactive, new session");
    const args = h.session.invocations[0]?.args ?? [];
    expect(args[0]).toBe("--session-id");
    expect(args[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.backend.resumeCalls[0]?.sessionId).toBe(args[1]);
    expect(h.prompt.asks).toEqual([]);
    expect(headSha()).toBe(head);
    expect(porcelain()).toBe("");
  });

  it("starts a new session when the kept session is not a Claude Code one", async () => {
    writeSpec(SPEC, specDocument([Q1]));
    commitAll();
    keepAuthoringSession(AUTHORING_ID, "codex-cli");
    const h = harness({ answers: [answer(specDocument([Q1]))] });

    const result = await h.run();

    expect(Either.getOrThrow(result)).toMatchObject({ session: "new" });
    expect(h.session.invocations[0]?.args[0]).toBe("--session-id");
  });

  it("starts a new session here when the kept session ran in another checkout", async () => {
    writeSpec(SPEC, specDocument([Q1]));
    commitAll();
    keepAuthoringSession(AUTHORING_ID, "claude-code", join(configDir, "other-clone"));
    const h = harness({ answers: [answer(specDocument([Q1]))] });

    const result = await h.run();

    expect(Either.getOrThrow(result)).toMatchObject({ session: "new" });
    expect(h.session.invocations[0]?.args[0]).toBe("--session-id");
    expect(h.session.invocations[0]?.cwd).toBe(repoDir);
    expect(h.backend.resumeCalls[0]?.options.cwd).toBe(repoDir);
  });

  it("numbers each decision of an artifact in its own folder", async () => {
    writeSpec(SPEC, specDocument([Q1, Q2]));
    commitAll();
    const first = harness({ answers: [answer(specDocument([Q1, Q2]))] });
    await first.run();
    const second = harness({ answers: [answer(specDocument([Q2], [arbitrated(Q1)]))] });

    const result = await second.run();

    expect(Either.getOrThrow(result)).toMatchObject({ decisionId: `${AUTHORING_ID}/02` });
    expect(existsSync(join(decisionFolder("02"), "prompt.md"))).toBe(true);
  });
});

describe("decide — model resolves from flag, then catalog", { timeout: 30_000 }, () => {
  it("uses the catalog default and prints it, then the flags", async () => {
    writeSpec(SPEC, specDocument([Q1]));
    commitAll();
    const byDefault = harness({ answers: [answer(specDocument([Q1]))] });
    await byDefault.run();
    expect(byDefault.lines[1]).toBe("model      claude-opus-5-5 / high (catalog default)");

    const byFlag = harness({ answers: [answer(specDocument([Q1]))] });
    await byFlag.run({ model: "claude-sonnet-5-5", effort: "medium" });
    expect(byFlag.lines[1]).toBe("model      claude-sonnet-5-5 / medium (flag)");
    expect(byFlag.session.invocations[0]?.args.slice(2, 6)).toEqual([
      "--model",
      "claude-sonnet-5-5",
      "--effort",
      "medium",
    ]);
    expect(byFlag.backend.resumeCalls[0]?.options).toMatchObject({
      model: "claude-sonnet-5-5",
      effort: "medium",
    });
  });
});

describe("decide — preconditions refuse before the session", { timeout: 30_000 }, () => {
  it("refuses a diverged sidecar, naming the remedies", async () => {
    const md = writeSpec(SPEC, specDocument([Q1]));
    writeRepoFile(SPEC, `${md}\nA hand edit.\n`);
    commitAll();
    const h = harness();

    const message = expectRefused(await h.run(), 12, headSha());

    expect(message).toContain("has a body that differs from its sidecar's rendering");
    expect(message).toContain("phax artifact new spec log-rotation --headless");
    expectNoSession(h);
  });

  it("refuses an uncommitted change on the artifact or its sidecar", async () => {
    writeSpec(SPEC, specDocument([Q1]));
    commitAll();
    const head = headSha();
    writeRepoFile(SPEC_JSON, `${readRepoFile(SPEC_JSON)} `);
    const h = harness();

    const result = await h.run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(exitCodeForAuthoringError(result.left)).toBe(12);
      expect(result.left.message).toContain(`${SPEC_JSON} has uncommitted changes`);
    }
    expect(headSha()).toBe(head);
    expectNoSession(h);
  });

  it("names an uncommitted body edit as such, not as a diverged sidecar", async () => {
    const md = writeSpec(SPEC, specDocument([Q1]));
    commitAll();
    writeRepoFile(SPEC, `${md}\nA stray edit.\n`);
    const h = harness();

    const result = await h.run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(exitCodeForAuthoringError(result.left)).toBe(12);
      expect(result.left.message).toContain(
        `${SPEC} has uncommitted changes — commit or discard them first`,
      );
    }
    expectNoSession(h);
  });

  it("refuses a Completed spec", async () => {
    const archived = `docs/specs/archive/${AUTHORING_ID}.md`;
    writeSpec(archived, specDocument([Q1]), SPEC_FRONTMATTER.replace("Draft", "Completed"));
    commitAll();
    const h = harness();

    const message = expectRefused(await h.run({ path: archived }), 12, headSha());

    expect(message).toContain("is Completed — only a Draft artifact is decided");
    expectNoSession(h);
  });

  it("refuses an Approved spec, naming phax artifact reopen", async () => {
    writeSpec(
      SPEC,
      specDocument([Q1]),
      SPEC_FRONTMATTER.replace("Draft", "Approved").replace(
        "---\n",
        "---\napproved:\n  date: 2026-10-16\n  baseline: abc1234\n",
      ),
    );
    commitAll();
    const h = harness();

    const message = expectRefused(await h.run(), 12, headSha());

    expect(message).toBe(
      `Decide refused: ${SPEC} is Approved — reopen it first with \`phax artifact reopen ${SPEC}\``,
    );
    expectNoSession(h);
  });

  it("refuses without a terminal: decide is interactive only", async () => {
    writeSpec(SPEC, specDocument([Q1]));
    commitAll();
    const h = harness({ terminal: false });

    const message = expectRefused(await h.run(), 12, headSha());

    expect(message).toBe("Decide refused: no terminal — phax artifact decide is interactive only");
    expectNoSession(h);
  });

  it("refuses a --model outside Claude Code, naming it", async () => {
    writeSpec(SPEC, specDocument([Q1]));
    commitAll();
    const h = harness();

    const message = expectRefused(await h.run({ model: "gpt-6-sol" }), 12, headSha());

    expect(message).toContain("decide runs on Claude Code only");
    expectNoSession(h);
  });

  it("refuses without a committing identity", async () => {
    writeSpec(SPEC, specDocument([Q1]));
    commitAll();
    git(["config", "--local", "--unset", "user.name"]);
    // An empty GIT_COMMITTER_NAME is no name: phax falls back to user.name, unset.
    vi.stubEnv("GIT_COMMITTER_NAME", "");
    const h = harness();

    const result = await h.run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "DecideRefusedError", reason: "operator" });
      expect(exitCodeForAuthoringError(result.left)).toBe(12);
    }
    expectNoSession(h);
  });

  it("waits for migration: an older live sidecar refuses decide, naming migrate-documents", async () => {
    writeSpec(SPEC, specDocument([Q1]));
    const older = "docs/specs/2609281200-log-format.md";
    writeRepoFile(older, `${SPEC_FRONTMATTER}# Log format\n`);
    writeRepoFile(
      older.replace(/\.md$/, ".json"),
      JSON.stringify({ $schema: schemaUrl("spec-document", "0.17.0"), kind: "spec" }),
    );
    commitAll();
    const h = harness();

    const message = expectRefused(await h.run(), 12, headSha());

    expect(message).toContain("docs/specs/2609281200-log-format.json");
    expect(message).toContain("phax artifact migrate-documents");
    expectNoSession(h);
  });
});

describe("decide — framing first; re-arbitrating one question", { timeout: 30_000 }, () => {
  it("presents Q2 and Q3 after the framing, then Q1 alone with its verdict, keeping it in history", async () => {
    const q1 = arbitrated(Q1, "Q1-a", { by: { kind: "operator", name: "Grace Hopper" } });
    const doc = specDocument([Q2, Q3], [q1]);
    writeSpec(SPEC, doc);
    commitAll();

    const first = harness({ answers: [answer(doc)] });
    await first.run();
    expect(first.lines[0]).toContain("framing F1–F5, then Q2, Q3 —");
    const prompt = readFileSync(join(decisionFolder("01"), "prompt.md"), "utf8");
    const questions = prompt.slice(prompt.indexOf("## 2. The questions"), prompt.indexOf("## 3."));
    expect(prompt.indexOf("- F5:")).toBeLessThan(prompt.indexOf("## 2. The questions"));
    expect(questions.indexOf("### Q2 —")).toBeLessThan(questions.indexOf("### Q3 —"));
    expect(questions).not.toContain("### Q1 —");

    const reArbitrated: SpecArbitratedQuestion = {
      ...arbitrated(Q1, "Q1-b", { revised: ["§5.1"] }),
      history: [q1.verdict],
    };
    const second = harness({ answers: [answer(specDocument([Q2, Q3], [reArbitrated]))] });
    const result = await second.run({ question: "Q1" });

    expect(Either.getOrThrow(result)).toMatchObject({ kind: "committed", decided: ["Q1"] });
    expect(second.lines[0]).toContain("then Q1 —");
    const reprompt = readFileSync(join(decisionFolder("02"), "prompt.md"), "utf8");
    expect(reprompt).toContain("Current verdict (decided, by the operator (Grace Hopper)");
    const [kept] = sidecarJson()["arbitratedQuestions"] as SpecArbitratedQuestion[];
    expect(kept?.verdict).toMatchObject({ chosen: "Q1-b", by: { name: OPERATOR } });
    expect(kept?.history).toEqual([q1.verdict]);
    expect(second.lines).toContain("Q1         arbitrated  Q1-b — departs: revises §5.1");

    const head = headSha();
    const third = harness();
    const message = expectRefused(await third.run({ question: "Q9" }), 12, head);
    expect(message).toContain("--question Q9 names no question of the artifact");
    expect(message).toContain("Q2, Q3, Q1");
    expect(third.session.invocations).toEqual([]);
  });
});

describe("decide — nothing to decide", { timeout: 30_000 }, () => {
  it("exits with nothing when every question is arbitrated, spawning no session", async () => {
    writeSpec(SPEC, specDocument([], [arbitrated(Q1)]));
    commitAll();
    const head = headSha();
    const h = harness({ terminal: false });

    const result = await h.run();

    expect(result).toEqual(Either.right({ kind: "nothing", path: SPEC }));
    expectNoSession(h);
    expect(headSha()).toBe(head);
  });
});

describe("decide — doctrine", { timeout: 30_000 }, () => {
  const PROJECT_SKILL =
    "- `C4` Prefer the reversible option.\n- `S1` Adopt it (project wording).\n";
  const DOCTRINE = "- `X1` Logs are evidence: keep them reachable.\n";

  function setUpDoctrine(): void {
    writeSpec(SPEC, specDocument([Q1, Q2]));
    writeRepoFile(".claude/skills/phax-decide-spec/SKILL.md", PROJECT_SKILL);
    writeRepoFile("docs/doctrine/spec.md", DOCTRINE);
    commitAll();
  }

  it("loads the project skill, then the doctrine file; X1 and C4 are citable", async () => {
    setUpDoctrine();
    const h = harness({
      answers: [answer(specDocument([Q2], [arbitrated(Q1, "Q1-a", { principles: ["X1", "C4"] })]))],
    });

    const result = await h.run({ doctrinePath: "docs/doctrine/spec.md" });

    expect(Either.getOrThrow(result)).toMatchObject({ kind: "committed" });
    const prompt = readFileSync(join(decisionFolder(), "prompt.md"), "utf8");
    const skillAt = prompt.indexOf("Adopt it (project wording)");
    expect(skillAt).toBeGreaterThan(0);
    expect(prompt).not.toContain("Decide a spec (bundled)");
    expect(prompt.indexOf("## Project doctrine (docs/doctrine/spec.md)")).toBeGreaterThan(skillAt);
    expect(prompt.indexOf("Logs are evidence")).toBeGreaterThan(skillAt);
  });

  it("rejects a verdict citing S0, which never opens a list item", async () => {
    writeSpec(SPEC, specDocument([Q1, Q2]));
    commitAll();
    const bad = answer(specDocument([Q2], [arbitrated(Q1, "Q1-a", { principles: ["S0"] })]));
    const h = harness({ answers: [bad, bad] });

    const message = expectRefused(await h.run(), 5, headSha());

    expect(message).toContain(
      'arbitratedQuestions[0].verdict.principles[0]: "S0" is no principle id',
    );
    expect(h.backend.resumeCalls).toHaveLength(2);
  });

  it("refuses an unreadable doctrine file, one with no id, and one redefining S1", async () => {
    writeSpec(SPEC, specDocument([Q1]));
    writeRepoFile("docs/doctrine/empty.md", "Prose only, no principle.\n");
    writeRepoFile("docs/doctrine/clash.md", "- `S1` Mine.\n");
    commitAll();
    const head = headSha();
    for (const doctrinePath of [
      "docs/doctrine/missing.md",
      "docs/doctrine/empty.md",
      "docs/doctrine/clash.md",
    ]) {
      const h = harness();
      const result = await h.run({ doctrinePath });
      expect(Either.isLeft(result), doctrinePath).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toMatchObject({ _tag: "DecideRefusedError", reason: "doctrine" });
        expect(exitCodeForAuthoringError(result.left)).toBe(12);
        expect(result.left.message).toContain(doctrinePath);
      }
      expectNoSession(h);
    }
    expect(headSha()).toBe(head);
  });
});

describe("decide — invalid decisions land nothing", { timeout: 30_000 }, () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly answer: () => string;
    readonly question?: string;
    readonly path: string;
  }> = [
    { name: "prose", answer: () => "I decided Q1, thanks.", path: "" },
    {
      name: "a verdict citing S12",
      answer: () => answer(specDocument([Q2], [arbitrated(Q1, "Q1-a", { principles: ["S12"] })])),
      path: "arbitratedQuestions[0].verdict.principles[0]",
    },
    {
      name: "a moved question that was not presented",
      question: "Q1",
      answer: () => answer(specDocument([Q1], [arbitrated(Q2)])),
      path: "arbitratedQuestions[0].id",
    },
    {
      name: "a chosen option the question does not list",
      answer: () =>
        answer(
          specDocument(
            [Q2],
            [{ ...arbitrated(Q1), verdict: verdict(Q1, "Q1-z", { abandoned: ["Q1-a", "Q1-b"] }) }],
          ),
        ),
      path: "arbitratedQuestions[0].verdict.chosen",
    },
    {
      name: "an abandoned list that is not exactly the unchosen options",
      answer: () =>
        answer(
          specDocument(
            [Q2],
            [{ ...arbitrated(Q1), verdict: verdict(Q1, "Q1-a", { abandoned: [] }) }],
          ),
        ),
      path: "arbitratedQuestions[0].verdict.abandoned",
    },
  ];

  for (const c of cases) {
    it(`${c.name}: exit 5 naming the path, tree and HEAD unchanged`, async () => {
      writeSpec(SPEC, specDocument([Q1, Q2]));
      commitAll();
      const h = harness({ answers: [c.answer(), c.answer()] });

      const result = await h.run(c.question === undefined ? {} : { question: c.question });

      const message = expectRefused(result, 5, headSha());
      expect(message).toContain("revised document rejected twice");
      if (c.path !== "") expect(message).toContain(`retry: ${c.path}`);
      if (Either.isLeft(result)) expect(result.left).toMatchObject({ path: c.path });
      expect(h.warnings[0]).toContain("revised document refused");
      expect(existsSync(join(decisionFolder(), "retry-prompt.md"))).toBe(true);
      expect(h.backend.resumeCalls[1]?.options.outputJsonlPath).toBe(
        join(decisionFolder(), "retry-output.jsonl"),
      );
    });
  }

  it("a refusal fixed by the corrective resume lands", async () => {
    writeSpec(SPEC, specDocument([Q1, Q2]));
    commitAll();
    const h = harness({
      answers: ["not json", answer(specDocument([Q2], [arbitrated(Q1)]))],
    });

    const result = await h.run();

    expect(Either.getOrThrow(result)).toMatchObject({ kind: "committed", decided: ["Q1"] });
    expect(h.backend.resumeCalls[1]?.sessionId).toBe("sess-handback");
    expect(h.backend.resumeCalls[1]?.prompt).toContain(
      "Refusal: the session's final message is not JSON",
    );
  });
});

describe("decide — the answer is read at the current shape only", { timeout: 30_000 }, () => {
  const READS = currentSchemaUrl("spec-document");
  const decided = () => specDocument([Q2], [arbitrated(Q1)]);
  const cases: ReadonlyArray<{ readonly name: string; readonly answer: () => string }> = [
    { name: "no $schema", answer: () => answer(decided(), null) },
    {
      name: "spec-document 0.17.0",
      answer: () => answer(decided(), schemaUrl("spec-document", "0.17.0")),
    },
    {
      name: "plan-document at its current shape",
      answer: () => answer(decided(), currentSchemaUrl("plan-document")),
    },
  ];

  for (const c of cases) {
    it(`${c.name}: exit 5 naming the $schema phax reads, never lifted`, async () => {
      writeSpec(SPEC, specDocument([Q1, Q2]));
      commitAll();
      const h = harness({ answers: [c.answer(), c.answer()] });

      const message = expectRefused(await h.run(), 5, headSha());

      expect(message).toContain(`phax reads ${READS}`);
      // No answer decoded, so none is kept.
      expect(existsSync(join(decisionFolder(), "document.json"))).toBe(false);
    });
  }
});

function surfaceElement(name: string, summary: string) {
  return {
    surface: name,
    summary,
    binding: "normative" as const,
    before: null,
    after: "phax rotate\n  rotated",
  };
}

describe("decide — the surface summary is kept", { timeout: 30_000 }, () => {
  // ac-decide-drops
  it("refuses a revised document that drops one element's summary, naming surface[1].summary, and keeps both files", async () => {
    const doc: SpecDocument = {
      ...specDocument([Q1, Q2]),
      surface: [
        surfaceElement("cli: `phax rotate`", "An operator can rotate a run's log."),
        surfaceElement("cli: `phax rotate --all`", "An operator can rotate every log at once."),
      ],
    };
    writeSpec(SPEC, doc);
    commitAll();
    const spec = readFileSync(join(repoDir, SPEC), "utf8");
    const sidecar = readFileSync(join(repoDir, SPEC.replace(/\.md$/, ".json")), "utf8");
    const { summary: _dropped, ...second } = doc.surface[1]!;
    const revisedDoc = {
      ...specDocument([Q2], [arbitrated(Q1)]),
      surface: [doc.surface[0], second],
    };
    const revised = answer(revisedDoc);
    const h = harness({ answers: [revised, revised] });

    const message = expectRefused(await h.run(), 5, headSha());

    expect(message).toContain("revised document rejected twice");
    expect(message).toContain("surface[1].summary");
    expect(readFileSync(join(repoDir, SPEC), "utf8")).toBe(spec);
    expect(readFileSync(join(repoDir, SPEC.replace(/\.md$/, ".json")), "utf8")).toBe(sidecar);
  });
});

describe("decide — revision rules", { timeout: 30_000 }, () => {
  it("refuses an edit to open question Q2, which was not decided", async () => {
    writeSpec(SPEC, specDocument([Q1, Q2]));
    commitAll();
    const edited = { ...Q2, rationale: "a new rationale" };
    const bad = answer(specDocument([edited], [arbitrated(Q1)]));
    const h = harness({ answers: [bad, bad] });

    const message = expectRefused(await h.run(), 5, headSha());

    expect(message).toContain('retry: openQuestions[0].rationale: "Q2" was not decided');
  });

  it("refuses a document that drops arbitrated Q3", async () => {
    writeSpec(SPEC, specDocument([Q1, Q2], [arbitrated(Q3)]));
    commitAll();
    const bad = answer(specDocument([Q2], [arbitrated(Q1)]));
    const h = harness({ answers: [bad, bad] });

    const message = expectRefused(await h.run(), 5, headSha());

    expect(message).toContain('retry: arbitratedQuestions: "Q3" is missing');
  });

  it("refuses a criterion that references a requirement it removed", async () => {
    writeSpec(SPEC, specDocument([Q1, Q2]));
    commitAll();
    const broken = {
      ...specDocument([Q2], [arbitrated(Q1, "Q1-b", { revised: ["§5"] })]),
      requirements: [
        {
          id: "R-rotate",
          title: "Rotate",
          pattern: "event" as const,
          statement: "WHEN a day ends THE system SHALL rotate the log.",
        },
      ],
    };
    const h = harness({ answers: [answer(broken), answer(broken)] });

    const message = expectRefused(await h.run(), 5, headSha());

    expect(message).toContain("retry: acceptanceCriteria");
  });
});

describe("decide — limits, concurrent edits, commit failures", { timeout: 30_000 }, () => {
  it("a usage limit on the handback exits 8 with nothing written", async () => {
    writeSpec(SPEC, specDocument([Q1]));
    commitAll();
    const h = harness();
    h.backend.failNextResumeWithRateLimit({ kind: "usage_limit" });

    const result = await h.run();

    expectRefused(result, 8, headSha());
    expect(h.prompt.asks).toEqual([]);
  });

  it("a concurrent edit to the artifact exits 12, leaving the edit and committing nothing", async () => {
    const md = writeSpec(SPEC, specDocument([Q1, Q2]));
    commitAll();
    const head = headSha();
    const h = harness({ answers: [answer(specDocument([Q2], [arbitrated(Q1)]))] });
    h.backend.setOnResumeAgent(() => writeRepoFile(SPEC, `${md}\nEdited meanwhile.\n`));

    const result = await h.run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "DecideRefusedError", reason: "changed" });
      expect(exitCodeForAuthoringError(result.left)).toBe(12);
    }
    expect(readRepoFile(SPEC)).toBe(`${md}\nEdited meanwhile.\n`);
    expect(headSha()).toBe(head);
    expect(porcelain()).toBe(`M ${SPEC}`);
  });

  it("a failed commit exits 12, leaving both files written but uncommitted", async () => {
    writeSpec(SPEC, specDocument([Q1, Q2]));
    commitAll();
    const head = headSha();
    const hook = join(repoDir, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    const h = harness({ answers: [answer(specDocument([Q2], [arbitrated(Q1)]))] });

    const result = await h.run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "ArtifactCommitFailedError" });
      expect(exitCodeForAuthoringError(result.left)).toBe(12);
    }
    expect(headSha()).toBe(head);
    expect(readRepoFile(SPEC)).toContain("## 9b. Arbitrated questions");
    expect(porcelain().split("\n").toSorted()).toEqual([`M  ${SPEC_JSON}`, `M  ${SPEC}`]);
  });
});

describe("decide — a plan stays executable", { timeout: 30_000 }, () => {
  it("lands Q1 with its phase, keeps the lineage, and seeds the extraction cache", async () => {
    const before = planDocument([Q1, Q2]);
    writePlan(before);
    commitAll();
    const decidedQ1: PlanArbitratedQuestion = {
      ...Q1,
      verdict: { ...verdict(Q1), principles: ["P1"], phase: "phase-02" },
      history: [],
    };
    // The session's lineage is overruled by the original's.
    const returned = { ...planDocument([Q2], [decidedQ1]), completesSpec: true };
    const h = harness({ answers: [answer(returned)] });

    const result = await h.run({ path: PLAN });

    expect(Either.getOrThrow(result)).toMatchObject({
      kind: "committed",
      paths: [PLAN, PLAN_JSON],
      // `<stamp>-<slug>`, as authoring names the plan's session folder.
      decisionId: `${PLAN_ID}/01`,
    });
    const prompt = readFileSync(join(decisionFolder("01", PLAN_ID), "prompt.md"), "utf8");
    expect(prompt).toContain("Decide a plan (bundled)");
    const sidecar = sidecarJson(PLAN_JSON) as {
      sourceSpec: unknown;
      completesSpec: unknown;
      preamble: { arbitratedQuestions: PlanArbitratedQuestion[] };
    };
    expect([sidecar.sourceSpec, sidecar.completesSpec]).toEqual([SOURCE_SPEC, false]);
    expect(sidecar.preamble.arbitratedQuestions[0]?.verdict).toMatchObject({ phase: "phase-02" });
    const md = readRepoFile(PLAN);
    expect(md.startsWith(PLAN_FRONTMATTER)).toBe(true);
    expect(structureFindings(md)).toEqual([]);
    expect(git(["log", "-1", "--format=%s"]).trim()).toBe("docs(plans): decide log-rotation Q1");

    // The re-rendered plan's projection is seeded: no extraction session runs.
    const fs = makeRootedNodeFileSystemLayer(repoDir);
    const cached = await Effect.runPromise(
      readCacheEntry(stateRoot, planCacheKey(md, EXTRACT_MODEL, EXTRACT_EFFORT)).pipe(
        Effect.provide(fs),
      ),
    );
    const { $schema: _schema, ...landed } = sidecar as unknown as Record<string, unknown>;
    expect(Option.getOrNull(cached)).toEqual(
      projectExtractedPlan({ version: 1, ...(landed as unknown as PlanDocument) }),
    );
    const extractor = makeFakeBackend();
    const loaded = await Effect.runPromise(
      loadOrExtractPlan({
        planMdPath: PLAN,
        model: EXTRACT_MODEL,
        effort: EXTRACT_EFFORT,
        stateRoot,
        nowIso: NOW,
      }).pipe(Effect.provide(Layer.mergeAll(fs, extractor.layer))),
    );
    expect(loaded.plan.phases.map((p) => p.id)).toEqual(["phase-01", "phase-02"]);
    expect(extractor.impl.completeCalls).toEqual([]);
  });

  it("a plan verdict naming a phase the plan lacks exits 5, naming the path", async () => {
    writePlan(planDocument([Q1, Q2]));
    commitAll();
    const bad = answer(
      planDocument(
        [Q2],
        [
          {
            ...Q1,
            verdict: { ...verdict(Q1), principles: ["P1"], phase: "phase-09" },
            history: [],
          },
        ],
      ),
    );
    const h = harness({ answers: [bad, bad] });

    const message = expectRefused(await h.run({ path: PLAN }), 5, headSha());

    expect(message).toContain("retry: preamble.arbitratedQuestions[0].verdict.phase");
  });
});

describe("decide — questions are named by their ids", { timeout: 30_000 }, () => {
  it("decides q-scope by id, status names q-keep open, and an unknown id names both", async () => {
    const keep = question("q-keep", ["keep-10", "keep-20"]);
    const scope = question("q-scope", ["local", "global"]);
    writeSpec(SPEC, specDocument([keep, scope]));
    commitAll();
    const h = harness({ answers: [answer(specDocument([keep], [arbitrated(scope)]))] });

    const result = await h.run({ question: "q-scope" });

    expect(Either.getOrThrow(result)).toMatchObject({ kind: "committed", decided: ["q-scope"] });
    const md = readRepoFile(SPEC);
    expect(md).toContain("### q-keep — What about q-keep?");
    expect(md).toContain("### q-scope — What about q-scope?");
    expect(md).toContain("- keep-10 — ");
    expect(md).toContain("- keep-20 — ");
    expect(md).toContain("Recommendation: keep-10");

    const report = await Effect.runPromise(
      inspectArtifact(SPEC).pipe(Effect.provide(makeRootedNodeFileSystemLayer(repoDir))),
    );
    expect(report.questions).toMatchObject({ kind: "summary", summary: { open: ["q-keep"] } });

    const again = harness();
    const message = expectRefused(await again.run({ question: "Q2" }), 12, headSha());
    expect(message).toContain("q-keep, q-scope");
  });
});

// A spec whose one requirement and criterion are written for `statement`.
function withRequirement(statement: string, then: string, doc: SpecDocument): SpecDocument {
  return {
    ...doc,
    requirements: [{ id: "R-check", title: "Check", pattern: "event", statement }],
    acceptanceCriteria: [
      {
        id: "AC-1",
        name: "Checked",
        given: "a log",
        when: "it is checked",
        then,
        refs: ["R-check"],
      },
    ],
  };
}

describe(
  "decide — a departing verdict revises the body, after the diff is accepted",
  { timeout: 30_000 },
  () => {
    const Q4: OpenQuestion = {
      id: "Q4",
      question: "Is the check structural or an oracle?",
      options: [
        { id: "structural", label: "A structural check", abandons: "behaviour coverage" },
        { id: "oracle", label: "An oracle", abandons: "speed" },
      ],
      recommendation: "structural",
      rationale: "it is faster",
    };

    it("a declined diff writes nothing; an accepted one commits the revised body", async () => {
      const before = withRequirement(
        "WHEN a log is written THE system SHALL check its structure.",
        "its structure is checked",
        specDocument([Q4]),
      );
      writeSpec(SPEC, before);
      commitAll();
      const head = headSha();
      const revised = withRequirement(
        "WHEN a log is written THE system SHALL check it against an oracle.",
        "the oracle agrees",
        specDocument(
          [],
          [arbitrated(Q4, "oracle", { revised: ["§5 R-check", "AC-1"], principles: ["C4"] })],
        ),
      );

      const declined = harness({ answers: [answer(revised)], confirm: [false] });
      expect(Either.getOrThrow(await declined.run())).toMatchObject({ kind: "declined" });
      expect(declined.lines).toContain(
        "Q4         arbitrated  oracle — departs: revises §5 R-check, AC-1",
      );
      expect(
        declined.lines.some((l) =>
          l.includes("+WHEN a log is written THE system SHALL check it against an oracle."),
        ),
      ).toBe(true);
      expect(headSha()).toBe(head);
      expect(porcelain()).toBe("");

      const cancelled = harness({ answers: [answer(revised)], confirm: [FAKE_PROMPT_CANCEL] });
      expect(Either.getOrThrow(await cancelled.run())).toMatchObject({ kind: "declined" });
      expect(headSha()).toBe(head);

      const accepted = harness({ answers: [answer(revised)], confirm: [true] });
      expect(Either.getOrThrow(await accepted.run())).toMatchObject({ kind: "committed" });
      const sidecar = sidecarJson() as unknown as SpecDocument;
      expect(sidecar.arbitratedQuestions[0]?.verdict).toMatchObject({
        chosen: "oracle",
        revised: ["§5 R-check", "AC-1"],
      });
      expect(sidecar.requirements[0]?.statement).toContain("against an oracle");
      expect(sidecar.acceptanceCriteria[0]?.refs).toEqual(["R-check"]);
    });

    it("a recommended verdict with revised [] changes nothing beyond §9 and the decision log", async () => {
      const before = specDocument([Q4]);
      writeSpec(SPEC, before);
      commitAll();
      const h = harness({ answers: [answer(specDocument([], [arbitrated(Q4)]))] });

      await h.run();

      const sidecar = sidecarJson() as unknown as SpecDocument;
      expect(sidecar.requirements).toEqual(before.requirements);
      expect(sidecar.acceptanceCriteria).toEqual(before.acceptanceCriteria);
      expect(sidecar.arbitratedQuestions[0]?.verdict).toMatchObject({ revised: [] });
    });
  },
);

// ── The decision record (§5.30) ───────────────────────────────────────────

const RECORDS_ON: ResolvedRecordsConfig = {
  enabled: true,
  transcript: true,
  destination: { kind: "in-repo" },
  autoPush: false,
};
const RECORDS_BRANCH = "phax/records/v1";
const KEPT_FIRST_SESSION = "11111111-2222-4333-8444-555555555555";

// A Claude handback turn's stream: every event names the session it ran in.
function claudeTranscript(sessionId: string): string {
  return [
    JSON.stringify({ type: "system", subtype: "init", session_id: sessionId }),
    JSON.stringify({
      type: "result",
      session_id: sessionId,
      result: "{}",
      usage: {
        input_tokens: 900,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 4000,
        output_tokens: 700,
      },
      total_cost_usd: 0.2,
    }),
    "",
  ].join("\n");
}

// The handback writes its transcript as Claude would, naming the session.
function playTranscripts(h: Harness): void {
  h.backend.setOnResumeAgent((sessionId, _prompt, options) => {
    if (options.outputJsonlPath !== undefined) {
      writeFileSync(options.outputJsonlPath, claudeTranscript(sessionId));
    }
  });
}

function recordsBranchExists(): boolean {
  return git(["branch", "--list", RECORDS_BRANCH]).trim() !== "";
}

/** The newest record's files, by path, as committed on the records branch. */
function recordBlobs(): ReadonlyMap<string, string> {
  const paths = git(["ls-tree", "-r", "--name-only", RECORDS_BRANCH]).trim().split("\n");
  return new Map(paths.map((path) => [path, git(["show", `${RECORDS_BRANCH}:${path}`])]));
}

function recordManifest(index = "01", id = AUTHORING_ID): Record<string, unknown> {
  return JSON.parse(
    git(["show", `${RECORDS_BRANCH}:decision/${id}/${index}/record.json`]),
  ) as Record<string, unknown>;
}

describe("decide — the decision record", { timeout: 30_000 }, () => {
  it("explains a committed decide: two arbitrated, one departing, no session id anywhere", async () => {
    const before = specDocument([Q1, Q2]);
    writeSpec(SPEC, before);
    commitAll();
    const head = headSha();
    keepAuthoringSession();
    const revised: SpecDocument = {
      ...specDocument([], [arbitrated(Q1), arbitrated(Q2, "Q2-b", { revised: ["§5 R-keep"] })]),
      requirements: [
        {
          id: "R-keep",
          title: "Keep",
          pattern: "event",
          statement: "WHEN a run ends THE system SHALL keep its log for a week.",
        },
      ],
    };
    const h = harness({ answers: [answer(revised)] });
    playTranscripts(h);

    const result = await h.run({ records: RECORDS_ON });

    const committed = Either.getOrThrow(result);
    if (committed.kind !== "committed") throw new Error("expected committed");
    expect(committed.record).toMatchObject({
      kind: "written",
      key: `decision/${AUTHORING_ID}/01`,
      shape: "full",
    });
    expect(committed.recordPush).toEqual({ kind: "not-configured" });

    const outcome = await Effect.runPromise(
      explainRecord({
        sha: committed.commit.hash,
        repoRoot: repoDir,
        records: RECORDS_ON,
        publishRemote: "origin",
      }).pipe(Effect.provide(Layer.mergeAll(NodeGitLayer, NodeShellLayer))),
    );
    if (outcome.kind !== "found-decision")
      throw new Error(`expected found-decision: ${outcome.kind}`);
    expect(outcome.record.manifest).toMatchObject({
      kind: "decision",
      decisionId: `${AUTHORING_ID}/01`,
      artifact: SPEC,
      artifactKind: "spec",
      mode: "interactive",
      session: "resumed-authoring",
      doctrine: [
        {
          kind: "skill",
          name: "phax-decide-spec",
          source: "bundled",
          fingerprint: createHash("sha256").update(SKILL_SPEC).digest("hex"),
        },
      ],
      questions: ["Q1", "Q2"],
      arbitrated: 2,
      departed: 1,
      sourceSha: head,
      provider: "claude-code",
      model: "claude-opus-5-5",
      effort: "high",
      outcome: "committed",
      commit: committed.commit.hash,
      usage: { available: true, usage: { provider: "claude-code", outputTokens: 700 } },
    });
    expect(outcome.record.files).toEqual([
      "body.diff",
      "document.json",
      "handback-prompt.md",
      "output.jsonl",
      "prompt.md",
    ]);
    expect(recordManifest()["$schema"]).toBe(currentSchemaUrl("decision-record-manifest"));
    const blobs = recordBlobs();
    expect(blobs.get(`decision/${AUTHORING_ID}/01/body.diff`)).toContain("for a week");
    expect(blobs.get(`decision/${AUTHORING_ID}/01/document.json`)).toBe(readRepoFile(SPEC_JSON));
    // The kept authoring ids reach no blob, the transcript's included.
    for (const [path, blob] of blobs) {
      expect(blob, path).not.toContain(KEPT_SESSION);
      expect(blob, path).not.toContain(KEPT_FIRST_SESSION);
    }
    expect(blobs.get(`decision/${AUTHORING_ID}/01/output.jsonl`)).toContain(
      "[session id withheld]",
    );
  });

  it("a refused document leaves a failed record, with the retry and without a document", async () => {
    writeSpec(SPEC, specDocument([Q1, Q2]));
    commitAll();
    const h = harness({ answers: ["prose", "more prose"] });
    playTranscripts(h);

    expectRefused(await h.run({ records: RECORDS_ON }), 5, headSha());

    const manifest = recordManifest();
    expect(manifest).toMatchObject({
      outcome: "failed",
      commit: null,
      arbitrated: 0,
      departed: 0,
      session: "new",
    });
    // Both handback turns are counted.
    expect(manifest["usage"]).toMatchObject({ usage: { outputTokens: 1400 } });
    const files = [...recordBlobs().keys()].map((path) => path.split("/").at(-1));
    expect(files.toSorted()).toEqual([
      "handback-prompt.md",
      "output.jsonl",
      "prompt.md",
      "record.json",
      "retry-output.jsonl",
      "retry-prompt.md",
    ]);
    // The new session's own id is withheld too.
    const newSession = h.session.invocations[0]?.args[1] ?? "";
    for (const blob of recordBlobs().values()) expect(blob).not.toContain(newSession);
  });

  it("a declined diff leaves a declined record carrying the diff shown", async () => {
    writeSpec(SPEC, specDocument([Q1, Q2]));
    commitAll();
    const h = harness({
      answers: [answer(specDocument([Q2], [arbitrated(Q1)]))],
      confirm: [false],
    });

    const result = await h.run({ records: RECORDS_ON });

    expect(Either.getOrThrow(result)).toMatchObject({
      kind: "declined",
      record: { kind: "written" },
    });
    expect(recordManifest()).toMatchObject({
      outcome: "declined",
      commit: null,
      arbitrated: 1,
      departed: 0,
      shape: "skeleton",
      usage: { available: false },
    });
    expect([...recordBlobs().keys()]).toContain(`decision/${AUTHORING_ID}/01/body.diff`);
  });

  it("a document that decides nothing leaves an undecided record", async () => {
    const doc = specDocument([Q1]);
    writeSpec(SPEC, doc);
    commitAll();
    const h = harness({ answers: [answer(doc)] });

    const result = await h.run({ records: RECORDS_ON });

    expect(Either.getOrThrow(result)).toMatchObject({ kind: "undecided" });
    expect(recordManifest()).toMatchObject({ outcome: "undecided", commit: null, arbitrated: 0 });
  });

  it("a usage limit and a concurrent edit each leave a failed record", async () => {
    writeSpec(SPEC, specDocument([Q1, Q2]));
    commitAll();
    const limited = harness();
    limited.backend.failNextResumeWithRateLimit({ kind: "usage_limit" });
    expectRefused(await limited.run({ records: RECORDS_ON }), 8, headSha());
    expect(recordManifest("01")).toMatchObject({ outcome: "failed", usage: { available: false } });

    const md = readRepoFile(SPEC);
    const edited = harness({ answers: [answer(specDocument([Q2], [arbitrated(Q1)]))] });
    edited.backend.setOnResumeAgent(() => writeRepoFile(SPEC, `${md}\nEdited meanwhile.\n`));
    const result = await edited.run({ records: RECORDS_ON });
    expect(Either.isLeft(result)).toBe(true);
    expect(recordManifest("02")).toMatchObject({ outcome: "failed", commit: null, arbitrated: 1 });
  });

  it("a refusal before the session writes no record", async () => {
    writeSpec(SPEC, specDocument([Q1]));
    commitAll();
    const h = harness({ terminal: false });

    expectRefused(await h.run({ records: RECORDS_ON }), 12, headSha());

    expect(recordsBranchExists()).toBe(false);
  });

  it("a failed decide warns when its record is refused, and still fails as the decide did", async () => {
    writeSpec(SPEC, specDocument([Q1]));
    commitAll();
    const h = harness();
    h.github.setVisibility("public");
    h.backend.failNextResumeWithRateLimit({ kind: "usage_limit" });

    expectRefused(await h.run({ records: RECORDS_ON }), 8, headSha());

    expect(h.warnings.some((w) => w.startsWith("decision record refused: "))).toBe(true);
    expect(recordsBranchExists()).toBe(false);
  });
});
