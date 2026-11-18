// The code link of a process repository, checked against the repository: the directory named
// by `code.root` must exist, be exactly the top level of a git repository, and be ignored and
// untracked by this repository. Every command reads the link from the same phax.json: the
// nearest one walking up from where it starts to the repository's top level (the rule
// loadConfig follows), and a refusal names that file.
import { join } from "node:path";
import { Effect, Result } from "effect";
import { classifyArtifactPath } from "../domain/artifact/document.js";
import type { ArtifactStatus } from "../domain/artifact/status.js";
import {
  CODE_ROOT_MISSING,
  CODE_ROOT_NOT_TOP_LEVEL,
  codeRootMessage,
  codeRootNotIgnored,
  codeRootProblem,
  codeRootTracked,
  phaxConfigCandidates,
} from "../domain/config/codeLink.js";
import { ConfigValidationError } from "../domain/errors.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { formatConfigParseError } from "../schemas/formatError.js";
import { decodeCodeLinkDeclaration, type ResolvedConfig } from "../schemas/phaxConfig.js";

export interface CodeLink {
  readonly root: string;
  /** Absolute: the process repository's root joined with `root`. */
  readonly path: string;
}

/**
 * The checks of a declared root against the repository at `repoRoot`, refusing with a
 * `ConfigValidationError` that names `configPath`: the root is missing, is not a repository's
 * top level, is not ignored by `repoRoot`, or is ignored but still tracked by it.
 */
export function checkCodeRoot(input: {
  readonly repoRoot: string;
  readonly root: string;
  readonly configPath: string;
}): Effect.Effect<CodeLink, ConfigValidationError | GitError | FsError, Git | FileSystem> {
  const { repoRoot, root, configPath } = input;
  const path = join(repoRoot, root);
  const refuse = (reason: string) =>
    Effect.fail(
      new ConfigValidationError({ message: codeRootMessage(root, reason), path: configPath }),
    );
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;
    if (!(yield* fs.exists(path))) return yield* refuse(CODE_ROOT_MISSING);
    if ((yield* git.repoTopLevel(path)) !== path) return yield* refuse(CODE_ROOT_NOT_TOP_LEVEL);
    if (!(yield* git.isIgnored(repoRoot, root))) return yield* refuse(codeRootNotIgnored(root));
    // An ignore rule does not untrack: a root added before it was ignored (a gitlink from
    // `git add`, or its files) is still the process repository's.
    if (yield* git.isTracked(repoRoot, root)) return yield* refuse(codeRootTracked(root));
    return { root, path };
  });
}

/**
 * The project's code link, or null when phax.json declares none. Refuses a link whose root is
 * missing, is not a repository's top level, or is tracked or not ignored by the process
 * repository, naming the phax.json that declares it.
 */
export function resolveCodeLink(
  config: ResolvedConfig,
): Effect.Effect<CodeLink | null, ConfigValidationError | GitError | FsError, Git | FileSystem> {
  const declared = config.code;
  if (declared === undefined) return Effect.succeed(null);
  return checkCodeRoot({
    repoRoot: config.repoRoot,
    root: declared.root,
    configPath: declared.configPath,
  });
}

/** The project's phax.json, nearest first from `startDir` up to `root`; null when there is none. */
export function findProjectConfig(
  startDir: string,
  root: string,
): Effect.Effect<string | null, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    for (const candidate of phaxConfigCandidates(startDir, root)) {
      if (yield* fs.exists(candidate)) return candidate;
    }
    return null;
  });
}

/** A phax.json as read for its `code` key alone: an object, or why it cannot be read as one. */
export type PhaxJsonObject =
  | { readonly kind: "object"; readonly raw: Readonly<Record<string, unknown>> }
  | { readonly kind: "unreadable"; readonly reason: string };

/** The phax.json at `configPath` parsed, without decoding any of its keys. */
export function readPhaxJsonObject(
  configPath: string,
): Effect.Effect<PhaxJsonObject, FsError, FileSystem> {
  return Effect.gen(function* () {
    const text = yield* (yield* FileSystem).readText(configPath);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return {
        kind: "unreadable",
        reason: `is not valid JSON (${e instanceof Error ? e.message : String(e)})`,
      } as const;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { kind: "unreadable", reason: "is not a JSON object" } as const;
    }
    return { kind: "object", raw: raw as Record<string, unknown> } as const;
  });
}

/**
 * The root a phax.json's `code` key declares, decoded alone: the rest of the file is not read.
 * A key that does not decode, or a root that is not canonical, refuses naming `configPath`.
 */
export function declaredCodeRoot(
  raw: Readonly<Record<string, unknown>>,
  configPath: string,
): Effect.Effect<string, ConfigValidationError> {
  const input = { code: raw["code"] };
  const decoded = decodeCodeLinkDeclaration(input);
  if (Result.isFailure(decoded)) {
    return Effect.fail(
      new ConfigValidationError({
        message: `Invalid code link in "${configPath}":\n${formatConfigParseError(input, decoded.failure)}`,
        path: configPath,
      }),
    );
  }
  const root = decoded.success.code.root;
  const problem = codeRootProblem(root);
  if (problem !== null) {
    return Effect.fail(
      new ConfigValidationError({ message: codeRootMessage(root, problem), path: configPath }),
    );
  }
  return Effect.succeed(root);
}

/**
 * The code link a transition records: only a plan's approval reads one, and it reads nothing
 * of the configuration but the `code` key of the project's phax.json (found from `cwd`, as
 * every command finds it), so no other config problem, in phax.json or an overlay, blocks an
 * approval. Null for every other transition, and when phax.json is absent or declares no
 * `code`. A phax.json phax cannot read as an object, a `code` key that does not decode, and a
 * declared root that fails its checks refuse: a project that may declare a link never gets a
 * plan approval recorded without its code baseline.
 */
export function resolveApprovalCodeLink(input: {
  readonly repoRoot: string;
  readonly cwd: string;
  readonly repoRelPath: string;
  readonly target: ArtifactStatus;
}): Effect.Effect<CodeLink | null, ConfigValidationError | GitError | FsError, Git | FileSystem> {
  const { repoRoot, cwd, repoRelPath, target } = input;
  if (target !== "Approved" || classifyArtifactPath(repoRelPath)?.kind !== "plan") {
    return Effect.succeed(null);
  }
  return Effect.gen(function* () {
    const configPath = yield* findProjectConfig(cwd, repoRoot);
    if (configPath === null) return null;
    const read = yield* readPhaxJsonObject(configPath);
    if (read.kind === "unreadable") {
      return yield* Effect.fail(
        new ConfigValidationError({
          message: `Cannot tell whether this project declares a code link: "${configPath}" ${read.reason}`,
          path: configPath,
        }),
      );
    }
    if (!Object.hasOwn(read.raw, "code")) return null;
    const root = yield* declaredCodeRoot(read.raw, configPath);
    return yield* checkCodeRoot({ repoRoot, root, configPath });
  });
}
