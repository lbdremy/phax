// The protected changes of a phase's worktree: what differs from the phase
// base in a file some protected glob names. Judged against the base, never
// HEAD, so a commit the agent made during its turn is still checked.
import { Effect } from "effect";
import {
  protectedChanges,
  protectedTrackedPaths,
  type ProtectedChange,
  type ProtectedList,
} from "../domain/security/protectedPaths.js";
import { Git, type GitError } from "../ports/git.js";

export interface ProtectedPathsCheckInput {
  readonly worktree: string;
  readonly base: string;
  readonly list: ProtectedList;
}

export function checkProtectedPaths(
  input: ProtectedPathsCheckInput,
): Effect.Effect<readonly ProtectedChange[], GitError, Git> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const atBase = yield* git.readTree(input.worktree, input.base);
    const tracked = protectedTrackedPaths(
      input.list,
      atBase.map((entry) => entry.path),
    );
    const observation = yield* git.observeWorktree(input.worktree, input.base, tracked);
    return protectedChanges(input.list, observation);
  });
}
