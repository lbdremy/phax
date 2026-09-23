// Acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { authorArtifact, type AuthorArtifactInput } from "../../src/app/authorArtifact.js";
import { cacheEntryPath } from "../../src/app/planCacheStore.js";
import { exitCodeForAuthoringError, exitCodeForError } from "../../src/cli/commands/runLayers.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import {
  ArtifactCommitFailedError,
  ArtifactCreationError,
  AuthoringDocumentError,
  RateLimitError,
} from "../../src/domain/errors.js";
import { EXTRACTOR_VERSION, planCacheKey } from "../../src/domain/planCache/key.js";
import type { RoutingResolution } from "../../src/domain/routing/types.js";
import { splitFrontmatter } from "../../src/domain/artifact/frontmatter.js";
import { renderPlanBody } from "../../src/domain/authoring/renderPlan.js";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import { decodeExtractedPlanCacheEntry } from "../../src/schemas/extractedPlanCacheEntry.js";
import { decodePlanDocument, projectExtractedPlan } from "../../src/schemas/planDocument.js";
import { decodeSpecDocument } from "../../src/schemas/specDocument.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";

const NOW = "2026-09-23T08:35:12.000Z";
const STATE_ROOT = "/state";
const REPO_ROOT = "/repo";
const SPEC_PATH = "docs/specs/2609230835-plan-prune.md";
const SPEC_SIDECAR = "docs/specs/2609230835-plan-prune.json";
const PLAN_PATH = "docs/plans/2609230835-plan-prune-plan.md";
const PLAN_SIDECAR = "docs/plans/2609230835-plan-prune-plan.json";
const SOURCE_SPEC = "docs/specs/2609091412-plan-prune.md";
const SESSION_FOLDER = "/state/authoring/2609230835-plan-prune";

const APPROVED_SPEC = `---
status: Approved
date: 2026-09-09
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-09-09
  baseline: abc1234
---
# Plan prune
`;

const SPEC_DOCUMENT = {
  version: 1,
  kind: "spec",
  title: "Plan Prune",
  ground: [{ path: "docs/ideas/plan-prune.md", note: "the idea this spec makes precise" }],
  context: "A slug is held forever by its archived run.",
  problem: "The `-2` habit is the visible symptom.",
  productGoal: {
    statement: "Free a slug once its run is archived.",
    guidingRule: "A slug is held only by a live run.",
  },
  terminology: [{ term: "live run", definition: "a run that is not archived" }],
  requirements: [
    {
      id: "5.1",
      title: "Prune eligibility",
      pattern: "event",
      statement: "WHEN a run is archived THE system SHALL make it eligible to prune.",
    },
  ],
  surface: [
    {
      surface: "cli: `phax prune <run>`",
      binding: "normative",
      before: null,
      after: "phax prune usage-cli\n  pruned usage-cli\n  $? = 0",
    },
  ],
  nonGoals: ["pruning a run that is not archived"],
  acceptanceCriteria: [
    {
      id: "AC-1",
      name: "Prune frees the slug",
      given: "an archived run usage-cli",
      when: "`phax prune usage-cli` runs",
      then: "the slug is free",
      refs: ["5.1"],
    },
  ],
  openQuestions: [
    {
      id: "Q1",
      question: "Is pruning manual or automatic past `keep`?",
      options: [
        { id: "manual", label: "an explicit `phax prune`", abandons: "self-shrinking" },
        { id: "auto", label: "prune at archive time", abandons: "later inspection" },
      ],
      recommendation: "manual",
      rationale: "records already keep the trajectory",
    },
  ],
  planningNote: { settled: ["manual prune"], open: [], constraints: ["no new state"] },
  docsPage: { kind: "none", why: "the CLI reference covers it" },
};

