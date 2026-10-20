import { Either } from "effect";
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
