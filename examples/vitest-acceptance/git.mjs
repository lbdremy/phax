// Files at a commit and in the working tree. git is always called with an
// argument array, never a shell string, in the gated worktree.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Whether `sha` names a commit of the repository in `cwd`. */
export function commitExists(cwd, sha) {
  try {
    git(cwd, ["cat-file", "-e", `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** The text of `path` at commit `sha`, or null when the commit has no such file. */
export function fileAt(cwd, sha, path) {
  try {
    git(cwd, ["cat-file", "-e", `${sha}:${path}`]);
  } catch {
    return null;
  }
  return git(cwd, ["cat-file", "blob", `${sha}:${path}`]);
}

/** The text of `path` in the working tree, or null when there is no such file. */
export function fileNow(cwd, path) {
  try {
    return readFileSync(join(cwd, path), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") return null;
    throw error;
  }
}
