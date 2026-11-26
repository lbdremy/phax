import { describe, expect, it } from "vitest";
import {
  type BranchFacts,
  type BranchStep,
  decideFollow,
  type FollowDecision,
  type FollowMatch,
  followMatchOf,
  followSubject,
  type Landed,
  notFound,
  resolveOnBranch,
} from "../../../src/domain/findings/landed.js";

type RangeCommitFacts = NonNullable<BranchFacts["range"]>[number];

// Where a fix landed, from branch facts alone (spec finding-fix-identity §5.3 to §5.8): the
// recorded commit, then the fate key, then the patch id; one match is found, several are
// ambiguous, none goes on. The use case gathers each fact only when a step asks for it.

const RUN_ID = "gate-retry-1700000000000";
const KEY = { runId: RUN_ID, findingId: "F2" };
const START = "2026-11-01T10:00:00.000Z";
const RECORDED = "a".repeat(40);
const sha = (c: string) => c.repeat(40);

const keyMessage = (finding = "F2", run = RUN_ID) =>
  `fix(review): ${finding} of gate-retry\n\nShort-Name: gate-retry\nFinding-Run: ${run}\nFinding: ${finding}\n`;

const commit = (
  c: string,
  message = "chore: unrelated",
  committedAt = "2026-11-02T09:00:00+01:00",
): RangeCommitFacts => ({ sha: sha(c), committedAt, message });

const facts = (over: Partial<BranchFacts> = {}): BranchFacts => ({
  branch: "main",
  recorded: RECORDED,
  key: KEY,
  recordedReachable: false,
  startedAt: START,
  range: [],
  recordedHeld: true,
  patchIds: { recorded: "p-recorded", range: new Map() },
  ...over,
});

const landed = (value: Landed): BranchStep => ({ kind: "landed", landed: value });
const found = (by: "recorded" | "key" | "patch-id", c: string, branch = "main"): BranchStep =>
  landed({ status: "found", by, commit: c, branch, recorded: RECORDED });
const NONE: BranchStep = { kind: "none" };

