// Acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transitionArtifactBy } from "../../src/app/artifactStatus.js";
import { runArtifactStatus } from "../../src/cli/commands/artifact.js";
import { renderPlanBody } from "../../src/domain/authoring/renderPlan.js";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import { renderSpecBodyV0_17_0 } from "../../src/domain/authoring/renderSpecV0_17_0.js";
import { makeFakeTerminal } from "../../src/infra/fakes/terminal.js";
import { makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import {
  type SpecDocumentV0_17_0Value,
  readPlanDocumentFile,
  withSchemaUrl,
} from "../../src/schemas/persisted.js";
import type { PlanDocument } from "../../src/schemas/planDocument.js";
import type {
  LiftedVerdict,
  OpenQuestion,
  PlanArbitratedQuestion,
  SpecArbitratedQuestion,
} from "../../src/schemas/questions.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import type { SpecDocument } from "../../src/schemas/specDocument.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Real-git acceptance for spec artifact-decide §8 'Status counts questions by
// state and arbiter' and 'Questions are named by their ids' (§5.27, §5.55,
// §5.56), without decide: fixtures are written directly. Every spec, plan,
// question, operator and grant is made up.

const OPERATOR = "Ada Lovelace";
const SPEC = "docs/specs/2609251400-plan-prune.md";
const SPEC_SIDECAR = "docs/specs/2609251400-plan-prune.json";
const PLAN = "docs/plans/2609261000-plan-prune-store-plan.md";
const PLAN_SIDECAR = "docs/plans/2609261000-plan-prune-store-plan.json";

const SPEC_FRONTMATTER =
  "---\nstatus: Draft\ndate: 2026-09-25\naudience: maintainers\nscope: plan pruning\n---\n";
const PLAN_FRONTMATTER = "---\nstatus: Draft\nsource-spec: null\n---\n";

function option(id: string, label: string) {
  return { id, label, abandons: `what ${label.toLowerCase()} gives up` };
}

function question(id: string, text: string, rationale = "it is the cheaper choice"): OpenQuestion {
  return {
    id,
    question: text,
    options: [option(`${id}-a`, "First"), option(`${id}-b`, "Second")],
    recommendation: `${id}-a`,
    rationale,
  };
}

const LIFTED_Q1: SpecArbitratedQuestion = {
  ...question("Q1", "Is pruning manual?", "Decided by the author on 2026-09-28, records keep it"),
  verdict: {
    kind: "lifted",
    chosen: "Q1-a",
    abandoned: ["Q1-b"],
    why: "Decided by the author on 2026-09-28, records keep it",
    at: "2026-09-28",
    by: { kind: "unattributed" },
  },
  history: [],
};

const DECIDED_Q2: SpecArbitratedQuestion = {
  ...question("Q2", "How many runs are kept?"),
  verdict: {
    kind: "decided",
    chosen: "Q2-b",
    abandoned: ["Q2-a"],
    why: "two weeks are asked for",
    advocate: "ten is enough",
    principles: ["S2"],
    reversibility: "cheap",
    by: { kind: "operator", name: OPERATOR },
    at: "2026-10-20T08:02:11Z",
    revised: [],
  },
  history: [],
};

const OPEN_Q3_Q4 = [question("Q3", "Where do pruned runs go?"), question("Q4", "Is prune logged?")];

// An open question decided by the operator for its recommendation: the
// approval lock admits an Approved artifact only once none is open.
function decidedFor(q: OpenQuestion): SpecArbitratedQuestion {
  return {
    ...q,
    verdict: {
      ...(DECIDED_Q2.verdict as Extract<SpecArbitratedQuestion["verdict"], { kind: "decided" }>),
      chosen: q.recommendation,
      abandoned: q.options.map((o) => o.id).filter((id) => id !== q.recommendation),
    },
    history: [],
  };
}

const DECIDED_Q3_Q4 = OPEN_Q3_Q4.map(decidedFor);

// A spec's arbitrated question as a plan's, its verdict naming the phase it bears on.
function onPhase(q: SpecArbitratedQuestion): PlanArbitratedQuestion {
  return {
    ...q,
    verdict: { ...q.verdict, phase: "phase-02" } as PlanArbitratedQuestion["verdict"],
    history: [],
  };
}

const SPEC_BASE: Omit<SpecDocument, "openQuestions" | "arbitratedQuestions"> = {
  kind: "spec",
  title: "Plan prune",
  ground: [{ path: "src/app/archive.ts", note: "where runs are archived" }],
  context: "A slug is held forever by its archived run.",
  problem: "The `-2` habit is the visible symptom.",
  productGoal: {
    statement: "Free a slug once its run is archived.",
    guidingRule: "A slug is held only by a live run.",
  },
  terminology: [],
  requirements: [
    {
      id: "R-prune",
      title: "Prune",
      pattern: "event",
      statement: "WHEN a run is archived THE system SHALL make it prunable.",
    },
  ],
  surface: [],
  nonGoals: [],
  acceptanceCriteria: [
    {
      id: "AC-1",
      name: "Prune frees the slug",
      given: "an archived run",
      when: "it is pruned",
      then: "its slug is free",
      refs: ["R-prune"],
    },
  ],
  planningNote: { settled: [], open: [], constraints: [] },
  docsPage: { kind: "none", why: "the CLI reference covers it" },
};

function planBase(): PlanDocument {
  const doc = readPlanDocumentFile("plan.json", {
    $schema: schemaUrl("plan-document", "0.20.0"),
    kind: "plan",
    sourceSpec: null,
    completesSpec: null,
    run: { shortName: "plan-prune-store", title: "Plan prune store", requiredCommands: [] },
    preamble: {
      summary: "Two phases: the store, then the command.",
      requiredCommandsNote: "No extra commands.",
      technicalArbitrations: [],
    },
    phases: ["phase-01", "phase-02"].map((id) => ({
      id,
      title: `Step ${id}`,
      model: "claude-sonnet-5",
      effort: "medium",
      planMarkdownAnchor: `#${id}-step`,
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: `feat: ${id}`, body: "Do the step." },
      objective: "Do the step.",
      detailedInstructions: [],
      boundaryContracts: null,
      testStrategy: "Unit.",
      implementationOrder: [],
      excludedScope: [],
      verification: "standard",
      expectedHandoff: "Nothing.",
    })),
  });
  if (Either.isLeft(doc)) throw new Error(doc.left.message);
  return doc.right;
}

