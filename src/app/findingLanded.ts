// Where each fixed finding's latest fix landed, resolved at read time (spec finding-fix-identity
// §5.3 to §5.8). The base branch first, then the run's branch; on each, the recorded commit, its
// fate key, then its patch id, over the commits made since the run started. Every fact is read
// through the Git port, once per run and only when a finding needs it: each searched branch's
// range once, its patch ids once, and the patch ids of every recorded commit the repository holds
// in one call. Read-only: nothing is written or fetched, and GitHub is never asked.
import { Effect } from "effect";
import {
  type BranchFacts,
  type FollowMatch,
  followMatchOf,
  type Landed,
  notFound,
  resolveOnBranch,
} from "../domain/findings/landed.js";
import { Git, type GitError, type RangeCommit } from "../ports/git.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";

/**
 * The base branch as the fix commands read it: `publish.baseBranch`, else `main`; the local branch
 * when it resolves (label `<base>`), else the remote-tracking one of `publish.remote` (label
 * `<remote>/<base>`). When neither resolves, `ref` is null and the label is `<base>`.
 */
export function baseBranchOf(
  repo: string,
  config: ResolvedConfig,
): Effect.Effect<{ readonly ref: string | null; readonly label: string }, GitError, Git> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const base = config.publish.baseBranch ?? "main";
    const local = `refs/heads/${base}`;
    if ((yield* git.resolveRef(repo, local)) !== null) return { ref: local, label: base };
    const remote = `refs/remotes/${config.publish.remote}/${base}`;
    if ((yield* git.resolveRef(repo, remote)) !== null) {
      return { ref: remote, label: `${config.publish.remote}/${base}` };
    }
    return { ref: null, label: base };
  });
}

/** One fixed finding to resolve: its id and the commit its latest fixed record names. */
export interface FixToResolve {
  readonly id: string;
  readonly recorded: string;
}

/** What resolving a run's fixes answers: the base branch's label, and each finding's resolution. */
export interface RunLandings {
  readonly baseBranch: string;
  readonly landed: ReadonlyMap<string, Landed>;
}

interface SearchedBranch {
  readonly label: string;
  /** The tip's sha, or null when the branch does not resolve: it is not searched. */
  readonly tip: string | null;
}

/**
 * Resolves every fix of the run in one pass. A git failure fails the call; a branch that does not
 * resolve, or a recorded commit the repository does not hold, does not.
 */