describe("resolveOnBranch", () => {
  const cases: ReadonlyArray<readonly [string, BranchFacts, BranchStep]> = [
    [
      "recorded reachable: found by recorded, whatever the range holds",
      facts({ recordedReachable: true, range: [commit("b", keyMessage())] }),
      found("recorded", RECORDED),
    ],
    [
      "recorded reachable with no start time: still found by recorded",
      facts({ recordedReachable: true, startedAt: null, range: undefined }),
      found("recorded", RECORDED),
    ],
    [
      "no start time: only the recorded step runs",
      facts({ startedAt: null, range: undefined, patchIds: undefined }),
      NONE,
    ],
    ["range not gathered yet: asks for it", facts({ range: undefined }), { kind: "needs-range" }],
    [
      "one commit carries the key: found by key",
      facts({ range: [commit("b"), commit("c", keyMessage())] }),
      found("key", sha("c")),
    ],
    [
      "two commits carry the key: ambiguous, oldest first, never the latest",
      facts({ range: [commit("b", keyMessage()), commit("d"), commit("c", keyMessage())] }),
      landed({
        status: "ambiguous",
        commits: [sha("b"), sha("c")],
        branch: "main",
        recorded: RECORDED,
      }),
    ],
    [
      "a key match wins over a patch-id match",
      facts({
        range: [commit("b", keyMessage()), commit("c")],
        patchIds: { recorded: "p-recorded", range: new Map([[sha("c"), "p-recorded"]]) },
      }),
      found("key", sha("b")),
    ],
    [
      "no key match, patch ids not gathered yet: asks for them",
      facts({ range: [commit("b")], patchIds: undefined }),
      { kind: "needs-patch-ids" },
    ],
    [
      "no key match, recorded not held: no patch-id step",
      facts({ range: [commit("b")], recordedHeld: false, patchIds: undefined }),
      NONE,
    ],
    [
      "one patch-id match: found by patch id",
      facts({
        range: [commit("b"), commit("c")],
        patchIds: { recorded: "p-recorded", range: new Map([[sha("c"), "p-recorded"]]) },
      }),
      found("patch-id", sha("c")),
    ],
    [
      "two patch-id matches: ambiguous",
      facts({
        range: [commit("b"), commit("c")],
        patchIds: {
          recorded: "p-recorded",
          range: new Map([
            [sha("b"), "p-recorded"],
            [sha("c"), "p-recorded"],
          ]),
        },
      }),
      landed({
        status: "ambiguous",
        commits: [sha("b"), sha("c")],
        branch: "main",
        recorded: RECORDED,
      }),
    ],
    [
      "no patch-id match: nothing",
      facts({
        range: [commit("b")],
        patchIds: { recorded: "p-recorded", range: new Map([[sha("b"), "p-other"]]) },
      }),
      NONE,
    ],
    [
      "the recorded commit has an empty diff: no patch-id match",
      facts({
        range: [commit("b")],
        patchIds: { recorded: undefined, range: new Map([[sha("b"), "p-recorded"]]) },
      }),
      NONE,
    ],
    [
      "a key match on the run's branch names that branch",
      facts({ branch: "phax/gate-retry--phase-02", range: [commit("c", keyMessage())] }),
      found("key", sha("c"), "phax/gate-retry--phase-02"),
    ],
    [
      "a commit before the run's start never matches by key",
      facts({ range: [commit("b", keyMessage(), "2026-11-01T09:59:59.999Z")] }),
      NONE,
    ],
    [
      "a commit before the run's start never matches by patch id",
      facts({
        range: [commit("b", "chore: same diff", "2026-10-01T10:00:00+00:00")],
        patchIds: { recorded: "p-recorded", range: new Map([[sha("b"), "p-recorded"]]) },
      }),
      NONE,
    ],
    [
      "a commit at the run's start, to the millisecond, counts",
      facts({ range: [commit("b", keyMessage(), "2026-11-01T11:00:00+01:00")] }),
      found("key", sha("b")),
    ],
  ];

  it.each(cases)("%s", (_name, given, expected) => {
    expect(resolveOnBranch(given)).toEqual(expected);
  });

  // Metamorphic: an irrelevant commit, or one made before the start, changes no answer.
  it.each(cases)("%s — unchanged by an irrelevant or earlier commit", (_name, given, expected) => {
    if (given.range === undefined) return;
    const noise = [
      commit("e", "docs: unrelated\n\nFinding-Run: other-run\nFinding: F2"),
      commit("f", keyMessage(), "2026-10-31T23:00:00Z"),
    ];
    const patchIds =
      given.patchIds === undefined
        ? undefined
        : {
            recorded: given.patchIds.recorded,
            range: new Map([
              ...given.patchIds.range,
              [sha("e"), "p-other"],
              [sha("f"), given.patchIds.recorded ?? "p-none"],
            ]),
          };
    for (const range of [
      [...noise, ...given.range],
      [...given.range, ...noise],
    ]) {
      expect(resolveOnBranch({ ...given, range, patchIds })).toEqual(expected);
    }
  });
});

describe("notFound", () => {
  it("names every branch looked for and the recorded sha", () => {
    expect(notFound(["main", "phax/gate-retry--phase-02"], RECORDED)).toEqual({
      status: "not-found",
      branches: ["main", "phax/gate-retry--phase-02"],
      recorded: RECORDED,
    });
  });
});

