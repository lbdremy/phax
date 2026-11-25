import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
  gitdirPointerVerdict,
  parseGitdirPointer,
  renderGitdirPointerRefusal,
  type GitdirEntry,
} from "../domain/security/gitdirPointer.js";

/**
 * The settings every git call in a phase worktree carries on its command line,
 * so neither a hook nor an fsmonitor command the agent planted runs (SEC-06,
 * SEC-07). Command-line config wins over every config file.
 */
export const WORKTREE_HARDENING_ARGS: readonly string[] = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
];

/** A linked worktree registered in the main checkout's common git directory. */
interface Registration {
  /** The worktree's root, as its real path. */
  readonly root: string;
  /** The gitdir its `.git` must name: `<common>/worktrees/<name>`, as registered. */
  readonly gitdir: string;
}

/** What the guard decides for one git call. */
type GuardDecision =
  | { readonly kind: "plain" }
  | { readonly kind: "hardened" }
  | { readonly kind: "refused"; readonly message: string };

export interface WorktreeGuard {
  /**
   * Whether a git call run in `cwd` is a phase-worktree call (hardened, once
   * its pointer is checked), a call elsewhere (plain), or refused because the
   * worktree's `.git` no longer names its registered gitdir.
   */
  readonly decide: (cwd: string) => Promise<GuardDecision>;
  /** Forget the registrations, so the next call reads them again. */
  readonly invalidate: () => void;
}

/** Runs `git <args>` in `cwd`, unguarded, and answers its stdout. */
export type PlainGitRunner = (args: readonly string[], cwd: string) => Promise<string>;

async function realpathOr(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

async function readRegistrations(common: string): Promise<readonly Registration[]> {
  const worktreesDir = join(common, "worktrees");
  let names: string[];
  try {
    names = await readdir(worktreesDir);
  } catch {
    return [];
  }
  const found: Registration[] = [];
  for (const name of names) {
    const adminDir = join(worktreesDir, name);
    let text: string;
    try {
      text = await readFile(join(adminDir, "gitdir"), "utf8");
    } catch {
      continue;
    }
    const line = text.replace(/\r?\n$/, "");
    if (line === "") continue;
    // `<worktree>/.git`, absolute, or relative to the admin directory.
    const dotGit = isAbsolute(line) ? line : resolve(adminDir, line);
    found.push({ root: await realpathOr(dirname(dotGit)), gitdir: adminDir });
  }
  return found;
}

async function readEntry(dotGit: string): Promise<GitdirEntry> {
  let stat;
  try {
    stat = await lstat(dotGit);
  } catch {
    return { kind: "absent", text: null, linkTarget: null };
  }
  if (stat.isSymbolicLink()) {
    const target = await readlink(dotGit).catch(() => null);
    return { kind: "symlink", text: null, linkTarget: target };
  }
  if (stat.isDirectory()) return { kind: "directory", text: null, linkTarget: null };
  if (!stat.isFile()) return { kind: "other", text: null, linkTarget: null };
  const text = await readFile(dotGit, "utf8");
  return { kind: "file", text, linkTarget: null };
}

/**
 * The guard of a git layer rooted at the main checkout `repoRoot`. The common
 * git directory is resolved once, in the main checkout and never in a
 * worktree; its `worktrees/<name>/gitdir` registrations are cached and read
 * again when a cwd is in none of them, or after `invalidate`. A call is a
 * phase-worktree call when its cwd's real path lies in a registered worktree
 * other than the main checkout itself (the innermost one when they nest).
 */
export function makeWorktreeGuard(repoRoot: string, runGit: PlainGitRunner): WorktreeGuard {
  let mainRoot: string | null = null;
  let common: string | null = null;
  let registrations: readonly Registration[] | null = null;

  // A failure is not cached: the next call asks again.
  const loadRegistrations = async (): Promise<readonly Registration[]> => {
    if (registrations !== null) return registrations;
    common ??= await realpathOr(
      (await runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], repoRoot)).trim(),
    );
    registrations = await readRegistrations(common);
    return registrations;
  };

  const find = (
    all: readonly Registration[],
    cwd: string,
    main: string,
  ): Registration | undefined =>
    all
      .filter((reg) => reg.root !== main && isInside(cwd, reg.root))
      .toSorted((a, b) => b.root.length - a.root.length)[0];

  return {
    invalidate: () => {
      registrations = null;
    },
    decide: async (cwd) => {
      mainRoot ??= await realpathOr(repoRoot);
      const main = mainRoot;
      const real = await realpathOr(cwd);
      let match = find(await loadRegistrations(), real, main);
      if (match === undefined) {
        registrations = null;
        match = find(await loadRegistrations(), real, main);
      }
      if (match === undefined) return { kind: "plain" };

      const dotGit = join(match.root, ".git");
      const entry = await readEntry(dotGit);
      const parsed =
        entry.kind === "file" && entry.text !== null
          ? parseGitdirPointer(entry.text, match.root)
          : null;
      const verdict = gitdirPointerVerdict({
        entry,
        resolvedTarget: parsed === null ? null : await realpathOr(parsed),
        expectedGitdir: await realpathOr(match.gitdir),
      });
      if (verdict.ok) return { kind: "hardened" };
      return {
        kind: "refused",
        message: renderGitdirPointerRefusal({
          dotGitPath: dotGit,
          holds: verdict.holds,
          expectedGitdir: match.gitdir,
        }),
      };
    },
  };
}
