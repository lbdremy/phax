// Acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transitionArtifactBy } from "../../src/app/artifactStatus.js";
import { type DecideArtifactInput, decideArtifact } from "../../src/app/decideArtifact.js";
import { migrateDocuments } from "../../src/app/migrateDocuments.js";
import { plansStalenessReport } from "../../src/app/planStaleness.js";
import { runArtifactStatus } from "../../src/cli/commands/artifact.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import { serializeSidecar } from "../../src/domain/artifact/sidecar.js";
import type { ArtifactStatus } from "../../src/domain/artifact/status.js";
import { renderPlanBody } from "../../src/domain/authoring/renderPlan.js";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import { renderSpecBodyV0_17_0 } from "../../src/domain/authoring/renderSpecV0_17_0.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { ArtifactOpenQuestionsError } from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakePrompt } from "../../src/infra/fakes/prompt.js";
import { makeFakeSession } from "../../src/infra/fakes/session.js";
import { makeFakeTerminal } from "../../src/infra/fakes/terminal.js";
import { makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { type SpecDocumentV0_17_0Value, currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { PlanDocument } from "../../src/schemas/planDocument.js";
import type {
  LiftedVerdict,
  OpenQuestion,
  PlanArbitratedQuestion,
  SpecArbitratedQuestion,
} from "../../src/schemas/questions.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";
import type { SpecDocument } from "../../src/schemas/specDocument.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Real-git acceptance for the decide steps of spec artifact-decide §8 that
// the earlier plans left: decide after reopen, a bound plan going stale after
// a decide, a lifted spec decided after migration, status after a decide and
// a machine approval, and a hand-authored spec decided then refused approval.
// The interactive session, the handback, the confirm prompt and the terminal
// are fakes; approve, reopen, migrate, status and plans status are real.
// Every spec, plan, question and operator is made up.

const OPERATOR = "Ada Lovelace";
const NOW = "2026-10-16T09:00:41.000Z";
const SPEC = "docs/specs/2610160900-log-rotation.md";
const SPEC_JSON = "docs/specs/2610160900-log-rotation.json";
const PLAN = "docs/plans/2610161000-log-rotation-plan.md";
const PLAN_JSON = "docs/plans/2610161000-log-rotation-plan.json";
const MODEL = "claude-haiku-5-5";
const EFFORT = "low";

const SKILL_SPEC = "- `S1` Adopt the recommendation.\n- `C4` Prefer the reversible option.\n";
const SKILL_PLAN = "- `P1` Split by shippable surface.\n";

const SECURITY: ResolvedSecurityConfig = {
  profile: "secure",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],
};

const SPEC_FRONTMATTER =
  "---\nstatus: Draft\ndate: 2026-10-16\naudience: maintainers\nscope: logs\n---\n";

let repoDir: string;
let configDir: string;
let stateRoot: string;
let originalCwd: string;

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

function porcelain(): string {
  return git(["status", "--porcelain"]).trim();
}

// ── Fixtures ──────────────────────────────────────────────────────────────

function question(id: string): OpenQuestion {
  return {
    id,
    question: `What about ${id}?`,
    options: [
      { id: `${id}-a`, label: "The first way", abandons: "the second way" },
      { id: `${id}-b`, label: "The second way", abandons: "the first way" },
    ],
    recommendation: `${id}-a`,
    rationale: "it is the cheaper way",
  };
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

function lifted(q: OpenQuestion): SpecArbitratedQuestion {
  const v: LiftedVerdict = {
    kind: "lifted",
    chosen: q.recommendation,
    abandoned: q.options.map((o) => o.id).filter((id) => id !== q.recommendation),
    why: q.rationale,
    at: "2026-09-28",
    by: { kind: "unattributed" },
  };
  return { ...q, verdict: v, history: [] };
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

function writeSpec(doc: SpecDocument): void {
  writeRepoFile(SPEC, SPEC_FRONTMATTER + renderSpecBody(doc));
  writeRepoFile(SPEC_JSON, serializeSidecar({ kind: "spec", document: doc }));
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
    sourceSpec: null,
    completesSpec: null,
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

function writePlan(doc: PlanDocument): void {
  writeRepoFile(PLAN, `---\nstatus: Draft\nsource-spec: null\n---\n${renderPlanBody(doc)}`);
  writeRepoFile(PLAN_JSON, serializeSidecar({ kind: "plan", document: doc }));
}

// A hand-written plan bound to the spec, which phax extracts deterministically.
function boundPlanMd(): string {
  return `---
status: Draft
source-spec: ${SPEC}
completes-spec: true
---
# Log rotation store

## Overview

Store the rotated logs.

## Required commands

- pnpm check:full

## phase-01 — Store {#phase-01-store}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

### Planned files to create

- (none)

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Commit subject

feat: store rotated logs

### Commit body

Store them.
`;
}

/** A session's answer: the document, `$schema` first at the current shape. */
function answer(doc: { readonly kind: "spec" | "plan" }): string {
  const format = doc.kind === "spec" ? "spec-document" : "plan-document";
  return JSON.stringify({ $schema: currentSchemaUrl(format), ...doc });
}

// ── Running ───────────────────────────────────────────────────────────────

function decide(answers: readonly string[], overrides: Partial<DecideArtifactInput> = {}) {
  const backend = makeFakeBackend();
  for (const finalText of answers) {
    backend.impl.addResumeResponse({
      sessionId: "sess-handback" as ClaudeSessionId,
      outputPath: "",
      finalText,
    });
  }
  const session = makeFakeSession();
  const lines: string[] = [];
  const layer = Layer.mergeAll(
    makeRootedNodeFileSystemLayer(repoDir),
    NodeGitLayer,
    backend.layer,
    session.layer,
    makeFakePrompt([true]).layer,
    makeFakeTerminal(true).layer,
    makeFakeGitHub().layer,
  );
  const run = Effect.runPromise(
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
        extractPlanModel: MODEL,
        extractPlanEffort: EFFORT,
        nowIso: NOW,
        records: {
          enabled: false,
          transcript: false,
          destination: { kind: "in-repo" },
          autoPush: false,
        },
        publishRemote: "origin",
        output: { log: (l) => lines.push(l), warn: () => {} },
        ...overrides,
      }).pipe(Effect.provide(layer)),
    ),
  );
  return run.then((result) => ({ result, lines }));
}

async function landDecide(
  answers: readonly string[],
  overrides: Partial<DecideArtifactInput> = {},
) {
  const { result, lines } = await decide(answers, overrides);
  if (Either.isLeft(result)) throw new Error(`decide failed: ${result.left.message}`);
  expect(result.right.kind).toBe("committed");
  return { result: result.right, lines };
}

function transition(path: string, target: ArtifactStatus, by: string) {
  const layer = Layer.mergeAll(
    makeRootedNodeFileSystemLayer(repoDir),
    NodeGitLayer,
    makeFakeTerminal(false).layer,
  );
  return Effect.runPromise(
    Effect.either(
      transitionArtifactBy(path, target, { repoRoot: repoDir, nowIso: NOW, commit: true, by }).pipe(
        Effect.provide(layer),
      ),
    ),
  );
}

async function transitioned(path: string, target: ArtifactStatus, by = "operator"): Promise<void> {
  const result = await transition(path, target, by);
  if (Either.isLeft(result)) throw new Error(`${target} failed: ${result.left.message}`);
}

/** Approve refused by the lock, naming exactly `open`; nothing written. */
async function expectLocked(path: string, open: readonly string[]): Promise<void> {
  const head = headSha();
  const result = await transition(path, "Approved", "operator");
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isLeft(result)) {
    expect(result.left).toBeInstanceOf(ArtifactOpenQuestionsError);
    expect(exitCodeForError(result.left)).toBe(12);
    expect(result.left.message).toBe(
      `Approval refused: ${path} has open questions — ${open.join(", ")}. Answer them with \`phax artifact decide ${path}\`.`,
    );
  }
  expect(headSha()).toBe(head);
  expect(porcelain()).toBe("");
}