describe("a commit carries the fate key", () => {
  const cases: ReadonlyArray<readonly [string, string, boolean]> = [
    ["phax's own trailers", keyMessage(), true],
    ["trailers in a middle paragraph", `fix\n\nFinding-Run: ${RUN_ID}\nFinding: F2\n\nmore`, true],
    [
      "the key in one of several squashed messages",
      `Squash (#7)\n\n* fix F1\n\nShort-Name: gate-retry\nFinding-Run: ${RUN_ID}\nFinding: F1\n\n* fix F2\n\nShort-Name: gate-retry\nFinding-Run: ${RUN_ID}\nFinding: F2\n`,
      true,
    ],
    [
      "one paragraph naming two findings",
      `fix\n\nFinding-Run: ${RUN_ID}\nFinding: F1\nFinding: F2`,
      true,
    ],
    ["CRLF line ends", `fix\r\n\r\nFinding-Run: ${RUN_ID}\r\nFinding: F2\r\n`, true],
    ["trailing whitespace on the lines", `fix\n\nFinding-Run: ${RUN_ID}  \nFinding: F2\t\n`, true],
    [
      "a blank line holding only spaces splits paragraphs",
      `Finding-Run: ${RUN_ID}\n   \nFinding: F2`,
      false,
    ],
    ["the two lines in different paragraphs", `Finding-Run: ${RUN_ID}\n\nFinding: F2`, false],
    ["another run", keyMessage("F2", "other-run-1"), false],
    ["another finding", keyMessage("F20"), false],
    ["a lower-case key", `fix\n\nfinding-run: ${RUN_ID}\nfinding: F2`, false],
    ["leading whitespace on a line", `fix\n\n Finding-Run: ${RUN_ID}\nFinding: F2`, false],
    ["Finding-Run alone", `fix\n\nFinding-Run: ${RUN_ID}`, false],
    [
      "Finding alone (a fix commit made before Finding-Run)",
      "fix\n\nShort-Name: gate-retry\nFinding: F2",
      false,
    ],
    ["an empty message", "", false],
  ];

  // The key is read by the key step: one commit carrying it is found by key, else nothing (the
  // recorded commit not held, so no patch-id step runs).
  it.each(cases)("%s", (_name, message, carries) => {
    const step = resolveOnBranch(
      facts({ range: [commit("b", message)], recordedHeld: false, patchIds: undefined }),
    );
    expect(step).toEqual(carries ? found("key", sha("b")) : NONE);
  });
});

