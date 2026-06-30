import * as path from "node:path";

/**
 * Repo-relative directory prefixes that Claude Code treats as protected and
 * that phax may offer to approve via a scoped PreToolUse hook.
 *
 * Claude Code additionally protects `.git/`, `.vscode/`, `.idea/`, and other
 * paths; those are intentionally out of scope here. This constant governs only
 * what phax is willing to grant a hook approval for.
 *
 * `.claude/worktrees/` is writable under acceptEdits and is excluded by
 * `isProtectedPath`.
 */
export const CLAUDE_PROTECTED_PREFIXES: readonly string[] = [".claude/"];

const CLAUDE_PROTECTED_EXCLUSIONS: readonly string[] = [".claude/worktrees/"];

const APPROVABLE_TOOL_NAMES = new Set(["Edit", "Write", "MultiEdit"]);

function normalizeRepoRelative(input: string): string {
  const stripped = input.replace(/\\/g, "/").replace(/^\.\/+/, "");
  const normalized = path.posix.normalize(stripped);
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

function prefixCovers(prefix: string, candidate: string): boolean {
  const normalizedPrefix = normalizeRepoRelative(prefix);
  const bare = normalizedPrefix.endsWith("/") ? normalizedPrefix.slice(0, -1) : normalizedPrefix;
  if (!bare) return false;
  if (candidate === bare) return true;
  return candidate.startsWith(bare + "/");
}

export function isProtectedPath(repoRelativePosixPath: string): boolean {
  const normalized = normalizeRepoRelative(repoRelativePosixPath);
  if (!normalized || normalized.startsWith("../") || normalized === "..") {
    return false;
  }
  for (const exclusion of CLAUDE_PROTECTED_EXCLUSIONS) {
    if (prefixCovers(exclusion, normalized)) return false;
  }
  for (const prefix of CLAUDE_PROTECTED_PREFIXES) {
    if (prefixCovers(prefix, normalized)) return true;
  }
  return false;
}

export interface ResolveProtectedApprovalsInput {
  readonly plannedPaths: readonly string[];
  readonly allowWriteProtected: readonly string[];
  readonly worktreeRoot: string;
}

export interface ResolveProtectedApprovalsResult {
  readonly approved: readonly string[];
  readonly uncovered: readonly string[];
}

function toAbsolutePosix(worktreeRoot: string, repoRelative: string): string {
  const normalizedRoot = worktreeRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const joined = `${normalizedRoot}/${repoRelative}`;
  return path.posix.normalize(joined);
}

/**
 * Partition a phase's declared planned paths into protected paths that the
 * operator's `allowWriteProtected` prefixes cover (returned as absolute POSIX
 * paths) and protected paths that fall outside any configured prefix. Both
 * outputs deduplicate while preserving input order.
 *
 * Non-protected paths are ignored entirely.
 */
export function resolveProtectedApprovals(
  input: ResolveProtectedApprovalsInput,
): ResolveProtectedApprovalsResult {
  const approved: string[] = [];
  const uncovered: string[] = [];
  const seenApproved = new Set<string>();
  const seenUncovered = new Set<string>();

  for (const raw of input.plannedPaths) {
    const normalized = normalizeRepoRelative(raw);
    if (!normalized || !isProtectedPath(normalized)) continue;

    const covered = input.allowWriteProtected.some((prefix) => prefixCovers(prefix, normalized));

    if (covered) {
      const absolute = toAbsolutePosix(input.worktreeRoot, normalized);
      if (!seenApproved.has(absolute)) {
        seenApproved.add(absolute);
        approved.push(absolute);
      }
    } else {
      if (!seenUncovered.has(normalized)) {
        seenUncovered.add(normalized);
        uncovered.push(normalized);
      }
    }
  }

  return { approved, uncovered };
}

export interface DecideProtectedPathApprovalInput {
  readonly approvedAbsolutePaths: readonly string[];
  readonly toolName: string;
  readonly filePath: string | undefined;
}

/**
 * Runtime decision for a single Claude Code PreToolUse invocation. Returns
 * `"allow"` only when the tool is one of Edit/Write/MultiEdit and the
 * resolved absolute `filePath` exactly matches an approved path. Otherwise
 * `"defer"` — the hook emits nothing and Claude's normal protected-path
 * handling applies.
 */
export function decideProtectedPathApproval(
  input: DecideProtectedPathApprovalInput,
): "allow" | "defer" {
  if (!APPROVABLE_TOOL_NAMES.has(input.toolName)) return "defer";
  if (!input.filePath) return "defer";

  const normalized = path.posix.normalize(input.filePath.replace(/\\/g, "/"));
  if (!path.posix.isAbsolute(normalized)) return "defer";

  for (const approved of input.approvedAbsolutePaths) {
    const normalizedApproved = path.posix.normalize(approved.replace(/\\/g, "/"));
    if (normalizedApproved === normalized) return "allow";
  }
  return "defer";
}
