import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { Either } from "effect";
import { ConfigValidationError } from "../domain/errors.js";
import { decodeNamespace } from "../domain/branded.js";
import { mergeConfigLayers } from "../domain/config/mergeLayers.js";
import { findDuplicateCommand } from "../domain/gate/commandWords.js";
import { isPhaseWorktree } from "../domain/security/phaseGuard.js";
import { PHAX_CONTEXT_DIR } from "./worktree.js";
import {
  type ResolvedConfig,
  type PhaxUserOverlay,
  decodePhaxConfig,
  decodePhaxUserOverlay,
  DEFAULT_EXTRACT_MODEL,
  resolvePublishConfig,
  resolveComplianceReviewConfig,
  resolveCodeReviewConfig,
  resolveAuthoringConfig,
} from "../schemas/phaxConfig.js";
import { resolveSecurityConfig, DEFAULT_SECURITY_PROFILE } from "../schemas/securityConfig.js";
import { resolveRecordsConfig } from "../schemas/recordsConfig.js";
import { formatConfigParseError } from "../schemas/formatError.js";

const MISSING_NAME_MESSAGE = `PHAX project name is missing in phax.json. Add a name field, for example: name: "louloupapers".`;

function validateNameField(raw: unknown): ConfigValidationError | undefined {
  const obj = raw as Record<string, unknown>;
  const name = obj?.["name"];
  if (typeof name !== "string" || name === "") {
    return new ConfigValidationError({ message: MISSING_NAME_MESSAGE, path: "name" });
  }
  const result = decodeNamespace(name);
  if (Either.isLeft(result)) {
    return new ConfigValidationError({ message: MISSING_NAME_MESSAGE, path: "name" });
  }
  return undefined;
}

