import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transitionArtifactBy } from "../../src/app/artifactStatus.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import { serializeSidecar } from "../../src/domain/artifact/sidecar.js";
import { renderPlanBody } from "../../src/domain/authoring/renderPlan.js";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import {
  ArtifactOpenQuestionsError,
  ArtifactQuestionsUnparsedError,
} from "../../src/domain/errors.js";
import { makeFakeTerminal } from "../../src/infra/fakes/terminal.js";
import { makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import type { PlanDocument } from "../../src/schemas/planDocument.js";
import type { OpenQuestion, PlanArbitratedQuestion } from "../../src/schemas/questions.js";
import type { SpecDocument } from "../../src/schemas/specDocument.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Real-git acceptance for spec artifact-decide §8 'Approval waits for no open
// question' (§5.38, §5.39): approve refuses a spec or plan while a question is
// open, headless or hand-authored, and a hand-authored §9 that does not parse.
// Every spec, plan, question and operator is made up.

const NOW = "2026-10-16T09:28:11.427Z";
const OPERATOR = "Ada Lovelace";
const SPEC = "docs/specs/2610160900-log-rotation.md";
const PLAN = "docs/plans/2610161000-log-rotation-plan.md";

const SPEC_FRONTMATTER =
  "---\nstatus: Draft\ndate: 2026-10-16\naudience: maintainers\nscope: logs\n---\n";
const PLAN_FRONTMATTER = "---\nstatus: Draft\nsource-spec: null\n---\n";

let repoDir: string;
let configDir: string;

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

function specDocument(open: readonly OpenQuestion[]): SpecDocument {
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
        // oxlint-disable-next-line unicorn/no-thenable -- given/when/then data, never awaited
        then: "its log is kept",
        refs: ["R-keep"],
      },
    ],
    openQuestions: [...open],
    arbitratedQuestions: [],
    planningNote: { settled: [], open: [], constraints: [] },
    docsPage: { kind: "none", why: "the CLI reference covers it" },
  };
}

function planPhase(id: string): PlanDocument["phases"][number] {
  return {
    id,
    title: `Step ${id}`,
    model: "claude-sonnet-5-5",
    effort: "medium",
    planMarkdownAnchor: `#${id}-step`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [`src/${id}.ts`],
    optionalFilesToEdit: [],
    commit: { subject: `feat: ${id}`, body: "Do the step." },
    objective: "Do the step.",
    detailedInstructions: ["Do it."],
    boundaryContracts: null,
    testStrategy: "Unit.",
    implementationOrder: ["Do it."],
    excludedScope: [],
    verification: "The `standard` gate profile.",
    expectedHandoff: "Nothing.",
  };
}

function planDocument(
  open: readonly OpenQuestion[],
  decided: readonly PlanArbitratedQuestion[],
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

const Q1 = question("Q1");
const Q2 = question("Q2");

const DECIDED_Q1: PlanArbitratedQuestion = {
  ...Q1,
  verdict: {
    kind: "decided",
    chosen: "Q1-a",
    abandoned: ["Q1-b"],
    why: "the operator weighed it",
    advocate: "the other way keeps more options open",
    principles: ["P1"],
    reversibility: "cheap",
    by: { kind: "operator", name: OPERATOR },
    at: "2026-10-16T08:00:00Z",
    revised: [],
    phase: "phase-02",
  },
  history: [],
};

// A hand-authored spec in the §9 format: `open` is the open section's body.
function handSpec(open: string): string {
  return `${SPEC_FRONTMATTER}# Log rotation

## 1. Context

Every run writes one log.

## 9. Open questions

${open}
## 9b. Arbitrated questions

### Q1 — Logs: kept per run, or rotated daily?

- per-run — kept per run — abandons: a bounded log directory
- daily — rotated daily — abandons: one log per run to attach to a report

Recommendation: per-run — keep logs per run.

Decision: per-run — by operator (Grace Hopper), 2026-10-15
Why: a report names its run. Advocate: a bounded directory. Principles: none. Reversibility: cheap. Revised: none.

## 12. Decision log

- 2026-10-15 Q1 decided per-run — operator (Grace Hopper)
`;
}

const OPEN_Q2 = `### Q2 — How many logs are kept?

- keep-10 — Ten — abandons: older logs
- keep-20 — Twenty — abandons: disk space

Recommendation: keep-10 — ten covers a working week.

`;

function approve(path: string) {
  const layer = Layer.mergeAll(
    makeRootedNodeFileSystemLayer(repoDir),
    NodeGitLayer,
    makeFakeTerminal(true).layer,
  );
  return Effect.runPromise(
    Effect.either(
      transitionArtifactBy(path, "Approved", {
        repoRoot: repoDir,
        nowIso: NOW,
        commit: true,
        by: undefined,
      }).pipe(Effect.provide(layer)),
    ),
  );
}

// A refusal: exit 12, nothing written, HEAD unchanged; returns the error.
function expectRefused(result: Awaited<ReturnType<typeof approve>>, head: string): unknown {
  expect(Either.isLeft(result)).toBe(true);
  expect(headSha()).toBe(head);
  expect(porcelain()).toBe("");
  if (Either.isRight(result)) return undefined;
  expect(exitCodeForError(result.left)).toBe(12);
  return result.left;
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "phax-lock-config-"));
  writeFileSync(join(configDir, "gitconfig"), "[user]\n\tuseConfigOnly = true\n");
  vi.stubEnv("GIT_CONFIG_GLOBAL", join(configDir, "gitconfig"));
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  repoDir = mkdtempSync(join(tmpdir(), "phax-lock-"));
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

