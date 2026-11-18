// Where a plan given to `phax run --plan` lives: with this repository's code, or in a process
// repository that links this one (spec code-repository). A plan inside the run's repository is
// not linked. Otherwise the plan's own repository is read — its phax.json `code` key and nothing
// else, none of its commands, gates or providers — and the plan is linked only when that link
// names the run's repository. Everything else stays loose, as it always was, with no warning.
import { dirname, join, relative, sep } from "node:path";
import { Effect, Result } from "effect";
import { classifyArtifactPath } from "../domain/artifact/document.js";
import { codeRootMessage, codeRootNotIgnored, codeRootProblem } from "../domain/config/codeLink.js";
import { ConfigValidationError } from "../domain/errors.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { decodePhaxConfig } from "../schemas/phaxConfig.js";
import { formatConfigParseError } from "../schemas/formatError.js";
import type { CodeLink } from "./codeLink.js";

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
 * repository's artifact at `planPath`), or a `ConfigValidationError` naming the process repository's
 * phax.json when its link is declared but unusable.
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

    const fs = (yield* FileSystem).rootedAt(processRoot);
    const configPath = join(processRoot, "phax.json");
    if (!(yield* fs.exists(configPath))) return LOOSE;
    const refuse = (message: string) =>
      Effect.fail(new ConfigValidationError({ message, path: configPath }));

    const text = yield* fs.readText(configPath);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return yield* refuse(
        `Invalid phax.json at "${configPath}": ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return yield* refuse(`Invalid phax.json at "${configPath}": not a JSON object`);
    }
    if (!Object.hasOwn(raw, "code")) return LOOSE;

    const decoded = decodePhaxConfig(raw);
    if (Result.isFailure(decoded)) {
      return yield* refuse(
        `Invalid phax.json at "${configPath}":\n${formatConfigParseError(raw, decoded.failure)}`,
      );
    }
    const declared = decoded.success.code;
    if (declared === undefined) return LOOSE;
    const root = declared.root;
    const problem = codeRootProblem(root);
    if (problem !== null) return yield* refuse(codeRootMessage(root, problem));

    const codePath = join(processRoot, root);
    if ((yield* git.repoTopLevel(codePath)) !== runRepoRoot) return LOOSE;
    if (!(yield* git.isIgnored(processRoot, root))) {
      return yield* refuse(codeRootMessage(root, codeRootNotIgnored(root)));
    }
    return { kind: "linked", processRoot, planPath, link: { root, path: codePath } };
  });
}
