// Resolves the `--landed <run>` argument of `plans overlap` to the folder that holds the
// run's global-file-reconciliation.json: the live run folder first, then the archive
// folder its registry entry points at. `phax prune` removes the registry entry, so a
// pruned run with no surviving entry cannot be told apart from an unknown one; the
// refusal names that ambiguity instead of guessing.
import { Data, Effect, Either } from "effect";
import { join } from "node:path";
import { FileSystem } from "../ports/fs.js";
import { parseRunRef, runKey } from "../domain/runRef.js";
import { readRegistry } from "./registry.js";

export class LandedRunResolutionError extends Data.TaggedError("LandedRunResolutionError")<{
  readonly message: string;
}> {}

export interface ResolveLandedRunInput {
  /** The raw `--landed` argument: `<short>` or `<namespace>.<short>`. */
  readonly landed: string;
  /** The configured namespace, used when the argument is a bare short name. */
  readonly namespace: string;
  readonly stateRoot: string;
}

export interface ResolvedLandedRun {
  readonly key: string;
  /** The folder holding the run's global-file-reconciliation.json. */
  readonly runPath: string;
  readonly archived: boolean;
}

export function resolveLandedRun(
  input: ResolveLandedRunInput,
): Effect.Effect<ResolvedLandedRun, LandedRunResolutionError, FileSystem> {
  return Effect.gen(function* () {
    const ref = parseRunRef(input.landed);
    if (Either.isLeft(ref)) {
      return yield* Effect.fail(new LandedRunResolutionError({ message: ref.left }));
    }
    const namespace = ref.right.namespace ?? input.namespace;
    const { shortName } = ref.right;
    const key = runKey(namespace, shortName);
    const runsRoot = join(input.stateRoot, "runs");

    const fs = yield* FileSystem;
    const livePath = join(runsRoot, key);
    if (yield* fs.exists(join(livePath, "run-status.json"))) {
      return { key, runPath: livePath, archived: false };
    }

    const registry = yield* readRegistry(input.stateRoot);
    const entry = registry.runs.find((r) => r.namespace === namespace && r.shortName === shortName);
    if (entry === undefined) {
      return yield* Effect.fail(
        new LandedRunResolutionError({
          message:
            `Run "${key}" is unknown: no run folder under "${runsRoot}/" and no registry entry. ` +
            "A pruned run looks the same — `phax prune` removes its registry entry",
        }),
      );
    }
    if (entry.archivePath === undefined) {
      return yield* Effect.fail(
        new LandedRunResolutionError({
          message: `Run "${key}" is in the registry but has no run folder under "${runsRoot}/" and no archive`,
        }),
      );
    }
    const archivedRunPath = join(entry.archivePath, "runs");
    if (!(yield* fs.exists(archivedRunPath))) {
      return yield* Effect.fail(
        new LandedRunResolutionError({
          message:
            `Run "${key}" was archived to "${entry.archivePath}" but that folder is gone — ` +
            "the run was pruned, so its landed diff is no longer available",
        }),
      );
    }
    return { key, runPath: archivedRunPath, archived: true };
  }).pipe(
    Effect.catchTags({
      FsError: (e) => Effect.fail(new LandedRunResolutionError({ message: e.message })),
      RegistryCorruptionError: (e) =>
        Effect.fail(new LandedRunResolutionError({ message: e.message })),
    }),
  );
}
