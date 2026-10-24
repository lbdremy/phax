import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transitionArtifactBy } from "../../src/app/artifactStatus.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import type { ArtifactStatus } from "../../src/domain/artifact/status.js";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import { SurfaceSummariesUnwrittenError } from "../../src/domain/errors.js";
import { makeFakeTerminal } from "../../src/infra/fakes/terminal.js";
import { makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";
import { SURFACE_SUMMARY_PLACEHOLDER, type SpecDocument } from "../../src/schemas/specDocument.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Real-git acceptance for surface-summary §8: a current-shape spec whose
// sidecar still holds the summary placeholder is neither approved nor
// completed, and the refusal names every element still to write. Every spec,
// operator and grant is made up.

const OPERATOR = "Ada Lovelace";
const NOW = "2026-10-24T09:28:11.427Z";
const LIVE = "docs/specs/2610241000-log-rotation.md";
const LIVE_SIDECAR = "docs/specs/2610241000-log-rotation.json";
const ARCHIVED = "docs/specs/archive/2610241000-log-rotation.md";

const ROTATE_ONE = "cli: `phax rotate <run>`";
const ROTATE_ALL = "cli: `phax rotate --all`";
const RECONCILE = "internal: phax-plan.json reconciliation";
const SENTENCE = "An operator can rotate every log at once.";

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

function frontmatter(status: string): string {
  return `---\nstatus: ${status}\ndate: 2026-10-24\naudience: maintainers\nscope: tidying\n---\n`;
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

// A spec at the current shape with three surface elements.
function spec(summaries: readonly [string, string, string]): SpecDocument {
  return {
    kind: "spec",
    title: "Log rotation",
    ground: [{ path: "src/app/archive.ts", note: "where runs are archived" }],
    context: "Log rotation matters.",
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
      element(ROTATE_ONE, summaries[0]),
      element(ROTATE_ALL, summaries[1]),
      element(RECONCILE, summaries[2]),
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

function writeSpec(status: string, doc: SpecDocument): void {
  writeRepoFile(LIVE, frontmatter(status) + renderSpecBody(doc));
  writeRepoFile(LIVE_SIDECAR, `${JSON.stringify(withSchemaUrl("spec-document", doc), null, 2)}\n`);
}

function transition(target: ArtifactStatus) {
  const layer = Layer.mergeAll(
    makeRootedNodeFileSystemLayer(repoDir),
    NodeGitLayer,
    makeFakeTerminal(false).layer,
  );
  return Effect.runPromise(
    Effect.either(
      transitionArtifactBy(LIVE, target, {
        repoRoot: repoDir,
        nowIso: NOW,
        commit: true,
        by: "operator",
      }).pipe(Effect.provide(layer)),
    ),
  );
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "phax-summary-refusal-config-"));
  writeFileSync(join(configDir, "gitconfig"), "[user]\n\tuseConfigOnly = true\n");
  vi.stubEnv("GIT_CONFIG_GLOBAL", join(configDir, "gitconfig"));
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  repoDir = mkdtempSync(join(tmpdir(), "phax-summary-refusal-"));
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

describe("a spec still holding the summary placeholder", { timeout: 30_000 }, () => {
  // ac-placeholder-approve
  it("is refused at approve with exit 12, naming each element still to write, writing nothing", async () => {
    writeSpec(
      "Draft",
      spec([
        SURFACE_SUMMARY_PLACEHOLDER,
        "An operator can rotate one run's log.",
        SURFACE_SUMMARY_PLACEHOLDER,
      ]),
    );
    commitAll();
    const head = headSha();
    const md = readRepoFile(LIVE);
    const sidecar = readRepoFile(LIVE_SIDECAR);

    const result = await transition("Approved");

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SurfaceSummariesUnwrittenError);
      expect(exitCodeForError(result.left)).toBe(12);
      expect(result.left.message.split("\n")).toEqual([
        `Approval refused: ${LIVE} has 2 surface summaries still to write`,
        `  ${ROTATE_ONE}`,
        `  ${RECONCILE}`,
        `  Write each one in ${LIVE_SIDECAR} and on its §6 \`Summary:\` line, then rerun.`,
      ]);
    }
    expect(headSha()).toBe(head);
    expect(git(["status", "--porcelain"]).trim()).toBe("");
    expect(readRepoFile(LIVE)).toBe(md);
    expect(readRepoFile(LIVE_SIDECAR)).toBe(sidecar);
    expect(existsSync(join(repoDir, "docs/specs/approvals"))).toBe(false);
  });

  // ac-placeholder-complete
  it("is refused at complete, naming the element, leaving the spec in place and archiving nothing", async () => {
    writeSpec("Approved", spec([SURFACE_SUMMARY_PLACEHOLDER, SENTENCE, SENTENCE]));
    commitAll();
    const head = headSha();
    const md = readRepoFile(LIVE);
    const sidecar = readRepoFile(LIVE_SIDECAR);

    const result = await transition("Completed");

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SurfaceSummariesUnwrittenError);
      expect(exitCodeForError(result.left)).toBe(12);
      expect(result.left.message.split("\n")).toEqual([
        `Completion refused: ${LIVE} has 1 surface summary still to write`,
        `  ${ROTATE_ONE}`,
        `  Write each one in ${LIVE_SIDECAR} and on its §6 \`Summary:\` line, then rerun.`,
      ]);
    }
    expect(headSha()).toBe(head);
    expect(git(["status", "--porcelain"]).trim()).toBe("");
    expect(readRepoFile(LIVE)).toBe(md);
    expect(readRepoFile(LIVE_SIDECAR)).toBe(sidecar);
    expect(existsSync(join(repoDir, ARCHIVED))).toBe(false);
  });

  // ac-placeholder-written
  it("is approved, with its record file, once every placeholder is replaced in the sidecar and on its Summary: line", async () => {
    writeSpec("Draft", spec([SENTENCE, SENTENCE, SENTENCE]));
    commitAll();

    const result = await transition("Approved");

    expect(Either.isRight(result)).toBe(true);
    expect(readRepoFile(LIVE)).toContain("status: Approved");
    expect(existsSync(join(repoDir, "docs/specs/approvals/2610241000-log-rotation.json"))).toBe(
      true,
    );
  });

  it("is not refused at abandon", async () => {
    writeSpec("Draft", spec([SURFACE_SUMMARY_PLACEHOLDER, SENTENCE, SENTENCE]));
    commitAll();

    const result = await transition("Abandoned");

    expect(Either.isRight(result)).toBe(true);
  });
});