const PLAN_DOCUMENT = {
  version: 1,
  kind: "plan",
  sourceSpec: SOURCE_SPEC,
  run: { shortName: "plan-prune", title: "Plan prune", requiredCommands: [] },
  preamble: {
    summary: "One phase: the prune command.",
    requiredCommandsNote: "No extra commands.",
    technicalArbitrations: [],
  },
  phases: [
    {
      id: "phase-01",
      title: "Prune command",
      model: "claude-sonnet-5",
      effort: "high",
      planMarkdownAnchor: "#phase-01-prune-command",
      plannedFilesToCreate: ["src/app/prune.ts"],
      plannedFilesToEdit: ["src/cli/main.ts"],
      optionalFilesToEdit: [],
      commit: { subject: "feat(cli): phax prune", body: "Add `phax prune`." },
      objective: "Free a slug once its run is archived.",
      detailedInstructions: ["Add the use case."],
      boundaryContracts: null,
      testStrategy: "Unit and integration.",
      implementationOrder: ["Use case", "CLI"],
      excludedScope: [],
      verification: "The `standard` gate profile.",
      expectedHandoff: "The command's exit codes.",
    },
  ],
};

const fakeResolution: RoutingResolution = {
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

const fakeSecurity: ResolvedSecurityConfig = {
  profile: "secure",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],
};

function input(overrides: Partial<AuthorArtifactInput> = {}): AuthorArtifactInput {
  return {
    kind: "spec",
    slug: "plan-prune",
    brief: { text: "Prune archived runs.\nFree their slugs.\n", path: "brief.md" },
    sourceSpec: null,
    model: "claude-opus-5-5",
    effort: "high",
    resolution: fakeResolution,
    skillText: "# phax-spec skill\n\nWrite specs.\n",
    security: fakeSecurity,
    repoRoot: REPO_ROOT,
    stateRoot: STATE_ROOT,
    extractPlanModel: "claude-sonnet-5",
    extractPlanEffort: "medium",
    nowIso: NOW,
    records: RECORDS_OFF,
    output: { warn: () => {} },
    ...overrides,
  };
}

const RECORDS_OFF: ResolvedRecordsConfig = {
  enabled: false,
  transcript: false,
  destination: { kind: "in-repo" },
  autoPush: false,
};

const RECORDS_IN_REPO: ResolvedRecordsConfig = {
  enabled: true,
  transcript: true,
  destination: { kind: "in-repo" },
  autoPush: false,
};

function setup(finalText?: string) {
  const fs = makeFakeFileSystem();
  const git = makeFakeGit();
  const backend = makeFakeBackend();
  const github = makeFakeGitHub();
  if (finalText !== undefined) {
    backend.impl.addRunResponse({
      sessionId: "sess-authoring" as ClaudeSessionId,
      outputPath: `${SESSION_FOLDER}/output.jsonl`,
      finalText,
    });
  }
  git.impl.setHeadCommit("a1b2c3d4".repeat(5));
  const layer = Layer.mergeAll(fs.layer, git.layer, backend.layer, github.layer);
  const run = (i: AuthorArtifactInput) =>
    Effect.runPromise(Effect.either(authorArtifact(i).pipe(Effect.provide(layer))));
  return { fs: fs.impl, git: git.impl, backend: backend.impl, run };
}

function repoFiles(fs: { files: Map<string, string> }): string[] {
  return [...fs.files.keys()].filter((path) => path.startsWith("docs/")).toSorted();
}

