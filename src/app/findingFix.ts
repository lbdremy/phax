// `phax finding fix <run> <id>… -- <path>…` (spec finding-ids-and-fates §5.11, §5.12, §5.19,
// §5.20): commits exactly the named paths in the run's final worktree while the run is
// review_open, then records each named finding `fixed` on `phax/records/v1`. With `--commit <sha>`
// it records an existing commit and makes none. Every refusal comes before any write. Nothing is
// pushed and no GitHub call is made: the records reach the remote with the run's publish.
import { isAbsolute, relative, resolve } from "node:path";
import { Data, Effect, Result } from "effect";
import type { FindingFateEntry } from "../schemas/findingFateRecord.js";
import { runKey } from "../domain/runRef.js";
import type { RegistryCorruptionError } from "../domain/errors.js";
import { defaultFixSubject, fixCommitBody, splitFixOperands } from "../domain/findings/fixCall.js";
import { type PathClass } from "../schemas/pathClass.js";
import { classifyPath, pathClassesOf } from "../domain/findings/pathClass.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import type { Terminal } from "../ports/terminal.js";
import type { CodeReviewFindingEntry, ComplianceFindingEntry } from "../schemas/findingList.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import {
  fateRecordDestination,
  type FindingRecordsOffError,
  type FindingRecordsUnavailableError,
  writeFateRecord,
} from "./findingFateRecords.js";
import {
  type FindingFateRecordUnreadableError,
  listRunFindings,
  type FindingReviewUnreadableError,
  type FindingRunRefError,
  resolveFindingRun,
  type ResolvedFindingRun,
} from "./findingList.js";
import { resolveArbiter } from "./resolveArbiter.js";
import { gitFailureLine } from "./writeReviewRecord.js";

/** A refusal of the call, made before anything is written. */
export class FindingFixRefusedError extends Data.TaggedError("FindingFixRefusedError")<{
  readonly message: string;
}> {}

/** Some fate records could not be written after the commit landed: the commit stays. */
export class FindingFateNotRecordedError extends Data.TaggedError("FindingFateNotRecordedError")<{
  readonly message: string;
  /** The commit that stays, or null when the call made none (dismiss, defer). */
  readonly commit: string | null;
  readonly recorded: readonly string[];
  readonly unrecorded: readonly string[];
  readonly retry: string;
}> {}

export interface FindingFixInput {
  /** The run as given on the command line. */
  readonly ref: string;
  /** Everything after the run reference: the ids, then the paths. */
  readonly operands: readonly string[];
  readonly commit: string | undefined;
  readonly subject: string | undefined;
  readonly body: string | undefined;
  readonly by: string | undefined;
  readonly cwd: string;
  readonly nowIso: string;
  readonly config: ResolvedConfig;
}

export interface FindingFixAnswer {
  readonly run: {
    readonly namespace: string;
    readonly shortName: string;
    readonly runId: string;
    readonly state: ResolvedFindingRun["state"];
  };
  readonly commit: {
    readonly sha: string;
    readonly made: boolean;
    readonly subject: string | null;
    readonly paths: readonly { readonly path: string; readonly pathClass: PathClass }[];
  };
  readonly recorded: readonly {
    readonly finding: string;
    readonly key: string;
    readonly recordCommit: string;
  }[];
  readonly findings: readonly (CodeReviewFindingEntry | ComplianceFindingEntry)[];
}

export type FindingFixError =
  | FindingFixRefusedError
  | FindingFateNotRecordedError
  | FindingRecordsOffError
  | FindingRecordsUnavailableError
  | FindingRunRefError
  | FindingReviewUnreadableError
  | FindingFateRecordUnreadableError
  | GitError
  | FsError
  | RegistryCorruptionError;

const refuse = (message: string) => Effect.fail(new FindingFixRefusedError({ message }));

const gitLine = (error: GitError | FsError): string =>
  gitFailureLine("stderr" in error && error.stderr ? error.stderr : error.message);

/** The sha the call names, resolved to a full commit sha in `repo`, or a refusal. */
function resolveCommit(repo: string, named: string) {
  return Effect.gen(function* () {
    const git = yield* Git;
    const sha = yield* git.resolveRef(repo, `${named}^{commit}`);
    if (sha === null) {
      return yield* refuse(`--commit ${named} names no commit in the run's repository`);
    }
    return sha;
  });
}

/** Whether `sha` is, or is an ancestor of, the tip `ref`; false when `ref` does not resolve. */
function reachableFrom(repo: string, sha: string, ref: string) {
  return Effect.gen(function* () {
    const git = yield* Git;
    const tip = yield* git.resolveRef(repo, ref);
    if (tip === null) return false;
    return (yield* git.mergeBase(repo, sha, tip)) === sha;
  });
}