function findGitRoot(startDir: string): string | undefined {
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

function findPhaxConfig(startDir: string, gitRoot: string): string | undefined {
  let current = startDir;
  while (true) {
    const candidate = join(current, "phax.json");
    if (existsSync(candidate)) return candidate;
    if (current === gitRoot) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function expandTilde(p: string): string {
  if (p === "~" || p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

function validateWorkspacePaths(
  config: ReturnType<typeof decodePhaxConfig> extends Either.Either<infer A, infer _> ? A : never,
  gitRoot: string,
): ConfigValidationError | undefined {
  if (!config.workspaces) return undefined;
  for (const ws of config.workspaces) {
    const absPath = resolve(gitRoot, ws.path);
    if (!absPath.startsWith(gitRoot + "/") && absPath !== gitRoot) {
      return new ConfigValidationError({
        message: `Workspace path "${ws.path}" for workspace "${ws.id}" must be inside the repository root "${gitRoot}"`,
        path: `workspaces[${ws.id}].path`,
      });
    }
  }
  return undefined;
}

function validateUniqueWorkspaceIds(
  config: ReturnType<typeof decodePhaxConfig> extends Either.Either<infer A, infer _> ? A : never,
): ConfigValidationError | undefined {
  if (!config.workspaces || config.workspaces.length === 0) return undefined;
  const ids = config.workspaces.map((ws) => ws.id);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      return new ConfigValidationError({
        message: `Duplicate workspace id "${id}"`,
        path: "workspaces[].id",
      });
    }
    seen.add(id);
  }
  return undefined;
}

// `still failing` matches a step by its command in the previous attempt, so
// a profile may list each command once (top-level and workspace profiles).
function validateUniqueGateCommands(
  config: ReturnType<typeof decodePhaxConfig> extends Either.Either<infer A, infer _> ? A : never,
): ConfigValidationError | undefined {
  const profileSets: { readonly prefix: string; readonly profiles: typeof config.gateProfiles }[] =
    [
      { prefix: "gateProfiles", profiles: config.gateProfiles },
      ...(config.workspaces ?? []).flatMap((ws) =>
        ws.gateProfiles
          ? [{ prefix: `workspaces[${ws.id}].gateProfiles`, profiles: ws.gateProfiles }]
          : [],
      ),
    ];
  for (const { prefix, profiles } of profileSets) {
    for (const [profile, steps] of Object.entries(profiles)) {
      const duplicate = findDuplicateCommand(steps);
      if (duplicate) {
        const path = `${prefix}.${profile}`;
        return new ConfigValidationError({
          message: `${path} lists the command "${duplicate.command}" twice (steps ${duplicate.first} and ${duplicate.second})`,
          path,
        });
      }
    }
  }
  return undefined;
}

function localUserConfigPath(projectConfigPath: string): string {
  return join(dirname(projectConfigPath), "phax.local.json");
}

function readUserOverlay(
  filePath: string,
): Either.Either<PhaxUserOverlay | undefined, ConfigValidationError> {
  if (!existsSync(filePath)) {
    return Either.right(undefined);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    return Either.left(
      new ConfigValidationError({
        message: `Failed to read or parse "${filePath}": ${String(err)}`,
        path: filePath,
      }),
    );
  }
  const decoded = decodePhaxUserOverlay(raw);
  if (Either.isLeft(decoded)) {
    return Either.left(
      new ConfigValidationError({
        message: `Invalid user config at "${filePath}":\n${formatConfigParseError(raw, decoded.left)}`,
        path: filePath,
      }),
    );
  }
  return Either.right(decoded.right);
}

export interface ConfigSources {
  readonly project: string;
  readonly localOverlay: string | undefined;
  readonly globalOverlay: string | undefined;
}

/**
 * Reports which config files loadConfig would read for a cwd, reusing the same
 * discovery helpers and existence rules. Returns undefined when no git root or
 * no phax.json is found (the same two conditions under which loadConfig returns Left).
 */
export function describeConfigSources(cwd: string = process.cwd()): ConfigSources | undefined {
  const gitRoot = findGitRoot(cwd);
  if (!gitRoot) return undefined;
  const configPath = findPhaxConfig(cwd, gitRoot);
  if (!configPath) return undefined;
  const localPath = localUserConfigPath(configPath);
  const globalPath = join(homedir(), ".phax", "config.json");
  return {
    project: configPath,
    localOverlay: existsSync(localPath) ? localPath : undefined,
    globalOverlay: existsSync(globalPath) ? globalPath : undefined,
  };
}

function findGitDir(startDir: string, flag: "--git-dir" | "--git-common-dir"): string | undefined {
  try {
    const dir = execSync(`git rev-parse --path-format=absolute ${flag}`, {
      cwd: startDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return dir.length > 0 ? dir : undefined;
  } catch {
    return undefined;
  }
}

export interface WorkingTreeLocation {
  /** The root of the working tree holding the cwd (a linked worktree's own root). */
  readonly root: string;
  /** The repository's main checkout: the parent of git's common dir. */
  readonly mainRoot: string;
  /** True in a linked worktree: its git dir differs from the common dir. */
  readonly isLinkedWorktree: boolean;
}

/**
 * Locates the working tree holding `cwd` and the repository's main checkout,
 * found through git's common dir. In the main checkout both are the same
 * root. `mainRoot` falls back to `root` when the common dir is not a `.git`
 * folder (a bare repository's worktree). Undefined outside any working tree.
 */
export function locateWorkingTree(cwd: string): WorkingTreeLocation | undefined {
  const root = findGitRoot(cwd);
  if (!root) return undefined;
  const commonDir = findGitDir(cwd, "--git-common-dir");
  const gitDir = findGitDir(cwd, "--git-dir");
  const mainRoot =
    commonDir !== undefined && basename(commonDir) === ".git" ? dirname(commonDir) : root;
  const isLinkedWorktree = commonDir !== undefined && gitDir !== undefined && gitDir !== commonDir;
  return { root, mainRoot, isLinkedWorktree };
}

/**
 * Whether `cwd` is inside a phase worktree (the phase guard's detection rule):
 * a linked worktree whose root holds `.phax-context/`.
 */
export function isInPhaseWorktree(cwd: string): boolean {
  const tree = locateWorkingTree(cwd);
  if (tree === undefined) return false;
  return isPhaseWorktree({
    isLinkedWorktree: tree.isLinkedWorktree,
    hasPhaxContext: existsSync(join(tree.root, PHAX_CONTEXT_DIR)),
  });
}

export function locatePhaxConfig(cwd: string): string | undefined {
  const gitRoot = findGitRoot(cwd);
  if (!gitRoot) return undefined;
  return findPhaxConfig(cwd, gitRoot);
}

export type LoadConfigError = ConfigValidationError;

export function loadConfig(
  cwd: string = process.cwd(),
): Either.Either<ResolvedConfig, LoadConfigError> {
  const gitRoot = findGitRoot(cwd);
  if (!gitRoot) {
    return Either.left(
      new ConfigValidationError({
        message: "Not inside a git repository",
      }),
    );
  }

  const configPath = findPhaxConfig(cwd, gitRoot);
  if (!configPath) {
    return Either.left(
      new ConfigValidationError({
        message: `Could not find phax.json starting from "${cwd}" up to git root "${gitRoot}"`,
      }),
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    return Either.left(
      new ConfigValidationError({
        message: `Failed to read or parse "${configPath}": ${String(err)}`,
        path: configPath,
      }),
    );
  }

  const nameError = validateNameField(raw);
  if (nameError) return Either.left(nameError);

  const decoded = decodePhaxConfig(raw);
  if (Either.isLeft(decoded)) {
    return Either.left(
      new ConfigValidationError({
        message: `Invalid phax.json at "${configPath}":\n${formatConfigParseError(raw, decoded.left)}`,
        path: configPath,
      }),
    );
  }

  const projectConfig = decoded.right;

  const globalUserPath = join(homedir(), ".phax", "config.json");
  const globalUserResult = readUserOverlay(globalUserPath);
  if (Either.isLeft(globalUserResult)) return Either.left(globalUserResult.left);
  const globalUser = globalUserResult.right;

  const localUserPath = localUserConfigPath(configPath);
  const localUserResult = readUserOverlay(localUserPath);
  if (Either.isLeft(localUserResult)) return Either.left(localUserResult.left);
  const localUser = localUserResult.right;

  const config = mergeConfigLayers({
    project: projectConfig,
    ...(globalUser !== undefined ? { globalUser } : {}),
    ...(localUser !== undefined ? { localUser } : {}),
  });

  const dupError = validateUniqueWorkspaceIds(config);
  if (dupError) return Either.left(dupError);

  const gateCommandError = validateUniqueGateCommands(config);
  if (gateCommandError) return Either.left(gateCommandError);

  const pathError = validateWorkspacePaths(config, gitRoot);
  if (pathError) return Either.left(pathError);

  const root: string = gitRoot;
  function resolvePathList(paths: readonly string[] | undefined): readonly string[] {
    if (!paths || paths.length === 0) return [];
    return paths.map((p) => resolve(root, expandTilde(p)));
  }

  const rawSecurity = config.security;
  const resolvedSecurity = resolveSecurityConfig(
    rawSecurity
      ? {
          ...rawSecurity,
          filesystem: rawSecurity.filesystem
            ? {
                allowRead: resolvePathList(rawSecurity.filesystem.allowRead),
                allowWrite: resolvePathList(rawSecurity.filesystem.allowWrite),
              }
            : undefined,
        }
      : undefined,
    DEFAULT_SECURITY_PROFILE,
  );

  const resolved: ResolvedConfig = {
    raw: config,
    namespace: config.name,
    stateRoot: expandTilde(config.state?.root ?? "~/.phax"),
    repoRoot: gitRoot,
    maxFixAttempts: config.agent?.maxFixAttempts ?? 1,
    extractPlanModel: config.agent?.extractPlan?.model ?? DEFAULT_EXTRACT_MODEL,
    extractPlanEffort: config.agent?.extractPlan?.effort ?? "low",
    fileReconciliationMode: config.fileReconciliation?.mode ?? "report_only",
    security: resolvedSecurity,
    publish: resolvePublishConfig(config.publish),
    ...(config.brief !== undefined ? { brief: config.brief } : {}),
    ...(config.planAuditor !== undefined ? { planAuditor: config.planAuditor } : {}),
    complianceReview: resolveComplianceReviewConfig(config.review?.compliance),
    codeReview: resolveCodeReviewConfig(config.review?.code),
    authoring: resolveAuthoringConfig(config.authoring),
    records: resolveRecordsConfig(config.records),
  };

  return Either.right(resolved);
}