describe("authorArtifact — spec", () => {
  it("writes the rendered spec and its sidecar, then commits exactly the two paths", async () => {
    const { fs, git, backend, run } = setup(JSON.stringify(SPEC_DOCUMENT));

    const result = await run(input());

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;
    expect(result.right).toEqual({
      path: SPEC_PATH,
      sidecarPath: SPEC_SIDECAR,
      commit: { hash: "a1b2c3d4".repeat(5), subject: "docs(specs): draft plan-prune" },
      authoringId: "2609230835-plan-prune",
      sessionFolder: SESSION_FOLDER,
      record: { kind: "records-off" },
    });

    const doc = decodeSpecDocument(SPEC_DOCUMENT);
    if (Either.isLeft(doc)) throw new Error("fixture does not decode");
    const md = fs.getFile(SPEC_PATH) ?? "";
    expect(md).toContain("status: Draft");
    expect(md).toContain("date: 2026-09-23");
    expect(splitFrontmatter(md)?.body).toBe(renderSpecBody(doc.right));

    const sidecar = fs.getFile(SPEC_SIDECAR) ?? "";
    expect(JSON.parse(sidecar)).toEqual(SPEC_DOCUMENT);
    expect(fs.getFile(`${SESSION_FOLDER}/document.json`)).toBe(sidecar);

    const commits = git.calls.filter((call) => call.method === "commitPaths");
    expect(commits).toHaveLength(1);
    const [commit] = commits;
    if (commit?.method !== "commitPaths") throw new Error("no commit");
    expect(commit.paths).toEqual([SPEC_PATH, SPEC_SIDECAR]);
    expect(commit.subject).toBe("docs(specs): draft plan-prune");
    expect(commit.body).toMatch(/\n\nArtifact: docs\/specs\/2609230835-plan-prune\.md\n/);
    expect(commit.body).toMatch(/\nAuthoring-Id: 2609230835-plan-prune$/);

    // No cache seed for a spec.
    expect([...fs.files.keys()].some((path) => path.includes("/cache/plans/"))).toBe(false);

    // One session, read-only review posture rooted at the repository.
    expect(backend.runCalls).toHaveLength(1);
    const options = backend.runCalls[0]?.options;
    expect(options?.cwd).toBe(REPO_ROOT);
    expect(options?.model).toBe("claude-opus-5-5");
    expect(options?.effort).toBe("high");
    expect(options?.security.filesystem.allowWrite).toEqual([`${REPO_ROOT}/.phax-context`]);
    expect(options?.outputJsonlPath).toBe(`${SESSION_FOLDER}/output.jsonl`);
    expect(options?.phaseFolderPath).toBe(SESSION_FOLDER);
  });

  it("records the brief and the prompt in the session folder", async () => {
    const { fs, backend, run } = setup(JSON.stringify(SPEC_DOCUMENT));

    await run(input());

    expect(fs.getFile(`${SESSION_FOLDER}/brief.md`)).toBe(
      "Prune archived runs.\nFree their slugs.\n",
    );
    const prompt = fs.getFile(`${SESSION_FOLDER}/prompt.md`);
    expect(prompt).toBe(backend.runCalls[0]?.prompt);
    expect(prompt).toContain("# phax-spec skill");
    expect(prompt).toContain("Free their slugs.");
  });

  it("accepts a document wrapped in a json code fence", async () => {
    const { fs, run } = setup("```json\n" + JSON.stringify(SPEC_DOCUMENT) + "\n```");

    const result = await run(input());

    expect(Either.isRight(result)).toBe(true);
    expect(fs.getFile(SPEC_SIDECAR)).toBeDefined();
  });
});

