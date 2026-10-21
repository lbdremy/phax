/**
 * phax's glob matcher: exactly the dialect the `architecture-report` schema
 * documents (ArchitectureGlobSchema checks its syntax). Pure, matched by hand
 * with no RegExp, case-sensitive and the same on every host.
 *
 * A path is a working-tree-root-relative POSIX path, matched segment by
 * segment on `/`. `**` as a whole segment matches zero or more segments; `*`
 * matches zero or more characters within a segment; `?` matches exactly one
 * character other than `/`. Every other character is literal, `[`, `]`, `!`
 * and `.` included, and a leading dot is not special.
 */

/** True when `path` matches `glob`. */
export function matchesGlob(glob: string, path: string): boolean {
  // Consecutive `**` segments match what one does; collapsing them keeps the
  // search below linear in the number of `**` runs.
  const globs = glob.split("/").filter((g, i, all) => g !== "**" || all[i - 1] !== "**");
  const segments = path.split("/");
  // failed[gi][si]: globs from gi cannot match segments from si. Each pair is
  // tried once, so a glob of many `**` against a deep path stays polynomial.
  const failed = globs.map(() => Array.from({ length: segments.length + 1 }, () => false));
  const matchFrom = (gi: number, si: number): boolean => {
    if (gi === globs.length) return si === segments.length;
    if (failed[gi]![si]!) return false;
    const g = globs[gi]!;
    const matched =
      g === "**"
        ? // Zero or more whole segments.
          Array.from({ length: segments.length - si + 1 }, (_, n) => si + n).some((skip) =>
            matchFrom(gi + 1, skip),
          )
        : si < segments.length && matchSegment(g, segments[si]!) && matchFrom(gi + 1, si + 1);
    if (!matched) failed[gi]![si] = true;
    return matched;
  };
  return matchFrom(0, 0);
}

/** True when any of `paths` matches any of `globs`. */
export function matchesAnyGlob(globs: readonly string[], paths: readonly string[]): boolean {
  return paths.some((path) => globs.some((glob) => matchesGlob(glob, path)));
}

// One segment, by code point: `*` any run of characters, `?` one character.
// Iterative, backtracking only to the last `*`, so it is linear-times-length
// rather than exponential in the number of stars.
function matchSegment(globSegment: string, textSegment: string): boolean {
  const glob = [...globSegment];
  const text = [...textSegment];
  let gi = 0;
  let ti = 0;
  let star = -1;
  let resume = 0;
  while (ti < text.length) {
    const char = glob[gi];
    if (char === "*") {
      star = gi++;
      resume = ti;
    } else if (char !== undefined && (char === "?" || char === text[ti])) {
      gi++;
      ti++;
    } else if (star !== -1) {
      gi = star + 1;
      ti = ++resume;
    } else {
      return false;
    }
  }
  while (glob[gi] === "*") gi++;
  return gi === glob.length;
}
