// What phax's command definitions share: the configuration read as a run's first step, the
// repository and a path argument made repo-relative, and the fields an error line carries.
import { execSync } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Effect, Either } from "effect";
import * as Schema from "effect/Schema";
import { loadConfig } from "../../app/loadConfig.js";
import type { ConfigValidationError } from "../../domain/errors.js";
import type { ResolvedConfig } from "../../schemas/phaxConfig.js";
import type { FormatId } from "../../schemas/schemaUrl.js";
import { currentSchemaUrl } from "../../schemas/persisted.js";
import { CompleterAnnotationId } from "../commandLibrary/contract/index.js";

/** The fields of an error these commands declare, as the catalogue lists them: its message. */
export const MessageFields = Schema.Struct({ message: Schema.String });

/** An error as the runner reads its fields: a `Data.TaggedError` keeps its `message` off its
 *  enumerable own fields, so the `error` line under `--json` would carry none. The record keeps
 *  the tag and the fields, with the message among them when there is one. */
export function exposeMessage<E extends { readonly _tag: string; readonly message: string }>(
  error: E,
): E {
  // The tag is an own enumerable field, so the spread keeps it.
  return error.message === "" ? error : { ...error, message: error.message };
}

/** The configuration of the invocation directory's repository, or the error that refused it. */
export function configured(): Effect.Effect<ResolvedConfig, ConfigValidationError> {
  return Effect.suspend(() => {
    const config = loadConfig(process.cwd());
    return Either.isLeft(config) ? Effect.fail(config.left) : Effect.succeed(config.right);
  });
}

/** The root of the working tree holding `startDir`, or undefined outside any. */
export function gitRoot(startDir: string): string | undefined {
  try {
    const root = execSync("git rev-parse --show-toplevel", {
      cwd: startDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return root.length > 0 ? root : undefined;
  } catch {
    return undefined;
  }
}

/** The root of the working tree holding `startDir`, or `startDir` outside any. */
export function findGitRoot(startDir: string): string {
  return gitRoot(startDir) ?? startDir;
}

/** `path` absolutized against the invocation directory, and made repo-relative and POSIX:
 *  classifyArtifactPath matches on repo-relative paths, and a path outside the repository yields
 *  `../…`, which never classifies as an artifact. */
export function repoPaths(
  path: string,
  repoRoot: string,
): { readonly absolute: string; readonly repoRelPath: string } {
  const absolute = resolve(process.cwd(), path);
  return { absolute, repoRelPath: relative(repoRoot, absolute).split(sep).join("/") };
}

/** A run's short name, as every definition that takes a run declares it: with the completer that
 *  lists the runs (`phax ls --complete`), written once in the usage spec for the identifier. */
export const ShortNameArg = Schema.String.annotations({
  identifier: "short-name",
  description: "Run short name, e.g. usage-cli",
  [CompleterAnnotationId]: { run: "phax ls --complete", descriptions: true },
});

/** A written file's path as its record names it: from the repository root when the file is inside
 *  the repository holding `root`, else absolute (~/.phax and ~/.claude have no repository root,
 *  nor has a file written outside any repository, whose `root` is undefined). */
export function recordedPath(path: string, root: string | undefined): string {
  if (root === undefined) return path;
  const relation = relative(root, path);
  return relation === "" || relation.startsWith("..") || isAbsolute(relation)
    ? path
    : relation.split(sep).join("/");
}

/** The annotation that names a published format as an output's JSON Schema: a reference to the
 *  format's current shape, which the catalogue writes in place of the generated schema. */
export function publishedFormat(formatId: FormatId): {
  readonly jsonSchema: { readonly $ref: string };
} {
  return { jsonSchema: { $ref: currentSchemaUrl(formatId) } };
}
