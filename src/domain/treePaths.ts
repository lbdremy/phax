import { Result } from "effect";
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * The paths a provider command (`phax brief`, `phax architecture`) was given,
 * resolved against the cwd and made relative to the working tree's root with
 * POSIX separators. Duplicates are dropped, keeping the first occurrence in
 * the order given; existence is never checked. A path outside the tree, or the
 * tree itself, is refused.
 */
export function resolveTreePaths(input: {
  readonly cwd: string;
  readonly root: string;
  readonly paths: readonly [string, ...string[]];
}): Result.Result<readonly [string, ...string[]], { readonly refused: string }> {
  const resolved: string[] = [];
  for (const arg of input.paths) {
    const rel = relative(input.root, resolve(input.cwd, arg));
    if (rel === "") return Result.fail({ refused: `${arg} is the working tree itself` });
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
      return Result.fail({ refused: `${arg} is outside the working tree` });
    }
    const posix = rel.split(sep).join("/");
    if (!resolved.includes(posix)) resolved.push(posix);
  }
  const [first, ...rest] = resolved;
  // The loop pushes at least once: `paths` is non-empty and every refusal returns.
  return Result.succeed([first as string, ...rest]);
}
