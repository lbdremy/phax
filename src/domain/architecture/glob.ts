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
  return matchSegments(glob.split("/"), 0, path.split("/"), 0);
}

/** True when any of `paths` matches any of `globs`. */
export function matchesAnyGlob(globs: readonly string[], paths: readonly string[]): boolean {
  return paths.some((path) => globs.some((glob) => matchesGlob(glob, path)));
}

function matchSegments(
  globs: readonly string[],
  gi: number,
  segments: readonly string[],
  si: number,
): boolean {
  if (gi === globs.length) return si === segments.length;
  const glob = globs[gi]!;
  if (glob === "**") {
    // Zero or more whole segments.
    for (let skip = si; skip <= segments.length; skip++) {
      if (matchSegments(globs, gi + 1, segments, skip)) return true;
    }
    return false;
  }
  if (si === segments.length) return false;
  return (
    matchSegment([...glob], 0, [...segments[si]!], 0) &&
    matchSegments(globs, gi + 1, segments, si + 1)
  );
}

// One segment, by code point: `*` any run of characters, `?` one character.
function matchSegment(
  glob: readonly string[],
  gi: number,
  text: readonly string[],
  ti: number,
): boolean {
  if (gi === glob.length) return ti === text.length;
  const char = glob[gi]!;
  if (char === "*") {
    for (let skip = ti; skip <= text.length; skip++) {
      if (matchSegment(glob, gi + 1, text, skip)) return true;
    }
    return false;
  }
  if (ti === text.length) return false;
  if (char !== "?" && char !== text[ti]) return false;
  return matchSegment(glob, gi + 1, text, ti + 1);
}
