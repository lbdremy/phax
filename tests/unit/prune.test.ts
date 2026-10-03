import { Either } from "effect";
import { describe, expect, it } from "vitest";
import type { BranchName } from "../../src/domain/branded.js";
import {
  confirmationMode,
  decideRun,
  expectedRunBranches,
  formatBytes,
  isUnderRoot,
  parsePruneSelection,
  pruneExitCode,
  remoteTrackingRefsFor,
  runOwnedWorktreeRoots,
  selectPruneRuns,
  type PruneConfirmation,
  type PrunePlan,
  type PruneResult,
  type PruneRunFacts,
  type PruneRunReport,
} from "../../src/domain/prune.js";
import type { RegistryEntry } from "../../src/schemas/registry.js";

const ns = "phax";

const entry = (shortName: string, overrides?: Partial<RegistryEntry>): RegistryEntry => ({
  namespace: ns,
  shortName,
  runId: `${shortName}-2026-10-01`,
  state: "archived",
  branch: `phax/${shortName}`,
  projectName: "phax",
  phasesCount: 2,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  archivePath: `/state/archive/${ns}.${shortName}`,
  ...overrides,
});

const b = (name: string) => name as BranchName;

describe("parsePruneSelection", () => {
  it("refuses neither form, naming both accepted forms", () => {
    const result = parsePruneSelection([], false);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toContain("phax prune <short-name>...");
      expect(result.left).toContain("phax prune --all");
    }
  });

  it("refuses both forms, naming both accepted forms", () => {
    const result = parsePruneSelection(["old-idea"], true);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toContain("phax prune <short-name>...");
      expect(result.left).toContain("phax prune --all");
    }
  });

  it("selects names, deduplicated in order", () => {
    expect(parsePruneSelection(["a", "b", "a"], false)).toEqual(
      Either.right({ kind: "names", refs: ["a", "b"] }),
    );
  });

  it("selects all", () => {
    expect(parsePruneSelection([], true)).toEqual(Either.right({ kind: "all" }));
  });
});

describe("selectPruneRuns", () => {
  const entries = [
    entry("old-idea"),
    entry("live", { state: "review_open" }),
    entry("other", { namespace: "louloupapers" }),
    entry("older"),
    entry("running-one", { state: "running" }),
  ];

  it("refuses an unknown name as not-found", () => {
    const result = selectPruneRuns(entries, ns, { kind: "names", refs: ["ghost"] });
    expect(result).toEqual(
      Either.left([{ kind: "not-found", ref: "ghost", qualifiedName: "phax.ghost" }]),
    );
  });

  it("refuses a non-archived run with its state", () => {
    const result = selectPruneRuns(entries, ns, { kind: "names", refs: ["live"] });
    expect(result).toEqual(
      Either.left([
        {
          kind: "not-archived",
          ref: "live",
          qualifiedName: "phax.live",
          shortName: "live",
          state: "review_open",
        },
      ]),
    );
  });

  it("refuses a ref qualified with another namespace, even when it exists there", () => {
    const result = selectPruneRuns(entries, ns, {
      kind: "names",
      refs: ["louloupapers.other"],
    });
    expect(result).toEqual(
      Either.left([
        {
          kind: "other-namespace",
          ref: "louloupapers.other",
          qualifiedName: "louloupapers.other",
          namespace: "louloupapers",
        },
      ]),
    );
  });

  it("refuses an invalid ref", () => {
    const result = selectPruneRuns(entries, ns, { kind: "names", refs: ["Bad Name"] });
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left[0].kind).toBe("invalid");
  });

  it("resolves a ref qualified with the current namespace the same as the short form", () => {
    const short = selectPruneRuns(entries, ns, { kind: "names", refs: ["old-idea"] });
    const qualified = selectPruneRuns(entries, ns, { kind: "names", refs: ["phax.old-idea"] });
    expect(qualified).toEqual(short);
    expect(qualified).toEqual(Either.right([entries[0]]));
  });

  it("selects one run once when named both short and qualified", () => {
    const result = selectPruneRuns(entries, ns, {
      kind: "names",
      refs: ["old-idea", "phax.old-idea"],
    });
    expect(result).toEqual(Either.right([entries[0]]));
  });

  it("collects every refusal together", () => {
    const result = selectPruneRuns(entries, ns, {
      kind: "names",
      refs: ["old-idea", "ghost", "live", "louloupapers.other"],
    });
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.map((r) => r.kind)).toEqual([
        "not-found",
        "not-archived",
        "other-namespace",
      ]);
    }
  });

  it("all selects the namespace's archived entries in registry order", () => {
    const result = selectPruneRuns(entries, ns, { kind: "all" });
    expect(result).toEqual(Either.right([entries[0], entries[3]]));
  });

  it("all with nothing archived selects nothing", () => {
    const result = selectPruneRuns([entries[1]!], ns, { kind: "all" });
    expect(result).toEqual(Either.right([]));
  });
});

