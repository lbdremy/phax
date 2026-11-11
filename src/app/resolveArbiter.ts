import { Effect, Result } from "effect";
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
    const declared = by === undefined ? Result.succeed(null) : parseArbiterDeclaration(by);
    if (Result.isFailure(declared)) {
      return yield* Effect.fail(new ArtifactArbiterRefusedError({ message: declared.failure }));
    }
    const stdinIsTerminal = yield* (yield* Terminal).stdinIsTerminal;
    const committerName = needsOperatorName(declared.success, stdinIsTerminal)
      ? yield* (yield* Git).committerName(repoRoot)
      : null;
    const resolved = resolveFromFacts({
      declared: declared.success,
      stdinIsTerminal,
      committerName,
    });
    if (Result.isFailure(resolved)) {
      return yield* Effect.fail(new ArtifactArbiterRefusedError({ message: resolved.failure }));
    }
    return resolved.success;
  });
}
