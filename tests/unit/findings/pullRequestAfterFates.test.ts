import { Effect, Layer, Result } from "effect";
import { describe, expect, it } from "vitest";
import type { ResolvedFindingRun } from "../../../src/app/findingList.js";
import {
  FindingPullRequestNotUpdatedError,
  pullRequestAfterFates,
} from "../../../src/app/findingPullRequest.js";
import type { PrFinding } from "../../../src/domain/publish/prFindings.js";
import { makeFakeFileSystem } from "../../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../../src/infra/fakes/github.js";
import type { PullRequestState } from "../../../src/ports/github.js";
import { type ResolvedConfig, resolvePublishConfig } from "../../../src/schemas/phaxConfig.js";

// A fix reaches only an open pull request: on a merged or closed one, or when its state cannot be
// read, nothing is pushed and nothing commented, while the records and the commit the caller
// made stay. dismiss and defer comment whatever the state, and never ask it.

const PR = "https://github.com/acme/shop/pull/42";
const RUN_FOLDER = "/state/runs/gate-retry";
const WORKTREE = "/worktrees/gate-retry";
const SHA = "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432";
const at = "2026-01-01T00:00:00.000Z";
const operator = { kind: "operator", name: "Ada Lovelace" } as const;

const fixedFinding: PrFinding = {
  id: "F2",
  source: "code-review",
  severity: "concern",
  file: "src/gate.ts",
  line: 7,
  message: "The gate drops the exit code",
  lens: "core",
  escape: "omission",
  criterion: null,
  suggestion: "Keep it.",
  fate: "fixed",
  history: [{ fate: "fixed", commit: SHA, pathClasses: ["code"], by: operator, at }],
};

const run: ResolvedFindingRun = {
  namespace: "acme",
  shortName: "gate-retry",
  runId: "gate-retry-1",
  state: "review_open",
  runFolder: RUN_FOLDER,
  source: { kind: "off" },
  target: { kind: "unresolved", reason: "not needed here" },
  worktreePath: WORKTREE,
  runBranch: "phax/gate-retry--phase-01",
  notes: [],
};

const config = {
  repoRoot: "/repo",
  publish: resolvePublishConfig({ auto: true }),
} as ResolvedConfig;

function setUp(state: PullRequestState | "fails") {
  const fs = makeFakeFileSystem();
  fs.impl.setFile(
    `${RUN_FOLDER}/publication.json`,
    JSON.stringify({
      version: 1,
      enabled: true,
      provider: "github",
      remote: "origin",
      branch: run.runBranch,
      pushStatus: "pushed",
      prStatus: "created",
      pullRequestUrl: PR,
      createdAt: at,
    }),
  );
  fs.impl.addDir(WORKTREE);
  const git = makeFakeGit();
  const github = makeFakeGitHub();
  if (state === "fails") github.impl.failNextPullRequestState("gh: offline");
  else github.impl.setPullRequestState(state);
  return { git, github, layer: Layer.mergeAll(fs.layer, git.layer, github.layer) };
}

const settle = (verb: "fix" | "dismiss" | "defer", layer: ReturnType<typeof setUp>["layer"]) =>
  Effect.runPromise(
    Effect.result(
      pullRequestAfterFates({
        ref: "gate-retry",
        run,
        verb,
        findings: [fixedFinding],
        recorded: ["F2"],
        commit: verb === "fix" ? SHA : null,
        config,
      }).pipe(Effect.provide(layer)),
    ),
  );

describe("pullRequestAfterFates and the pull request's state", () => {
  it.each([
    ["merged", "pull-request-merged"],
    ["closed", "pull-request-closed"],
  ] as const)("a fix on a %s pull request pushes and comments nothing", async (state, reason) => {
    const { git, github, layer } = setUp(state);

    const result = await settle("fix", layer);

    expect(result).toEqual(Result.succeed({ kind: "not-posted", reason }));
    expect(github.impl.calls).toEqual([
      { method: "pullRequestState", pullRequest: PR, repo: WORKTREE },
    ]);
    expect(git.impl.calls.filter((call) => call.method === "pushBranch")).toEqual([]);
  });

  it("a fix on an open pull request asks its state, then pushes and comments", async () => {
    const { git, github, layer } = setUp("open");

    const result = await settle("fix", layer);

    expect(Result.isSuccess(result)).toBe(true);
    expect(Result.getOrNull(result)).toMatchObject({
      kind: "posted",
      url: PR,
      comments: [{ finding: "F2" }],
    });
    expect(github.impl.calls.map((call) => call.method)).toEqual([
      "pullRequestState",
      "commentOnPullRequest",
    ]);
    expect(git.impl.calls.filter((call) => call.method === "pushBranch")).toHaveLength(1);
  });

  it("a state that cannot be read pushes and comments nothing, and names the post retry", async () => {
    const { git, github, layer } = setUp("fails");

    const result = await settle("fix", layer);

    const error = Result.flip(result).pipe(Result.getOrNull);
    expect(error).toBeInstanceOf(FindingPullRequestNotUpdatedError);
    expect(error).toMatchObject({
      pullRequest: PR,
      commit: SHA,
      recorded: ["F2"],
      pushed: false,
      posted: [],
      unposted: ["F2"],
      retry: "phax finding post gate-retry F2",
    });
    expect(error?.message).toContain("could not read its state (gh: offline)");
    expect(error?.message).toContain("the fates of F2 are recorded");
    expect(error?.message).toContain(`the commit ${SHA.slice(0, 7)} stays`);
    expect(error?.message).toContain("nothing was pushed or commented");
    expect(github.impl.calls.map((call) => call.method)).toEqual(["pullRequestState"]);
    expect(git.impl.calls.filter((call) => call.method === "pushBranch")).toEqual([]);
  });

  it.each(["dismiss", "defer"] as const)(
    "%s comments on a merged pull request without asking its state",
    async (verb) => {
      const { git, github, layer } = setUp("merged");

      const result = await settle(verb, layer);

      expect(Result.getOrNull(result)).toMatchObject({ kind: "posted", pushed: null });
      expect(github.impl.calls.map((call) => call.method)).toEqual(["commentOnPullRequest"]);
      expect(git.impl.calls.filter((call) => call.method === "pushBranch")).toEqual([]);
    },
  );
});
