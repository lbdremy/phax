import { Effect, Layer, Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  FindingPullRequestNotUpdatedError,
  pushAndComment,
  type PushAndCommentInput,
} from "../../../src/app/findingPullRequest.js";
import type { PrFinding } from "../../../src/domain/publish/prFindings.js";
import { makeFakeFileSystem } from "../../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../../src/infra/fakes/github.js";

// One failed comment among several: the others are still posted, and the error and its retry name
// only the ids left, so `phax finding post` neither posts a comment twice nor leaves one out.

const PR = "https://github.com/acme/shop/pull/42";
const at = "2026-01-01T00:00:00.000Z";
const operator = { kind: "operator", name: "Ada Lovelace" } as const;

const dismissedFinding = (id: string, line: number): PrFinding => ({
  id,
  source: "code-review",
  severity: "concern",
  file: "src/gate.ts",
  line,
  message: `Finding ${id}`,
  lens: "core",
  escape: "omission",
  criterion: null,
  suggestion: "Cover it with a test.",
  fate: "dismissed",
  history: [
    {
      fate: "dismissed",
      verdict: {
        kind: "decided",
        chosen: "dismiss",
        abandoned: ["fix", "defer"],
        why: "not worth it",
        advocate: "Cover it with a test.",
        principles: [],
        reversibility: "cheap",
        by: operator,
        at,
        revised: [],
      },
    },
  ],
});

const input = (findings: readonly PrFinding[]): PushAndCommentInput => ({
  ref: "gate-retry",
  run: {
    namespace: "acme",
    shortName: "gate-retry",
    runId: "gate-retry-1",
    state: "review_open",
    runFolder: null,
    source: { kind: "off" },
    target: { kind: "unresolved", reason: "not needed here" },
    worktreePath: null,
    runBranch: null,
    notes: [],
  },
  pullRequest: PR,
  findings,
  push: false,
  remote: "origin",
  recorded: findings.map((finding) => finding.id),
  commit: null,
  repoRoot: "/made-up/repo",
});

describe("pushAndComment", () => {
  it("posts the rest when one comment fails, and names only the unposted ids and their retry", async () => {
    const github = makeFakeGitHub();
    github.impl.failNextComment("gh: rate limited");
    const layer = Layer.mergeAll(makeFakeFileSystem().layer, makeFakeGit().layer, github.layer);

    const result = await Effect.runPromise(
      Effect.result(
        pushAndComment(input([dismissedFinding("F3", 9), dismissedFinding("F5", 12)])).pipe(
          Effect.provide(layer),
        ),
      ),
    );

    const comments = github.impl.calls.filter((call) => call.method === "commentOnPullRequest");
    expect(comments).toHaveLength(2);
    expect(Result.isFailure(result)).toBe(true);
    const error = Result.flip(result).pipe(Result.getOrNull);
    expect(error).toBeInstanceOf(FindingPullRequestNotUpdatedError);
    expect(error?.posted).toEqual([{ finding: "F5", url: `${PR}#issuecomment-1` }]);
    expect(error?.unposted).toEqual(["F3"]);
    expect(error?.retry).toBe("phax finding post gate-retry F3");
    expect(error?.pushed).toBe(false);
    expect(error?.message).toContain("could not comment F3 (gh: rate limited)");
    expect(error?.message).toContain("Retry with: phax finding post gate-retry F3");
  });
});
