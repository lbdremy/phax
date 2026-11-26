import { describe, expect, it } from "vitest";
import {
  type BranchFacts,
  type BranchStep,
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