export function resolveRunLandings(input: {
  readonly repo: string;
  readonly runId: string;
  /** The run's final-phase branch; null for an archived run. */
  readonly runBranch: string | null;
  /** The run's start, or null when it could not be read: only the recorded step runs. */
  readonly startedAt: string | null;
  readonly config: ResolvedConfig;
  readonly fixes: readonly FixToResolve[];
}): Effect.Effect<RunLandings, GitError, Git> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const { repo, runId, startedAt } = input;
    const base = yield* baseBranchOf(repo, input.config);
    const landed = new Map<string, Landed>();
    if (input.fixes.length === 0) return { baseBranch: base.label, landed };

    const branches: SearchedBranch[] = [
      { label: base.label, tip: base.ref === null ? null : yield* git.resolveRef(repo, base.ref) },
    ];
    if (input.runBranch !== null) {
      branches.push({
        label: input.runBranch,
        tip: yield* git.resolveRef(repo, `refs/heads/${input.runBranch}`),
      });
    }

    const held = new Map<string, boolean>();
    for (const { recorded } of input.fixes) {
      if (!held.has(recorded)) held.set(recorded, yield* git.commitExists(recorded, repo));
    }
    let recordedPatchIds: ReadonlyMap<string, string> | undefined;
    const patchIdsOfRecorded = Effect.gen(function* () {
      recordedPatchIds ??= yield* git.patchIds(
        repo,
        [...held].filter(([, isHeld]) => isHeld).map(([sha]) => sha),
      );
      return recordedPatchIds;
    });

    for (const branch of branches) {
      const { tip } = branch;
      if (tip === null) continue;
      let range: readonly RangeCommit[] | undefined;
      let rangePatchIds: ReadonlyMap<string, string> | undefined;
      for (const fix of input.fixes) {
        if (landed.has(fix.id)) continue;
        const recordedHeld = held.get(fix.recorded) === true;
        let facts: BranchFacts = {
          branch: branch.label,
          recorded: fix.recorded,
          key: { runId, findingId: fix.id },
          recordedReachable:
            recordedHeld && (yield* git.mergeBase(repo, fix.recorded, tip)) === fix.recorded,
          startedAt,
          range,
          recordedHeld,
          patchIds: undefined,
        };
        let step = resolveOnBranch(facts);
        if (step.kind === "needs-range" && startedAt !== null) {
          range ??= yield* git.commitsSince(repo, tip, startedAt);
          facts = { ...facts, range };
          step = resolveOnBranch(facts);
        }
        if (step.kind === "needs-patch-ids" && range !== undefined) {
          rangePatchIds ??= yield* git.patchIds(
            repo,
            range.map((commit) => commit.sha),
          );
          const recorded = yield* patchIdsOfRecorded;
          facts = {
            ...facts,
            patchIds: { recorded: recorded.get(fix.recorded), range: rangePatchIds },
          };
          step = resolveOnBranch(facts);
        }
        if (step.kind === "landed") landed.set(fix.id, step.landed);
      }
    }

    const looked = branches.map((branch) => branch.label);
    for (const fix of input.fixes) {
      if (!landed.has(fix.id)) landed.set(fix.id, notFound(looked, fix.recorded));
    }
    return { baseBranch: base.label, landed };
  });
}

/**
 * Searches the base branch alone for the commits that `phax finding fix --commit` follows a named
 * commit to (spec §5.15): for each named finding, the commits since the run's start carrying its
 * fate key, then, when the repository holds the named commit, those with its patch id. Nothing is
 * found when the base branch does not resolve or the run's start is unknown. Read-only.
 */
export function followOnBase(input: {
  readonly repo: string;
  readonly runId: string;
  readonly startedAt: string | null;
  readonly config: ResolvedConfig;
  /** The named commit's full sha when the repository holds it, else the value as given. */
  readonly named: string;
  readonly held: boolean;
  readonly ids: readonly string[];
}): Effect.Effect<
  { readonly baseBranch: string; readonly matches: readonly FollowMatch[] },
  GitError,
  Git
> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const { repo, runId, startedAt, named, held } = input;
    const base = yield* baseBranchOf(repo, input.config);
    const tip = base.ref === null ? null : yield* git.resolveRef(repo, base.ref);
    let range: readonly RangeCommit[] | undefined;
    let patchIds: BranchFacts["patchIds"];
    const matches: FollowMatch[] = [];
    for (const id of input.ids) {
      if (tip === null || startedAt === null) {
        matches.push({ id, match: null });
        continue;
      }
      range ??= yield* git.commitsSince(repo, tip, startedAt);
      let facts: BranchFacts = {
        branch: base.label,
        recorded: named,
        key: { runId, findingId: id },
        recordedReachable: false,
        startedAt,
        range,
        recordedHeld: held,
        patchIds,
      };
      let step = resolveOnBranch(facts);
      if (step.kind === "needs-patch-ids") {
        const ofRange = yield* git.patchIds(
          repo,
          range.map((commit) => commit.sha),
        );
        const ofNamed = yield* git.patchIds(repo, [named]);
        patchIds = { recorded: ofNamed.get(named), range: ofRange };
        facts = { ...facts, patchIds };
        step = resolveOnBranch(facts);
      }
      matches.push({ id, match: followMatchOf(facts, step) });
    }
    return { baseBranch: base.label, matches };
  });
}