function plansReport() {
  return Effect.runPromise(
    plansStalenessReport({
      repoRoot: repoDir,
      stateRoot,
      model: "claude-sonnet-5",
      effort: "medium",
      nowIso: NOW,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeRootedNodeFileSystemLayer(repoDir),
          NodeGitLayer,
          makeFakeBackend().layer,
        ),
      ),
    ),
  );
}

async function statusLines(path: string): Promise<string[]> {
  const lines: string[] = [];
  const out = {
    log: (m: string) => lines.push(m),
    warn: (m: string) => lines.push(`WARN: ${m}`),
    error: (m: string) => lines.push(`ERROR: ${m}`),
  };
  process.chdir(repoDir);
  try {
    expect(await runArtifactStatus(path, out)).toBe(0);
  } finally {
    process.chdir(originalCwd);
  }
  return lines;
}

function lineOf(lines: readonly string[], label: string): string | undefined {
  return lines.find((l) => l.startsWith(`${label}:`));
}

beforeEach(() => {
  originalCwd = process.cwd();
  configDir = mkdtempSync(join(tmpdir(), "phax-decide-life-config-"));
  stateRoot = join(realpathSync(configDir), "state");
  writeFileSync(join(configDir, "gitconfig"), "[user]\n\tuseConfigOnly = true\n");
  vi.stubEnv("GIT_CONFIG_GLOBAL", join(configDir, "gitconfig"));
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  vi.stubEnv("GIT_COMMITTER_NAME", OPERATOR);
  repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-decide-life-")));
  git(["init", "-q", "-b", "main"]);
  disableGitAutoMaintenance(repoDir);
  git(["config", "--local", "user.name", OPERATOR]);
  git(["config", "--local", "user.email", "ada@example.test"]);
  writeRepoFile(".gitignore", ".phax-context/\n");
  writeRepoFile("README.md", "fixture\n");
  commitAll("init");
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.unstubAllEnvs();
  removeTempDir(repoDir);
  removeTempDir(configDir);
});

