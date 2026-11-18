// The code link of a process repository, checked against the repository: the directory named
// by `code.root` must exist, be exactly the top level of a git repository, and be ignored by
// this repository. The shape of the key itself is checked at config load.
import { join } from "node:path";
import { Effect } from "effect";
import {
  CODE_ROOT_MISSING,
  CODE_ROOT_NOT_TOP_LEVEL,
  codeRootMessage,
  codeRootNotIgnored,
} from "../domain/config/codeLink.js";
import { ConfigValidationError } from "../domain/errors.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import { describeConfigSources } from "./loadConfig.js";

export interface CodeLink {
  readonly root: string;
  /** Absolute: the process repository's root joined with `root`. */
  readonly path: string;
}

/**
 * The project's code link, or null when phax.json declares none. Refuses a link whose root is
 * missing, is not a repository's top level, or is not ignored by the process repository.
 */
export function resolveCodeLink(
  config: ResolvedConfig,
): Effect.Effect<CodeLink | null, ConfigValidationError | GitError | FsError, Git | FileSystem> {
  const declared = config.code;
  if (declared === undefined) return Effect.succeed(null);
  const root = declared.root;
  const path = join(config.repoRoot, root);
  const configPath =
    describeConfigSources(config.repoRoot)?.project ?? join(config.repoRoot, "phax.json");
  const refuse = (reason: string) =>
    Effect.fail(
      new ConfigValidationError({ message: codeRootMessage(root, reason), path: configPath }),
    );
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;
    if (!(yield* fs.exists(path))) return yield* refuse(CODE_ROOT_MISSING);
    if ((yield* git.repoTopLevel(path)) !== path) return yield* refuse(CODE_ROOT_NOT_TOP_LEVEL);
    if (!(yield* git.isIgnored(config.repoRoot, root)))
      return yield* refuse(codeRootNotIgnored(root));
    return { root, path };
  });
}