/**
 * The commit must be on the run's final-phase branch (a live run whose branch resolves) or on the
 * base branch (`publish.baseBranch`, else `main`; the local branch, else the remote-tracking one).
 */
function checkReachable(input: {
  readonly repo: string;
  readonly sha: string;
  readonly runBranch: string | null;
  /** Whether `repo` is the run's final worktree, whose HEAD is the run branch's tip. */
  readonly inWorktree: boolean;
  readonly config: ResolvedConfig;
}) {
  return Effect.gen(function* () {
    const git = yield* Git;
    const { repo, sha, config } = input;
    const checked: string[] = [];
    const named =
      input.runBranch !== null && (yield* git.resolveRef(repo, input.runBranch)) !== null
        ? input.runBranch
        : null;
    if (named !== null) {
      if (yield* reachableFrom(repo, sha, named)) return;
      checked.push(named);
    } else if (input.inWorktree) {
      // The branch's name does not resolve here: the worktree's own HEAD is the run's tip.
      if (yield* reachableFrom(repo, sha, "HEAD")) return;
      checked.push(input.runBranch ?? "the run branch");
    }
    const base = config.publish.baseBranch ?? "main";
    const remoteBase = `refs/remotes/${config.publish.remote}/${base}`;
    const local = `refs/heads/${base}`;
    const baseRef = (yield* git.resolveRef(repo, local)) !== null ? local : remoteBase;
    if (yield* reachableFrom(repo, sha, baseRef)) return;
    checked.push(baseRef === local ? base : baseRef);
    return yield* refuse(
      `--commit ${sha.slice(0, 7)} is on neither ${checked.join(" nor ")}: name a commit of the run branch or of the base branch (publish.baseBranch names it when it is not main)`,
    );
  });
}

/** The worktree's repo-relative path for each named path, or a refusal for one that leaves it. */
function resolvePaths(input: {
  readonly worktree: string;
  readonly cwd: string;
  readonly paths: readonly string[];
}) {
  return Effect.gen(function* () {
    const git = yield* Git;
    const root = (yield* git.repoTopLevel(input.worktree)) ?? input.worktree;
    const here = yield* git.repoTopLevel(input.cwd);
    const base = here !== null && here === root ? input.cwd : root;
    const resolved: string[] = [];
    const outside: string[] = [];
    for (const path of input.paths) {
      const relation = relative(root, resolve(base, path));
      if (relation === ".." || relation.startsWith("../") || isAbsolute(relation)) {
        outside.push(path);
        continue;
      }
      resolved.push(relation === "" ? "." : relation.split("\\").join("/"));
    }
    if (outside.length > 0) {
      return yield* refuse(`${outside.join(", ")} leaves the worktree ${root}`);
    }
    return resolved;
  });
}

/** The run must be open for review with its final worktree for a call that makes a commit. */
function requireOpenRun(run: ResolvedFindingRun) {
  return Effect.gen(function* () {
    if (run.state !== "review_open") {
      return yield* refuse(
        `${run.shortName} is ${run.state}, not review_open: a fix rides the run while it is open for review`,
      );
    }
    const fs = yield* FileSystem;
    if (
      run.worktreePath === null ||
      !(yield* fs.exists(run.worktreePath).pipe(Effect.orElseSucceed(() => false)))
    ) {
      return yield* refuse(`${run.shortName} has no final worktree to commit in`);
    }
    return run.worktreePath;
  });
}

/**
 * Fixes the findings the call names. The path form commits the named paths in the run's final
 * worktree; `--commit` records an existing commit. Either way each finding gets one `fixed` fate
 * record, in the order named. A record that fails after the commit landed leaves the commit and
 * fails with `FindingFateNotRecordedError`, whose retry is the `--commit` form.
 */
