// Acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { authorArtifact, type AuthorArtifactInput } from "../../src/app/authorArtifact.js";
import { exitCodeForAuthoringError } from "../../src/cli/commands/runLayers.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import {
  AgentInvocationError,
  ArtifactCommitFailedError,
  AuthoringDocumentError,
  RateLimitError,
  UsageLimitError,
} from "../../src/domain/errors.js";
import type { RoutingResolution } from "../../src/domain/routing/types.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";

// Made-up fixtures, in the shape tests/integration/authorArtifact.test.ts uses.
const NOW = "2026-10-13T14:12:00.000Z";
const REPO_ROOT = "/repo";
const STATE_ROOT = "/state";
const SLUG = "widget-export";
const AUTHORING_ID = `2610131412-${SLUG}`;
const SESSION_FOLDER = `${STATE_ROOT}/authoring/${AUTHORING_ID}`;
const SPEC_PATH = `docs/specs/${AUTHORING_ID}.md`;
const SPEC_SIDECAR = `docs/specs/${AUTHORING_ID}.json`;
const FIRST_SESSION = "sess-first" as ClaudeSessionId;

const SPEC_DOCUMENT = {
  version: 1,
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
      refs: ["5.1"],
    },
  ],
  openQuestions: [],
  arbitratedQuestions: [],
  planningNote: { settled: ["one file per widget"], open: [], constraints: [] },
  docsPage: { kind: "none", why: "the CLI reference covers it" },
};

const VALID = JSON.stringify(SPEC_DOCUMENT);

// Valid JSON, missing acceptanceCriteria[0].refs.
const { refs: _refs, ...criterionWithoutRefs } = SPEC_DOCUMENT.acceptanceCriteria[0] ?? {};
const MISSING_REFS = JSON.stringify({
  ...SPEC_DOCUMENT,
  acceptanceCriteria: [criterionWithoutRefs],
});
const MISSING_REFS_REASON = "acceptanceCriteria[0].refs: is missing";

// A document with a stray code expression inside it.
const STRAY_EXPRESSION = VALID.replace(
  '"context":"Widgets cannot leave the dashboard."',
  '"context":"Widgets cannot leave the dashboard.".replace("a","b")',
);
const STRAY_AT = STRAY_EXPRESSION.indexOf(".replace");

const resolution: RoutingResolution = {
  requested: { model: "claude-opus-5-5", family: "claude-opus", effort: "high" },
  selected: {
    provider: "claude-code",
    family: "claude-opus",
    concreteModel: "claude-opus-5-5",
    thinking: "high",
  },
  relationship: "exact",
  reason: "exact match",
};

const security: ResolvedSecurityConfig = {
  profile: "secure",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],
};

const RECORDS_IN_REPO: ResolvedRecordsConfig = {
  enabled: true,
  transcript: true,
  destination: { kind: "in-repo" },
  autoPush: false,
};

const FIRST_LINES = '{"type":"system","subtype":"init"}\n{"type":"result","result":"first"}\n';
const RETRY_LINES = '{"type":"result","result":"retry"}\n';

/**
 * One headless spec session over fakes. The fake backend plays the provider:
 * each call writes its transcript to the path it was given, and `events`
 * records, in order, every warning and every agent call.
 */
function setup(first: string | undefined, retry?: string) {
  const fs = makeFakeFileSystem();
  const git = makeFakeGit();
  const backend = makeFakeBackend();
  const github = makeFakeGitHub();
  const events: string[] = [];
  if (first !== undefined) {
    backend.impl.addRunResponse({
      sessionId: FIRST_SESSION,
      outputPath: `${SESSION_FOLDER}/output.jsonl`,
      finalText: first,
    });
  }
  if (retry !== undefined) {
    backend.impl.addResumeResponse({
      sessionId: FIRST_SESSION,
      outputPath: `${SESSION_FOLDER}/retry-output.jsonl`,
      finalText: retry,
    });
  }
  backend.impl.setOnRunAgent((_prompt, options) => {
    events.push("run");
    if (options.outputJsonlPath !== undefined)
      fs.impl.setFile(options.outputJsonlPath, FIRST_LINES);
  });
  backend.impl.setOnResumeAgent((_sessionId, _prompt, options) => {
    events.push("resume");
    if (options.outputJsonlPath !== undefined)
      fs.impl.setFile(options.outputJsonlPath, RETRY_LINES);
  });
  git.impl.setHeadCommit("3e9a1c4d".repeat(5));
  const layer = Layer.mergeAll(fs.layer, git.layer, backend.layer, github.layer);
  const input = (overrides: Partial<AuthorArtifactInput> = {}): AuthorArtifactInput => ({
    kind: "spec",
    slug: SLUG,
    brief: { text: "Export widgets.\n", path: "brief.md" },
    sourceSpec: null,
    completion: { last: false, notLast: false },
    model: "claude-opus-5-5",
    effort: "high",
    resolution,
    skillText: "# phax-spec skill\n",
    security,
    repoRoot: REPO_ROOT,
    stateRoot: STATE_ROOT,
    extractPlanModel: "claude-sonnet-5",
    extractPlanEffort: "medium",
    nowIso: NOW,
    records: RECORDS_IN_REPO,
    publishRemote: "origin",
    architectureProvider: false,
    output: { warn: (message) => events.push(`warn: ${message}`) },
    ...overrides,
  });
  const run = (overrides: Partial<AuthorArtifactInput> = {}) =>
    Effect.runPromise(Effect.either(authorArtifact(input(overrides)).pipe(Effect.provide(layer))));

  /** The authoring record's manifest, read back from the records branch. */
  const recordManifest = async (): Promise<Record<string, unknown>> => {
    const head = await Effect.runPromise(git.impl.resolveRef(REPO_ROOT, "phax/records/v1"));
    if (head === null) throw new Error("no record was written");
    const tree = await Effect.runPromise(git.impl.readTree(REPO_ROOT, head));
    const entry = tree.find((e) => e.path === `authoring/${AUTHORING_ID}/record.json`);
    if (entry === undefined) throw new Error("the record has no record.json");
    const bytes = await Effect.runPromise(git.impl.readBlob(REPO_ROOT, entry.oid));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  };

  /** The paths of the record's tree, relative to its key. */
  const recordFiles = (): readonly string[] =>
    git.impl.calls
      .flatMap((call) => (call.method === "writeTreeCommit" ? call.paths : []))
      .map((path) => path.replace(`authoring/${AUTHORING_ID}/`, ""));

  const artifactCommits = () => git.impl.calls.filter((call) => call.method === "commitPaths");

  return {
    fs: fs.impl,
    git: git.impl,
    backend: backend.impl,
    events,
    run,
    recordManifest,
    recordFiles,
    artifactCommits,
  };
}