describe("expectedRunBranches", () => {
  it("expands phase branches up to phasesCount, run branch first", () => {
    expect(expectedRunBranches({ branch: "phax/x", phasesCount: 3 }, [])).toEqual([
      "phax/x",
      "phax/x--phase-01",
      "phax/x--phase-02",
      "phax/x--phase-03",
    ]);
  });

  it("adds present phase branches beyond phasesCount, sorted", () => {
    expect(
      expectedRunBranches({ branch: "phax/x", phasesCount: 1 }, [
        "phax/x--phase-04",
        "phax/x--phase-01",
        "main",
      ]),
    ).toEqual(["phax/x", "phax/x--phase-01", "phax/x--phase-04"]);
  });

  it("never matches a neighbour run, the records branch, or a malformed suffix", () => {
    expect(
      expectedRunBranches({ branch: "phax/x", phasesCount: 0 }, [
        "phax/x-2",
        "phax/x-2--phase-01",
        "phax/records/v1",
        "phax/x--phase-1",
        "phax/x--phase-001",
        "phax/xy--phase-01",
      ]),
    ).toEqual(["phax/x"]);
  });

  it("treats branch metacharacters literally", () => {
    expect(
      expectedRunBranches({ branch: "phax/a.b", phasesCount: 0 }, ["phax/aXb--phase-01"]),
    ).toEqual(["phax/a.b"]);
  });
});

describe("remoteTrackingRefsFor", () => {
  it("keeps the short form of matching refs and skips HEAD", () => {
    expect(
      remoteTrackingRefsFor(
        ["phax/x", "phax/x--phase-02"],
        [
          "refs/remotes/origin/HEAD",
          "refs/remotes/origin/main",
          "refs/remotes/origin/phax/x--phase-02",
          "refs/remotes/upstream/phax/x",
          "refs/remotes/origin/phax/x-2",
        ],
      ),
    ).toEqual(["origin/phax/x--phase-02", "upstream/phax/x"]);
  });
});

describe("runOwnedWorktreeRoots and isUnderRoot", () => {
  it("names the live worktrees folder and the archive folder", () => {
    expect(runOwnedWorktreeRoots("/state", ns, "x", "/state/archive/phax.x")).toEqual([
      "/state/worktrees/phax.x",
      "/state/archive/phax.x",
    ]);
  });

  it("is separator-aware", () => {
    expect(isUnderRoot("/state/worktrees/phax.x", "/state/worktrees/phax.x")).toBe(true);
    expect(isUnderRoot("/state/worktrees/phax.x/phase-01", "/state/worktrees/phax.x")).toBe(true);
    expect(isUnderRoot("/state/worktrees/phax.x-2/phase-01", "/state/worktrees/phax.x")).toBe(
      false,
    );
    expect(isUnderRoot("/state/worktrees", "/state/worktrees/phax.x")).toBe(false);
    expect(isUnderRoot("/elsewhere", "/state")).toBe(false);
  });
});