describe("Approval waits for no open question", { timeout: 30_000 }, () => {
  it("refuses a headless Draft spec with open questions, naming them and decide", async () => {
    const doc = specDocument([Q1, Q2]);
    writeRepoFile(SPEC, SPEC_FRONTMATTER + renderSpecBody(doc));
    writeRepoFile(
      SPEC.replace(/\.md$/, ".json"),
      serializeSidecar({ kind: "spec", document: doc }),
    );
    commitAll();

    const head = headSha();
    const error = expectRefused(await approve(SPEC), head);

    expect(error).toBeInstanceOf(ArtifactOpenQuestionsError);
    expect((error as ArtifactOpenQuestionsError).message).toBe(
      `Approval refused: ${SPEC} has open questions — Q1, Q2. Answer them with \`phax artifact decide ${SPEC}\`.`,
    );
    expect(readRepoFile(SPEC)).toContain("status: Draft");
  });

  it("approves a hand-authored spec whose open section is empty, every question arbitrated", async () => {
    writeRepoFile(SPEC, handSpec("None.\n\n"));
    commitAll();

    const result = await approve(SPEC);

    expect(Either.isRight(result)).toBe(true);
    expect(readRepoFile(SPEC)).toContain("status: Approved");
    expect(porcelain()).toBe("");
  });

  it("approves a hand-authored spec with no question section, with no question check", async () => {
    writeRepoFile(SPEC, `${SPEC_FRONTMATTER}# Log rotation\n\n## 1. Context\n\nText.\n`);
    commitAll();

    const result = await approve(SPEC);

    expect(Either.isRight(result)).toBe(true);
    expect(readRepoFile(SPEC)).toContain("status: Approved");
  });

  it("refuses a hand-authored spec with an open question, naming it and decide", async () => {
    writeRepoFile(SPEC, handSpec(OPEN_Q2));
    commitAll();

    const head = headSha();
    const error = expectRefused(await approve(SPEC), head);

    expect(error).toBeInstanceOf(ArtifactOpenQuestionsError);
    expect((error as ArtifactOpenQuestionsError).open).toEqual(["Q2"]);
    expect((error as ArtifactOpenQuestionsError).message).toContain(
      `\`phax artifact decide ${SPEC}\``,
    );
  });

  it("refuses a hand-authored §9 that does not parse, naming its first departing line", async () => {
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

    const head = headSha();
    const error = expectRefused(await approve(SPEC), head);

    expect(error).toBeInstanceOf(ArtifactQuestionsUnparsedError);
    // Line 11 of the file: six frontmatter lines, the title, the heading, two blanks.
    expect((error as ArtifactQuestionsUnparsedError).message).toBe(
      `Approval refused: ${SPEC} has a question section that does not follow the §9 format, at line 11: **Q2 — Logs: kept per run, or rotated daily?**`,
    );
  });

  it("refuses a headless plan with open Q2, naming Q2 alone", async () => {
    const doc = planDocument([Q2], [DECIDED_Q1]);
    writeRepoFile(PLAN, PLAN_FRONTMATTER + renderPlanBody(doc));
    writeRepoFile(
      PLAN.replace(/\.md$/, ".json"),
      serializeSidecar({ kind: "plan", document: doc }),
    );
    commitAll();

    const head = headSha();
    const error = expectRefused(await approve(PLAN), head);

    expect(error).toBeInstanceOf(ArtifactOpenQuestionsError);
    expect((error as ArtifactOpenQuestionsError).message).toBe(
      `Approval refused: ${PLAN} has open questions — Q2. Answer them with \`phax artifact decide ${PLAN}\`.`,
    );
  });
});