describe("authorArtifact — a refused document is retried once in the same session", () => {
  it("a schema refusal fixed by the retry: one resume on the first session, warning first, artifact committed", async () => {
    const s = setup(MISSING_REFS, VALID);

    const result = await s.run();

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;

    // Resumed exactly once, on the first session's id, with a prompt naming the refusal.
    expect(s.backend.runCalls).toHaveLength(1);
    expect(s.backend.resumeCalls).toHaveLength(1);
    const [resume] = s.backend.resumeCalls;
    expect(resume?.sessionId).toBe(FIRST_SESSION);
    expect(resume?.prompt).toContain(MISSING_REFS_REASON);
    expect(resume?.prompt).toContain("Return the whole spec document again");

    // Same provider, model, effort, cwd and security; only the transcript path differs.
    const firstOptions = s.backend.runCalls[0]?.options;
    expect(resume?.options).toEqual({
      ...firstOptions,
      outputJsonlPath: `${SESSION_FOLDER}/retry-output.jsonl`,
    });

    // The warning names the refusal and is printed before the resume.
    expect(s.events).toEqual([
      "run",
      `warn: spec document refused — ${MISSING_REFS_REASON}\n  resuming the session once to ask for the whole document again`,
      "resume",
    ]);

    // The spec and its sidecar land exactly as for a first-answer success.
    expect(result.right.path).toBe(SPEC_PATH);
    expect(result.right.sidecarPath).toBe(SPEC_SIDECAR);
    expect(s.fs.getFile(SPEC_PATH)).toContain("status: Draft");
    expect(s.fs.getFile(SPEC_SIDECAR)).toBe(s.fs.getFile(`${SESSION_FOLDER}/document.json`));
    const commits = s.artifactCommits();
    expect(commits).toHaveLength(1);
    expect(commits[0]?.method === "commitPaths" && commits[0].paths).toEqual([
      SPEC_PATH,
      SPEC_SIDECAR,
    ]);

    expect((await s.recordManifest())["retry"]).toBe("retried");
  });

  it("a not-JSON refusal fixed by the retry: the prompt and the warning carry the parser error and position", async () => {
    const s = setup(STRAY_EXPRESSION, VALID);

    const result = await s.run();

    expect(Either.isRight(result)).toBe(true);
    const prompt = s.backend.resumeCalls[0]?.prompt ?? "";
    const warning = s.events.find((event) => event.startsWith("warn: ")) ?? "";
    for (const text of [prompt, warning]) {
      expect(text).toContain("the session's final message is not JSON (");
      expect(text).toContain("after property value");
      expect(text).toContain(`at position ${STRAY_AT})`);
    }
    expect(s.artifactCommits()).toHaveLength(1);
  });

  it("two refusals fail with today's error and exit code, name both, and land nothing", async () => {
    const s = setup(STRAY_EXPRESSION, MISSING_REFS);

    const result = await s.run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) return;
    expect(result.left).toBeInstanceOf(AuthoringDocumentError);
    expect(exitCodeForAuthoringError(result.left)).toBe(5);
    expect(result.left.message).toMatch(
      /^spec document rejected twice — first answer: the session's final message is not JSON \(.+ at position \d+\): .*; retry: acceptanceCriteria\[0\]\.refs: is missing$/s,
    );
    expect(s.backend.resumeCalls).toHaveLength(1);

    expect(s.fs.getFile(SPEC_PATH)).toBeUndefined();
    expect(s.fs.getFile(SPEC_SIDECAR)).toBeUndefined();
    expect(s.fs.getFile(`${SESSION_FOLDER}/document.json`)).toBeUndefined();
    expect(s.artifactCommits()).toHaveLength(0);

    const manifest = await s.recordManifest();
    expect(manifest["outcome"]).toBe("failed");
    expect(manifest["retry"]).toBe("retried");
  });

  it("a refused retry is not retried again", async () => {
    const s = setup(MISSING_REFS, MISSING_REFS);
    s.backend.addResumeResponse({ sessionId: FIRST_SESSION, outputPath: "", finalText: VALID });

    const result = await s.run();

    expect(Either.isLeft(result) && result.left instanceof AuthoringDocumentError).toBe(true);
    expect(s.backend.resumeCalls).toHaveLength(1);
    expect(s.backend.runCalls).toHaveLength(1);
  });
});

