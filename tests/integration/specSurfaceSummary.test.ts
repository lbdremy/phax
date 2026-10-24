import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transitionArtifactBy } from "../../src/app/artifactStatus.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import type { ArtifactStatus } from "../../src/domain/artifact/status.js";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import { renderSpecBodyV0_25_0 } from "../../src/domain/authoring/renderSpecV0_25_0.js";
import { DocumentMigrationRequiredError } from "../../src/domain/errors.js";
import { makeFakeTerminal } from "../../src/infra/fakes/terminal.js";
import { makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { type SpecDocumentV0_25_0Value, withSchemaUrl } from "../../src/schemas/persisted.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import type { SpecDocument } from "../../src/schemas/specDocument.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Real-git acceptance for surface-summary §8: a current sidecar missing a
// summary is an invalid sidecar, a 0.25.0 sidecar waits for migration, and an
// archived 0.25.0 spec is left alone (§5.1, §5.7, §5.11). Every spec,
// operator and grant is made up.

const OPERATOR = "Ada Lovelace";
const NOW = "2026-10-24T09:28:11.427Z";
const LIVE = "docs/specs/2610241000-log-rotation.md";
const LIVE_SIDECAR = "docs/specs/2610241000-log-rotation.json";
const OTHER = "docs/specs/2610241100-cache-keys.md";
const ARCHIVED = "docs/specs/archive/2609011000-old-prune.md";
const PLAN = "docs/plans/2610241200-log-rotation-plan.md";

const FRONTMATTER =
  "---\nstatus: Draft\ndate: 2026-10-24\naudience: maintainers\nscope: tidying\n---\n";

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

function sidecarOf(path: string): string {
  return `${path.slice(0, -".md".length)}.json`;
}

function element(surface: string, summary: string) {
  return {
    surface,
    summary,
    binding: "normative" as const,
    before: null,
    after: "phax rotate\n  rotated",
  };
}

// A spec at the current shape with three surface elements, a summary on each.
function currentSpec(title: string): SpecDocument {
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
    surface: [
      element("cli: `phax rotate <run>`", "An operator can rotate one run's log."),
      element("cli: `phax rotate --all`", "An operator can rotate every log at once."),
      element(
        "internal: phax-plan.json reconciliation",
        "A run's plan stays in step with its log.",
      ),
    ],
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
    openQuestions: [],
    arbitratedQuestions: [],
    planningNote: { settled: [], open: [], constraints: [] },
    docsPage: { kind: "none", why: "the CLI reference covers it" },
  };
}

function writeCurrentSpec(path: string, doc: SpecDocument, sidecar: unknown = doc): void {
  writeRepoFile(path, FRONTMATTER + renderSpecBody(doc));
  writeRepoFile(sidecarOf(path), json(withSchemaUrl("spec-document", sidecar as object)));
}

// The 0.25.0 shape: the same spec, no summaries.
function spec0_25_0(title: string): SpecDocumentV0_25_0Value {
  const { surface, ...rest } = currentSpec(title);
  return {
    ...rest,
    surface: surface.map(({ summary: _summary, ...older }) => older),
  };
}

function writeV0_25_0Spec(path: string, doc: SpecDocumentV0_25_0Value): void {
  writeRepoFile(path, FRONTMATTER + renderSpecBodyV0_25_0(doc));
  writeRepoFile(sidecarOf(path), json({ $schema: schemaUrl("spec-document", "0.25.0"), ...doc }));
}

function transition(path: string, target: ArtifactStatus, by = "operator") {
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

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "phax-surface-summary-config-"));
  writeFileSync(join(configDir, "gitconfig"), "[user]\n\tuseConfigOnly = true\n");
  vi.stubEnv("GIT_CONFIG_GLOBAL", join(configDir, "gitconfig"));
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  repoDir = mkdtempSync(join(tmpdir(), "phax-surface-summary-"));
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

describe(
  "a sidecar at the current shape needs a summary on every element",
  { timeout: 30_000 },
  () => {
    // ac-sidecar-missing
    it("refuses approve for an invalid sidecar naming surface[1].summary, writing nothing", async () => {
      const doc = currentSpec("Log rotation");
      const [first, second, third] = doc.surface;
      const { summary: _dropped, ...withoutSummary } = second!;
      writeCurrentSpec(LIVE, doc, { ...doc, surface: [first, withoutSummary, third] });
      commitAll();
      const head = headSha();
      const sidecar = readRepoFile(LIVE_SIDECAR);

      const result = await transition(LIVE, "Approved");

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left.message).toContain(
          `${LIVE} has an invalid sidecar (${LIVE_SIDECAR}: surface[1].summary: is missing)`,
        );
      }
      expect(headSha()).toBe(head);
      expect(git(["status", "--porcelain"]).trim()).toBe("");
      expect(readRepoFile(LIVE_SIDECAR)).toBe(sidecar);
      expect(readRepoFile(LIVE)).toContain("status: Draft");
    });

    it("approves a sidecar whose every element has a summary", async () => {
      writeCurrentSpec(LIVE, currentSpec("Log rotation"));
      commitAll();

      const result = await transition(LIVE, "Approved");

      expect(Either.isRight(result)).toBe(true);
    });
  },
);

describe("a live 0.25.0 sidecar waits for migrate-documents", { timeout: 30_000 }, () => {
  // ac-unmigrated-refuses
  it("refuses approve of a spec and of a plan, naming the sidecar and the shape, writing nothing", async () => {
    writeV0_25_0Spec(LIVE, spec0_25_0("Log rotation"));
    writeCurrentSpec(OTHER, currentSpec("Cache keys"));
    writeRepoFile(PLAN, "---\nstatus: Draft\nsource-spec: null\n---\n# Log rotation plan\n");
    commitAll();
    const head = headSha();
    const refusal = `${LIVE_SIDECAR} is stamped spec-document 0.25.0 — run \`phax artifact migrate-documents\` first`;

    for (const path of [OTHER, PLAN]) {
      const result = await transition(path, "Approved");

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(DocumentMigrationRequiredError);
        expect(exitCodeForError(result.left)).toBe(12);
        expect(result.left.message).toBe(`Approval refused: ${refusal}`);
      }
      expect(headSha()).toBe(head);
      expect(git(["status", "--porcelain"]).trim()).toBe("");
    }
  });

  // ac-archive-untouched: the archive is not a live sidecar.
  it("does not refuse approve on account of an archived 0.25.0 spec", async () => {
    writeV0_25_0Spec(ARCHIVED, spec0_25_0("Old prune"));
    writeCurrentSpec(OTHER, currentSpec("Cache keys"));
    commitAll();
    const archived = readRepoFile(sidecarOf(ARCHIVED));

    const result = await transition(OTHER, "Approved");

    expect(Either.isRight(result)).toBe(true);
    expect(readRepoFile(sidecarOf(ARCHIVED))).toBe(archived);
  });
});