const Q1 = question("Q1");
const Q2 = question("Q2");
const Q3 = question("Q3");

describe("decide after reopen", { timeout: 30_000 }, () => {
  it("reopens an Approved spec, re-arbitrates Q1 alone keeping its verdict in history, then approves again", async () => {
    const q1 = arbitrated(Q1, "Q1-a", { by: { kind: "operator", name: "Grace Hopper" } });
    writeSpec(specDocument([], [q1]));
    commitAll();
    await transitioned(SPEC, "Approved");
    await transitioned(SPEC, "Draft");

    const reArbitrated: SpecArbitratedQuestion = {
      ...arbitrated(Q1, "Q1-b", { revised: ["§5.1"] }),
      history: [q1.verdict],
    };
    const { result, lines } = await landDecide([answer(specDocument([], [reArbitrated]))], {
      question: "Q1",
    });

    expect(result).toMatchObject({ decided: ["Q1"] });
    expect(lines[0]).toContain("framing F1–F5, then Q1 —");
    const sidecar = JSON.parse(readRepoFile(SPEC_JSON)) as {
      arbitratedQuestions: SpecArbitratedQuestion[];
    };
    const [kept] = sidecar.arbitratedQuestions;
    expect(kept?.verdict).toMatchObject({ chosen: "Q1-b", by: { name: OPERATOR }, at: NOW });
    expect(kept?.history).toEqual([q1.verdict]);
    expect(Either.isRight(await transition(SPEC, "Approved", "operator"))).toBe(true);
  });
});

describe("decide on a reopened spec with a bound plan", { timeout: 30_000 }, () => {
  it("leaves the plan fresh on reopen, then stale with spec-changed once the decide is accepted", async () => {
    const q1 = arbitrated(Q1);
    writeSpec(specDocument([], [q1]));
    commitAll();
    await transitioned(SPEC, "Approved");
    writeRepoFile(PLAN, boundPlanMd());
    commitAll("plan");
    await transitioned(PLAN, "Approved");
    expect((await plansReport()).report).toEqual([{ path: PLAN, result: { kind: "fresh" } }]);

    await transitioned(SPEC, "Draft");
    expect((await plansReport()).report).toEqual([{ path: PLAN, result: { kind: "fresh" } }]);

    const reArbitrated: SpecArbitratedQuestion = {
      ...arbitrated(Q1, "Q1-b", { revised: ["§5.1"] }),
      history: [q1.verdict],
    };
    await landDecide([answer(specDocument([], [reArbitrated]))], { question: "Q1" });

    expect((await plansReport()).report).toEqual([
      {
        path: PLAN,
        result: { kind: "stale", evidence: [expect.objectContaining({ reason: "spec-changed" })] },
      },
    ]);
  });
});

// A 0.17.0 spec: Q1 and Q4 carry the author's marker, so migration lifts them.
function olderSpec(): SpecDocumentV0_17_0Value {
  const marked = (id: string, date: string): OpenQuestion => ({
    ...question(id),
    rationale: `Decided by the author on ${date}, the author chose it`,
  });
  const { openQuestions: _o, arbitratedQuestions: _a, ...base } = specDocument([]);
  return {
    ...base,
    openQuestions: [
      marked("Q1", "2026-09-28"),
      question("Q2"),
      question("Q3"),
      marked("Q4", "2026-09-30"),
    ],
  };
}