let repoDir: string;
let configDir: string;
let originalCwd: string;

function git(args: readonly string[]): string {
  return execFileSync("git", args, { cwd: repoDir, stdio: "pipe" }).toString();
}

function writeRepoFile(rel: string, content: string): void {
  const abs = join(repoDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function commitAll(message = "seed"): void {
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message]);
}

function writeHeadlessSpec(doc: SpecDocument): void {
  writeRepoFile(SPEC, SPEC_FRONTMATTER + renderSpecBody(doc));
  writeRepoFile(SPEC_SIDECAR, json(withSchemaUrl("spec-document", doc)));
}

function writeHeadlessPlan(doc: PlanDocument): void {
  writeRepoFile(PLAN, PLAN_FRONTMATTER + renderPlanBody(doc));
  writeRepoFile(PLAN_SIDECAR, json(withSchemaUrl("plan-document", doc)));
}

async function approveByMachine(path: string): Promise<void> {
  const layer = Layer.mergeAll(
    makeRootedNodeFileSystemLayer(repoDir),
    NodeGitLayer,
    makeFakeTerminal(false).layer,
  );
  const result = await Effect.runPromise(
    Effect.either(
      transitionArtifactBy(path, "Approved", {
        repoRoot: repoDir,
        nowIso: "2026-10-21T09:28:11.427Z",
        commit: true,
        by: "machine:roadmap-loop",
      }).pipe(Effect.provide(layer)),
    ),
  );
  if (Either.isLeft(result)) throw new Error(result.left.message);
}

// `phax artifact status <path>` as printed, run from the repository; it always exits 0 here.
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
  configDir = mkdtempSync(join(tmpdir(), "phax-questions-config-"));
  writeFileSync(join(configDir, "gitconfig"), "[user]\n\tuseConfigOnly = true\n");
  vi.stubEnv("GIT_CONFIG_GLOBAL", join(configDir, "gitconfig"));
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  repoDir = mkdtempSync(join(tmpdir(), "phax-questions-"));
  git(["init", "-q", "-b", "main"]);
  disableGitAutoMaintenance(repoDir);
  git(["config", "--local", "user.name", OPERATOR]);
  git(["config", "--local", "user.email", "ada@example.test"]);
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.unstubAllEnvs();
  removeTempDir(repoDir);
  removeTempDir(configDir);
});

