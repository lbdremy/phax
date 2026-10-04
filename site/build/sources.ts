// The docs site's sources: which repository files it renders, and README.md
// split into its intro and `##` sections, each keeping its offset and line in
// README.md so that messages name the real file's line.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { INTRO } from "./pageMap.js";
import { parseMarkdown, plainText } from "./markdown.js";

export const README = "README.md";

/** Single files the site renders besides README.md. */
const SOURCE_FILES = [
  "CONTRIBUTING.md",
  "docs/cli/reference.md",
  "docs/security.md",
  "docs/release.md",
  "docs/model-catalog.md",
] as const;

/** Directories whose `*.md` files (not recursive) the site renders. */
const SOURCE_DIRECTORIES = ["docs/blog", "docs/comparisons"] as const;

/** Every source path present under `repoRoot`, README.md included, sorted. */
export function listSources(repoRoot: string): ReadonlyArray<string> {
  const paths: Array<string> = [README, ...SOURCE_FILES].filter((path) =>
    existsSync(join(repoRoot, path)),
  );
  for (const directory of SOURCE_DIRECTORIES) {
    const absolute = join(repoRoot, directory);
    if (!existsSync(absolute)) continue;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) paths.push(`${directory}/${entry.name}`);
    }
  }
  return paths.toSorted();
}

/** Every source's text, keyed by repository-relative path, with `\n` line endings. */
export function readSources(repoRoot: string): ReadonlyMap<string, string> {
  return new Map(
    listSources(repoRoot).map((path) => [
      path,
      readFileSync(join(repoRoot, path), "utf8").replaceAll("\r\n", "\n"),
    ]),
  );
}

export interface ReadmeSection {
  /** The heading's plain text, or `(intro)` for the text before the first `##`. */
  readonly name: string;
  /** Offset of the section's first character in README.md. */
  readonly start: number;
  /** Offset one past the section's last character in README.md. */
  readonly end: number;
  /** 1-based line of the section's first character in README.md. */
  readonly line: number;
}

/**
 * README.md's intro and its top-level `##` sections, in document order. A
 * `##` inside a fenced code block, a list or a quote is not a section.
 */
export function splitReadme(text: string): ReadonlyArray<ReadmeSection> {
  const starts = parseMarkdown(text)
    .children.filter((node) => node.type === "heading" && node.depth === 2)
    .map((node) => ({
      name: plainText(node),
      start: node.position?.start.offset ?? 0,
      line: node.position?.start.line ?? 1,
    }));
  const bounds = [{ name: INTRO, start: 0, line: 1 }, ...starts];
  return bounds.map((bound, index) => ({
    ...bound,
    end: bounds[index + 1]?.start ?? text.length,
  }));
}