describe("decide on a lifted spec after migration", { timeout: 30_000 }, () => {
  it("refuses the second approve naming Q2 and Q3, then decide presents Q2 and Q3 alone, the lifted lines kept", async () => {
    const older = olderSpec();
    writeRepoFile(SPEC, SPEC_FRONTMATTER + renderSpecBodyV0_17_0(older));
    writeRepoFile(
      SPEC_JSON,
      `${JSON.stringify({ $schema: schemaUrl("spec-document", "0.17.0"), ...older }, null, 2)}\n`,
    );
    commitAll();

    const migrated = await Effect.runPromise(
      Effect.either(
        migrateDocuments({
          repoRoot: repoDir,
          stateRoot,
          extractPlanModel: MODEL,
          extractPlanEffort: EFFORT,
          nowIso: NOW,
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              makeRootedNodeFileSystemLayer(repoDir),
              NodeGitLayer,
              makeFakeTerminal(false).layer,
            ),
          ),
        ),
      ),
    );
    expect(Either.isRight(migrated)).toBe(true);
    await expectLocked(SPEC, ["Q2", "Q3"]);

    const sidecar = JSON.parse(readRepoFile(SPEC_JSON)) as SpecDocument & { $schema: string };
    expect(sidecar.arbitratedQuestions.map((q) => q.id)).toEqual(["Q1", "Q4"]);
    const revised = {
      ...sidecar,
      openQuestions: [],
      arbitratedQuestions: [...sidecar.arbitratedQuestions, arbitrated(Q2), arbitrated(Q3)],
    };
    const { result, lines } = await landDecide([JSON.stringify(revised)]);

    expect(result).toMatchObject({ decided: ["Q2", "Q3"] });
    expect(lines[0]).toContain("framing F1–F5, then Q2, Q3 —");
    const body = readRepoFile(SPEC);
    expect(body).toContain("Decision: Q1-a — lifted, unattributed, 2026-09-28");
    expect(body).toContain("Decision: Q4-a — lifted, unattributed, 2026-09-30");
    expect(Either.isRight(await transition(SPEC, "Approved", "operator"))).toBe(true);
  });
});

describe("status after a decide and a machine approval", { timeout: 30_000 }, () => {
  it("a spec counts its questions by state and names the machine approver", async () => {
    writeSpec(specDocument([Q1, Q2], [lifted(question("Q0"))]));
    commitAll();
    await expectLocked(SPEC, ["Q1", "Q2"]);

    await landDecide([
      answer(specDocument([], [lifted(question("Q0")), arbitrated(Q1), arbitrated(Q2)])),
    ]);
    await transitioned(SPEC, "Approved", "machine:roadmap-loop");

    const lines = await statusLines(SPEC);
    expect(lineOf(lines, "Questions")).toBe(
      "Questions:         3 — open 0 · arbitrated 3 (1 lifted)",
    );
    expect(lineOf(lines, "Approved")).toMatch(/ by machine \(roadmap-loop\)$/);
    expect(lines.join("\n")).not.toContain("decide");
  });

  it("a plan does the same, its verdict naming the phase", async () => {
    writePlan(planDocument([Q1]));
    commitAll();
    expect(lineOf(await statusLines(PLAN), "Legal transitions")).toMatch(
      /Approved \(once no question is open\)/,
    );

    const decidedQ1: PlanArbitratedQuestion = {
      ...Q1,
      verdict: { ...verdict(Q1, "Q1-a", { principles: ["P1"] }), phase: "phase-02" },
      history: [],
    };
    await landDecide([answer(planDocument([], [decidedQ1]))], { path: PLAN });
    await transitioned(PLAN, "Approved", "machine:roadmap-loop");

    const lines = await statusLines(PLAN);
    expect(lineOf(lines, "Questions")).toBe(
      "Questions:         1 — open 0 · arbitrated 1 (0 lifted)",
    );
    expect(lineOf(lines, "Approved")).toMatch(/ by machine \(roadmap-loop\)$/);
  });
});

const HAND_SPEC = `${SPEC_FRONTMATTER}# Log retention

## 1. Context

Every run writes one log.

## 9. Open questions

### Q1 — Logs: kept per run, or rotated daily?

- per-run — Kept per run — abandons: a bounded log directory
- daily — Rotated daily — abandons: one log per run

Recommendation: per-run — a report names its run

### Q2 — Retention: a week or a month?

- keep-7 — A week — abandons: a release cycle of logs
- keep-30 — A month — abandons: disk space

Recommendation: keep-30 — a month covers a release

## 10. Implementation-planning note

Settled: none.
`;

describe("a hand-authored spec decided in place", { timeout: 30_000 }, () => {
  it("lands Q1, then approve refuses naming Q2", async () => {
    writeRepoFile(SPEC, HAND_SPEC);
    commitAll();
    const handAnswer = JSON.stringify({
      $schema: currentSchemaUrl("hand-decision-answer"),
      kind: "spec",
      decisions: [
        { id: "Q1", verdict: verdict(question("Q1"), "per-run", { abandoned: ["daily"] }) },
      ],
      markdown: HAND_SPEC,
    });

    const { result } = await landDecide([handAnswer]);

    expect(result).toMatchObject({ paths: [SPEC], decided: ["Q1"] });
    await expectLocked(SPEC, ["Q2"]);
  });
});