describe("phax artifact status — questions by state and arbiter", () => {
  it("a headless spec prints its open ids, then once they are decided and it is approved, its counts and the machine approver", async () => {
    writeHeadlessSpec({
      ...SPEC_BASE,
      openQuestions: OPEN_Q3_Q4,
      arbitratedQuestions: [LIFTED_Q1, DECIDED_Q2],
    });
    commitAll();

    const draft = await statusLines(SPEC);
    expect(lineOf(draft, "Authored")).toBe(
      `Authored:          headless — sidecar ${SPEC_SIDECAR} (in sync)`,
    );
    expect(lineOf(draft, "Questions")).toBe(
      "Questions:         4 — open 2 (Q3, Q4) · arbitrated 2 (1 lifted)",
    );
    expect(draft).toContain(`  decide with \`phax artifact decide ${SPEC}\``);
    expect(lineOf(draft, "Legal transitions")).toBe(
      "Legal transitions: Approved (once no question is open), Abandoned",
    );

    writeHeadlessSpec({
      ...SPEC_BASE,
      openQuestions: [],
      arbitratedQuestions: [LIFTED_Q1, DECIDED_Q2, ...DECIDED_Q3_Q4],
    });
    commitAll("decide Q3 Q4");
    await approveByMachine(SPEC);

    const lines = await statusLines(SPEC);
    expect(lineOf(lines, "Questions")).toBe(
      "Questions:         4 — open 0 · arbitrated 4 (1 lifted)",
    );
    expect(lineOf(lines, "Approved")).toMatch(/ by machine \(roadmap-loop\)$/);
    expect(lines.join("\n")).not.toContain("decide");
  });

  it("a headless plan in the same situation prints the same lines", async () => {
    const base = planBase();
    // The spec's questions, with each decided verdict naming the phase it bears on.
    const lifted: PlanArbitratedQuestion = {
      ...LIFTED_Q1,
      verdict: LIFTED_Q1.verdict as LiftedVerdict,
      history: [],
    };
    writeHeadlessPlan({
      ...base,
      preamble: {
        ...base.preamble,
        openQuestions: OPEN_Q3_Q4,
        arbitratedQuestions: [lifted, onPhase(DECIDED_Q2)],
      },
    });
    commitAll();

    const draft = await statusLines(PLAN);
    expect(lineOf(draft, "Authored")).toBe(
      `Authored:          headless — sidecar ${PLAN_SIDECAR} (in sync)`,
    );
    expect(lineOf(draft, "Questions")).toBe(
      "Questions:         4 — open 2 (Q3, Q4) · arbitrated 2 (1 lifted)",
    );
    expect(draft).toContain(`  decide with \`phax artifact decide ${PLAN}\``);
    expect(lineOf(draft, "Legal transitions")).toMatch(
      /^Legal transitions: Approved \(once no question is open\)/,
    );

    writeHeadlessPlan({
      ...base,
      preamble: {
        ...base.preamble,
        openQuestions: [],
        arbitratedQuestions: [lifted, ...[DECIDED_Q2, ...DECIDED_Q3_Q4].map(onPhase)],
      },
    });
    commitAll("decide Q3 Q4");
    await approveByMachine(PLAN);

    const lines = await statusLines(PLAN);
    expect(lineOf(lines, "Questions")).toBe(
      "Questions:         4 — open 0 · arbitrated 4 (1 lifted)",
    );
    expect(lineOf(lines, "Approved")).toMatch(/ by machine \(roadmap-loop\)$/);
  });

  it("names questions by their ids", async () => {
    writeHeadlessSpec({
      ...SPEC_BASE,
      openQuestions: [
        {
          id: "q-keep",
          question: "How many runs are kept?",
          options: [option("keep-10", "Ten"), option("keep-20", "Twenty")],
          recommendation: "keep-10",
          rationale: "ten covers a working week",
        },
      ],
      arbitratedQuestions: [
        {
          ...LIFTED_Q1,
          ...question("q-scope", "Is the cache shared?"),
          verdict: { ...LIFTED_Q1.verdict, chosen: "q-scope-a", abandoned: ["q-scope-b"] },
        },
      ],
    });
    commitAll();

    expect(lineOf(await statusLines(SPEC), "Questions")).toBe(
      "Questions:         2 — open 1 (q-keep) · arbitrated 1 (1 lifted)",
    );
  });
});