describe("authorArtifact — plan", () => {
  it("seeds the extraction cache with the projection, keyed on the written file", async () => {
    const { fs, git, run } = setup(JSON.stringify(PLAN_DOCUMENT));
    fs.setFile(SOURCE_SPEC, APPROVED_SPEC);

    const result = await run(input({ kind: "plan", sourceSpec: SOURCE_SPEC }));

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;
    expect(result.right.path).toBe(PLAN_PATH);
    expect(result.right.sidecarPath).toBe(PLAN_SIDECAR);
    expect(result.right.commit.subject).toBe("docs(plans): draft plan-prune");

    const doc = decodePlanDocument(PLAN_DOCUMENT);
    if (Either.isLeft(doc)) throw new Error("fixture does not decode");
    const md = fs.getFile(PLAN_PATH) ?? "";
    expect(md).toContain(`source-spec: ${SOURCE_SPEC}`);
    expect(splitFrontmatter(md)?.body).toBe(renderPlanBody(doc.right));
    expect(JSON.parse(fs.getFile(PLAN_SIDECAR) ?? "")).toEqual(PLAN_DOCUMENT);

    const key = planCacheKey(md, "claude-sonnet-5", "medium");
    const entryText = fs.getFile(cacheEntryPath(STATE_ROOT, key));
    expect(entryText).toBeDefined();
    const entry = decodeExtractedPlanCacheEntry(JSON.parse(entryText ?? ""));
    expect(Either.isRight(entry)).toBe(true);
    if (Either.isRight(entry)) {
      expect(entry.right.extracted).toEqual(projectExtractedPlan(doc.right));
      expect(entry.right.model).toBe("claude-sonnet-5");
      expect(entry.right.effort).toBe("medium");
      expect(entry.right.extractorVersion).toBe(EXTRACTOR_VERSION);
      expect(entry.right.extractedAt).toBe(NOW);
    }

    const commit = git.calls.find((call) => call.method === "commitPaths");
    if (commit?.method !== "commitPaths") throw new Error("no commit");
    expect(commit.paths).toEqual([PLAN_PATH, PLAN_SIDECAR]);
  });

  it("puts the source spec in the prompt", async () => {
    const { fs, backend, run } = setup(JSON.stringify(PLAN_DOCUMENT));
    fs.setFile(SOURCE_SPEC, APPROVED_SPEC);

    await run(input({ kind: "plan", sourceSpec: SOURCE_SPEC }));

    expect(backend.runCalls[0]?.prompt).toContain("# Plan prune");
  });

  it("takes the source spec from --spec, not from the session's document", async () => {
    const { fs, run } = setup(JSON.stringify({ ...PLAN_DOCUMENT, sourceSpec: null }));
    fs.setFile(SOURCE_SPEC, APPROVED_SPEC);

    const result = await run(input({ kind: "plan", sourceSpec: SOURCE_SPEC }));

    expect(Either.isRight(result)).toBe(true);
    expect(JSON.parse(fs.getFile(PLAN_SIDECAR) ?? "").sourceSpec).toBe(SOURCE_SPEC);
  });
});

describe("authorArtifact — failures land nothing", () => {
  it("non-JSON final text: names 'not JSON', writes no artifact, commits nothing", async () => {
    const { fs, git, run } = setup("Here is your spec: it is great.");

    const result = await run(input());

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) return;
    expect(result.left).toBeInstanceOf(AuthoringDocumentError);
    expect(result.left.message).toContain("not JSON");
    expect(repoFiles(fs)).toEqual([]);
    expect(fs.getFile(`${SESSION_FOLDER}/document.json`)).toBeUndefined();
    expect(git.calls.some((call) => call.method === "commitPaths")).toBe(false);
  });

  it("schema-invalid document: the message names the first violation's path", async () => {
    const invalid = {
      ...SPEC_DOCUMENT,
      acceptanceCriteria: [{ ...SPEC_DOCUMENT.acceptanceCriteria[0], refs: ["5.9"] }],
    };
    const { fs, git, run } = setup(JSON.stringify(invalid));

    const result = await run(input());

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) return;
    expect(result.left).toBeInstanceOf(AuthoringDocumentError);
    expect(result.left.message).toContain("spec document rejected — ");
    expect(result.left.message).toContain("acceptanceCriteria[0].refs[0]");
    expect(repoFiles(fs)).toEqual([]);
    expect(fs.getFile(`${SESSION_FOLDER}/document.json`)).toBeUndefined();
    expect(git.calls.some((call) => call.method === "commitPaths")).toBe(false);
  });

  it("a document of the other kind is rejected", async () => {
    const { fs, run } = setup(JSON.stringify(PLAN_DOCUMENT));

    const result = await run(input());

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(AuthoringDocumentError);
    expect(repoFiles(fs)).toEqual([]);
  });

  it("an existing target is refused before the session is spawned", async () => {
    const { fs, backend, run } = setup(JSON.stringify(SPEC_DOCUMENT));
    fs.setFile(SPEC_PATH, APPROVED_SPEC);

    const result = await run(input());

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactCreationError);
      expect(result.left.message).toContain(SPEC_PATH);
    }
    expect(backend.runCalls.length).toBe(0);
    expect(fs.getFile(`${SESSION_FOLDER}/brief.md`)).toBeUndefined();
  });

  it("an existing sidecar is refused before the session is spawned", async () => {
    const { fs, backend, run } = setup(JSON.stringify(SPEC_DOCUMENT));
    fs.setFile(SPEC_SIDECAR, "{}");

    const result = await run(input());

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactCreationError);
      expect(result.left.message).toContain(SPEC_SIDECAR);
    }
    expect(backend.runCalls.length).toBe(0);
    expect(fs.getFile(SPEC_PATH)).toBeUndefined();
  });

  it("a bad slug or a missing --spec is refused before the session is spawned", async () => {
    const bad = setup(JSON.stringify(SPEC_DOCUMENT));
    const badSlug = await bad.run(input({ slug: "Plan_Prune" }));
    expect(Either.isLeft(badSlug) && badSlug.left instanceof ArtifactCreationError).toBe(true);
    expect(bad.backend.runCalls.length).toBe(0);

    const missing = setup(JSON.stringify(PLAN_DOCUMENT));
    const missingSpec = await missing.run(input({ kind: "plan", sourceSpec: SOURCE_SPEC }));
    expect(Either.isLeft(missingSpec) && missingSpec.left instanceof ArtifactCreationError).toBe(
      true,
    );
    expect(missing.backend.runCalls.length).toBe(0);
  });

  it("a rate limit from the backend propagates as RateLimitError", async () => {
    const { fs, backend, run } = setup();
    backend.failRunWithRateLimit(0, { kind: "rate_limit" });

    const result = await run(input());

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(RateLimitError);
    expect(repoFiles(fs)).toEqual([]);
  });

  it("a failed commit leaves both files in place and fails as ArtifactCommitFailedError", async () => {
    const { fs, git, run } = setup(JSON.stringify(SPEC_DOCUMENT));
    git.failNextCommitPaths("pre-commit hook failed");

    const result = await run(input());

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactCommitFailedError);
      if (result.left instanceof ArtifactCommitFailedError) {
        expect(result.left.paths).toEqual([SPEC_PATH, SPEC_SIDECAR]);
        expect(result.left.cause).toContain("pre-commit hook failed");
      }
    }
    expect(repoFiles(fs)).toEqual([SPEC_SIDECAR, SPEC_PATH]);
  });
});

