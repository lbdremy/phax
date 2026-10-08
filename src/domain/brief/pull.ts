import { Either } from "effect";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Where pulled brief records wait in a phase worktree, relative to its root. */
export const PULLED_BRIEFS_DIR = ".phax-context/briefs";

/**
 * The marker, inside `PULLED_BRIEFS_DIR`, saying the phase's briefs are
 * collected: a pull that finds it is answered and not recorded (spec Q7).
 */
export const BRIEFS_CLOSED_MARKER = "closed";

const PULLED_BRIEF_NAME = /^brief-(\d{2,})\.json$/;

/**
 * The paths `phax brief` was given, resolved against the cwd and made
 * relative to the working tree's root with POSIX separators. Duplicates are
 * dropped, keeping the first occurrence in the order given; existence is never
 * checked. A path outside the tree, or the tree itself, is refused.
 */
export function resolveBriefPaths(input: {
  readonly cwd: string;
  readonly root: string;
  readonly paths: readonly [string, ...string[]];
}): Either.Either<readonly [string, ...string[]], { readonly refused: string }> {
  const resolved: string[] = [];
  for (const arg of input.paths) {
    const rel = relative(input.root, resolve(input.cwd, arg));
    if (rel === "") return Either.left({ refused: `${arg} is the working tree itself` });
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
      return Either.left({ refused: `${arg} is outside the working tree` });
    }
    const posix = rel.split(sep).join("/");
    if (!resolved.includes(posix)) resolved.push(posix);
  }
  const [first, ...rest] = resolved;
  // The loop pushes at least once: `paths` is non-empty and every refusal returns.
  return Either.right([first as string, ...rest]);
}

/**
 * The name of the next pulled brief record: one past the highest `brief-NN.json`
 * among `existing` (two or more digits), at least `brief-01.json`.
 */
export function nextPulledBriefName(existing: readonly string[]): string {
  let highest = 0;
  for (const name of existing) {
    const match = PULLED_BRIEF_NAME.exec(name);
    if (match?.[1] !== undefined) highest = Math.max(highest, Number(match[1]));
  }
  return `brief-${String(highest + 1).padStart(2, "0")}.json`;
}
