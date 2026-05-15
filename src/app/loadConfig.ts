import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { Either } from "effect";
import { ConfigValidationError } from "../domain/errors.js";
import {
  type ResolvedConfig,
  decodePhaxConfig,
  DEFAULT_EXTRACT_MODEL,
} from "../schemas/phaxConfig.js";
import { formatParseError } from "../schemas/formatError.js";

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

  const decoded = decodePhaxConfig(raw);
  if (Either.isLeft(decoded)) {
    return Either.left(
      new ConfigValidationError({
        message: `Invalid phax.json at "${configPath}":\n${formatParseError(decoded.left)}`,
        path: configPath,
      }),
    );
  }

  const config = decoded.right;

  const dupError = validateUniqueWorkspaceIds(config);
  if (dupError) return Either.left(dupError);

  const pathError = validateWorkspacePaths(config, gitRoot);
  if (pathError) return Either.left(pathError);

  const resolved: ResolvedConfig = {
    raw: config,
    stateRoot: expandTilde(config.state.root),
    repoRoot: gitRoot,
    editorCommand: config.editor?.command ?? "zed",
    backend: config.agent?.backend ?? "claude-code-cli",
    maxFixAttempts: config.agent?.maxFixAttempts ?? 1,
    extractPlanModel: config.agent?.extractPlan?.model ?? DEFAULT_EXTRACT_MODEL,
    extractPlanEffort: config.agent?.extractPlan?.effort ?? "low",
  };

  return Either.right(resolved);
}