function recordWrites(git: ReturnType<typeof makeFakeGit>["impl"]) {
  return git.calls.flatMap((call) => (call.method === "writeTreeCommit" ? [call] : []));
}

describe("authorArtifact — authoring record", () => {
  const TRANSCRIPT = '{"type":"result","result":"{}"}\n';

  it("a committed session writes its record after the artifact commit, pointing back to it", async () => {
    const { fs, git, run } = setup(JSON.stringify(SPEC_DOCUMENT));
    fs.setFile(`${SESSION_FOLDER}/output.jsonl`, TRANSCRIPT);

    const result = await run(input({ records: RECORDS_IN_REPO }));

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;
    const writes = recordWrites(git);
    expect(writes).toHaveLength(1);
    const [write] = writes;
    expect(write?.branch).toBe("phax/records/v1");
    expect(write?.repo).toBe(REPO_ROOT);
    expect(write?.paths).toEqual([
      "authoring/2609230835-plan-prune/brief.md",
      "authoring/2609230835-plan-prune/document.json",
      "authoring/2609230835-plan-prune/output.jsonl",
      "authoring/2609230835-plan-prune/prompt.md",
      "authoring/2609230835-plan-prune/record.json",
    ]);
    expect(write?.message).toMatch(/^records\(authoring\): committed\n/);
    expect(write?.message).toContain("\nAuthoring-Id: 2609230835-plan-prune\n");
    expect(write?.message).toContain(`\nArtifact: ${SPEC_PATH}\n`);

    // The artifact commit precedes the record write.
    const commitIndex = git.calls.findIndex((call) => call.method === "commitPaths");
    const recordIndex = git.calls.findIndex((call) => call.method === "writeTreeCommit");
    expect(commitIndex).toBeGreaterThanOrEqual(0);
    expect(recordIndex).toBeGreaterThan(commitIndex);

    expect(result.right.record).toMatchObject({
      kind: "written",
      key: "authoring/2609230835-plan-prune",
      shape: "full",
    });
  });

  it("a failed session is still recorded — failed, no document — and the failure re-raised", async () => {
    const { fs, git, run } = setup("Here is your spec: it is great.");
    fs.setFile(`${SESSION_FOLDER}/output.jsonl`, TRANSCRIPT);

    const result = await run(input({ records: RECORDS_IN_REPO }));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(AuthoringDocumentError);
    expect(git.calls.some((call) => call.method === "commitPaths")).toBe(false);
    const writes = recordWrites(git);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.message).toMatch(/^records\(authoring\): failed\n/);
    expect(writes[0]?.paths).not.toContain("authoring/2609230835-plan-prune/document.json");
    expect(writes[0]?.paths).toContain("authoring/2609230835-plan-prune/prompt.md");
  });

  it("an agent failure is recorded as failed", async () => {
    const { git, backend, run } = setup();
    backend.failRunWithRateLimit(0, { kind: "rate_limit" });

    const result = await run(input({ records: RECORDS_IN_REPO }));

    expect(Either.isLeft(result) && result.left instanceof RateLimitError).toBe(true);
    const writes = recordWrites(git);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.message).toMatch(/^records\(authoring\): failed\n/);
  });

  it("a failed session's record warning goes to the output port", async () => {
    const { run } = setup("not json");
    const warnings: string[] = [];

    const result = await run(
      input({
        records: {
          ...RECORDS_IN_REPO,
          destination: { kind: "repo", remote: "https://example.com/records.git" },
        },
        output: { warn: (message) => warnings.push(message) },
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    expect(warnings).toEqual([
      "authoring record not written — the dedicated records clone is not configured (run `phax records sync`)",
    ]);
  });

  it("a refusal before the session records nothing", async () => {
    const { fs, git, run } = setup(JSON.stringify(SPEC_DOCUMENT));
    fs.setFile(SPEC_SIDECAR, "{}");

    const result = await run(input({ records: RECORDS_IN_REPO }));

    expect(Either.isLeft(result)).toBe(true);
    expect(recordWrites(git)).toHaveLength(0);
  });

  it("records off writes no record", async () => {
    const { git, run } = setup(JSON.stringify(SPEC_DOCUMENT));

    const result = await run(input());

    expect(Either.isRight(result) && result.right.record.kind).toBe("records-off");
    expect(recordWrites(git)).toHaveLength(0);
  });

  it("a record that cannot be written never fails the authoring", async () => {
    const { git, run } = setup(JSON.stringify(SPEC_DOCUMENT));

    const result = await run(
      input({
        records: {
          ...RECORDS_IN_REPO,
          destination: { kind: "repo", remote: "https://example.com/records.git" },
        },
      }),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.record).toEqual({ kind: "deferred-destination", destination: "repo" });
    }
    expect(git.calls.some((call) => call.method === "commitPaths")).toBe(true);
    expect(recordWrites(git)).toHaveLength(0);
  });
});

