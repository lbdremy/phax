import { isAbsolute, normalize, resolve } from "node:path";

/**
 * The check phax runs on a phase worktree's `.git` before any git command
 * there (SEC-07): `.git` must be a regular file whose `gitdir:` line names the
 * git directory phax created, registered in the main checkout. Anything else
 * (another gitdir, a directory, a symbolic link, nothing) would let the agent
 * choose the repository config git reads, so it is refused. Pure: the caller
 * reads the entry and resolves paths.
 */

/** What sits at `<worktree>/.git`, as `lstat` sees it (no link followed). */
type GitEntryKind = "file" | "directory" | "symlink" | "other" | "absent";

/** The `.git` entry as the caller read it. */
export interface GitdirEntry {
  readonly kind: GitEntryKind;
  /** The file's text, for a regular file; null otherwise. */
  readonly text: string | null;
  /** Where a symbolic link points, for a symlink; null otherwise. */
  readonly linkTarget: string | null;
}

export type GitdirPointerVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** What `.git` holds, as the refusal's `.git holds:` line shows it. */
      readonly holds: string;
    };

const POINTER = /^gitdir: (.+)$/;

/**
 * The absolute, normalised path a `.git` pointer file names, or null when the
 * text is not one `gitdir: <path>` line (a trailing newline is tolerated). A
 * relative path is resolved against the worktree root, as git does for a
 * worktree written with `worktree.useRelativePaths`.
 */
export function parseGitdirPointer(text: string, worktreeRoot: string): string | null {
  const body = text.endsWith("\r\n")
    ? text.slice(0, -2)
    : text.endsWith("\n")
      ? text.slice(0, -1)
      : text;
  if (body.includes("\n") || body.includes("\0")) return null;
  const match = POINTER.exec(body);
  const path = match?.[1];
  if (path === undefined || path.trim() === "") return null;
  return isAbsolute(path) ? normalize(path) : resolve(worktreeRoot, path);
}

/** Strip a trailing separator so `/a/b/` and `/a/b` compare equal. */
function comparable(path: string): string {
  const normal = normalize(path);
  return normal.length > 1 && normal.endsWith("/") ? normal.slice(0, -1) : normal;
}

const MAX_SHOWN = 200;

/** The file's text on one line: control characters escaped, long text cut. */
function shown(text: string): string {
  const trimmed = text.replace(/\r?\n$/, "");
  let line = "";
  for (const char of trimmed) {
    const code = char.charCodeAt(0);
    line +=
      char === "\n"
        ? "\\n"
        : code < 0x20 || code === 0x7f
          ? `\\x${code.toString(16).padStart(2, "0")}`
          : char;
  }
  return line.length > MAX_SHOWN ? `${line.slice(0, MAX_SHOWN)}…` : line;
}

const ENTRY_DESCRIPTIONS: Readonly<Record<Exclude<GitEntryKind, "file" | "symlink">, string>> = {
  directory: "a directory",
  other: "a special file (not a regular file)",
  absent: "nothing (no .git entry)",
};

function describeEntry(entry: GitdirEntry): string {
  if (entry.kind === "file") {
    return entry.text === null || entry.text.length === 0 ? "an empty file" : shown(entry.text);
  }
  if (entry.kind === "symlink") {
    return entry.linkTarget === null
      ? "a symbolic link"
      : `a symbolic link to ${shown(entry.linkTarget)}`;
  }
  return ENTRY_DESCRIPTIONS[entry.kind];
}

/**
 * Whether the entry still names the expected git directory. `resolvedTarget`
 * is the path the pointer names, as the caller canonicalised it (the parsed
 * path, through its real path when it exists); `expectedGitdir` is canonical
 * the same way. Only a regular file whose pointer names exactly that
 * directory passes.
 */
export function gitdirPointerVerdict(input: {
  readonly entry: GitdirEntry;
  readonly resolvedTarget: string | null;
  readonly expectedGitdir: string;
}): GitdirPointerVerdict {
  const { entry, resolvedTarget, expectedGitdir } = input;
  if (
    entry.kind === "file" &&
    resolvedTarget !== null &&
    comparable(resolvedTarget) === comparable(expectedGitdir)
  ) {
    return { ok: true };
  }
  return { ok: false, holds: describeEntry(entry) };
}

/** The refusal's lines, naming the worktree's `.git`, what it holds and what was expected. */
export function renderGitdirPointerRefusal(input: {
  readonly dotGitPath: string;
  readonly holds: string;
  readonly expectedGitdir: string;
}): string {
  return [
    `${input.dotGitPath}: the worktree's .git no longer points at the git directory phax created`,
    `.git holds:  ${input.holds}`,
    `expected:    gitdir: ${input.expectedGitdir}`,
    "phax ran no git command in this worktree after the change.",
  ].join("\n");
}
