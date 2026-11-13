import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  type ObservedWriter,
  type RunWriterInput,
  chooseWriterSession,
  diffAnswer,
  landAnswer,
  runWriter,
} from "../../src/app/headlessWriter.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { UsageLimitError } from "../../src/domain/errors.js";
import type { ProviderId } from "../../src/domain/routing/types.js";
import { resolveReviewSecurityPolicy } from "../../src/domain/security/resolveReviewPolicy.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import type { AgentRunResult, Backend } from "../../src/ports/backend.js";
import {
  KEPT_FIRST_SESSION,
  KEPT_SESSION,
  RETRY_SESSION,
  WRITER_SESSION,
  useDecideRepo,
} from "../helpers/decideVerdictsHarness.js";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => actual.tmpdir() };
});

// The shared writer path, through the parameters decide's own suites do not
// pin: the choice of session, the second refusal and the limits of the writer
// turn, and a change made to the artifact while the writer ran.

const world = useDecideRepo();
const ARTIFACT_ID = "20261025-1000-logs";
const PATH = "docs/specs/logs.md";

const layerFor = (backendLayer: Layer.Layer<Backend>) =>
  Layer.mergeAll(makeRootedNodeFileSystemLayer(world.repoDir), NodeGitLayer, backendLayer);

describe("chooseWriterSession", () => {
  const choose = (provider: ProviderId = "claude-code") =>
    Effect.runPromise(
      chooseWriterSession({
        stateRoot: world.stateRoot,
        repoRoot: world.repoDir,
        artifactId: ARTIFACT_ID,
        provider,
      }).pipe(Effect.provide(makeRootedNodeFileSystemLayer(world.repoDir))),
    );

  const other = realpathSync(mkdtempSync(join(tmpdir(), "phax-writer-other-")));

  const table: ReadonlyArray<{
    readonly name: string;
    readonly keep: () => void;
    readonly provider?: ProviderId;
    readonly expected: { kind: "new" | "resume"; id: string | null; keptIds: string[] };
  }> = [
    {
      name: "no session.json starts a new session",
      keep: () => undefined,
      expected: { kind: "new", id: null, keptIds: [] },
    },
    {
      name: "an undecodable session.json starts a new session",
      keep: () => {
        const folder = join(world.stateRoot, "authoring", ARTIFACT_ID);
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, "session.json"), "{ not json");
      },
      expected: { kind: "new", id: null, keptIds: [] },
    },
    {
      name: "a session kept on another provider starts a new session",
      keep: () => world.keepAuthoringSession(ARTIFACT_ID, { provider: "codex" }),
      expected: { kind: "new", id: null, keptIds: [] },
    },
    {
      name: "a session kept in another checkout starts a new session",
      keep: () => world.keepAuthoringSession(ARTIFACT_ID, { cwd: other }),
      expected: { kind: "new", id: null, keptIds: [] },
    },
    {
      name: "a match resumes the retry session, keeping both ids",
      keep: () => world.keepAuthoringSession(ARTIFACT_ID),
      expected: { kind: "resume", id: KEPT_SESSION, keptIds: [KEPT_FIRST_SESSION, KEPT_SESSION] },
    },
    {
      name: "a match without a retry id resumes the first session",
      keep: () => world.keepAuthoringSession(ARTIFACT_ID, { retrySessionId: null }),
      expected: { kind: "resume", id: KEPT_FIRST_SESSION, keptIds: [KEPT_FIRST_SESSION] },
    },
  ];

  for (const row of table) {
    it(row.name, async () => {
      row.keep();
      const session = await choose(row.provider);
      expect(session).toEqual(row.expected);
    });
  }
});