describe("phax artifact status — unmigrated sidecars", () => {
  it("a Draft spec stamped 0.17.0 names its shape and the migrate command, with its questions lifted by the marker", async () => {
    const older: SpecDocumentV0_17_0Value = {
      ...SPEC_BASE,
      openQuestions: [
        // Q1: marked in its question and its rationale.
        question(
          "Q1",
          "Is pruning manual? (Decided by the author on 2026-09-28; not reopened.)",
          "Decided by the author on 2026-09-28, records keep the trajectory",
        ),
        // Q2: unmarked.
        question("Q2", "How many runs are kept?"),
        // Q3: marked in its question only.
        question("Q3", "Where do pruned runs go? (Decided by the author on 2026-09-29.)"),
        // Q4: marked in its rationale only, chosen against the earlier recommendation.
        {
          ...question(
            "Q4",
            "Is prune logged?",
            "Decided by the author on 2026-09-30, against the previous recommendation (`Q4-a`)",
          ),
          recommendation: "Q4-b",
        },
      ],
    };
    writeRepoFile(SPEC, SPEC_FRONTMATTER + renderSpecBodyV0_17_0(older));
    writeRepoFile(SPEC_SIDECAR, json({ $schema: schemaUrl("spec-document", "0.17.0"), ...older }));
    commitAll();

    const lines = await statusLines(SPEC);
    expect(lineOf(lines, "Authored")).toBe(
      `Authored:          headless — sidecar ${SPEC_SIDECAR} (spec-document 0.17.0 — migrate with \`phax artifact migrate-documents\`)`,
    );
    expect(lineOf(lines, "Questions")).toBe(
      "Questions:         4 — open 2 (Q2, Q3) · arbitrated 2 (2 lifted)",
    );
  });

  it("a Draft plan stamped 0.20.0 prints no Questions line and names migrate-documents", async () => {
    const base = planBase();
    const { preamble, phases, ...rest } = base;
    const { openQuestions: _o, arbitratedQuestions: _a, ...olderPreamble } = preamble;
    const olderPhases = phases.map(({ assignmentReason: _r, ...phase }) => phase);
    writeRepoFile(PLAN, PLAN_FRONTMATTER + renderPlanBody(base));
    writeRepoFile(
      PLAN_SIDECAR,
      json({
        $schema: schemaUrl("plan-document", "0.20.0"),
        ...rest,
        preamble: olderPreamble,
        phases: olderPhases,
      }),
    );
    commitAll();

    const lines = await statusLines(PLAN);
    expect(lineOf(lines, "Authored")).toBe(
      `Authored:          headless — sidecar ${PLAN_SIDECAR} (plan-document 0.20.0 — migrate with \`phax artifact migrate-documents\`)`,
    );
    expect(lineOf(lines, "Questions")).toBeUndefined();
  });
});

describe("phax artifact status — hand-authored §9", () => {
  const HAND_SPEC = `${SPEC_FRONTMATTER}# Log rotation

## 1. Context

Every run writes one log.

## 9. Open questions

### Q3 — How many logs are kept?

- keep-10 — Ten — abandons: older logs
- keep-20 — Twenty — abandons: disk space

Recommendation: keep-10 — ten covers a working week.

## 9b. Arbitrated questions

### Q2 — Logs: kept per run, or rotated daily?

- per-run — kept per run — abandons: a bounded log directory
- daily — rotated daily — abandons: one log per run to attach to a report

Recommendation: per-run — keep logs per run.

Decision: per-run — by operator (Grace Hopper), 2026-10-20
Why: a report names its run. Advocate: a bounded directory. Principles: none. Reversibility: cheap. Revised: none.

## 12. Decision log

- 2026-10-20 Q2 decided per-run — operator (Grace Hopper)
`;

  it("a spec in the §9 format prints its counts", async () => {
    writeRepoFile(SPEC, HAND_SPEC);
    commitAll();

    const lines = await statusLines(SPEC);
    expect(lineOf(lines, "Authored")).toBe("Authored:          interactive (no sidecar)");
    expect(lineOf(lines, "Questions")).toBe(
      "Questions:         2 — open 1 (Q3) · arbitrated 1 (0 lifted)",
    );
  });

  it("a spec with bold question headings prints the departing line and exits 0", async () => {
    writeRepoFile(
      SPEC,
      `${SPEC_FRONTMATTER}# Log rotation

## 9. Open questions for implementation planning

**Q2 — Logs: kept per run, or rotated daily?**

- Kept per run — abandons: a bounded log directory
- Rotated daily — abandons: one log per run to attach to a report

Recommendation: keep logs per run.
`,
    );
    commitAll();

    expect(lineOf(await statusLines(SPEC), "Questions")).toBe(
      // Line 11 of the file: six frontmatter lines, the title, the heading, two blanks.
      "Questions:         does not parse — line 11 departs from the §9 format: **Q2 — Logs: kept per run, or rotated daily?**",
    );
  });

  it("a spec with neither question section prints no Questions line", async () => {
    writeRepoFile(SPEC, `${SPEC_FRONTMATTER}# Log rotation\n\n## 1. Context\n\nText.\n`);
    commitAll();

    expect(lineOf(await statusLines(SPEC), "Questions")).toBeUndefined();
  });
});
