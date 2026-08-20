import type { GitTreeEntry } from "../ports/git.js";

export function isPortcelainClean(output: string): boolean {
  return output.trim() === "";
}

// `git ls-tree -r -z` emits one NUL-terminated record per blob:
// "<mode> SP <type> SP <oid> TAB <path>". The `-z` form leaves paths raw
// (no C-quoting), so the byte after the tab through the NUL is the exact path.
export function parseLsTreeZ(output: string): readonly GitTreeEntry[] {
  const entries: GitTreeEntry[] = [];
  for (const record of output.split("\0")) {
    if (record.length === 0) continue;
    const tabIndex = record.indexOf("\t");
    if (tabIndex === -1) continue;
    const meta = record.slice(0, tabIndex).split(" ");
    const [mode, type, oid] = meta;
    if (mode === undefined || type === undefined || oid === undefined) continue;
    entries.push({
      mode,
      type: type === "tree" ? "tree" : "blob",
      oid,
      path: record.slice(tabIndex + 1),
    });
  }
  return entries;
}

export function parseBranchOutput(output: string): string {
  return output.trim();
}

export function parseBranchExistsOutput(output: string): boolean {
  return output.trim().length > 0;
}

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;

export function parseHeadCommitOutput(output: string): string | null {
  const trimmed = output.trim();
  return FULL_SHA_PATTERN.test(trimmed) ? trimmed : null;
}

export function parseChangedFilesOutput(output: string): readonly string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// A path git deems "unusual" (contains a double-quote, backslash, or control
// character) is emitted wrapped in double quotes with those bytes C-escaped.
// We run `status` with core.quotePath=false so non-ASCII bytes stay raw, leaving
// only `\"` and `\\` to unescape here.
function unquoteGitPath(token: string): string {
  if (token.length < 2 || !token.startsWith('"') || !token.endsWith('"')) return token;
  return token.slice(1, -1).replace(/\\(.)/g, "$1");
}

// `git status --porcelain` lines are "XY PATH" (untracked: "?? PATH"), or for
// renames "R  OLD -> NEW" — both the old and new side count as dirty.
export function parseDirtyPaths(output: string): readonly string[] {
  const paths: string[] = [];
  for (const line of output.split("\n")) {
    if (line.length === 0) continue;
    const rest = line.slice(3);
    const arrowIndex = rest.indexOf(" -> ");
    if (arrowIndex === -1) {
      paths.push(unquoteGitPath(rest));
    } else {
      paths.push(
        unquoteGitPath(rest.slice(0, arrowIndex)),
        unquoteGitPath(rest.slice(arrowIndex + 4)),
      );
    }
  }
  return paths;
}