export function fixFindings(
  input: FindingFixInput,
): Effect.Effect<FindingFixAnswer, FindingFixError, FileSystem | Git | Terminal> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const { config } = input;
    const { ids, paths } = splitFixOperands(input.operands);

    // 1. The call.
    if (ids.length === 0) {
      return yield* refuse("no finding named: give one or more finding ids (F2, C1) after the run");
    }
    const backfill = input.commit !== undefined;
    if (backfill && (paths.length > 0 || input.subject !== undefined || input.body !== undefined)) {
      return yield* refuse(
        "--commit records an existing commit and makes none: it takes no path, -m or --body",
      );
    }
    if (!backfill && paths.length === 0) {
      return yield* refuse("no path given: name the changed paths after --");
    }

    // 2. The run.
    const run = yield* resolveFindingRun(input.ref, config);
    const worktree = backfill ? run.worktreePath : yield* requireOpenRun(run);

    // 3. The records.
    const destination = yield* fateRecordDestination(run.target);
    if (run.target.kind === "unresolved") return yield* refuse(run.target.reason);
    const fs = yield* FileSystem;
    const inWorktree =
      worktree !== null && (yield* fs.exists(worktree).pipe(Effect.orElseSucceed(() => false)));
    const repo = inWorktree && worktree !== null ? worktree : run.target.repoRoot;

    // 4. Who fixes.
    const by = yield* resolveArbiter(input.by, repo).pipe(
      Effect.catchTag("ArtifactArbiterRefusedError", (error) => refuse(error.message)),
    );

    // 5. The findings.
    const before = yield* listRunFindings({ ref: input.ref, config });
    const known = new Set(before.document.findings.map((finding) => finding.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      return yield* refuse(
        `${run.shortName} has no finding ${unknown.join(", ")}: \`phax finding list ${run.shortName}\` names its findings`,
      );
    }

    // 6 and 7. The commit.
    let sha: string;
    let subject: string | null;
    if (input.commit === undefined) {
      const named = yield* resolvePaths({ worktree: repo, cwd: input.cwd, paths });
      const unchanged: string[] = [];
      for (const [index, path] of named.entries()) {
        if ((yield* git.dirtyPaths(repo, [path])).length === 0) {
          unchanged.push(paths[index] ?? path);
        }
      }
      if (unchanged.length > 0) {
        return yield* refuse(unchanged.map((path) => `${path} has no change`).join(", "));
      }
      subject = input.subject ?? defaultFixSubject(ids, run.shortName);
      yield* git.commitPaths(
        repo,
        named,
        subject,
        fixCommitBody({ shortName: run.shortName, ids, body: input.body }),
      );
      sha = yield* git.headCommit(repo);
    } else {
      sha = yield* resolveCommit(repo, input.commit);
      yield* checkReachable({ repo, sha, runBranch: run.runBranch, inWorktree, config });
      subject = null;
    }

    // 8. Its paths and classes.
    const changed = yield* git.commitChangedPaths(repo, sha);
    if (changed.length === 0) {
      return yield* refuse(`commit ${sha.slice(0, 7)} changes no path: there is nothing to record`);
    }
    const pathClasses = pathClassesOf(changed);

    // 9. One record per id, in the order named.
    const entry: Extract<FindingFateEntry, { fate: "fixed" }> = {
      fate: "fixed",
      commit: sha,
      pathClasses,
      by,
      at: input.nowIso,
    };
    const recorded: { finding: string; key: string; recordCommit: string }[] = [];
    const unrecorded: string[] = [];
    let reason = "";
    for (const finding of ids) {
      const written = yield* Effect.result(
        writeFateRecord({ destination, runId: run.runId, finding, entry }),
      );
      if (Result.isSuccess(written)) {
        recorded.push({ finding, ...written.success });
      } else {
        unrecorded.push(finding);
        if (reason === "") reason = gitLine(written.failure);
      }
    }
    if (unrecorded.length > 0) {
      const retry = `phax finding fix ${input.ref} ${unrecorded.join(" ")} --commit ${sha}`;
      const kept = input.commit === undefined ? `the commit ${sha.slice(0, 7)} stays` : "";
      const done =
        recorded.length === 0
          ? "none is recorded"
          : `recorded: ${recorded.map((r) => r.finding).join(", ")}`;
      return yield* Effect.fail(
        new FindingFateNotRecordedError({
          message: `✗ fix not recorded: ${unrecorded.join(", ")} of ${runKey(run.namespace, run.shortName)} could not be recorded on phax/records/v1 (${reason}); ${done}${kept === "" ? "" : `; ${kept}`}. Retry with: ${retry}`,
          commit: sha,
          recorded: recorded.map((r) => r.finding),
          unrecorded,
          retry,
        }),
      );
    }

    // 10. The answer: the named findings read again after the write.
    const after = yield* listRunFindings({ ref: input.ref, config });
    return {
      run: {
        namespace: run.namespace,
        shortName: run.shortName,
        runId: run.runId,
        state: run.state,
      },
      commit: {
        sha,
        made: input.commit === undefined,
        subject,
        paths: changed.map((path) => ({ path, pathClass: classifyPath(path) })),
      },
      recorded,
      findings: ids.flatMap((id) => after.document.findings.filter((finding) => finding.id === id)),
    };
  });
}
