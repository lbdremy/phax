// The README the @lbdremy/phax npm package ships: the repository's README.md
// with every relative link made absolute on GitHub at the release tag, since
// the files it links to are not in the package. Pure, and free of Deno APIs so
// the Node test suite can unit-test it (npmReadme.test.ts);
// scripts/prepare-npm.ts is the Deno entry point that writes it.

const REPOSITORY = "https://github.com/lbdremy/phax";

/** An inline link or image target: `](target)` or `](target "title")`. */
const INLINE_TARGET = /\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g;

/** Absolute URLs, in-page anchors and other schemes (`mailto:`) stay as written. */
const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

function absolute(target: string, tag: string): string {
  if (ABSOLUTE.test(target)) return target;
  const path = target.replace(/^\.\//, "");
  const kind = path.split("#")[0]!.endsWith("/") ? "tree" : "blob";
  return `${REPOSITORY}/${kind}/${tag}/${path}`;
}

/** `readme` with its relative link targets outside fenced code made absolute at `tag`. */
export function npmReadme(readme: string, tag: string): string {
  let fence: string | undefined;
  return readme
    .split("\n")
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker !== undefined) {
        if (fence === undefined) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
        return line;
      }
      if (fence !== undefined) return line;
      return line.replace(
        INLINE_TARGET,
        (_match, target: string, title: string) => `](${absolute(target, tag)}${title})`,
      );
    })
    .join("\n");
}