describe("runWriter", () => {
  class Twice extends Error {
    readonly _tag = "Twice";
    constructor(
      readonly at: string,
      message: string,
    ) {
      super(message);
    }
  }

  function setup(kept: boolean) {
    if (kept) world.keepAuthoringSession(ARTIFACT_ID);
    const backend = makeFakeBackend();
    const folder = join(world.stateRoot, "writer");
    mkdirSync(folder, { recursive: true });
    const observed: ObservedWriter<string> = { retried: false, sessionIds: [], accepted: null };
    const warnings: string[] = [];
    const security = resolveReviewSecurityPolicy({
      mode: "secure",
      worktreePath: world.repoDir,
      config: {
        profile: "secure",
        filesystem: { allowRead: [], allowWrite: [] },
        network: { profile: "provider-only" },
        mcp: { mode: "disabled", allow: [] },
        agentCommands: [],
      },
    });
    const input = (
      session: RunWriterInput<string, Twice>["session"],
    ): RunWriterInput<string, Twice> => ({
      session,
      prompt: "write it",
      folder,
      options: {
        provider: "claude-code",
        model: "claude-sonnet-5-5",
        effort: "medium",
        cwd: world.repoDir,
        security,
      },
      check: (result: AgentRunResult) =>
        result.finalText === "good"
          ? Result.succeed("good")
          : Result.fail({ path: "doc", message: `bad: ${result.finalText}` }),
      retryPrompt: (refusal) => `again: ${refusal}`,
      refusedWarning: (refusal) => `refused ${refusal}`,
      rejectedTwice: (path, message) => new Twice(path, message),
      transcriptFileName: "output.jsonl",
      retryPromptFileName: "retry-prompt.md",
      retryTranscriptFileName: "retry-output.jsonl",
      observed,
      warn: (m) => warnings.push(m),
    });
    const run = (session: RunWriterInput<string, Twice>["session"]) =>
      Effect.runPromise(
        Effect.result(runWriter(input(session)).pipe(Effect.provide(layerFor(backend.layer)))),
      );
    return { backend: backend.impl, observed, warnings, run, folder };
  }

  const fresh = { kind: "new", id: null, keptIds: [] } as const;
  const resume = {
    kind: "resume",
    id: KEPT_SESSION as ClaudeSessionId,
    keptIds: [KEPT_SESSION],
  } as const;

  it("fails through the caller's factory on a second refusal, naming both", async () => {
    const t = setup(false);
    t.backend.addRunResponse({
      sessionId: WRITER_SESSION as ClaudeSessionId,
      outputPath: "",
      finalText: "one",
    });
    t.backend.addResumeResponse({
      sessionId: RETRY_SESSION as ClaudeSessionId,
      outputPath: "",
      finalText: "two",
    });
    const result = await t.run(fresh);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isSuccess(result)) return;
    const error = result.failure as Twice;
    expect(error).toBeInstanceOf(Twice);
    expect(error.at).toBe("doc");
    expect(error.message).toContain("rejected twice");
    expect(error.message).toContain("bad: one");
    expect(error.message).toContain("bad: two");
    expect(t.backend.resumeCalls).toHaveLength(1);
    expect(t.backend.resumeCalls[0]?.sessionId).toBe(WRITER_SESSION);
    expect(t.backend.resumeCalls[0]?.prompt).toContain("again: ");
    expect(t.observed.retried).toBe(true);
    expect(t.observed.sessionIds).toEqual([WRITER_SESSION, RETRY_SESSION]);
    expect(t.observed.accepted).toBeNull();
    expect(t.warnings).toHaveLength(1);
    expect(readFileSync(join(t.folder, "retry-prompt.md"), "utf8")).toContain("again: ");
  });

  it("accepts the corrective resume's answer and runs every turn read-only", async () => {
    const t = setup(false);
    t.backend.addRunResponse({
      sessionId: WRITER_SESSION as ClaudeSessionId,
      outputPath: "",
      finalText: "one",
    });
    t.backend.addResumeResponse({
      sessionId: RETRY_SESSION as ClaudeSessionId,
      outputPath: "",
      finalText: "good",
    });
    const result = await t.run(fresh);
    expect(Result.isSuccess(result)).toBe(true);
    expect(t.observed.accepted).toBe("good");
    expect(t.backend.runCalls[0]?.options.readOnly).toBe(true);
    expect(t.backend.resumeCalls[0]?.options.readOnly).toBe(true);
  });

  it("resumes the kept session for the first turn and never retries an accepted answer", async () => {
    const t = setup(true);
    t.backend.addResumeResponse({
      sessionId: RETRY_SESSION as ClaudeSessionId,
      outputPath: "",
      finalText: "good",
    });
    const result = await t.run(resume);
    expect(Result.isSuccess(result)).toBe(true);
    expect(t.backend.runCalls).toEqual([]);
    expect(t.backend.resumeCalls).toHaveLength(1);
    expect(t.backend.resumeCalls[0]?.sessionId).toBe(KEPT_SESSION);
    expect(t.observed.retried).toBe(false);
  });

  it("never resumes after a usage limit on a new session", async () => {
    const t = setup(false);
    t.backend.failRunWithRateLimit(0, { kind: "usage_limit" });
    const result = await t.run(fresh);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isSuccess(result)) return;
    expect(result.failure).toBeInstanceOf(UsageLimitError);
    expect(t.backend.resumeCalls).toEqual([]);
    expect(t.observed.retried).toBe(false);
  });

  it("never retries a usage limit on the kept session's turn", async () => {
    const t = setup(true);
    t.backend.failNextResumeWithRateLimit({ kind: "usage_limit" });
    const result = await t.run(resume);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isSuccess(result)) return;
    expect(result.failure).toBeInstanceOf(UsageLimitError);
    expect(t.backend.resumeCalls).toHaveLength(1);
    expect(t.observed.retried).toBe(false);
  });
});