function code(result: Either.Either<unknown, unknown>): number {
  return Either.isLeft(result) ? exitCodeForAuthoringError(result.left) : 0;
}

describe("authorArtifact — exit codes", () => {
  it("maps each failure family to the spec's exit code", async () => {
    const notJson = await setup("not json").run(input());
    const refused = setup(JSON.stringify(SPEC_DOCUMENT));
    refused.fs.setFile(SPEC_SIDECAR, "{}");
    const sidecarExists = await refused.run(input());
    const limited = setup();
    limited.backend.failRunWithRateLimit(0, { kind: "usage_limit" });
    const usageLimit = await limited.run(input());
    const failedCommit = setup(JSON.stringify(SPEC_DOCUMENT));
    failedCommit.git.failNextCommitPaths("hook failed");
    const commitFailed = await failedCommit.run(input());

    expect(code(notJson)).toBe(5);
    expect(code(sidecarExists)).toBe(12);
    expect(code(usageLimit)).toBe(8);
    expect(code(commitFailed)).toBe(12);
  });

  it("leaves a transition's failed commit on its generic exit code", () => {
    const err = new ArtifactCommitFailedError({ paths: [SPEC_PATH], cause: "hook failed" });
    expect(exitCodeForError(err)).toBe(1);
  });
});
