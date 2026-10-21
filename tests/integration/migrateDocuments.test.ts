import { execFileSync } from "node:child_process";
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
import { artifactFingerprint } from "../../src/app/approvalRecordStore.js";
import { transitionArtifactBy } from "../../src/app/artifactStatus.js";
import { migrateDocuments } from "../../src/app/migrateDocuments.js";
import { readCacheEntry } from "../../src/app/planCacheStore.js";
import { plansStalenessReport } from "../../src/app/planStaleness.js";
import { runArtifactMigrateDocuments, runArtifactStatus } from "../../src/cli/commands/artifact.js";
import { exitCodeForAuthoringError, exitCodeForError } from "../../src/cli/commands/runLayers.js";
import { approvalRecordPathFor } from "../../src/domain/artifact/approvalRecordFile.js";
import { renderDocumentMigrationReport } from "../../src/domain/artifact/render.js";
import type { ArtifactKind } from "../../src/domain/artifact/status.js";
import { renderPlanBody } from "../../src/domain/authoring/renderPlan.js";
import { renderPlanBodyV0_25_0 } from "../../src/domain/authoring/renderPlanV0_25_0.js";
import { renderSpecBodyV0_17_0 } from "../../src/domain/authoring/renderSpecV0_17_0.js";
import {
  ArtifactCommitFailedError,
  ArtifactDirtyWriteSetError,
  DocumentMigrationRefusedError,
  DocumentMigrationRequiredError,
} from "../../src/domain/errors.js";
import { planCacheKey } from "../../src/domain/planCache/key.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeTerminal } from "../../src/infra/fakes/terminal.js";
import { makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import {
  type PlanDocumentV0_25_0Value,
  type SpecDocumentV0_17_0Value,
  currentSchemaUrl,
  readPlanDocumentFile,
} from "../../src/schemas/persisted.js";
import { projectExtractedPlan } from "../../src/schemas/planDocument.js";
import type { OpenQuestion } from "../../src/schemas/questions.js";
import { CURRENT_STAMPS } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Real-git acceptance for spec artifact-decide §8 'Plan documents in flight
// are lifted and restamped, older ones still refused', 'Spec documents in
// flight are lifted by the rationale marker', 'Migration refuses rather than
// overwrite a hand edit', 'Migration names the approvals and plans it
// unsettles' and the migrate-documents half of 'Commit failure leaves the
// files' (§5.29, §5.31, §5.32, §5.49–§5.54). Every spec, plan, question,
// operator and grant is made up; older sidecars are built in the frozen
// shapes with their literal stamps, and their bodies with the frozen rendering.

const OPERATOR = "Ada Lovelace";
const NOW = "2026-10-21T09:28:11.427Z";
const MODEL = "claude-sonnet-5";
const EFFORT = "medium";

const LOG_ROTATION = "docs/specs/2609281200-log-rotation.md";
const PLAN_PRUNE = "docs/specs/2609251400-plan-prune.md";
const CACHE_KEYS = "docs/specs/2609271000-cache-keys.md";
const PLAN = "docs/plans/2609261000-plan-prune-store-plan.md";
const COMMIT_SUBJECT = "chore(artifacts): migrate documents to their current shapes";

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

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
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

function sidecarOf(path: string): string {
  return `${path.slice(0, -".md".length)}.json`;
}

function recordOf(kind: ArtifactKind, path: string): string {
  const record = approvalRecordPathFor(kind, path);
  if (record === null) throw new Error(`no record path for ${path}`);
  return record;
}

// ── Fixtures ──────────────────────────────────────────────────────────────

function question(id: string, rationale = "it is the cheaper choice", text?: string): OpenQuestion {
  return {
    id,
    question: text ?? `What about ${id}?`,
    options: [
      { id: `${id}-a`, label: "First", abandons: "the second" },
      { id: `${id}-b`, label: "Second", abandons: "the first" },
    ],
    recommendation: `${id}-a`,
    rationale,
  };
}

function marked(id: string, date: string): OpenQuestion {
  return question(id, `Decided by the author on ${date}, the author chose it`);
}

// The four marker cases of §9 Q12.
const MARKER_CASES: readonly OpenQuestion[] = [
  // Q1: marked in its question and its rationale.
  question(
    "Q1",
    "Decided by the author on 2026-09-28, records keep the trajectory",
    "Is rotation manual? (Decided by the author on 2026-09-28; not reopened.)",
  ),
  // Q2: unmarked.
  question("Q2"),
  // Q3: marked in its question only.
  question("Q3", "it is the cheaper choice", "Where do rotated logs go? (Decided by the author.)"),
  // Q4: marked in its rationale only, chosen against an earlier recommendation.
  {
    ...question(
      "Q4",
      "Decided by the author on 2026-09-30, against the previous recommendation (`Q4-a`)",
    ),
    recommendation: "Q4-b",
  },
];

function olderSpec(
  title: string,
  openQuestions: readonly OpenQuestion[],
): SpecDocumentV0_17_0Value {
  return {
    kind: "spec",
    title,
    ground: [{ path: "src/app/archive.ts", note: "where runs are archived" }],
    context: `${title} matters.`,
    problem: "The `-2` habit is the visible symptom.",
    productGoal: { statement: "Keep it bounded.", guidingRule: "Kept only while useful." },
    terminology: [],
    requirements: [
      {
        id: "R-main",
        title: "Main",
        pattern: "event",
        statement: "WHEN a run ends THE system SHALL tidy up.",
      },
    ],
    surface: [],
    nonGoals: [],
    acceptanceCriteria: [
      {
        id: "AC-1",
        name: "It tidies up",
        given: "a finished run",
        when: "it is tidied",
        // oxlint-disable-next-line unicorn/no-thenable -- given/when/then data, never awaited
        then: "nothing is left behind",
        refs: ["R-main"],
      },
    ],
    openQuestions: [...openQuestions],
    planningNote: { settled: [], open: [], constraints: [] },
    docsPage: { kind: "none", why: "the CLI reference covers it" },
  };
}

function specFrontmatter(status: string, approved = ""): string {
  return `---\nstatus: ${status}\ndate: 2026-09-25\naudience: maintainers\nscope: tidying\n${approved}---\n`;
}

// A headless spec stamped 0.17.0, its body the frozen rendering.
function writeOlderSpec(path: string, doc: SpecDocumentV0_17_0Value, frontmatter: string): string {
  const md = frontmatter + renderSpecBodyV0_17_0(doc);
  writeRepoFile(path, md);
  writeRepoFile(sidecarOf(path), json({ $schema: schemaUrl("spec-document", "0.17.0"), ...doc }));
  return md;
}

function olderPlan(sourceSpec: string | null) {
  return {
    kind: "plan",
    sourceSpec,
    completesSpec: sourceSpec === null ? null : true,
    run: { shortName: "plan-prune-store", title: "Plan prune store", requiredCommands: [] },
    preamble: {
      summary: "Two phases: the store, then the command.",
      requiredCommandsNote: "No extra commands.",
      technicalArbitrations: [],
    },
    phases: ["phase-01", "phase-02"].map((id) => ({
      id,
      title: `Step ${id}`,
      model: id === "phase-01" ? "claude-opus-5-5" : "claude-sonnet-5",
      effort: id === "phase-01" ? "high" : "medium",
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
  };
}

function planFrontmatter(status: string, sourceSpec: string | null, approved = ""): string {
  const lineage =
    sourceSpec === null
      ? "source-spec: null\n"
      : `source-spec: ${sourceSpec}\ncompletes-spec: true\n`;
  return `---\nstatus: ${status}\n${lineage}${approved}---\n`;
}

// A headless plan stamped 0.20.0, its body the plan renderer's.
function writeOlderPlan(sourceSpec: string | null, frontmatter: string): string {
  const sidecar = { $schema: schemaUrl("plan-document", "0.20.0"), ...olderPlan(sourceSpec) };
  const lifted = readPlanDocumentFile(sidecarOf(PLAN), sidecar);
  if (Either.isLeft(lifted)) throw new Error(lifted.left.message);
  const md = frontmatter + renderPlanBody(lifted.right);
  writeRepoFile(PLAN, md);
  writeRepoFile(sidecarOf(PLAN), json(sidecar));
  return md;
}

const PHASE_REASON = "Designs the prune store, which no code in the repository shows yet.";

// The 0.25.0 shape: questions in the preamble, a `modelReason` on each phase.
function plan0_25_0(): PlanDocumentV0_25_0Value {
  const { preamble, phases, ...rest } = olderPlan(null);
  return {
    ...rest,
    kind: "plan",
    sourceSpec: null,
    completesSpec: null,
    preamble: { ...preamble, openQuestions: [], arbitratedQuestions: [] },
    phases: phases.map(({ model, effort, ...phase }, i) => ({
      ...phase,
      modelReason: i === 1 ? PHASE_REASON : null,
      model,
      effort: effort as "high" | "medium",
    })) as unknown as PlanDocumentV0_25_0Value["phases"],
  };
}

// A headless plan stamped 0.25.0, its body the frozen 0.25.0 rendering.
function writeV0_25_0Plan(frontmatter: string): string {
  const doc = plan0_25_0();
  const md = frontmatter + renderPlanBodyV0_25_0(doc);
  writeRepoFile(PLAN, md);
  writeRepoFile(sidecarOf(PLAN), json({ $schema: schemaUrl("plan-document", "0.25.0"), ...doc }));
  return md;
}

function approvedStamp(): string {
  return `approved:\n  date: 2026-09-25\n  baseline: "${headSha().slice(0, 7)}"\n`;
}

// A 0.19.0 spec approval record, written before phax named the approver.
function writeOlderSpecRecord(path: string, md: string): void {
  writeRepoFile(
    recordOf("spec", path),
    json({
      $schema: schemaUrl("spec-approval-record", "0.19.0"),
      artifact: path,
      specFingerprint: artifactFingerprint(md),
      approvedAt: "2026-09-25T09:28:11.427Z",
      baseline: headSha(),
    }),
  );
}

function writeOlderPlanRecord(md: string, spec: { path: string; md: string }): void {
  writeRepoFile(
    recordOf("plan", PLAN),
    json({
      $schema: schemaUrl("plan-approval-record", "0.19.0"),
      artifact: PLAN,
      planFingerprint: artifactFingerprint(md),
      approvedAt: "2026-09-26T10:00:00.000Z",
      baseline: headSha(),
      sourceSpec: { path: spec.path, fingerprint: artifactFingerprint(spec.md) },
    }),
  );
}

// ── Running ───────────────────────────────────────────────────────────────

function layer() {
  return Layer.mergeAll(
    makeRootedNodeFileSystemLayer(repoDir),
    NodeGitLayer,
    makeFakeTerminal(false).layer,
  );
}

function migrate() {
  return Effect.runPromise(
    Effect.either(
      migrateDocuments({
        repoRoot: repoDir,
        stateRoot,
        extractPlanModel: MODEL,
        extractPlanEffort: EFFORT,
        nowIso: NOW,
      }).pipe(Effect.provide(layer())),
    ),
  );
}

async function migrated() {
  const result = await migrate();
  if (Either.isLeft(result)) throw new Error(`migration failed: ${result.left.message}`);
  return result.right;
}

function approve(path: string) {
  return Effect.runPromise(
    Effect.either(
      transitionArtifactBy(path, "Approved", {
        repoRoot: repoDir,
        nowIso: NOW,
        commit: true,
        by: "machine:roadmap-loop",
      }).pipe(Effect.provide(layer())),
    ),
  );
}

// `phax artifact status <path>` as printed, run from the repository.
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
  configDir = mkdtempSync(join(tmpdir(), "phax-migrate-documents-config-"));
  stateRoot = join(configDir, "state");
  writeFileSync(join(configDir, "gitconfig"), "[user]\n\tuseConfigOnly = true\n");
  vi.stubEnv("GIT_CONFIG_GLOBAL", join(configDir, "gitconfig"));
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-migrate-documents-")));
  git(["init", "-q", "-b", "main"]);
  disableGitAutoMaintenance(repoDir);
  git(["config", "--local", "user.name", OPERATOR]);
  git(["config", "--local", "user.email", "ada@example.test"]);
  writeRepoFile("README.md", "fixture\n");
  commitAll("init");
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.unstubAllEnvs();
  removeTempDir(repoDir);
  removeTempDir(configDir);
});

describe("migrate-documents — plan documents in flight", { timeout: 30_000 }, () => {
  it("restamps a Draft 0.20.0 plan with empty questions, its body and lineage byte-identical, its cache re-seeded", async () => {
    const md = writeOlderPlan(null, planFrontmatter("Draft", null));
    commitAll();

    const before = await statusLines(PLAN);
    expect(lineOf(before, "Authored")).toContain(
      "plan-document 0.20.0 — migrate with `phax artifact migrate-documents`",
    );
    expect(lineOf(before, "Questions")).toBeUndefined();

    const result = await migrated();

    const sidecar = JSON.parse(readRepoFile(sidecarOf(PLAN))) as {
      $schema: string;
      sourceSpec: unknown;
      completesSpec: unknown;
      preamble: Record<string, unknown>;
      phases: Array<Record<string, unknown>>;
    };
    expect(sidecar.$schema).toBe(currentSchemaUrl("plan-document"));
    expect(sidecar.phases.map((phase) => phase["assignmentReason"])).toEqual([null, null]);
    expect(sidecar.phases.map((phase) => "modelReason" in phase)).toEqual([false, false]);
    expect(Object.keys(sidecar.phases[0] ?? {}).slice(-3)).toEqual([
      "assignmentReason",
      "model",
      "effort",
    ]);
    expect(sidecar.preamble["openQuestions"]).toEqual([]);
    expect(sidecar.preamble["arbitratedQuestions"]).toEqual([]);
    expect([sidecar.sourceSpec, sidecar.completesSpec]).toEqual([null, null]);
    expect(readRepoFile(PLAN)).toBe(md);
    expect(headFiles()).toEqual([sidecarOf(PLAN)]);
    expect(git(["log", "-1", "--format=%s"]).trim()).toBe(COMMIT_SUBJECT);
    expect(porcelain()).toBe("");

    // The re-seeded cache holds the plan's projection: a run finds it without extraction.
    const lifted = readPlanDocumentFile(sidecarOf(PLAN), sidecar);
    if (Either.isLeft(lifted)) throw new Error(lifted.left.message);
    const cached = await Effect.runPromise(
      readCacheEntry(stateRoot, planCacheKey(md, MODEL, EFFORT)).pipe(
        Effect.provide(makeRootedNodeFileSystemLayer(repoDir)),
      ),
    );
    expect(Option.getOrNull(cached)).toEqual(projectExtractedPlan({ version: 1, ...lifted.right }));
    expect(Option.getOrNull(cached)?.phases.map((phase) => [phase.model, phase.effort])).toEqual([
      ["claude-opus-5-5", "high"],
      ["claude-sonnet-5", "medium"],
    ]);

    expect(renderDocumentMigrationReport(result)).toContain(
      `plan-document 0.20.0 → ${CURRENT_STAMPS["plan-document"]}`,
    );
    expect(lineOf(await statusLines(PLAN), "Authored")).toBe(
      `Authored:          headless — sidecar ${sidecarOf(PLAN)} (in sync)`,
    );
  });

  it("lifts a 0.25.0 plan with its reasons, re-rendering its Model reason lines as Assignment reason", async () => {
    const md = writeV0_25_0Plan(planFrontmatter("Draft", null));
    commitAll();
    expect(md).toContain(`\n**Model reason:** ${PHASE_REASON}\n`);

    const before = await statusLines(PLAN);
    expect(lineOf(before, "Authored")).toContain(
      "plan-document 0.25.0 — migrate with `phax artifact migrate-documents`",
    );

    const result = await migrated();

    const sidecar = JSON.parse(readRepoFile(sidecarOf(PLAN))) as {
      $schema: string;
      phases: Array<Record<string, unknown>>;
    };
    expect(sidecar.$schema).toBe(currentSchemaUrl("plan-document"));
    expect(sidecar.phases.map((phase) => phase["assignmentReason"])).toEqual([null, PHASE_REASON]);
    expect(sidecar.phases.map((phase) => "modelReason" in phase)).toEqual([false, false]);
    expect(Object.keys(sidecar.phases[1] ?? {}).slice(-3)).toEqual([
      "assignmentReason",
      "model",
      "effort",
    ]);

    const after = readRepoFile(PLAN);
    expect(after).toContain(`\n**Assignment reason:** ${PHASE_REASON}\n`);
    expect(after).not.toContain("Model reason");
    expect(after).toBe(md.replace("**Model reason:**", "**Assignment reason:**"));
    expect(headFiles()).toEqual([PLAN, sidecarOf(PLAN)].toSorted());
    expect(git(["log", "-1", "--format=%s"]).trim()).toBe(COMMIT_SUBJECT);
    expect(porcelain()).toBe("");
    expect(renderDocumentMigrationReport(result)).toContain(
      `plan-document 0.25.0 → ${CURRENT_STAMPS["plan-document"]}`,
    );
    expect(lineOf(await statusLines(PLAN), "Authored")).toBe(
      `Authored:          headless — sidecar ${sidecarOf(PLAN)} (in sync)`,
    );
  });

  // interactive-phases "One lift gives every phase its mode"; oracle-phases
  // "Lifted sidecars get oracle null".
  it.each([
    ["0.20.0", (fm: string) => writeOlderPlan(null, fm)],
    ["0.25.0", (fm: string) => writeV0_25_0Plan(fm)],
  ] as const)(
    "lifts a %s plan with mode headless and oracle null on every phase, adding no line to plan.md",
    async (_release, write) => {
      const md = write(planFrontmatter("Draft", null));
      commitAll();

      await migrated();

      const sidecar = JSON.parse(readRepoFile(sidecarOf(PLAN))) as {
        $schema: string;
        phases: Array<Record<string, unknown>>;
      };
      expect(sidecar.$schema).toMatch(
        /^https:\/\/docs\.phax\.run\/schemas\/plan-document\/\d+\.\d+\.\d+\.json$/,
      );
      expect(sidecar.$schema).toBe(currentSchemaUrl("plan-document"));
      expect(sidecar.phases.map((phase) => [phase["mode"], phase["oracle"]])).toEqual([
        ["headless", null],
        ["headless", null],
      ]);
      for (const phase of sidecar.phases) {
        const keys = Object.keys(phase);
        const at = keys.indexOf("optionalFilesToEdit");
        expect(keys.slice(at, at + 3)).toEqual(["optionalFilesToEdit", "mode", "oracle"]);
      }
      const after = readRepoFile(PLAN);
      expect(after).not.toMatch(/\*\*Mode:\*\*|\*\*Oracle (phase|files):\*\*/);
      expect(after).toBe(md.replace("**Model reason:**", "**Assignment reason:**"));
    },
  );

  it("refuses a 0.25.0 plan whose body was edited by hand, writing nothing", async () => {
    writeV0_25_0Plan(planFrontmatter("Draft", null));
    writeRepoFile(PLAN, readRepoFile(PLAN).replace("Do the step.", "Do the step, by hand."));
    commitAll();
    const before = headSha();

    const result = await migrate();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(DocumentMigrationRefusedError);
      expect(result.left.message).toContain(
        `${PLAN} is not its sidecar's plan-document 0.25.0 rendering — a hand edit would be overwritten`,
      );
    }
    expect(headSha()).toBe(before);
    expect(JSON.parse(readRepoFile(sidecarOf(PLAN))).$schema).toBe(
      schemaUrl("plan-document", "0.25.0"),
    );
  });

  it("refuses a 0.19.0 plan beside a spec as invalid, naming completesSpec, writing nothing", async () => {
    writeOlderSpec(PLAN_PRUNE, olderSpec("Plan prune", []), specFrontmatter("Draft"));
    const { completesSpec: _unrecorded, ...older } = olderPlan(PLAN_PRUNE);
    writeRepoFile(PLAN, `${planFrontmatter("Draft", PLAN_PRUNE)}# Plan prune store\n`);
    writeRepoFile(
      sidecarOf(PLAN),
      json({ $schema: schemaUrl("plan-document", "0.19.0"), ...older }),
    );
    commitAll();
    const head = headSha();

    // Status reads it as today: an invalid sidecar naming the missing completesSpec.
    expect(lineOf(await statusLines(PLAN), "Authored")).toMatch(
      /\(invalid sidecar — .*completesSpec/,
    );

    const result = await migrate();
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(DocumentMigrationRefusedError);
      expect(exitCodeForAuthoringError(result.left)).toBe(12);
      expect(result.left.message).toMatch(
        new RegExp(`^migrate refused: ${PLAN} has an invalid sidecar \\(.*completesSpec`),
      );
      expect(result.left.message).not.toContain(PLAN_PRUNE);
    }
    expect(headSha()).toBe(head);
    expect(porcelain()).toBe("");
  });
});

describe("migrate-documents — spec documents in flight", { timeout: 30_000 }, () => {
  it("lifts a Draft 0.17.0 spec by the rationale marker; approve waits for it", async () => {
    const doc = olderSpec("Log rotation", MARKER_CASES);
    writeOlderSpec(LOG_ROTATION, doc, specFrontmatter("Draft"));
    commitAll();

    const before = await statusLines(LOG_ROTATION);
    expect(lineOf(before, "Authored")).toBe(
      `Authored:          headless — sidecar ${sidecarOf(LOG_ROTATION)} (spec-document 0.17.0 — migrate with \`phax artifact migrate-documents\`)`,
    );

    const head = headSha();
    const refused = await approve(LOG_ROTATION);
    expect(Either.isLeft(refused)).toBe(true);
    if (Either.isLeft(refused)) {
      expect(refused.left).toBeInstanceOf(DocumentMigrationRequiredError);
      expect(exitCodeForError(refused.left)).toBe(12);
      expect(refused.left.message).toBe(
        `Approval refused: ${sidecarOf(LOG_ROTATION)} is stamped spec-document 0.17.0 — run \`phax artifact migrate-documents\` first`,
      );
    }
    expect(headSha()).toBe(head);
    expect(porcelain()).toBe("");

    await migrated();
    expect(headFiles()).toEqual([LOG_ROTATION, sidecarOf(LOG_ROTATION)].toSorted());
    expect(readRepoFile(LOG_ROTATION).startsWith(specFrontmatter("Draft"))).toBe(true);

    const sidecar = JSON.parse(readRepoFile(sidecarOf(LOG_ROTATION))) as {
      openQuestions: { id: string }[];
      arbitratedQuestions: { id: string; verdict: Record<string, unknown> }[];
    };
    expect(sidecar.openQuestions.map((q) => q.id)).toEqual(["Q2", "Q3"]);
    expect(sidecar.arbitratedQuestions.map((q) => q.id)).toEqual(["Q1", "Q4"]);
    for (const q of sidecar.arbitratedQuestions) {
      expect(Object.keys(q.verdict).toSorted()).toEqual(
        ["abandoned", "at", "by", "chosen", "kind", "why"].toSorted(),
      );
      expect(q.verdict["by"]).toEqual({ kind: "unattributed" });
    }
    expect(sidecar.arbitratedQuestions[1]?.verdict).toMatchObject({
      chosen: "Q4-b",
      abandoned: ["Q4-a"],
      at: "2026-09-30",
    });

    const after = await statusLines(LOG_ROTATION);
    expect(lineOf(after, "Authored")).toBe(
      `Authored:          headless — sidecar ${sidecarOf(LOG_ROTATION)} (in sync)`,
    );
    expect(lineOf(after, "Questions")).toBe(
      "Questions:         4 — open 2 (Q2, Q3) · arbitrated 2 (2 lifted)",
    );
    const body = readRepoFile(LOG_ROTATION);
    expect(body).toContain("Decision: Q1-a — lifted, unattributed, 2026-09-28");
    expect(body).toContain("Decision: Q4-b — lifted, unattributed, 2026-09-30");
  });
});

describe("migrate-documents — never overwrites a hand edit", { timeout: 30_000 }, () => {
  it("refuses a hand-edited body, then uncommitted changes, then migrates, then has nothing to migrate", async () => {
    const editedDoc = olderSpec("Log rotation", [question("Q2")]);
    const editedMd = writeOlderSpec(LOG_ROTATION, editedDoc, specFrontmatter("Draft"));
    writeOlderSpec(CACHE_KEYS, olderSpec("Cache keys", [question("Q3")]), specFrontmatter("Draft"));
    const handEdit = editedMd.replace("Log rotation matters.", "Log rotation matters a lot.");
    writeRepoFile(LOG_ROTATION, handEdit);
    commitAll();
    const head = headSha();
    const sidecarBefore = readRepoFile(sidecarOf(CACHE_KEYS));

    // 1. The hand-edited spec is named with both remedies; nothing moves.
    const first = await migrate();
    expect(Either.isLeft(first)).toBe(true);
    if (Either.isLeft(first)) {
      expect(first.left).toBeInstanceOf(DocumentMigrationRefusedError);
      expect(exitCodeForAuthoringError(first.left)).toBe(12);
      expect(first.left.message.split("\n")).toEqual([
        `migrate refused: ${LOG_ROTATION} is not its sidecar's spec-document 0.17.0 rendering — a hand edit would be overwritten`,
        "  Re-author it headless (remove the artifact and its sidecar, then run " +
          "`phax artifact new spec log-rotation --headless --brief <file|->`), " +
          `or delete ${sidecarOf(LOG_ROTATION)} to demote the artifact to hand-authored. Then rerun.`,
      ]);
    }
    expect(headSha()).toBe(head);
    expect(readRepoFile(LOG_ROTATION)).toBe(handEdit);
    expect(readRepoFile(sidecarOf(CACHE_KEYS))).toBe(sidecarBefore);

    // 2. The edit moves out (committed), but the in-sync spec's sidecar is dirty.
    writeRepoFile(LOG_ROTATION, editedMd);
    commitAll("move the edit elsewhere");
    const reformatted = `${JSON.stringify(JSON.parse(sidecarBefore))}\n`;
    writeRepoFile(sidecarOf(CACHE_KEYS), reformatted);
    const head2 = headSha();
    const second = await migrate();
    expect(Either.isLeft(second)).toBe(true);
    if (Either.isLeft(second)) {
      expect(second.left).toBeInstanceOf(ArtifactDirtyWriteSetError);
      expect(exitCodeForAuthoringError(second.left)).toBe(12);
      expect(second.left.message).toContain(sidecarOf(CACHE_KEYS));
    }
    expect(headSha()).toBe(head2);
    expect(readRepoFile(LOG_ROTATION)).toBe(editedMd);
    expect(readRepoFile(sidecarOf(CACHE_KEYS))).toBe(reformatted);

    // 3. The change is discarded: both specs migrate in one commit.
    git(["checkout", "--", sidecarOf(CACHE_KEYS)]);
    await migrated();
    expect(headFiles()).toEqual(
      [LOG_ROTATION, sidecarOf(LOG_ROTATION), CACHE_KEYS, sidecarOf(CACHE_KEYS)].toSorted(),
    );
    expect(git(["rev-list", "--count", `${head2}..HEAD`]).trim()).toBe("1");
    expect(porcelain()).toBe("");

    // 4. Nothing left: exit 0, no commit.
    const head4 = headSha();
    const fourth = await migrated();
    expect(fourth).toEqual({ kind: "nothing-to-migrate" });
    expect(renderDocumentMigrationReport(fourth)).toEqual([
      "nothing to migrate: every live spec and plan sidecar is at its current shape",
    ]);
    expect(headSha()).toBe(head4);
  });
});

describe("migrate-documents — names what it unsettles", { timeout: 30_000 }, () => {
  it("names Approved specs left edited since approval, their open questions, and the plan left stale", async () => {
    // Plan prune: Approved, every question marked, so none stays open.
    const pruneDoc = olderSpec("Plan prune", [
      marked("Q1", "2026-09-24"),
      marked("Q2", "2026-09-24"),
    ]);
    const pruneMd = writeOlderSpec(
      PLAN_PRUNE,
      pruneDoc,
      specFrontmatter("Approved", approvedStamp()),
    );
    // Cache keys: Approved, with an unmarked Q3.
    const cacheDoc = olderSpec("Cache keys", [marked("Q1", "2026-09-26"), question("Q3")]);
    const cacheMd = writeOlderSpec(
      CACHE_KEYS,
      cacheDoc,
      specFrontmatter("Approved", approvedStamp()),
    );
    // The plan bound to plan-prune: Approved, recording the spec's fingerprint.
    const planMd = writeOlderPlan(
      PLAN_PRUNE,
      planFrontmatter("Approved", PLAN_PRUNE, approvedStamp()),
    );
    writeOlderSpecRecord(PLAN_PRUNE, pruneMd);
    writeOlderSpecRecord(CACHE_KEYS, cacheMd);
    writeOlderPlanRecord(planMd, { path: PLAN_PRUNE, md: pruneMd });
    commitAll("approve before migration");
    const records = [
      recordOf("spec", PLAN_PRUNE),
      recordOf("spec", CACHE_KEYS),
      recordOf("plan", PLAN),
    ];
    const recordsBefore = records.map(readRepoFile);
    const planSidecarBefore = JSON.parse(readRepoFile(sidecarOf(PLAN))) as Record<string, unknown>;

    const result = await migrated();
    const lines = renderDocumentMigrationReport(result);
    const report = lines.join("\n");

    expect(report).toContain(
      `    now edited since approval — re-approve with \`phax artifact approve ${PLAN_PRUNE}\``,
    );
    expect(report).toContain(
      "    now edited since approval, with open questions Q3 — reopen it and decide Q3 before re-approving",
    );
    expect(report).toMatch(/plan-document 0\.20\.0 → .*\n {2}\S+ +Approved {2}body unchanged/);
    expect(lines.slice(-3)).toEqual([
      "stale (spec-changed)",
      `  ${PLAN}  its spec ${PLAN_PRUNE} was re-rendered`,
      expect.stringMatching(new RegExp(`^committed [0-9a-f]{7} ${escape(COMMIT_SUBJECT)}$`)),
    ]);
    // Only the spec left with an open question is told to decide.
    expect(lines.filter((l) => l.includes("decide"))).toHaveLength(1);

    // Exactly the two specs, their sidecars and the plan's sidecar.
    expect(headFiles()).toEqual(
      [
        PLAN_PRUNE,
        sidecarOf(PLAN_PRUNE),
        CACHE_KEYS,
        sidecarOf(CACHE_KEYS),
        sidecarOf(PLAN),
      ].toSorted(),
    );
    expect(readRepoFile(PLAN)).toBe(planMd);
    const planSidecar = JSON.parse(readRepoFile(sidecarOf(PLAN))) as Record<string, unknown>;
    expect([planSidecar["sourceSpec"], planSidecar["completesSpec"]]).toEqual([
      planSidecarBefore["sourceSpec"],
      planSidecarBefore["completesSpec"],
    ]);
    expect(records.map(readRepoFile)).toEqual(recordsBefore);

    // `phax plans status` reads the plan stale, with spec-changed evidence.
    const { layer: backendLayer } = makeFakeBackend();
    const staleness = await Effect.runPromise(
      plansStalenessReport({
        repoRoot: repoDir,
        stateRoot,
        model: MODEL,
        effort: EFFORT,
        nowIso: NOW,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(makeRootedNodeFileSystemLayer(repoDir), NodeGitLayer, backendLayer),
        ),
      ),
    );
    expect(staleness.report).toEqual([
      {
        path: PLAN,
        result: { kind: "stale", evidence: [{ reason: "spec-changed", specPath: PLAN_PRUNE }] },
      },
    ]);

    const status = await statusLines(PLAN_PRUNE);
    expect(lineOf(status, "Edited since")).toBe("Edited since:      yes");
    expect(lineOf(status, "Approved")).toMatch(/ unattributed$/);
  });
});

describe("migrate-documents — names only the plans it makes stale", { timeout: 30_000 }, () => {
  async function migrateWithPlan(planStatus: string, recordedSpecMd: (md: string) => string) {
    const pruneMd = writeOlderSpec(
      PLAN_PRUNE,
      olderSpec("Plan prune", [marked("Q1", "2026-09-24")]),
      specFrontmatter("Approved", approvedStamp()),
    );
    const planMd = writeOlderPlan(
      PLAN_PRUNE,
      planFrontmatter(planStatus, PLAN_PRUNE, approvedStamp()),
    );
    writeOlderSpecRecord(PLAN_PRUNE, pruneMd);
    writeOlderPlanRecord(planMd, { path: PLAN_PRUNE, md: recordedSpecMd(pruneMd) });
    commitAll("approve before migration");
    return renderDocumentMigrationReport(await migrated()).join("\n");
  }

  it("does not name a plan that was already Stale", async () => {
    const report = await migrateWithPlan("Stale", (md) => md);
    expect(report).toContain(PLAN_PRUNE);
    expect(report).not.toContain("stale (spec-changed)");
  });

  it("does not name an Approved plan already behind its spec before migration", async () => {
    const report = await migrateWithPlan("Approved", (md) => `${md}\nAn earlier revision.\n`);
    expect(report).toContain(PLAN_PRUNE);
    expect(report).not.toContain("stale (spec-changed)");
  });
});

describe("migrate-documents — an unreadable sidecar", { timeout: 30_000 }, () => {
  it("refuses a live sidecar that is not JSON, naming it, and writes nothing", async () => {
    const md = writeOlderSpec(
      LOG_ROTATION,
      olderSpec("Log rotation", [question("Q2")]),
      specFrontmatter("Draft"),
    );
    writeOlderSpec(CACHE_KEYS, olderSpec("Cache keys", [question("Q3")]), specFrontmatter("Draft"));
    const broken = `${readRepoFile(sidecarOf(LOG_ROTATION))}}\n`;
    writeRepoFile(sidecarOf(LOG_ROTATION), broken);
    commitAll();
    const head = headSha();

    const result = await migrate();
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(DocumentMigrationRefusedError);
      expect(exitCodeForAuthoringError(result.left)).toBe(12);
      expect(result.left.message).toContain(
        `migrate refused: ${LOG_ROTATION} has an invalid sidecar`,
      );
    }
    expect(headSha()).toBe(head);
    expect(readRepoFile(LOG_ROTATION)).toBe(md);
    expect(readRepoFile(sidecarOf(LOG_ROTATION))).toBe(broken);
    expect(porcelain()).toBe("");
  });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("migrate-documents — commit failure", { timeout: 30_000 }, () => {
  it("fails with exit 12 and leaves the files written but uncommitted", async () => {
    writeOlderSpec(
      LOG_ROTATION,
      olderSpec("Log rotation", [question("Q2")]),
      specFrontmatter("Draft"),
    );
    commitAll();
    const head = headSha();
    const hook = join(repoDir, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\necho 'refused by hook' >&2\nexit 1\n");
    chmodSync(hook, 0o755);

    const result = await migrate();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactCommitFailedError);
      expect(exitCodeForAuthoringError(result.left)).toBe(12);
    }
    expect(headSha()).toBe(head);
    expect(JSON.parse(readRepoFile(sidecarOf(LOG_ROTATION)))).toMatchObject({
      $schema: currentSchemaUrl("spec-document"),
      arbitratedQuestions: [],
    });
    expect(readRepoFile(LOG_ROTATION)).toContain("## 9b. Arbitrated questions");
    // Written, and differing from HEAD: left for the operator to commit.
    expect(git(["diff", "HEAD", "--name-only"]).trim().split("\n").toSorted()).toEqual(
      [LOG_ROTATION, sidecarOf(LOG_ROTATION)].toSorted(),
    );
  });
});

describe("phax artifact migrate-documents — the command", { timeout: 30_000 }, () => {
  async function runCommand(): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    const out = {
      log: (m: string) => lines.push(m),
      warn: (m: string) => lines.push(`WARN: ${m}`),
      error: (m: string) => lines.push(`ERROR: ${m}`),
    };
    process.chdir(repoDir);
    try {
      return { code: await runArtifactMigrateDocuments(out), lines };
    } finally {
      process.chdir(originalCwd);
    }
  }

  beforeEach(() => {
    vi.stubEnv("HOME", configDir);
    writeRepoFile(
      "phax.json",
      JSON.stringify({
        version: 1,
        name: "test",
        gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
      }),
    );
    commitAll("config");
  });

  it("exits 0 with nothing to migrate, then migrates, and exits 12 on a refusal", async () => {
    expect(await runCommand()).toEqual({
      code: 0,
      lines: ["nothing to migrate: every live spec and plan sidecar is at its current shape"],
    });

    const md = writeOlderSpec(
      LOG_ROTATION,
      olderSpec("Log rotation", [question("Q2")]),
      specFrontmatter("Draft"),
    );
    writeRepoFile(LOG_ROTATION, md.replace("Log rotation matters.", "Edited."));
    commitAll();
    const refused = await runCommand();
    expect(refused.code).toBe(12);
    expect(refused.lines[0]).toBe(
      `ERROR: migrate refused: ${LOG_ROTATION} is not its sidecar's spec-document 0.17.0 rendering — a hand edit would be overwritten\n` +
        "  Re-author it headless (remove the artifact and its sidecar, then run " +
        "`phax artifact new spec log-rotation --headless --brief <file|->`), " +
        `or delete ${sidecarOf(LOG_ROTATION)} to demote the artifact to hand-authored. Then rerun.`,
    );

    writeRepoFile(LOG_ROTATION, md);
    commitAll("revert");
    const done = await runCommand();
    expect(done.code).toBe(0);
    expect(done.lines.at(-1)).toMatch(
      /^committed [0-9a-f]{7} chore\(artifacts\): migrate documents/,
    );
    expect(existsSync(join(repoDir, sidecarOf(LOG_ROTATION)))).toBe(true);
  });
});