describe("diffAnswer and landAnswer", () => {
  class Changed extends Error {
    readonly _tag = "Changed";
    constructor(
      readonly at: string,
      readonly which: string,
    ) {
      super(`${at} changed`);
    }
  }

  const SEED = "# Logs\n\nbefore\n";
  const NEXT = "# Logs\n\nafter\n";

  function seed(): void {
    world.writeRepoFile(PATH, SEED);
    world.commitAll("add the artifact");
  }

  const landInput = (
    overrides: { snapshotSidecarText?: string | null; sidecarText?: string | null } = {},
  ) => ({
    repoRoot: world.repoDir,
    stateRoot: world.stateRoot,
    path: PATH,
    snapshotMd: SEED,
    snapshotSidecarText: null,
    md: NEXT,
    sidecarText: null,
    planDocument: null,
    extractPlanModel: "claude-haiku-5-5",
    extractPlanEffort: "low",
    nowIso: "2026-10-25T10:00:00.000Z",
    commitMessage: { subject: "docs(specs): change logs", body: "Body line." },
    verbatimMessage: false,
    changed: (at: string, which: "artifact" | "sidecar") => new Changed(at, which),
    ...overrides,
  });

  const layer = () => Layer.mergeAll(makeRootedNodeFileSystemLayer(world.repoDir), NodeGitLayer);

  it("keeps the answer's files in the folder and returns the diff, writing nothing to the repository", async () => {
    seed();
    const head = world.headSha();
    const folder = join(world.stateRoot, "land");
    mkdirSync(folder, { recursive: true });
    const diff = await Effect.runPromise(
      diffAnswer({
        folder,
        repoRoot: world.repoDir,
        path: PATH,
        beforeMd: SEED,
        afterMd: NEXT,
        documentJson: "{}\n",
        fileNames: { document: "d.json", before: "b.md", after: "a.md", diff: "x.diff" },
      }).pipe(Effect.provide(layer())),
    );
    expect(diff).toContain("-before");
    expect(diff).toContain("+after");
    expect(readFileSync(join(folder, "x.diff"), "utf8")).toBe(diff);
    expect(readFileSync(join(folder, "d.json"), "utf8")).toBe("{}\n");
    expect(readFileSync(join(folder, "b.md"), "utf8")).toBe(SEED);
    expect(readFileSync(join(folder, "a.md"), "utf8")).toBe(NEXT);
    expect(world.headSha()).toBe(head);
    expect(world.porcelain()).toBe("");
  });

  it("writes the artifact and commits exactly it in one commit", async () => {
    seed();
    const landed = await Effect.runPromise(landAnswer(landInput()).pipe(Effect.provide(layer())));
    expect(landed.paths).toEqual([PATH]);
    expect(landed.commit.subject).toBe("docs(specs): change logs");
    expect(landed.commit.hash).toBe(world.headSha());
    expect(world.headFiles()).toEqual([PATH]);
    expect(world.readRepoFile(PATH)).toBe(NEXT);
    expect(world.git(["log", "-1", "--format=%b"]).trim()).toBe("Body line.");
  });

  it("refuses through the caller's changed when the artifact changed, leaving the change and HEAD", async () => {
    seed();
    const head = world.headSha();
    world.writeRepoFile(PATH, "# Logs\n\nsomeone else\n");
    const result = await Effect.runPromise(
      Effect.result(landAnswer(landInput()).pipe(Effect.provide(layer()))),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isSuccess(result)) return;
    expect(result.failure).toBeInstanceOf(Changed);
    const error = result.failure as Changed;
    expect(error.at).toBe(PATH);
    expect(error.which).toBe("artifact");
    expect(world.readRepoFile(PATH)).toBe("# Logs\n\nsomeone else\n");
    expect(world.headSha()).toBe(head);
  });

  it("names the sidecar when only the sidecar changed", async () => {
    world.writeRepoFile(PATH, SEED);
    world.writeRepoFile("docs/specs/logs.json", "{}\n");
    world.commitAll("add the artifact and its sidecar");
    const head = world.headSha();
    world.writeRepoFile("docs/specs/logs.json", '{"edited":true}\n');
    const result = await Effect.runPromise(
      Effect.result(
        landAnswer(landInput({ snapshotSidecarText: "{}\n", sidecarText: '{"next":1}\n' })).pipe(
          Effect.provide(layer()),
        ),
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isSuccess(result)) return;
    const error = result.failure as Changed;
    expect(error.which).toBe("sidecar");
    expect(error.at).toBe("docs/specs/logs.json");
    expect(world.readRepoFile(PATH)).toBe(SEED);
    expect(world.headSha()).toBe(head);
  });
});
