import { Effect, Either } from "effect";
import {
  needsOperatorName,
  parseArbiterDeclaration,
  resolveArbiter as resolveFromFacts,
  type ResolvedArbiter,
} from "../domain/artifact/arbiter.js";
import { ArtifactArbiterRefusedError } from "../domain/errors.js";
import { Git, type GitError } from "../ports/git.js";
import { Terminal } from "../ports/terminal.js";

/**
 * Who performs a gesture, from its raw `--by` value (undefined when absent):
 * stdin's terminal state is always read, the committer name only when the
 * operator is named. Writes nothing, so a refusal leaves the tree as it was.
 */
export function resolveArbiter(
  by: string | undefined,
  repoRoot: string,
): Effect.Effect<ResolvedArbiter, ArtifactArbiterRefusedError | GitError, Terminal | Git> {
  return Effect.gen(function* () {
    const declared = by === undefined ? Either.right(null) : parseArbiterDeclaration(by);
    if (Either.isLeft(declared)) {
      return yield* Effect.fail(new ArtifactArbiterRefusedError({ message: declared.left }));
    }
    const stdinIsTerminal = yield* (yield* Terminal).stdinIsTerminal;
    const committerName = needsOperatorName(declared.right, stdinIsTerminal)
      ? yield* (yield* Git).committerName(repoRoot)
      : null;
    const resolved = resolveFromFacts({ declared: declared.right, stdinIsTerminal, committerName });
    if (Either.isLeft(resolved)) {
      return yield* Effect.fail(new ArtifactArbiterRefusedError({ message: resolved.left }));
    }
    return resolved.right;
  });
}