describe("decideRun", () => {
  const facts = (overrides?: Partial<PruneRunFacts>): PruneRunFacts => ({
    entry: entry("x"),
    archivePath: "/state/archive/phax.x",
    archiveBytes: 100,
    expectedBranches: [b("phax/x"), b("phax/x--phase-01"), b("phax/x--phase-02")],
    presentBranches: [b("phax/x"), b("phax/x--phase-01"), b("phax/x--phase-02")],
    unpreserved: [
      { branch: b("phax/x"), unpreservedCommits: 0 },
      { branch: b("phax/x--phase-01"), unpreservedCommits: 0 },
      { branch: b("phax/x--phase-02"), unpreservedCommits: 0 },
    ],
    worktrees: [{ path: "/repo", branch: "main", prunable: false }],
    ownedWorktreeRoots: ["/state/worktrees/phax.x", "/state/archive/phax.x"],
    remoteBranchesKept: [],
    ...overrides,
  });

  const withUnpreserved = {
    unpreserved: [
      { branch: b("phax/x"), unpreservedCommits: 0 },
      { branch: b("phax/x--phase-02"), unpreservedCommits: 2 },
    ],
  };

  it("prunes a run with nothing unpreserved and nothing checked out", () => {
    const run = decideRun(facts(), false);
    expect(run.outcome).toBe("would-prune");
    expect(run.kept).toBeNull();
    expect(run.branchesDiscarded).toEqual([]);
    expect(run.qualifiedName).toBe("phax.x");
  });

  it("keeps a run whose branch is checked out elsewhere, even with force", () => {
    const worktrees = [
      { path: "/repo", branch: "phax/x--phase-02", prunable: false },
      { path: "/other", branch: "main", prunable: false },
    ];
    for (const force of [false, true]) {
      const run = decideRun(facts({ worktrees, ...withUnpreserved }), force);
      expect(run.outcome).toBe("would-keep");
      expect(run.kept).toEqual({
        reason: "branch-checked-out",
        worktrees: [{ branch: "phax/x--phase-02", worktreePath: "/repo" }],
      });
    }
  });

  it("is not blocked by a run-owned or prunable worktree", () => {
    const worktrees = [
      {
        path: "/state/archive/phax.x/worktrees/phase-01",
        branch: "phax/x--phase-01",
        prunable: false,
      },
      { path: "/gone/somewhere", branch: "phax/x--phase-02", prunable: true },
    ];
    expect(decideRun(facts({ worktrees }), false).outcome).toBe("would-prune");
  });

  it("keeps a run with unpreserved commits without force", () => {
    const run = decideRun(facts(withUnpreserved), false);
    expect(run.outcome).toBe("would-keep");
    expect(run.kept).toEqual({
      reason: "unpreserved-commits",
      branches: [{ branch: "phax/x--phase-02", unpreservedCommits: 2 }],
    });
  });

  it("discards unpreserved commits with force", () => {
    const run = decideRun(facts(withUnpreserved), true);
    expect(run.outcome).toBe("would-prune");
    expect(run.kept).toBeNull();
    expect(run.branchesDiscarded).toEqual([{ branch: "phax/x--phase-02", unpreservedCommits: 2 }]);
  });
});

describe("confirmationMode", () => {
  type Flags = Parameters<typeof confirmationMode>[0];
  const cases = {
    "dry-run": [
      { dryRun: true, yes: false, json: false, stdinIsTTY: false },
      { dryRun: true, yes: true, json: true, stdinIsTTY: true },
    ],
    yes: [
      { dryRun: false, yes: true, json: false, stdinIsTTY: false },
      { dryRun: false, yes: true, json: true, stdinIsTTY: true },
    ],
    prompt: [{ dryRun: false, yes: false, json: false, stdinIsTTY: true }],
    missing: [
      { dryRun: false, yes: false, json: false, stdinIsTTY: false },
      { dryRun: false, yes: false, json: true, stdinIsTTY: true },
    ],
  } satisfies Record<PruneConfirmation, readonly Flags[]>;

  for (const [mode, flagSets] of Object.entries(cases)) {
    for (const flags of flagSets) {
      it(`${JSON.stringify(flags)} → ${mode}`, () => {
        expect(confirmationMode(flags)).toBe(mode);
      });
    }
  }
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [3328599654, "3.1 GB"],
    [5 * 1024 ** 4, "5.0 TB"],
    [2048 * 1024 ** 4, "2048.0 TB"],
  ])("%d → %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

const runReport = (outcome: "pruned" | "kept"): PruneRunReport => ({
  qualifiedName: "phax.x",
  shortName: "x",
  runId: "x-1",
  outcome,
  archiveBytes: 0,
  bytesFreed: 0,
  branchesDeleted: [],
  branchesDiscarded: [],
  alreadyAbsent: [],
  remoteBranchesKept: [],
  kept:
    outcome === "kept"
      ? { reason: "removal-failed", part: "archive folder", message: "EACCES" }
      : null,
});

describe("pruneExitCode", () => {
  const plan: PrunePlan = {
    namespace: ns,
    runs: [],
    totals: { pruned: 0, kept: 0, bytesFreed: 0 },
  };
  const applied = (...outcomes: ("pruned" | "kept")[]): PruneResult => ({
    kind: "applied",
    plan,
    report: { runs: outcomes.map(runReport), totals: { pruned: 0, kept: 0, bytesFreed: 0 } },
  });

  it.each<[string, PruneResult, number]>([
    ["nothing-to-prune", { kind: "nothing-to-prune" }, 0],
    ["previewed", { kind: "previewed", plan }, 0],
    ["declined", { kind: "declined", plan }, 1],
    ["confirmation-missing", { kind: "confirmation-missing", plan }, 1],
    ["applied, all pruned", applied("pruned", "pruned"), 0],
    ["applied, one kept", applied("pruned", "kept"), 3],
    ["applied, all kept", applied("kept"), 3],
  ])("%s → %d", (_label, result, code) => {
    expect(pruneExitCode(result)).toBe(code);
  });
});
