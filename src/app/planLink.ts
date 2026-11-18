// Where a plan given to `phax run --plan` lives: with this repository's code, or in a process
// repository that links this one (spec code-repository). A plan inside the run's repository is
// not linked. Otherwise the plan's own repository is read — the `code` key of its phax.json and
// nothing else, none of its commands, gates or providers — and the plan is linked only when that
// link names the run's repository. Everything else stays loose, as it always was, with no
// warning: phax refuses only where it cannot tell whether a plan of that repository's
// docs/plans/ is linked to this one, or where the link names this repository and is unusable.
import { dirname, relative, resolve, sep } from "node:path";
import { Effect } from "effect";
import { classifyArtifactPath } from "../domain/artifact/document.js";
import { ConfigValidationError } from "../domain/errors.js";
import type { FileSystem, FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import {
  checkCodeRoot,
  type CodeLink,
  declaredCodeRoot,
  findProjectConfig,
  readPhaxJsonObject,
} from "./codeLink.js";

export type PlanLink =
  | { readonly kind: "loose" }
  | {
      readonly kind: "linked";
      /** Absolute: the process repository's top level. */
      readonly processRoot: string;
      /** The plan's path relative to `processRoot`, `/`-separated. */
      readonly planPath: string;
      readonly link: CodeLink;
    };

const LOOSE: PlanLink = { kind: "loose" };

const isInside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith("/");
};

/**
 * The link of a plan: `loose` (today's behaviour, untouched), `linked` (the plan is the process
 * repository's artifact at `planPath`), or a `ConfigValidationError` naming the process
 * repository's phax.json. The phax.json is the one phax finds walking up from the plan's
 * directory to the process repository's top level, as from a command run there.
 *
 * Loose: no phax.json, an object with no `code` key, or a `code.root` that resolves to another
 * repository than this one, whatever else the file holds. Refused: a phax.json that is not a
 * JSON object, or a `code` key with no `root` string, since phax cannot tell whether the plan is
 * linked; and a link that names this repository but does not decode, is not canonical, or fails
 * the checks against the process repository (not this repository's top level, tracked, not
 * ignored).
 */
export function resolvePlanLink(input: {
  readonly runRepoRoot: string;
  readonly planAbsolute: string;
}): Effect.Effect<PlanLink, ConfigValidationError | GitError | FsError, Git | FileSystem> {
  const { runRepoRoot, planAbsolute } = input;
  return Effect.gen(function* () {
    if (isInside(runRepoRoot, planAbsolute)) return LOOSE;

    const git = yield* Git;
    const processRoot = yield* git.repoTopLevel(dirname(planAbsolute));
    if (processRoot === null) return LOOSE;
    if (!isInside(processRoot, planAbsolute)) return LOOSE;
    const planPath = relative(processRoot, planAbsolute).split(sep).join("/");
    if (classifyArtifactPath(planPath)?.kind !== "plan") return LOOSE;

    const configPath = yield* findProjectConfig(dirname(planAbsolute), processRoot);
    if (configPath === null) return LOOSE;
    const cannotTell = (reason: string) =>
      Effect.fail(
        new ConfigValidationError({
          message: `Cannot tell whether ${planPath} is linked to this repository: "${configPath}" ${reason}`,
          path: configPath,
        }),
      );

    const read = yield* readPhaxJsonObject(configPath);
    if (read.kind === "unreadable") return yield* cannotTell(read.reason);
    if (!Object.hasOwn(read.raw, "code")) return LOOSE;
    const code = read.raw["code"];
    const named =
      typeof code === "object" && code !== null && !Array.isArray(code)
        ? (code as Record<string, unknown>)["root"]
        : undefined;
    if (typeof named !== "string")
      return yield* cannotTell('declares "code" with no "root" string');

    // Where the link points, before anything of it is judged: a link to another repository
    // leaves the plan loose, even when it would not pass the checks below.
    if ((yield* git.repoTopLevel(resolve(processRoot, named))) !== runRepoRoot) return LOOSE;

    const root = yield* declaredCodeRoot(read.raw, configPath);
    const link = yield* checkCodeRoot({ repoRoot: processRoot, root, configPath });
    return { kind: "linked", processRoot, planPath, link };
  });
}