// Following a named commit on the base branch (spec §5.15, §5.16): one commit for every named
// finding, or a refusal naming every candidate.
describe("decideFollow", () => {
  const SUBJECT = "1111111 is on neither phax/gate-retry--phase-02 nor main";
  const decide = (matches: readonly FollowMatch[], held: boolean) =>
    decideFollow({
      subject: SUBJECT,
      base: "main",
      runId: RUN_ID,
      held,
      matches,
      unsearched: null,
    });
  const one = (id: string, c: string, by: "key" | "patch-id" = "key"): FollowMatch => ({
    id,
    match: { by, commits: [sha(c)] },
  });
  const many = (id: string, by: "key" | "patch-id", ...cs: string[]): FollowMatch => ({
    id,
    match: { by, commits: cs.map(sha) },
  });
  const nothing = (id: string): FollowMatch => ({ id, match: null });
  const refused = (message: string): FollowDecision => ({ kind: "refused", message });
  const follow = (
    c: string,
    ...matches: ReadonlyArray<readonly [string, "key" | "patch-id"]>
  ): FollowDecision => ({
    kind: "follow",
    commit: sha(c),
    matches: matches.map(([finding, by]) => ({ finding, by })),
  });

  const cases: ReadonlyArray<readonly [string, readonly FollowMatch[], boolean, FollowDecision]> = [
    ["one finding, one commit by key", [one("F2", "b")], true, follow("b", ["F2", "key"])],
    [
      "one finding, one commit by patch id",
      [one("F2", "b", "patch-id")],
      true,
      follow("b", ["F2", "patch-id"]),
    ],
    [
      "two findings, the same commit by key",
      [one("F2", "b"), one("F5", "b")],
      true,
      follow("b", ["F2", "key"], ["F5", "key"]),
    ],
    [
      "two findings, the same commit, one by patch id: each by its own step",
      [one("F2", "b", "patch-id"), one("F5", "b")],
      true,
      follow("b", ["F2", "patch-id"], ["F5", "key"]),
    ],
    [
      "nothing for a held commit",
      [nothing("F2"), nothing("F5")],
      true,
      refused(
        `${SUBJECT}, and no commit of main since the run started carries ${RUN_ID} F2, F5 or has its patch id: name a commit of the run branch or of the base branch with --commit (after a merge on the forge, update main first, for example with git pull)`,
      ),
    ],
    [
      "nothing for a commit not held: no patch id",
      [nothing("F2")],
      false,
      refused(
        `${SUBJECT}, and no commit of main since the run started carries ${RUN_ID} F2: name a commit of the run branch or of the base branch with --commit (after a merge on the forge, update main first, for example with git pull)`,
      ),
    ],
    [
      "two commits carry the key",
      [many("F2", "key", "b", "c")],
      true,
      refused(
        `${SUBJECT}, and 2 commits of main carry ${RUN_ID} F2: bbbbbbb, ccccccc. Name one with --commit`,
      ),
    ],
    [
      "two commits have the patch id, named once for two findings",
      [many("F2", "patch-id", "b", "c"), many("F5", "patch-id", "b", "c")],
      true,
      refused(
        `${SUBJECT}, and 2 commits of main have its patch id: bbbbbbb, ccccccc. Name one with --commit`,
      ),
    ],
    [
      "different commits per finding",
      [one("F2", "b"), one("F5", "c")],
      true,
      refused(
        `${SUBJECT}, and the named findings resolve to different commits of main: F2 → bbbbbbb, F5 → ccccccc. Name one with --commit`,
      ),
    ],
    [
      "one found, another nothing",
      [one("F2", "b"), nothing("F5")],
      false,
      refused(
        `${SUBJECT}, and F2 resolves to bbbbbbb; no commit of main since the run started carries ${RUN_ID} F5. Name one with --commit`,
      ),
    ],
    [
      "one found, another several",
      [one("F2", "b"), many("F5", "key", "c", "d")],
      true,
      refused(
        `${SUBJECT}, and 2 commits of main carry ${RUN_ID} F5: ccccccc, ddddddd; F2 resolves to bbbbbbb. Name one with --commit`,
      ),
    ],
  ];

  it.each(cases)("%s", (_name, matches, held, expected) => {
    expect(decide(matches, held)).toEqual(expected);
  });

  it.each(cases)("%s — a refusal names every candidate", (_name, matches, held) => {
    const decision = decide(matches, held);
    if (decision.kind !== "refused") return;
    for (const m of matches) {
      for (const c of m.match?.commits ?? []) expect(decision.message).toContain(c.slice(0, 7));
    }
  });

  it("says the base branch was not searched instead of claiming nothing matched", () => {
    const reason =
      "the run's start time cannot be read (run-status.json, or the registry for an archived run)";
    expect(
      decideFollow({
        subject: SUBJECT,
        base: "main",
        runId: RUN_ID,
        held: true,
        matches: [nothing("F2")],
        unsearched: reason,
      }),
    ).toEqual(
      refused(
        `${SUBJECT}, and main could not be searched: ${reason}. Name a commit of the run branch or of the base branch with --commit`,
      ),
    );
  });
});

describe("followMatchOf", () => {
  it.each([
    ["one key match", facts({ range: [commit("b", keyMessage())] }), "key", ["b"]],
    [
      "two key matches",
      facts({ range: [commit("b", keyMessage()), commit("c", keyMessage())] }),
      "key",
      ["b", "c"],
    ],
    [
      "two patch-id matches",
      facts({
        range: [commit("b"), commit("c")],
        patchIds: {
          recorded: "p",
          range: new Map([
            [sha("b"), "p"],
            [sha("c"), "p"],
          ]),
        },
      }),
      "patch-id",
      ["b", "c"],
    ],
  ] as const)("reads %s", (_name, given, by, cs) => {
    expect(followMatchOf(given, resolveOnBranch(given))).toEqual({ by, commits: cs.map(sha) });
  });

  it("reads no match as null", () => {
    const given = facts({ range: [commit("b")] });
    expect(followMatchOf(given, resolveOnBranch(given))).toBeNull();
  });
});

describe("followSubject", () => {
  it("names a held commit by its short sha and the branches, any other value as given", () => {
    expect(followSubject("1".repeat(40), ["phax/x--phase-02", "main"])).toBe(
      "1111111 is on neither phax/x--phase-02 nor main",
    );
    expect(followSubject("abc1234", null)).toBe("abc1234 is not in the repository");
  });
});
