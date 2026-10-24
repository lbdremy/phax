import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transitionArtifactBy } from "../../src/app/artifactStatus.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import type { ArtifactStatus } from "../../src/domain/artifact/status.js";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import { renderSpecBodyV0_17_0 } from "../../src/domain/authoring/renderSpecV0_17_0.js";
import { DocumentMigrationRequiredError } from "../../src/domain/errors.js";
import { makeFakeTerminal } from "../../src/infra/fakes/terminal.js";
import { makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { type SpecDocumentV0_17_0Value, withSchemaUrl } from "../../src/schemas/persisted.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Real-git acceptance for spec artifact-decide §8 'Approve, reopen and decide
// wait for migration' (decide is plan C) — §5.54: while one live sidecar is
// stamped below its current shape, approve and reopen of any spec or plan
// refuse with exit 12 before writing anything, naming the sidecar and
// `phax artifact migrate-documents`; complete and abandon are not refused.
// Every spec, operator and grant is made up.

const OPERATOR = "Ada Lovelace";
const NOW = "2026-10-21T09:28:11.427Z";
const LOG_ROTATION = "docs/specs/2609281200-log-rotation.md";
const LOG_ROTATION_SIDECAR = "docs/specs/2609281200-log-rotation.json";
const CACHE_KEYS = "docs/specs/2609271000-cache-keys.md";
const PLAN_PRUNE = "docs/specs/2609251400-plan-prune.md";

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

function spec(title: string): SpecDocumentV0_17_0Value {
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
    openQuestions: [],
    planningNote: { settled: [], open: [], constraints: [] },
    docsPage: { kind: "none", why: "the CLI reference covers it" },
  };
}

const FRONTMATTER =
  "---\nstatus: Draft\ndate: 2026-09-25\naudience: maintainers\nscope: tidying\n---\n";

// A headless spec at the current shape.
function writeCurrentSpec(path: string, title: string): void {
  const doc = { ...spec(title), surface: [], arbitratedQuestions: [] };
  writeRepoFile(path, FRONTMATTER + renderSpecBody(doc));
  writeRepoFile(`${path.slice(0, -".md".length)}.json`, json(withSchemaUrl("spec-document", doc)));
}

function transition(path: string, target: ArtifactStatus, by?: string) {
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

beforeEach(async () => {
  configDir = mkdtempSync(join(tmpdir(), "phax-migration-refusal-config-"));
  writeFileSync(join(configDir, "gitconfig"), "[user]\n\tuseConfigOnly = true\n");
  vi.stubEnv("GIT_CONFIG_GLOBAL", join(configDir, "gitconfig"));
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  repoDir = mkdtempSync(join(tmpdir(), "phax-migration-refusal-"));
  git(["init", "-q", "-b", "main"]);
  disableGitAutoMaintenance(repoDir);
  git(["config", "--local", "user.name", OPERATOR]);
  git(["config", "--local", "user.email", "ada@example.test"]);

  writeCurrentSpec(CACHE_KEYS, "Cache keys");
  writeCurrentSpec(PLAN_PRUNE, "Plan prune");
  commitAll();
  const approved = await transition(PLAN_PRUNE, "Approved", "machine:roadmap-loop");
  if (Either.isLeft(approved)) throw new Error(approved.left.message);

  // One live sidecar stamped 0.17.0, its body the frozen rendering.
  const older = spec("Log rotation");
  writeRepoFile(LOG_ROTATION, FRONTMATTER + renderSpecBodyV0_17_0(older));
  writeRepoFile(
    LOG_ROTATION_SIDECAR,
    json({ $schema: schemaUrl("spec-document", "0.17.0"), ...older }),
  );
  commitAll("an older spec");
});

afterEach(() => {
  vi.unstubAllEnvs();
  removeTempDir(repoDir);
  removeTempDir(configDir);
});

describe("approve and reopen wait for migrate-documents", { timeout: 30_000 }, () => {
  it.each([
    ["approve", CACHE_KEYS, "Approved", "machine:roadmap-loop", "Approval refused"],
    ["reopen", PLAN_PRUNE, "Draft", "operator", "Reopen refused"],
  ] as const)(
    "%s of an artifact at the current shape exits 12, naming the unmigrated sidecar, writing nothing",
    async (_gesture, path, target, by, refused) => {
      const head = headSha();

      const result = await transition(path, target, by);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(DocumentMigrationRequiredError);
        expect(exitCodeForError(result.left)).toBe(12);
        expect(result.left.message).toBe(
          `${refused}: ${LOG_ROTATION_SIDECAR} is stamped spec-document 0.17.0 — run \`phax artifact migrate-documents\` first`,
        );
      }
      expect(headSha()).toBe(head);
      expect(git(["status", "--porcelain"]).trim()).toBe("");
    },
  );

  it("refuses whatever --by says: an unresolvable arbiter is never reached", async () => {
    const result = await transition(CACHE_KEYS, "Approved", undefined);
    expect(Either.isLeft(result) && result.left).toBeInstanceOf(DocumentMigrationRequiredError);
  });

  it("names every unmigrated sidecar", async () => {
    // Plan prune's sidecar, rewritten as one written before `$schema`.
    writeRepoFile(PLAN_PRUNE.replace(".md", ".json"), json({ version: 1, ...spec("Plan prune") }));
    commitAll("a second older sidecar");

    const result = await transition(CACHE_KEYS, "Approved", "operator");

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message.split("\n")).toEqual([
        "Approval refused: 2 live sidecars are stamped below their current shape — run `phax artifact migrate-documents` first",
        "  docs/specs/2609251400-plan-prune.json is stamped spec-document written before $schema",
        `  ${LOG_ROTATION_SIDECAR} is stamped spec-document 0.17.0`,
      ]);
    }
  });

  it("does not refuse complete or abandon: they carry an older sidecar as before", async () => {
    const completed = await transition(PLAN_PRUNE, "Completed");
    expect(Either.isRight(completed)).toBe(true);

    const abandoned = await transition(CACHE_KEYS, "Abandoned");
    expect(Either.isRight(abandoned)).toBe(true);

    const abandonedOlder = await transition(LOG_ROTATION, "Abandoned");
    expect(Either.isRight(abandonedOlder)).toBe(true);
    expect(git(["status", "--porcelain"]).trim()).toBe("");
  });
});