describe("authorArtifact — only a refused document is retried", () => {
  it.each([
    ["a rate limit", "rate_limit", RateLimitError],
    ["a usage limit", "usage_limit", UsageLimitError],
  ] as const)(
    "%s on the first run fails as it is, never resumed, retry none",
    async (_name, kind, errorClass) => {
      const s = setup(undefined);
      s.backend.failRunWithRateLimit(0, { kind });

      const result = await s.run();

      expect(Either.isLeft(result) && result.left instanceof errorClass).toBe(true);
      expect(s.backend.resumeCalls).toHaveLength(0);
      expect(s.events.some((event) => event.startsWith("warn: spec document refused"))).toBe(false);
      expect((await s.recordManifest())["retry"]).toBe("none");
    },
  );

  it("an agent invocation error on the first run fails as it is, never resumed, retry none", async () => {
    const s = setup(undefined);

    const result = await s.run();

    expect(Either.isLeft(result) && result.left instanceof AgentInvocationError).toBe(true);
    expect(s.backend.resumeCalls).toHaveLength(0);
    expect((await s.recordManifest())["retry"]).toBe("none");
  });

  it("a failed artifact commit fails as it is, never resumed, retry none", async () => {
    const s = setup(VALID, VALID);
    s.git.failNextCommitPaths("pre-commit hook failed");

    const result = await s.run();

    expect(Either.isLeft(result) && result.left instanceof ArtifactCommitFailedError).toBe(true);
    expect(s.backend.resumeCalls).toHaveLength(0);
    expect((await s.recordManifest())["retry"]).toBe("none");
  });

  it("a rate limit during the resume fails as it is, with no second resume, and retry retried", async () => {
    const s = setup(MISSING_REFS);
    s.backend.failNextResumeWithRateLimit({ kind: "rate_limit" });

    const result = await s.run();

    expect(Either.isLeft(result) && result.left instanceof RateLimitError).toBe(true);
    expect(s.backend.resumeCalls).toHaveLength(1);
    expect(s.artifactCommits()).toHaveLength(0);
    const manifest = await s.recordManifest();
    expect(manifest["outcome"]).toBe("failed");
    expect(manifest["retry"]).toBe("retried");
  });
});

describe("authorArtifact — the first answer's transcript survives the retry", () => {
  it.each([
    ["committed", VALID],
    ["failed", MISSING_REFS],
  ] as const)(
    "%s: output.jsonl holds the first run's lines; the retry's prompt and transcript sit beside it",
    async (_outcome, retry) => {
      const s = setup(MISSING_REFS, retry);

      await s.run();

      expect(s.fs.getFile(`${SESSION_FOLDER}/output.jsonl`)).toBe(FIRST_LINES);
      expect(s.fs.getFile(`${SESSION_FOLDER}/retry-output.jsonl`)).toBe(RETRY_LINES);
      expect(s.fs.getFile(`${SESSION_FOLDER}/retry-prompt.md`)).toBe(
        s.backend.resumeCalls[0]?.prompt,
      );
      // prompt.md stays the first prompt.
      expect(s.fs.getFile(`${SESSION_FOLDER}/prompt.md`)).toBe(s.backend.runCalls[0]?.prompt);

      // The record carries both transcripts and the retry prompt.
      expect(s.recordFiles()).toEqual(
        expect.arrayContaining(["output.jsonl", "retry-output.jsonl", "retry-prompt.md"]),
      );
    },
  );

  it("a first-answer session writes no retry files and records retry none", async () => {
    const s = setup(VALID);

    const result = await s.run();

    expect(Either.isRight(result)).toBe(true);
    expect(s.backend.resumeCalls).toHaveLength(0);
    expect(s.fs.getFile(`${SESSION_FOLDER}/retry-prompt.md`)).toBeUndefined();
    expect(s.fs.getFile(`${SESSION_FOLDER}/retry-output.jsonl`)).toBeUndefined();
    expect((await s.recordManifest())["retry"]).toBe("none");
  });
});
