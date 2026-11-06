import { Effect } from "effect";
import {
  classifyRecordsBranch,
  recordsBranchPhrase,
  recordsBranchRemedy,
  type RecordsBranchReading,
} from "../domain/records/branchState.js";
import { Git, type GitError } from "../ports/git.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";

/**
 * The records branch is an ordinary branch, not a custom ref namespace, so it
 * travels with a clone and a fetch (spec §5.3).
 */
export const RECORDS_BRANCH_NAME = "phax/records/v1";

/** The local records clone's remote is always named `origin` — it is cloned,
 * never added by hand — so this is also the push target for a `repo` destination. */
export const ORIGIN = "origin";

/**
 * Where a record lands and which remote it is published to: the source
 * repository and `publishRemote` for an in-repo destination, the dedicated
 * clone and its `origin` otherwise. A dedicated destination without a clone
 * path is already deferred by `resolveRecordDestination`; the source
 * repository stands in so the function stays total.
 */
export function recordsBranchLocation(input: {
  readonly records: ResolvedRecordsConfig;
  readonly repoRoot: string;
  readonly publishRemote: string;
  readonly recordsClonePath?: string | undefined;
}): { readonly repo: string; readonly remote: string } {
  if (input.records.destination.kind === "repo") {
    return { repo: input.recordsClonePath ?? input.repoRoot, remote: ORIGIN };
  }
  return { repo: input.repoRoot, remote: input.publishRemote };
}

/**
 * Read the local and remote-tracking tips of the records branch and classify
 * their relation. The remote tip is the one phax last fetched: nothing is
 * fetched here.
 */
export function readRecordsBranch(
  repo: string,
  remote: string,
): Effect.Effect<RecordsBranchReading, GitError, Git> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const localTip = yield* git.resolveRef(repo, `refs/heads/${RECORDS_BRANCH_NAME}`);
    const remoteTip = yield* git.resolveRef(repo, `refs/remotes/${remote}/${RECORDS_BRANCH_NAME}`);
    const mergeBase =
      localTip !== null && remoteTip !== null && localTip !== remoteTip
        ? yield* git.mergeBase(repo, localTip, remoteTip)
        : null;
    return {
      state: classifyRecordsBranch({ localTip, remoteTip, mergeBase }),
      localTip,
      remoteTip,
    };
  });
}

const SHORT_SHA_LENGTH = 7;

/**
 * The sentence a record written on a diverged or unrelated branch owes its
 * operator, or null when the branch is in no such state. The record is kept
 * on the local tip; the sentence names the state, both tips and the remedy.
 */
export function describeRecordWriteBranch(
  reading: RecordsBranchReading,
  where: { readonly localPath: string; readonly remote: string },
): string | null {
  if (reading.state !== "diverged" && reading.state !== "unrelated") return null;
  const remedy = recordsBranchRemedy(reading.state, where);
  const local = (reading.localTip ?? "").slice(0, SHORT_SHA_LENGTH);
  const remote = (reading.remoteTip ?? "").slice(0, SHORT_SHA_LENGTH);
  return `record kept on the local records branch, which is ${recordsBranchPhrase(reading.state, where.remote)} (local ${local}, ${where.remote} ${remote}); run \`${remedy}\`, then push`;
}
